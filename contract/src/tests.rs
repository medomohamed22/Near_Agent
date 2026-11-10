use crate::*;
use near_sdk::test_utils::{get_created_receipts, VMContextBuilder};
use near_sdk::mock::MockAction;
use near_sdk::testing_env;

const HASH_A: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const HASH_B: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const TIMEOUT_SEC: u64 = 120;
const START_NS: u64 = 1_800_000_000_000_000_000;

fn acc(name: &str) -> AccountId {
    format!("{name}.testnet").parse().unwrap()
}

fn price() -> NearToken {
    NearToken::from_near(5)
}

/// Sets who is calling, what they attach, and how many seconds have passed.
fn call_as(who: &str, deposit: NearToken, after_sec: u64) {
    testing_env!(VMContextBuilder::new()
        .current_account_id(acc("carpass"))
        .predecessor_account_id(acc(who))
        .attached_deposit(deposit)
        .block_timestamp(START_NS + after_sec * 1_000_000_000)
        .build());
}

fn free(who: &str) {
    call_as(who, NearToken::from_near(0), 0);
}

/// How much the last call transferred to `to`.
fn paid_to(to: &str) -> NearToken {
    let target = acc(to);
    let yocto: u128 = get_created_receipts()
        .iter()
        .filter(|r| r.receiver_id == target)
        .flat_map(|r| r.actions.iter())
        .map(|a| match a {
            MockAction::Transfer { deposit, .. } => deposit.as_yoctonear(),
            _ => 0,
        })
        .sum();
    NearToken::from_yoctonear(yocto)
}

fn nothing() -> NearToken {
    NearToken::from_near(0)
}

fn setup() -> Contract {
    free("admin");
    let mut c = Contract::new(acc("admin"), TIMEOUT_SEC);
    c.add_attester(acc("workshop"));
    call_as("seller", VEHICLE_DEPOSIT, 0);
    assert_eq!(c.create_vehicle("Corolla 2018".into(), HASH_A.into()), 1);
    c
}

fn listed() -> Contract {
    let mut c = setup();
    free("seller");
    assert_eq!(c.list_for_sale(1, price()), 1);
    c
}

fn funded() -> Contract {
    let mut c = listed();
    call_as("buyer", price(), 0);
    c.fund_sale(1);
    c
}

fn status(c: &Contract) -> SaleStatus {
    c.get_sale(1).unwrap().status
}

// ---- passports and records ----

#[test]
fn creates_a_passport() {
    let c = setup();
    let v = c.get_vehicle(1).unwrap();
    assert_eq!(v.owner, acc("seller"));
    assert_eq!(c.get_vehicle_by_vin(HASH_A.into()).unwrap().id, 1);
    assert_eq!(c.get_config().vehicle_count, 1);
}

#[test]
#[should_panic(expected = "attach at least 0.1 NEAR")]
fn passport_needs_the_storage_deposit() {
    let mut c = setup();
    call_as("seller", NearToken::from_millinear(10), 0);
    c.create_vehicle("Lancer".into(), HASH_B.into());
}

#[test]
#[should_panic(expected = "a passport already exists")]
fn one_passport_per_vin() {
    let mut c = setup();
    call_as("buyer", VEHICLE_DEPOSIT, 0);
    c.create_vehicle("Same car".into(), HASH_A.into());
}

#[test]
#[should_panic(expected = "vin_hash must be 64")]
fn rejects_a_raw_vin() {
    let mut c = setup();
    call_as("seller", VEHICLE_DEPOSIT, 0);
    c.create_vehicle("Lancer".into(), "JTDBR32E720123456".into());
}

#[test]
fn odometer_rollback_is_flagged_not_rejected() {
    let mut c = setup();
    free("seller");
    assert!(!c.add_record(1, RecordKind::Maintenance, HASH_A.into(), 20230101, Some(10_000)).odometer_conflict);
    assert!(!c.add_record(1, RecordKind::Maintenance, HASH_A.into(), 20240101, Some(12_000)).odometer_conflict);
    assert!(c.add_record(1, RecordKind::Inspection, HASH_B.into(), 20250101, Some(11_500)).odometer_conflict);
    let v = c.get_vehicle(1).unwrap();
    assert_eq!(v.odometer_conflicts, 1);
    assert_eq!(v.last_odometer_km, 12_000, "the conflicting reading must not replace the last good one");
    assert_eq!(v.record_count, 3);
    assert_eq!(c.get_records(1, None, None).len(), 3);
}

#[test]
fn backdated_higher_reading_is_flagged() {
    let mut c = setup();
    free("seller");
    c.add_record(1, RecordKind::Odometer, HASH_A.into(), 20240101, Some(50_000));
    assert!(c.add_record(1, RecordKind::Odometer, HASH_A.into(), 20230101, Some(60_000)).odometer_conflict);
    assert!(!c.add_record(1, RecordKind::Odometer, HASH_A.into(), 20230601, Some(40_000)).odometer_conflict);
}

#[test]
fn records_without_a_reading_never_conflict() {
    let mut c = setup();
    free("seller");
    c.add_record(1, RecordKind::Odometer, HASH_A.into(), 20240101, Some(50_000));
    assert!(!c.add_record(1, RecordKind::Insurance, HASH_B.into(), 20250101, None).odometer_conflict);
    assert_eq!(c.get_vehicle(1).unwrap().last_odometer_km, 50_000);
}

#[test]
#[should_panic(expected = "only the passport holder or an approved workshop")]
fn strangers_cannot_add_records() {
    let mut c = setup();
    free("buyer");
    c.add_record(1, RecordKind::Maintenance, HASH_A.into(), 20240101, None);
}

#[test]
#[should_panic(expected = "event_date must be a real date")]
fn rejects_impossible_dates() {
    let mut c = setup();
    free("seller");
    c.add_record(1, RecordKind::Maintenance, HASH_A.into(), 20230230, None);
}

#[test]
fn workshop_record_is_attested_at_once() {
    let mut c = setup();
    free("workshop");
    let r = c.add_record(1, RecordKind::Inspection, HASH_A.into(), 20240101, Some(1_000));
    assert_eq!(r.attested_by, Some(acc("workshop")));
    assert_eq!(c.get_vehicle(1).unwrap().attested_count, 1);
}

#[test]
fn workshop_attests_a_holder_record_once() {
    let mut c = setup();
    free("seller");
    assert_eq!(c.add_record(1, RecordKind::Maintenance, HASH_A.into(), 20240101, None).attested_by, None);
    free("workshop");
    c.attest_record(1, 0);
    assert_eq!(c.get_records(1, None, None)[0].attested_by, Some(acc("workshop")));
    assert_eq!(c.get_vehicle(1).unwrap().attested_count, 1);
}

#[test]
#[should_panic(expected = "already attested")]
fn cannot_attest_twice() {
    let mut c = setup();
    free("workshop");
    c.add_record(1, RecordKind::Inspection, HASH_A.into(), 20240101, None);
    c.attest_record(1, 0);
}

#[test]
#[should_panic(expected = "only an approved workshop can attest")]
fn holder_cannot_attest_own_record() {
    let mut c = setup();
    free("seller");
    c.add_record(1, RecordKind::Maintenance, HASH_A.into(), 20240101, None);
    c.attest_record(1, 0);
}

#[test]
#[should_panic(expected = "cannot attest records on its own passport")]
fn workshop_cannot_attest_its_own_car() {
    let mut c = setup();
    call_as("workshop", VEHICLE_DEPOSIT, 0);
    let id = c.create_vehicle("Workshop van".into(), HASH_B.into());
    free("workshop");
    let r = c.add_record(id, RecordKind::Maintenance, HASH_A.into(), 20240101, None);
    assert_eq!(r.attested_by, None, "a workshop's record on its own car is not attested");
    c.attest_record(id, 0);
}

#[test]
#[should_panic(expected = "only the admin")]
fn only_admin_approves_workshops() {
    let mut c = setup();
    free("seller");
    c.add_attester(acc("seller"));
}

#[test]
#[should_panic(expected = "only an approved workshop can attest")]
fn removed_workshop_loses_the_right() {
    let mut c = setup();
    free("seller");
    c.add_record(1, RecordKind::Maintenance, HASH_A.into(), 20240101, None);
    free("admin");
    c.remove_attester(acc("workshop"));
    free("workshop");
    c.attest_record(1, 0);
}

// ---- sale: happy path ----

#[test]
fn full_sale_pays_the_seller_and_moves_the_passport() {
    let mut c = funded();
    assert_eq!(status(&c), SaleStatus::Funded);
    assert_eq!(c.get_sale(1).unwrap().deadline_ms, START_NS / 1_000_000 + TIMEOUT_SEC * 1000);

    free("seller");
    c.mark_handed_over(1);
    assert_eq!(status(&c), SaleStatus::HandedOver);

    free("buyer");
    let _ = c.confirm_receipt(1);
    assert_eq!(status(&c), SaleStatus::Completed);
    assert_eq!(paid_to("seller"), price());
    assert_eq!(paid_to("buyer"), nothing());
    let v = c.get_vehicle(1).unwrap();
    assert_eq!(v.owner, acc("buyer"));
    assert_eq!(v.active_sale, None);
    assert_eq!(c.get_seller_stats(acc("seller")).completed, 1);
}

#[test]
fn buyer_may_confirm_without_waiting_for_the_seller_step() {
    let mut c = funded();
    free("buyer");
    let _ = c.confirm_receipt(1);
    assert_eq!(status(&c), SaleStatus::Completed);
}

#[test]
fn new_holder_can_relist() {
    let mut c = funded();
    free("buyer");
    let _ = c.confirm_receipt(1);
    free("buyer");
    assert_eq!(c.list_for_sale(1, price()), 2);
    assert_eq!(c.get_sales(None, None).len(), 2);
}

// ---- sale: guards ----

#[test]
#[should_panic(expected = "only the passport holder can list")]
fn only_holder_lists() {
    let mut c = setup();
    free("buyer");
    c.list_for_sale(1, price());
}

#[test]
#[should_panic(expected = "already has an open sale")]
fn one_open_sale_per_car() {
    let mut c = listed();
    free("seller");
    c.list_for_sale(1, price());
}

#[test]
#[should_panic(expected = "price must be greater than zero")]
fn price_cannot_be_zero() {
    let mut c = setup();
    free("seller");
    c.list_for_sale(1, NearToken::from_near(0));
}

#[test]
#[should_panic(expected = "attach exactly the listed price")]
fn underpaying_is_rejected() {
    let mut c = listed();
    call_as("buyer", NearToken::from_near(4), 0);
    c.fund_sale(1);
}

#[test]
#[should_panic(expected = "attach exactly the listed price")]
fn overpaying_is_rejected() {
    let mut c = listed();
    call_as("buyer", NearToken::from_near(6), 0);
    c.fund_sale(1);
}

#[test]
#[should_panic(expected = "the seller cannot buy their own car")]
fn seller_cannot_fund_own_sale() {
    let mut c = listed();
    call_as("seller", price(), 0);
    c.fund_sale(1);
}

#[test]
#[should_panic(expected = "not open for payment")]
fn cannot_fund_twice() {
    let mut c = funded();
    call_as("other", price(), 0);
    c.fund_sale(1);
}

#[test]
#[should_panic(expected = "only the buyer can confirm receipt")]
fn seller_cannot_release_to_self() {
    let mut c = funded();
    free("seller");
    let _ = c.confirm_receipt(1);
}

#[test]
#[should_panic(expected = "no held payment to release")]
fn cannot_release_twice() {
    let mut c = funded();
    free("buyer");
    let _ = c.confirm_receipt(1);
    free("buyer");
    let _ = c.confirm_receipt(1);
}

#[test]
#[should_panic(expected = "only the seller can mark the handover")]
fn buyer_cannot_mark_handover() {
    let mut c = funded();
    free("buyer");
    c.mark_handed_over(1);
}

// ---- sale: cancel ----

#[test]
fn seller_withdraws_a_listing() {
    let mut c = listed();
    free("seller");
    assert!(c.cancel_sale(1).is_none());
    assert_eq!(status(&c), SaleStatus::Cancelled);
    assert_eq!(c.get_vehicle(1).unwrap().active_sale, None);
    assert_eq!(c.get_seller_stats(acc("seller")).cancelled, 0);
}

#[test]
#[should_panic(expected = "only the seller can withdraw a listing")]
fn stranger_cannot_withdraw_a_listing() {
    let mut c = listed();
    free("buyer");
    let _ = c.cancel_sale(1);
}

#[test]
fn buyer_backs_out_before_handover_and_is_refunded() {
    let mut c = funded();
    free("buyer");
    assert!(c.cancel_sale(1).is_some());
    assert_eq!(status(&c), SaleStatus::Refunded);
    assert_eq!(paid_to("buyer"), price());
    assert_eq!(paid_to("seller"), nothing());
    assert_eq!(c.get_vehicle(1).unwrap().owner, acc("seller"));
    assert_eq!(c.get_seller_stats(acc("seller")).cancelled, 0);
}

#[test]
fn seller_calling_off_a_paid_sale_refunds_and_counts_against_them() {
    let mut c = funded();
    free("seller");
    let _ = c.cancel_sale(1);
    assert_eq!(status(&c), SaleStatus::Refunded);
    assert_eq!(paid_to("buyer"), price());
    assert_eq!(c.get_seller_stats(acc("seller")).cancelled, 1);
}

#[test]
#[should_panic(expected = "can no longer be cancelled")]
fn buyer_cannot_cancel_after_handover() {
    let mut c = funded();
    free("seller");
    c.mark_handed_over(1);
    free("buyer");
    let _ = c.cancel_sale(1);
}

#[test]
#[should_panic(expected = "only the buyer or the seller can cancel")]
fn stranger_cannot_cancel_a_paid_sale() {
    let mut c = funded();
    free("other");
    let _ = c.cancel_sale(1);
}

// ---- sale: timeouts ----

#[test]
#[should_panic(expected = "the deadline has not passed yet")]
fn timeout_cannot_be_claimed_early() {
    let mut c = funded();
    call_as("buyer", NearToken::from_near(0), TIMEOUT_SEC - 1);
    let _ = c.claim_timeout(1);
}

#[test]
fn silent_seller_means_refund_after_deadline() {
    let mut c = funded();
    call_as("buyer", NearToken::from_near(0), TIMEOUT_SEC);
    let _ = c.claim_timeout(1);
    assert_eq!(status(&c), SaleStatus::Refunded);
    assert_eq!(paid_to("buyer"), price());
}

#[test]
fn silent_buyer_means_release_after_deadline() {
    let mut c = funded();
    call_as("seller", NearToken::from_near(0), 10);
    c.mark_handed_over(1);
    call_as("seller", NearToken::from_near(0), 10 + TIMEOUT_SEC);
    let _ = c.claim_timeout(1);
    assert_eq!(status(&c), SaleStatus::Completed);
    assert_eq!(paid_to("seller"), price());
    assert_eq!(c.get_vehicle(1).unwrap().owner, acc("buyer"));
}

#[test]
#[should_panic(expected = "the deadline has not passed yet")]
fn handover_restarts_the_clock() {
    let mut c = funded();
    call_as("seller", NearToken::from_near(0), TIMEOUT_SEC - 10);
    c.mark_handed_over(1);
    call_as("seller", NearToken::from_near(0), TIMEOUT_SEC + 5);
    let _ = c.claim_timeout(1);
}

#[test]
#[should_panic(expected = "no clock is running")]
fn no_timeout_on_a_listing() {
    let mut c = listed();
    call_as("seller", NearToken::from_near(0), TIMEOUT_SEC * 10);
    let _ = c.claim_timeout(1);
}

// ---- sale: disputes ----

#[test]
fn dispute_freezes_the_payment() {
    let mut c = funded();
    free("seller");
    c.mark_handed_over(1);
    free("buyer");
    c.open_dispute(1, HASH_B.into());
    let s = c.get_sale(1).unwrap();
    assert_eq!(s.status, SaleStatus::Disputed);
    assert_eq!(s.deadline_ms, 0);
    assert_eq!(s.dispute_opened_by, Some(acc("buyer")));
    assert_eq!(paid_to("buyer"), nothing());
    assert_eq!(paid_to("seller"), nothing());
}

#[test]
#[should_panic(expected = "no held payment to release")]
fn buyer_cannot_confirm_during_a_dispute() {
    let mut c = funded();
    free("seller");
    c.open_dispute(1, HASH_B.into());
    free("buyer");
    let _ = c.confirm_receipt(1);
}

#[test]
#[should_panic(expected = "no clock is running")]
fn timeout_cannot_bypass_a_dispute() {
    let mut c = funded();
    free("buyer");
    c.open_dispute(1, HASH_B.into());
    call_as("seller", NearToken::from_near(0), TIMEOUT_SEC * 10);
    let _ = c.claim_timeout(1);
}

#[test]
#[should_panic(expected = "only the buyer or the seller can open a dispute")]
fn stranger_cannot_open_a_dispute() {
    let mut c = funded();
    free("other");
    c.open_dispute(1, HASH_B.into());
}

#[test]
#[should_panic(expected = "a dispute needs a held payment")]
fn no_dispute_on_a_listing() {
    let mut c = listed();
    free("seller");
    c.open_dispute(1, HASH_B.into());
}

#[test]
#[should_panic(expected = "only the admin")]
fn parties_cannot_resolve_their_own_dispute() {
    let mut c = funded();
    free("buyer");
    c.open_dispute(1, HASH_B.into());
    let _ = c.resolve_dispute(1, false);
}

#[test]
fn reviewer_refunds_the_buyer() {
    let mut c = funded();
    free("buyer");
    c.open_dispute(1, HASH_B.into());
    free("admin");
    let _ = c.resolve_dispute(1, false);
    assert_eq!(status(&c), SaleStatus::Refunded);
    assert_eq!(paid_to("buyer"), price());
    assert_eq!(c.get_seller_stats(acc("seller")).disputes_lost, 1);
    assert_eq!(c.get_vehicle(1).unwrap().owner, acc("seller"));
}

#[test]
fn reviewer_releases_to_the_seller() {
    let mut c = funded();
    free("buyer");
    c.open_dispute(1, HASH_B.into());
    free("admin");
    let _ = c.resolve_dispute(1, true);
    assert_eq!(status(&c), SaleStatus::Completed);
    assert_eq!(paid_to("seller"), price());
    assert_eq!(c.get_seller_stats(acc("seller")).disputes_lost, 0);
}

#[test]
#[should_panic(expected = "not in dispute")]
fn reviewer_cannot_settle_twice() {
    let mut c = funded();
    free("buyer");
    c.open_dispute(1, HASH_B.into());
    free("admin");
    let _ = c.resolve_dispute(1, true);
    free("admin");
    let _ = c.resolve_dispute(1, false);
}
