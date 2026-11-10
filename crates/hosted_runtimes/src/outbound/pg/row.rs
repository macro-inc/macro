//! Decode persisted rows without exposing invalid payloads to lifecycle processing.

use bot_id::BotId;
use chrono::{DateTime, Utc};
use harness_id::HarnessId;
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

use super::PgComputerRepo;
use crate::domain::ids::ComputerId;
use crate::domain::lifecycle::HostId;
use crate::domain::models::{
    Computer, ComputerDisplayMetadata, ComputerName, ComputerRecord, SanitizedReason,
};
use crate::domain::size::{
    CatalogEntryId, ComputerResources, ComputerSize, DiskGib, MemoryGib, Vcpus,
};

pub(super) struct ComputerRow {
    pub(super) id: Uuid,
    pub(super) team_id: Uuid,
    pub(super) host_id: Option<Uuid>,
    pub(super) name: String,
    pub(super) size: String,
    pub(super) vcpus: i32,
    pub(super) memory_gib: i32,
    pub(super) disk_gib: i32,
    pub(super) catalog_entry: String,
    pub(super) price_id: Option<String>,
    pub(super) state: serde_json::Value,
    pub(super) harness_id: Option<Uuid>,
    pub(super) created_by: String,
    pub(super) created_at: DateTime<Utc>,
    pub(super) enrolled_at: Option<DateTime<Utc>>,
    pub(super) enrollment_generation: i64,
    pub(super) setup_completed_at: Option<DateTime<Utc>>,
    pub(super) default_agent_id: Option<Uuid>,
}

fn invalid_row(rule: &'static str) -> SanitizedReason {
    SanitizedReason::new(rule)
}

impl TryFrom<ComputerRow> for Computer {
    type Error = SanitizedReason;

    fn try_from(row: ComputerRow) -> Result<Self, Self::Error> {
        Ok(Computer {
            id: ComputerId::new_from_uuid(row.id),
            team_id: row.team_id,
            name: ComputerName::try_new(&row.name)
                .map_err(|_| invalid_row("name must contain 1..=64 characters"))?,
            size: row
                .size
                .parse::<ComputerSize>()
                .map_err(|_| invalid_row("size must be a supported computer size"))?,
            resources: ComputerResources {
                vcpus: Vcpus::new(
                    u32::try_from(row.vcpus)
                        .map_err(|_| invalid_row("vcpus must fit an unsigned resource count"))?,
                ),
                memory_gib: MemoryGib::new(
                    u32::try_from(row.memory_gib).map_err(|_| {
                        invalid_row("memory_gib must fit an unsigned resource count")
                    })?,
                ),
                disk_gib: DiskGib::new(
                    u32::try_from(row.disk_gib)
                        .map_err(|_| invalid_row("disk_gib must fit an unsigned resource count"))?,
                ),
            },
            catalog_entry: CatalogEntryId::try_new(row.catalog_entry)
                .map_err(|_| invalid_row("catalog_entry must be a versioned catalog identifier"))?,
            price_id: row
                .price_id
                .map(|id| {
                    id.parse::<stripe::PriceId>()
                        .map_err(|_| invalid_row("price_id must be a Stripe price identifier"))
                })
                .transpose()?,
            state: serde_json::from_value(row.state)
                .map_err(|_| invalid_row("state must satisfy lifecycle field rules"))?,
            harness_id: row.harness_id.map(HarnessId::new_from_uuid),
            created_by: MacroUserIdStr::try_from(row.created_by)
                .map_err(|_| invalid_row("created_by must be a valid Macro user identifier"))?,
            created_at: row.created_at,
            enrolled_at: row.enrolled_at,
            setup_completed_at: row.setup_completed_at,
            default_agent_id: row.default_agent_id.map(BotId::new_from_uuid),
            enrollment_generation: crate::domain::enrollment::EnrollmentGeneration::new(
                u32::try_from(row.enrollment_generation).map_err(|_| {
                    invalid_row("enrollment_generation must fit an unsigned generation")
                })?,
            ),
        })
    }
}

impl PgComputerRepo {
    pub(super) fn decode_row(row: ComputerRow) -> ComputerRecord {
        let id = ComputerId::new_from_uuid(row.id);
        let team_id = row.team_id;
        let host_id = row.host_id.map(HostId::new);
        let display = ComputerDisplayMetadata {
            name: row.name.clone(),
            size: row.size.clone(),
            vcpus: i64::from(row.vcpus),
            memory_gib: i64::from(row.memory_gib),
            disk_gib: i64::from(row.disk_gib),
            catalog_entry: row.catalog_entry.clone(),
            created_at: row.created_at,
            purchased_by: row.created_by.clone(),
        };
        match Computer::try_from(row) {
            Ok(computer) => computer.into(),
            Err(reason) => {
                tracing::warn!(computer_id = %id, reason = %reason,
                    hosted_runtimes.corrupt_rows = 1_i64, "computer row quarantined");
                ComputerRecord::NeedsAttention {
                    id,
                    team_id,
                    host_id,
                    reason,
                    display,
                }
            }
        }
    }
}
