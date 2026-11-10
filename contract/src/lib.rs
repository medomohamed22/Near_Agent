//! CarPass: a used-car passport plus an escrowed sale, for NEAR **testnet**.
//!
//! On chain: document hashes, odometer readings, workshop attestations and the
//! sale escrow. Off chain: the documents themselves and anything personal.
//! Nothing here proves or transfers legal ownership of a vehicle.

use near_sdk::store::{LookupMap, LookupSet};
use near_sdk::{env, log, near, require, AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault, Promise, PromiseError};

mod records;
mod sale;
#[cfg(test)]
mod tests;

pub use records::{Record, RecordKind};
pub use sale::{Sale, SaleStatus};

/// Deposit required to open a passport; it pays for the passport's storage
/// and for the records later attached to it.
pub const VEHICLE_DEPOSIT: NearToken = NearToken::from_millinear(100);
/// Paid with every listing and kept by the contract: each listing adds a sale
/// record that stays in storage, so the lister covers it.
pub const LISTING_FEE: NearToken = NearToken::from_millinear(10);
pub const MAX_RECORDS_PER_VEHICLE: u32 = 60;
const PAYOUT_CALLBACK_GAS: Gas = Gas::from_tgas(5);
pub const MAX_LABEL_LEN: usize = 64;
pub const MAX_PAGE: u32 = 50;

#[derive(BorshStorageKey)]
#[near]
enum Key {
    Attesters,
    Vehicles,
    VinIndex,
    Records,
    Sales,
    SellerStats,
    Owed,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Vehicle {
    pub id: u64,
    /// Holder of the passport inside CarPass. Not proof of legal ownership.
    pub owner: AccountId,
    pub label: String,
    /// SHA-256 of the VIN plus a salt, hex. The VIN itself never goes on chain.
    pub vin_hash: String,
    pub record_count: u32,
    pub attested_count: u32,
    pub last_odometer_km: u32,
    /// Date (YYYYMMDD) of the reading in `last_odometer_km`; 0 when none yet.
    pub last_odometer_date: u32,
    pub odometer_conflicts: u32,
    pub active_sale: Option<u64>,
    pub created_at_ms: u64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, Default, PartialEq)]
pub struct SellerStats {
    pub completed: u32,
    pub cancelled: u32,
    pub disputes_lost: u32,
}

#[near(serializers = [json])]
pub struct Config {
    pub admin: AccountId,
    pub timeout_sec: u64,
    pub vehicle_count: u64,
    pub sale_count: u64,
    pub vehicle_deposit: NearToken,
    pub listing_fee: NearToken,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    admin: AccountId,
    /// How long each escrow stage may sit before either side can close it.
    timeout_ms: u64,
    attesters: LookupSet<AccountId>,
    vehicles: LookupMap<u64, Vehicle>,
    vin_index: LookupMap<String, u64>,
    records: LookupMap<(u64, u32), Record>,
    sales: LookupMap<u64, Sale>,
    seller_stats: LookupMap<AccountId, SellerStats>,
    /// Payments that could not be delivered, waiting for `withdraw_owed`.
    owed: LookupMap<AccountId, NearToken>,
    next_vehicle_id: u64,
    next_sale_id: u64,
}

#[near]
impl Contract {
    #[init]
    #[private]
    pub fn new(admin: AccountId, timeout_sec: u64) -> Self {
        require!(timeout_sec >= 30, "timeout_sec must be at least 30");
        Self {
            admin,
            timeout_ms: timeout_sec * 1000,
            attesters: LookupSet::new(Key::Attesters),
            vehicles: LookupMap::new(Key::Vehicles),
            vin_index: LookupMap::new(Key::VinIndex),
            records: LookupMap::new(Key::Records),
            sales: LookupMap::new(Key::Sales),
            seller_stats: LookupMap::new(Key::SellerStats),
            owed: LookupMap::new(Key::Owed),
            next_vehicle_id: 1,
            next_sale_id: 1,
        }
    }

    // ---- admin ----

    pub fn add_attester(&mut self, account_id: AccountId) {
        self.assert_admin();
        self.attesters.insert(account_id.clone());
        emit("attester_added", &format!(r#"{{"account_id":"{account_id}"}}"#));
    }

    pub fn remove_attester(&mut self, account_id: AccountId) {
        self.assert_admin();
        self.attesters.remove(&account_id);
        emit("attester_removed", &format!(r#"{{"account_id":"{account_id}"}}"#));
    }

    // ---- passports ----

    /// Opens a passport for a car. Attach at least `VEHICLE_DEPOSIT`; anything
    /// above it is refunded.
    #[payable]
    pub fn create_vehicle(&mut self, label: String, vin_hash: String) -> u64 {
        let label = label.trim().to_string();
        require!(!label.is_empty() && label.chars().count() <= MAX_LABEL_LEN, "label must be 1-64 characters");
        require!(is_sha256_hex(&vin_hash), "vin_hash must be 64 lowercase hex characters");
        require!(!self.vin_index.contains_key(&vin_hash), "a passport already exists for this VIN");
        let attached = env::attached_deposit();
        require!(attached >= VEHICLE_DEPOSIT, "attach at least 0.1 NEAR to cover storage");

        let owner = env::predecessor_account_id();
        let id = self.next_vehicle_id;
        self.next_vehicle_id += 1;
        self.vehicles.insert(
            id,
            Vehicle {
                id,
                owner: owner.clone(),
                label,
                vin_hash: vin_hash.clone(),
                record_count: 0,
                attested_count: 0,
                last_odometer_km: 0,
                last_odometer_date: 0,
                odometer_conflicts: 0,
                active_sale: None,
                created_at_ms: env::block_timestamp_ms(),
            },
        );
        self.vin_index.insert(vin_hash, id);
        emit("vehicle_created", &format!(r#"{{"vehicle_id":{id},"owner":"{owner}"}}"#));

        let extra = attached.saturating_sub(VEHICLE_DEPOSIT);
        if !extra.is_zero() {
            let _ = self.pay(owner, extra);
        }
        id
    }

    // ---- payouts ----

    /// Runs after every payment the contract sends. If the transfer did not
    /// arrive, the amount is recorded as owed so it can be claimed later.
    #[private]
    pub fn on_payout(&mut self, account_id: AccountId, amount: NearToken, #[callback_result] result: Result<(), PromiseError>) -> bool {
        if result.is_ok() {
            return true;
        }
        let total = self.owed.get(&account_id).copied().unwrap_or(NearToken::from_yoctonear(0)).saturating_add(amount);
        self.owed.insert(account_id.clone(), total);
        emit("payout_failed", &format!(r#"{{"account_id":"{account_id}","amount":"{}"}}"#, amount.as_yoctonear()));
        false
    }

    /// Claims a payment that failed to arrive earlier.
    pub fn withdraw_owed(&mut self) -> Promise {
        let caller = env::predecessor_account_id();
        // Removed before sending, so two calls cannot both be paid.
        let amount = self.owed.remove(&caller).unwrap_or_else(|| env::panic_str("nothing is owed to this account"));
        self.pay(caller, amount)
    }

    pub fn get_owed(&self, account_id: AccountId) -> NearToken {
        self.owed.get(&account_id).copied().unwrap_or(NearToken::from_yoctonear(0))
    }

    // ---- views ----

    pub fn get_config(&self) -> Config {
        Config {
            admin: self.admin.clone(),
            timeout_sec: self.timeout_ms / 1000,
            vehicle_count: self.next_vehicle_id - 1,
            sale_count: self.next_sale_id - 1,
            vehicle_deposit: VEHICLE_DEPOSIT,
            listing_fee: LISTING_FEE,
        }
    }

    pub fn get_vehicle(&self, vehicle_id: u64) -> Option<Vehicle> {
        self.vehicles.get(&vehicle_id).cloned()
    }

    pub fn get_vehicle_by_vin(&self, vin_hash: String) -> Option<Vehicle> {
        self.vin_index.get(&vin_hash).and_then(|id| self.vehicles.get(id)).cloned()
    }

    /// Passports with id >= `from`, oldest first.
    pub fn get_vehicles(&self, from: Option<u64>, limit: Option<u32>) -> Vec<Vehicle> {
        let start = from.unwrap_or(1).max(1);
        let limit = limit.unwrap_or(MAX_PAGE).min(MAX_PAGE) as u64;
        (start..self.next_vehicle_id).take(limit as usize).filter_map(|id| self.vehicles.get(&id).cloned()).collect()
    }

    pub fn is_attester(&self, account_id: AccountId) -> bool {
        self.attesters.contains(&account_id)
    }

    pub fn get_seller_stats(&self, account_id: AccountId) -> SellerStats {
        self.seller_stats.get(&account_id).cloned().unwrap_or_default()
    }
}

impl Contract {
    fn assert_admin(&self) {
        require!(env::predecessor_account_id() == self.admin, "only the admin can do this");
    }

    /// Sends `amount` and checks the result in `on_payout`.
    pub(crate) fn pay(&self, to: AccountId, amount: NearToken) -> Promise {
        Promise::new(to.clone())
            .transfer(amount)
            .then(Self::ext(env::current_account_id()).with_static_gas(PAYOUT_CALLBACK_GAS).on_payout(to, amount))
    }

    pub(crate) fn vehicle(&self, vehicle_id: u64) -> Vehicle {
        self.vehicles.get(&vehicle_id).cloned().unwrap_or_else(|| env::panic_str("no such vehicle"))
    }
}

pub(crate) fn is_sha256_hex(s: &str) -> bool {
    s.len() == 64 && s.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

/// NEP-297 event. `data` is one JSON object built from ids, account ids and
/// enum names only, so it needs no escaping.
pub(crate) fn emit(event: &str, data: &str) {
    log!(r#"EVENT_JSON:{{"standard":"carpass","version":"1.0.0","event":"{}","data":[{}]}}"#, event, data);
}
