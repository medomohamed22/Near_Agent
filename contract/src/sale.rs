use crate::*;

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum SaleStatus {
    /// Offered; no money held.
    Listed,
    /// The buyer's payment is held by the contract.
    Funded,
    /// The seller says the car was handed over; waiting for the buyer.
    HandedOver,
    /// Payment released to the seller.
    Completed,
    /// Withdrawn before anyone paid.
    Cancelled,
    /// Payment returned to the buyer.
    Refunded,
    /// Payment frozen until the admin reviews the dispute.
    Disputed,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Sale {
    pub id: u64,
    pub vehicle_id: u64,
    pub seller: AccountId,
    pub buyer: Option<AccountId>,
    /// Testnet NEAR. It has no monetary value.
    pub price: NearToken,
    pub status: SaleStatus,
    /// When the current stage times out, in ms since epoch; 0 when no clock runs.
    pub deadline_ms: u64,
    pub dispute_hash: Option<String>,
    pub dispute_opened_by: Option<AccountId>,
    pub created_at_ms: u64,
    pub updated_at_ms: u64,
}

#[near]
impl Contract {
    pub fn list_for_sale(&mut self, vehicle_id: u64, price: NearToken) -> u64 {
        let seller = env::predecessor_account_id();
        let mut vehicle = self.vehicle(vehicle_id);
        require!(seller == vehicle.owner, "only the passport holder can list the car");
        require!(vehicle.active_sale.is_none(), "this car already has an open sale");
        require!(!price.is_zero(), "price must be greater than zero");

        let id = self.next_sale_id;
        self.next_sale_id += 1;
        let now = env::block_timestamp_ms();
        self.sales.insert(
            id,
            Sale {
                id,
                vehicle_id,
                seller: seller.clone(),
                buyer: None,
                price,
                status: SaleStatus::Listed,
                deadline_ms: 0,
                dispute_hash: None,
                dispute_opened_by: None,
                created_at_ms: now,
                updated_at_ms: now,
            },
        );
        vehicle.active_sale = Some(id);
        self.vehicles.insert(vehicle_id, vehicle);
        emit("sale_listed", &format!(r#"{{"sale_id":{id},"vehicle_id":{vehicle_id},"seller":"{seller}"}}"#));
        id
    }

    /// The buyer pays the exact price into escrow.
    #[payable]
    pub fn fund_sale(&mut self, sale_id: u64) {
        let buyer = env::predecessor_account_id();
        let mut sale = self.sale(sale_id);
        require!(sale.status == SaleStatus::Listed, "this sale is not open for payment");
        require!(buyer != sale.seller, "the seller cannot buy their own car");
        require!(env::attached_deposit() == sale.price, "attach exactly the listed price");

        sale.buyer = Some(buyer.clone());
        sale.status = SaleStatus::Funded;
        self.save_stage(sale, true);
        emit("sale_funded", &format!(r#"{{"sale_id":{sale_id},"buyer":"{buyer}"}}"#));
    }

    /// The seller records that the car was handed over. From here the buyer
    /// can confirm or dispute, but no longer cancel.
    pub fn mark_handed_over(&mut self, sale_id: u64) {
        let mut sale = self.sale(sale_id);
        require!(env::predecessor_account_id() == sale.seller, "only the seller can mark the handover");
        require!(sale.status == SaleStatus::Funded, "the sale must be paid and not yet handed over");
        sale.status = SaleStatus::HandedOver;
        self.save_stage(sale, true);
        emit("sale_handed_over", &format!(r#"{{"sale_id":{sale_id}}}"#));
    }

    /// The buyer confirms they received the car; the payment goes to the seller.
    pub fn confirm_receipt(&mut self, sale_id: u64) -> Promise {
        let sale = self.sale(sale_id);
        require!(Some(env::predecessor_account_id()) == sale.buyer, "only the buyer can confirm receipt");
        require!(
            matches!(sale.status, SaleStatus::Funded | SaleStatus::HandedOver),
            "there is no held payment to release"
        );
        self.release_to_seller(sale)
    }

    /// Seller: withdraw a listing, or call off a paid sale before handover.
    /// Buyer: back out before handover. Any held payment returns to the buyer.
    pub fn cancel_sale(&mut self, sale_id: u64) -> Option<Promise> {
        let caller = env::predecessor_account_id();
        let mut sale = self.sale(sale_id);
        match sale.status {
            SaleStatus::Listed => {
                require!(caller == sale.seller, "only the seller can withdraw a listing");
                sale.status = SaleStatus::Cancelled;
                self.close_vehicle_sale(sale.vehicle_id);
                self.save_stage(sale, false);
                emit("sale_cancelled", &format!(r#"{{"sale_id":{sale_id}}}"#));
                None
            }
            SaleStatus::Funded => {
                let is_seller = caller == sale.seller;
                require!(is_seller || Some(&caller) == sale.buyer.as_ref(), "only the buyer or the seller can cancel");
                if is_seller {
                    self.bump_stats(&sale.seller, |s| s.cancelled += 1);
                }
                Some(self.refund_buyer(sale))
            }
            _ => env::panic_str("this sale can no longer be cancelled"),
        }
    }

    /// After the deadline anyone may close a stalled sale: an unanswered
    /// payment goes back to the buyer, an unanswered handover pays the seller.
    pub fn claim_timeout(&mut self, sale_id: u64) -> Promise {
        let sale = self.sale(sale_id);
        require!(
            matches!(sale.status, SaleStatus::Funded | SaleStatus::HandedOver),
            "no clock is running on this sale"
        );
        require!(env::block_timestamp_ms() >= sale.deadline_ms, "the deadline has not passed yet");
        if sale.status == SaleStatus::Funded {
            self.refund_buyer(sale)
        } else {
            self.release_to_seller(sale)
        }
    }

    /// Either side freezes the payment and points at their evidence.
    pub fn open_dispute(&mut self, sale_id: u64, evidence_hash: String) {
        let caller = env::predecessor_account_id();
        let mut sale = self.sale(sale_id);
        require!(caller == sale.seller || Some(&caller) == sale.buyer.as_ref(), "only the buyer or the seller can open a dispute");
        require!(
            matches!(sale.status, SaleStatus::Funded | SaleStatus::HandedOver),
            "a dispute needs a held payment"
        );
        require!(is_sha256_hex(&evidence_hash), "evidence_hash must be 64 lowercase hex characters");
        sale.status = SaleStatus::Disputed;
        sale.dispute_hash = Some(evidence_hash);
        sale.dispute_opened_by = Some(caller.clone());
        self.save_stage(sale, false);
        emit("dispute_opened", &format!(r#"{{"sale_id":{sale_id},"opened_by":"{caller}"}}"#));
    }

    /// A human reviewer (the admin account) settles a dispute. This is a demo
    /// decision, not a legal ruling.
    pub fn resolve_dispute(&mut self, sale_id: u64, release_to_seller: bool) -> Promise {
        self.assert_admin();
        let sale = self.sale(sale_id);
        require!(sale.status == SaleStatus::Disputed, "this sale is not in dispute");
        emit("dispute_resolved", &format!(r#"{{"sale_id":{sale_id},"release_to_seller":{release_to_seller}}}"#));
        if release_to_seller {
            self.release_to_seller(sale)
        } else {
            self.bump_stats(&sale.seller, |s| s.disputes_lost += 1);
            self.refund_buyer(sale)
        }
    }

    pub fn get_sale(&self, sale_id: u64) -> Option<Sale> {
        self.sales.get(&sale_id).cloned()
    }

    /// Sales with id >= `from`, oldest first.
    pub fn get_sales(&self, from: Option<u64>, limit: Option<u32>) -> Vec<Sale> {
        let start = from.unwrap_or(1).max(1);
        let limit = limit.unwrap_or(MAX_PAGE).min(MAX_PAGE);
        (start..self.next_sale_id).take(limit as usize).filter_map(|id| self.sales.get(&id).cloned()).collect()
    }
}

impl Contract {
    fn sale(&self, sale_id: u64) -> Sale {
        self.sales.get(&sale_id).cloned().unwrap_or_else(|| env::panic_str("no such sale"))
    }

    fn save_stage(&mut self, mut sale: Sale, start_clock: bool) {
        let now = env::block_timestamp_ms();
        sale.updated_at_ms = now;
        sale.deadline_ms = if start_clock { now + self.timeout_ms } else { 0 };
        self.sales.insert(sale.id, sale);
    }

    fn close_vehicle_sale(&mut self, vehicle_id: u64) {
        let mut vehicle = self.vehicle(vehicle_id);
        vehicle.active_sale = None;
        self.vehicles.insert(vehicle_id, vehicle);
    }

    fn bump_stats(&mut self, seller: &AccountId, f: impl FnOnce(&mut SellerStats)) {
        let mut stats = self.seller_stats.get(seller).cloned().unwrap_or_default();
        f(&mut stats);
        self.seller_stats.insert(seller.clone(), stats);
    }

    // Both settlement paths write the final state before sending the payment,
    // so a sale can never pay out twice.

    fn release_to_seller(&mut self, mut sale: Sale) -> Promise {
        let buyer = sale.buyer.clone().unwrap_or_else(|| env::panic_str("sale has no buyer"));
        let (seller, price, sale_id) = (sale.seller.clone(), sale.price, sale.id);
        let mut vehicle = self.vehicle(sale.vehicle_id);
        vehicle.owner = buyer.clone();
        vehicle.active_sale = None;
        self.vehicles.insert(sale.vehicle_id, vehicle);
        self.bump_stats(&seller, |s| s.completed += 1);
        sale.status = SaleStatus::Completed;
        self.save_stage(sale, false);
        emit("sale_completed", &format!(r#"{{"sale_id":{sale_id},"seller":"{seller}","buyer":"{buyer}"}}"#));
        Promise::new(seller).transfer(price)
    }

    fn refund_buyer(&mut self, mut sale: Sale) -> Promise {
        let buyer = sale.buyer.clone().unwrap_or_else(|| env::panic_str("sale has no buyer"));
        let (price, sale_id) = (sale.price, sale.id);
        self.close_vehicle_sale(sale.vehicle_id);
        sale.status = SaleStatus::Refunded;
        self.save_stage(sale, false);
        emit("sale_refunded", &format!(r#"{{"sale_id":{sale_id},"buyer":"{buyer}"}}"#));
        Promise::new(buyer).transfer(price)
    }
}
