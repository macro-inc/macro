//! Merging duplicate CRM records into the one that stays.
//!
//! The use case is the same for every record type: an admin previews the
//! merge, then commits it with the preview's revision. The repository locks
//! every record, recomputes the preview under the locks and moves each owner's
//! rows in one transaction; what moves for a record type is the repository's
//! to say. The merge log keeps every changed row with its value before.

pub mod plan;
pub mod service;

#[cfg(test)]
mod test;

use macro_user_id::user_id::MacroUserIdStr;
use models_properties::service::property_value::PropertyValue;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

use super::model::CrmError;

/// The rollout flag for merging, evaluated for the acting user.
pub const MERGE_FLAG: &str = "enable-crm-merge";

/// The most records one merge folds into the one that stays. The merge holds
/// the team's exclusive email-privacy lock while it runs, so it stays small.
pub const MAX_MERGE_SOURCES: usize = 10;

/// The kind of record a merge combines.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum MergeRecordType {
    /// CRM companies.
    Company,
    /// CRM contacts.
    Contact,
}

impl MergeRecordType {
    /// The value stored in `crm_merges.record_type`.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Company => "company",
            Self::Contact => "contact",
        }
    }
}

/// The records to merge: the one that stays and the ones merged into it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MergeTargets {
    record_type: MergeRecordType,
    survivor: Uuid,
    sources: Vec<Uuid>,
}

impl MergeTargets {
    /// Validate a merge request. Sources are deduplicated and sorted, so the
    /// same merge always fingerprints the same way.
    pub fn new(
        record_type: MergeRecordType,
        survivor: Uuid,
        sources: impl IntoIterator<Item = Uuid>,
    ) -> Result<Self, MergeError> {
        let mut sources: Vec<Uuid> = sources.into_iter().collect();
        sources.sort_unstable();
        sources.dedup();
        if sources.is_empty() {
            return Err(MergeError::Invalid(
                "choose at least one record to merge into the one that stays".into(),
            ));
        }
        if sources.contains(&survivor) {
            return Err(MergeError::Invalid(
                "the record that stays can't also be merged away".into(),
            ));
        }
        if sources.len() > MAX_MERGE_SOURCES {
            return Err(MergeError::Invalid(format!(
                "merge at most {MAX_MERGE_SOURCES} records at a time"
            )));
        }
        Ok(Self {
            record_type,
            survivor,
            sources,
        })
    }

    /// The kind of record merged.
    pub fn record_type(&self) -> MergeRecordType {
        self.record_type
    }

    /// The record that stays.
    pub fn survivor(&self) -> Uuid {
        self.survivor
    }

    /// The records merged into it, sorted.
    pub fn sources(&self) -> &[Uuid] {
        &self.sources
    }

    /// Every record the merge names, sorted: the order rows are locked in.
    pub fn all_sorted(&self) -> Vec<Uuid> {
        let mut all = self.sources.clone();
        all.push(self.survivor);
        all.sort_unstable();
        all
    }
}

/// What happens to a teammate's email-sharing rule that names a record merged
/// away. A rule is never pointed at the record that stays, which would share
/// more than its owner chose.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum SharingRulesChoice {
    /// Keep sharing exactly what was shared: the rule becomes rules for the
    /// record's domains (or addresses) as they are at the merge.
    #[default]
    Keep,
    /// Stop sharing it: the rule is removed.
    Stop,
}

/// A merge to commit, bound to the preview the admin reviewed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MergeCommand {
    /// The records merged.
    pub targets: MergeTargets,
    /// The revision of the preview the admin confirmed.
    pub revision: String,
    /// Unique per actor and team: an exact retry returns the first result.
    pub request_key: Uuid,
    /// What happens to teammates' sharing rules naming a merged record.
    pub sharing_rules: SharingRulesChoice,
}

/// Who merges, in which team. The actor has been checked as an admin or owner
/// with CRM access before the repository sees the scope.
#[derive(Debug, Clone)]
pub struct MergeScope {
    /// The team whose records are merged.
    pub team_id: Uuid,
    /// The admin or owner merging.
    pub actor: MacroUserIdStr<'static>,
}

/// A record as the review names it.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct MergedRecord {
    /// Record id.
    pub id: Uuid,
    /// Display name, as listings show it.
    pub name: String,
}

/// A pipeline in which the record that stays will have more than one entry.
/// Entries are distinct deals, so they stay separate.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SharedPipeline {
    /// Pipeline id.
    pub pipeline_id: Uuid,
    /// Pipeline name.
    pub name: String,
    /// Entries the record that stays has in it after the merge.
    pub entries_after: u32,
}

/// A team-visible field whose values differ. The value of the record that
/// stays is kept; the others are dropped and kept in the merge log.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct FieldConflict {
    /// The property definition.
    pub property_id: Uuid,
    /// The property's name.
    pub property_name: String,
    /// The value kept.
    #[schema(value_type = Object)]
    pub kept: PropertyValue,
    /// The values dropped, with the record each came from.
    pub dropped: Vec<DroppedValue>,
}

/// One value a merge drops.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct DroppedValue {
    /// The record merged away that held it.
    pub record_id: Uuid,
    /// The value.
    #[schema(value_type = Object)]
    pub value: PropertyValue,
}

/// What moves to the record that stays.
#[derive(Debug, Clone, Default, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct MergeMoves {
    /// People filed under the records merged away.
    pub contacts: u32,
    /// Pipeline entries tracking the records merged away.
    pub pipeline_entries: u32,
    /// Tasks, notes, emails, calls, events and rows that reference them.
    pub references: u32,
    /// Discussion messages on them.
    pub discussion_messages: u32,
}

/// What email sync does after the merge. The record that stays keeps its
/// setting; domains whose sync was off stay out of sync.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct MergeEmailSync {
    /// Whether the record that stays syncs mail.
    pub survivor_syncs: bool,
    /// Domains joining it whose mail stays out of sync.
    pub kept_out: Vec<String>,
}

/// Teammates whose email-sharing rules name a record merged away. Whose rules
/// they are is not shown.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SharingRulesPreview {
    /// How many teammates' rules change.
    pub teammates: u32,
    /// Whether every changed rule set still fits the rule limits when kept.
    pub keep_fits: bool,
}

/// A person blocking the merge: they share an address with someone filed
/// under another of the records.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SameAddressPerson {
    /// The address both hold.
    pub address: String,
    /// Contact id.
    pub contact_id: Uuid,
    /// Contact name, when it has one.
    pub name: Option<String>,
    /// The record it is filed under.
    pub record_id: Uuid,
    /// Whether the contact is archived.
    pub archived: bool,
}

/// A person a contact merge would move to another company.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct OtherCompanyPerson {
    /// Contact id.
    pub contact_id: Uuid,
    /// Contact name, when it has one.
    pub name: Option<String>,
    /// The company it is filed under.
    pub company_id: Uuid,
    /// That company's name, as listings show it.
    pub company_name: String,
}

/// Why a merge can't go ahead until someone changes the records.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum MergeBlock {
    /// People under different records share an address; merging would file
    /// two people with one address under the same record.
    SameAddressPeople {
        /// Every person involved, archived ones too.
        people: Vec<SameAddressPerson>,
    },
    /// People merged away are filed under another company than the contact
    /// that stays and hold a work address, so they can't change company, as
    /// a contact edit couldn't move them: merge the companies first.
    DifferentCompanies {
        /// The people who would change company.
        people: Vec<OtherCompanyPerson>,
    },
}

/// The review an admin confirms before merging.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct MergePreview {
    /// Changes whenever anything shown here changes; the commit must name it.
    pub revision: String,
    /// The kind of record merged.
    pub record_type: MergeRecordType,
    /// The record that stays.
    pub survivor: MergedRecord,
    /// The records merged into it.
    pub sources: Vec<MergedRecord>,
    /// The domains (or addresses) the record that stays has after the merge,
    /// its own first.
    pub identifiers: Vec<String>,
    /// What moves.
    pub moves: MergeMoves,
    /// Pipelines where the record that stays will have several entries.
    pub shared_pipelines: Vec<SharedPipeline>,
    /// Team-visible values that differ.
    pub conflicts: Vec<FieldConflict>,
    /// What email sync does.
    pub email_sync: MergeEmailSync,
    /// Teammates' sharing rules naming a record merged away.
    pub sharing_rules: Option<SharingRulesPreview>,
    /// Set when the merge can't go ahead.
    pub blocked: Option<MergeBlock>,
    /// The entries moving in each pipeline, so the review names and counts
    /// only the pipelines its reader can open.
    #[serde(skip)]
    pub pipeline_moves: Vec<PipelineMoves>,
    /// Each reference that moves, so the review counts only those its
    /// reader could see.
    #[serde(skip)]
    pub reference_holders: Vec<ReferenceHolder>,
}

/// A reference to a merged record, held by a property of another entity.
#[derive(Debug, Clone, PartialEq)]
pub struct ReferenceHolder {
    /// The entity holding it.
    pub entity_type: models_properties::EntityType,
    /// Its id.
    pub entity_id: String,
    /// The user whose personal property holds it; `None` for a team or
    /// system property.
    pub owner: Option<String>,
}

/// The entries of merged records in one pipeline.
#[derive(Debug, Clone, PartialEq)]
pub struct PipelineMoves {
    /// The pipeline.
    pub pipeline_id: Uuid,
    /// Its entries for a merged record.
    pub entries: u32,
}

/// A committed merge.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct MergeOutcome {
    /// The merge's id in the merge log.
    pub merge_id: Uuid,
    /// The kind of record merged.
    pub record_type: MergeRecordType,
    /// The record that stays.
    pub survivor_id: Uuid,
    /// The records merged into it; their ids now open the record that stays.
    pub merged_ids: Vec<Uuid>,
    /// When the merge committed.
    pub committed_at: chrono::DateTime<chrono::Utc>,
}

/// Why a merge was refused.
#[derive(Debug, thiserror::Error)]
pub enum MergeError {
    /// The caller is not a team admin or owner.
    #[error("merging records requires the admin or owner team role")]
    PermissionRequired,
    /// Merging is not enabled for the caller.
    #[error("merging records is not available")]
    Unavailable,
    /// A record is missing, in another team, or not visible to the caller.
    #[error("a record to merge is unavailable")]
    RecordUnavailable,
    /// A record is archived; restore it before merging.
    #[error("archived records can't be merged; restore it first")]
    RecordHidden(Uuid),
    /// A record was merged into another since the caller looked.
    #[error("a record was already merged into another")]
    AlreadyMerged {
        /// The merged record's id.
        record_id: Uuid,
        /// The record it opens now.
        current_id: Uuid,
    },
    /// The records changed after the preview; review again.
    #[error("the records changed since the review; review the merge again")]
    PreviewStale,
    /// The request key was used for a different merge.
    #[error("this request key was used for a different merge")]
    RequestReused,
    /// The records must change before they can be merged.
    #[error("these records can't be merged until they change")]
    Conflict(MergeBlock),
    /// Keeping a teammate's sharing would exceed the rule limits.
    #[error(
        "keeping a teammate's email sharing would exceed the rule limits; choose to stop sharing instead"
    )]
    SharingRulesTooLarge,
    /// The request is malformed.
    #[error("{0}")]
    Invalid(String),
    /// Storage or CRM availability failed.
    #[error(transparent)]
    Crm(#[from] CrmError),
}

impl MergeError {
    /// The stable code clients and agents branch on.
    pub fn code(&self) -> &'static str {
        match self {
            Self::PermissionRequired => "merge_permission_required",
            Self::Unavailable => "merge_unavailable",
            Self::RecordUnavailable => "record_unavailable",
            Self::RecordHidden(_) => "record_hidden",
            Self::AlreadyMerged { .. } => "record_already_merged",
            Self::PreviewStale => "merge_preview_stale",
            Self::RequestReused => "merge_request_reused",
            Self::Conflict(_) => "merge_conflict",
            Self::SharingRulesTooLarge => "merge_sharing_rules_too_large",
            Self::Invalid(_) => "invalid_request",
            Self::Crm(CrmError::AccessDenied) => "crm_access_denied",
            Self::Crm(CrmError::Contended) => "contended",
            Self::Crm(_) => "storage_error",
        }
    }
}
