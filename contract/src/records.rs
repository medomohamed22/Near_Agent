use crate::*;

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum RecordKind {
    Maintenance,
    Inspection,
    Accident,
    Warranty,
    Insurance,
    Odometer,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Record {
    pub index: u32,
    pub kind: RecordKind,
    /// SHA-256 of the original document, hex, so anyone holding the file can
    /// check it is the one that was registered.
    pub doc_hash: String,
    /// Date the document describes, as YYYYMMDD.
    pub event_date: u32,
    pub odometer_km: Option<u32>,
    pub added_by: AccountId,
    /// Workshop that vouched for this record; never the passport holder.
    pub attested_by: Option<AccountId>,
    /// The reading disagrees with another reading on the passport. The record is kept
    /// and flagged; the contract does not decide which reading is wrong.
    pub odometer_conflict: bool,
    pub created_at_ms: u64,
}

#[near]
impl Contract {
    /// Registers a document against a passport. The holder or an approved
    /// workshop may call it; a workshop's record counts as attested at once.
    pub fn add_record(
        &mut self,
        vehicle_id: u64,
        kind: RecordKind,
        doc_hash: String,
        event_date: u32,
        odometer_km: Option<u32>,
    ) -> Record {
        let caller = env::predecessor_account_id();
        let mut vehicle = self.vehicle(vehicle_id);
        let is_workshop = self.attesters.contains(&caller);
        require!(caller == vehicle.owner || is_workshop, "only the passport holder or an approved workshop can add records");
        require!(is_sha256_hex(&doc_hash), "doc_hash must be 64 lowercase hex characters");
        require!(is_valid_date(event_date), "event_date must be a real date written as YYYYMMDD");
        require!(vehicle.record_count < MAX_RECORDS_PER_VEHICLE, "this passport has reached its record limit");
        if let Some(km) = odometer_km {
            require!(km <= 2_000_000, "odometer_km is out of range");
        }

        // Compare against every other clean reading on the passport, whatever
        // order the documents were added in: an earlier-dated document must
        // not show more kilometres, a later-dated one must not show fewer.
        // Readings dated the same day are not compared with each other.
        let mut conflict = false;
        for i in 0..vehicle.record_count {
            let other = self.records.get(&(vehicle_id, i)).unwrap_or_else(|| env::panic_str("record missing"));
            require!(other.doc_hash != doc_hash, "this document is already on this passport");
            if let (Some(km), Some(other_km), false) = (odometer_km, other.odometer_km, other.odometer_conflict) {
                if (other.event_date < event_date && other_km > km) || (other.event_date > event_date && other_km < km) {
                    conflict = true;
                }
            }
        }
        if let Some(km) = odometer_km {
            if conflict {
                vehicle.odometer_conflicts += 1;
            } else if vehicle.last_odometer_date == 0
                || event_date > vehicle.last_odometer_date
                || (event_date == vehicle.last_odometer_date && km > vehicle.last_odometer_km)
            {
                vehicle.last_odometer_km = km;
                vehicle.last_odometer_date = event_date;
            }
        }

        let index = vehicle.record_count;
        // A workshop attests its own record unless it also holds the passport.
        let attested_by = (is_workshop && caller != vehicle.owner).then(|| caller.clone());
        let record = Record {
            index,
            kind,
            doc_hash,
            event_date,
            odometer_km,
            added_by: caller.clone(),
            attested_by: attested_by.clone(),
            odometer_conflict: conflict,
            created_at_ms: env::block_timestamp_ms(),
        };
        vehicle.record_count += 1;
        if attested_by.is_some() {
            vehicle.attested_count += 1;
        }
        self.records.insert((vehicle_id, index), record.clone());
        self.vehicles.insert(vehicle_id, vehicle);
        emit(
            "record_added",
            &format!(
                r#"{{"vehicle_id":{vehicle_id},"index":{index},"kind":"{kind:?}","added_by":"{caller}","attested":{},"odometer_conflict":{conflict}}}"#,
                attested_by.is_some()
            ),
        );
        record
    }

    /// An approved workshop vouches for a record the holder added.
    pub fn attest_record(&mut self, vehicle_id: u64, index: u32) {
        let caller = env::predecessor_account_id();
        require!(self.attesters.contains(&caller), "only an approved workshop can attest");
        let mut vehicle = self.vehicle(vehicle_id);
        require!(caller != vehicle.owner, "a workshop cannot attest records on its own passport");
        let mut record =
            self.records.get(&(vehicle_id, index)).cloned().unwrap_or_else(|| env::panic_str("no such record"));
        require!(record.attested_by.is_none(), "this record is already attested");
        record.attested_by = Some(caller.clone());
        vehicle.attested_count += 1;
        self.records.insert((vehicle_id, index), record);
        self.vehicles.insert(vehicle_id, vehicle);
        emit("record_attested", &format!(r#"{{"vehicle_id":{vehicle_id},"index":{index},"attested_by":"{caller}"}}"#));
    }

    pub fn get_records(&self, vehicle_id: u64, from: Option<u32>, limit: Option<u32>) -> Vec<Record> {
        let count = self.vehicles.get(&vehicle_id).map(|v| v.record_count).unwrap_or(0);
        let start = from.unwrap_or(0);
        let limit = limit.unwrap_or(MAX_PAGE).min(MAX_PAGE);
        (start..count)
            .take(limit as usize)
            .filter_map(|i| self.records.get(&(vehicle_id, i)).cloned())
            .collect()
    }
}

fn is_valid_date(d: u32) -> bool {
    let (y, m, day) = (d / 10_000, (d / 100) % 100, d % 100);
    if !(1950..=2100).contains(&y) || !(1..=12).contains(&m) || day == 0 {
        return false;
    }
    let leap = (y % 4 == 0 && y % 100 != 0) || y % 400 == 0;
    let max = match m {
        2 => 28 + leap as u32,
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    };
    day <= max
}
