//! Agent tools for merging duplicate CRM records, over the same use case as
//! the merge routes. A merge can't be undone, so the agent reviews it with
//! PreviewMerge and commits that review's revision with MergeRecords.

#[cfg(test)]
mod test;

use std::sync::Arc;

use ai_toolset::{
    AsyncTool, AsyncToolCollection, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations,
    ToolCallError, ToolResult,
};
use async_trait::async_trait;
use entity_access::domain::ports::EntityAccessService;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::caller_team_receipt;
use crate::domain::record_merge::{
    MergeBlock, MergeCommand, MergeError, MergePreview, MergeRecordType, MergeTargets,
    SharingRulesChoice, service::RecordMerges,
};

/// The merge use case and the access service that resolves the caller's team.
pub struct MergeToolContext<Merges, ESvc> {
    /// Reviews and commits merges.
    pub merges: Arc<Merges>,
    /// Resolves the caller's team and role.
    pub entity_access_service: Arc<ESvc>,
}

impl<Merges, ESvc> Clone for MergeToolContext<Merges, ESvc> {
    fn clone(&self) -> Self {
        Self {
            merges: self.merges.clone(),
            entity_access_service: self.entity_access_service.clone(),
        }
    }
}

/// The merge tools.
pub fn merge_toolset<Merges, ESvc>() -> AsyncToolCollection<MergeToolContext<Merges, ESvc>>
where
    Merges: RecordMerges,
    ESvc: EntityAccessService,
{
    AsyncToolCollection::new()
        .add_tool::<PreviewMerge, MergeToolContext<Merges, ESvc>>()
        .add_tool::<MergeRecords, MergeToolContext<Merges, ESvc>>()
}

/// The kind of record merged.
#[derive(Debug, Clone, Copy, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ToolMergeRecordType {
    /// CRM companies.
    Company,
    /// CRM contacts (people).
    Contact,
}

impl From<ToolMergeRecordType> for MergeRecordType {
    fn from(record_type: ToolMergeRecordType) -> Self {
        match record_type {
            ToolMergeRecordType::Company => MergeRecordType::Company,
            ToolMergeRecordType::Contact => MergeRecordType::Contact,
        }
    }
}

/// What happens to teammates' email sharing that names a merged record.
#[derive(Debug, Clone, Copy, Default, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ToolSharingRules {
    /// Keep sharing exactly the same mail.
    #[default]
    Keep,
    /// Stop sharing it.
    Stop,
}

impl From<ToolSharingRules> for SharingRulesChoice {
    fn from(choice: ToolSharingRules) -> Self {
        match choice {
            ToolSharingRules::Keep => SharingRulesChoice::Keep,
            ToolSharingRules::Stop => SharingRulesChoice::Stop,
        }
    }
}

/// Review merging CRM records into one.
#[derive(Debug, Deserialize, JsonSchema, Clone)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "PreviewMerge",
    description = "Review merging duplicate CRM companies, or duplicate people (contacts), into the one that stays, without changing anything. Returns what moves (people, addresses, pipeline entries, references, discussion), the values that differ and which are kept, what email sync does, how many teammates' email sharing names a merged record, anything that blocks the merge, and the revision MergeRecords needs. Only team admins and owners can merge. Show the user the review before merging."
)]
pub struct PreviewMerge {
    /// The kind of record.
    #[schemars(description = "The kind of record: company or contact.")]
    pub record_type: ToolMergeRecordType,
    /// The record that stays.
    #[schemars(
        description = "The record that stays: its name and values win, and a company keeps its domains, a contact its company and primary address."
    )]
    pub survivor_id: Uuid,
    /// The records merged into it.
    #[schemars(
        description = "The records of the same kind merged into it and deleted, at most ten."
    )]
    pub source_ids: Vec<Uuid>,
}

impl ToolAnnotated for PreviewMerge {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::read_only("Review CRM merge");
}

/// A merge's review, as an agent reads it.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PreviewMergeResponse {
    /// Pass to MergeRecords to merge as reviewed.
    pub revision: String,
    /// The review: the record that stays and the ones merged into it, what
    /// moves, differing values, email sync, sharing and blocks.
    pub review: serde_json::Value,
}

/// Merge CRM records into one, as reviewed.
#[derive(Debug, Deserialize, JsonSchema, Clone)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "MergeRecords",
    description = "Merge duplicate CRM companies, or duplicate people (contacts), into the one that stays, exactly as a PreviewMerge review showed: for companies, people, domains and lists move to it; for contacts, addresses and mailbox sources; for both, pipeline entries, references, discussions and favorites. The merged records are deleted. It can't be undone; merge only after the user confirmed that review. Old ids keep opening the record that stays. Refused with merge_preview_stale when anything changed since the review: preview again."
)]
pub struct MergeRecords {
    /// The kind of record.
    #[schemars(description = "The kind of record: company or contact, as reviewed.")]
    pub record_type: ToolMergeRecordType,
    /// The record that stays.
    #[schemars(description = "The record that stays, as reviewed.")]
    pub survivor_id: Uuid,
    /// The records merged into it.
    #[schemars(description = "The records merged into it, as reviewed.")]
    pub source_ids: Vec<Uuid>,
    /// The review's revision.
    #[schemars(description = "The revision PreviewMerge returned.")]
    pub revision: String,
    /// A key for this merge; repeat it only to retry the same merge.
    #[schemars(
        description = "A new UUID for this merge. Reuse it only to retry the same call: a retry returns the first result."
    )]
    pub request_key: Uuid,
    /// Teammates' sharing that names a merged record.
    #[schemars(
        description = "keep (default): teammates keep sharing exactly the same mail. stop: they stop sharing mail from the merged records."
    )]
    #[serde(default)]
    pub sharing_rules: ToolSharingRules,
}

impl ToolAnnotated for MergeRecords {
    const ANNOTATIONS: ToolAnnotations =
        ToolAnnotations::destructive("Merge CRM records").with_idempotent();
}

/// A committed merge.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct MergeRecordsResponse {
    /// The merge.
    pub merge_id: Uuid,
    /// The record that stays.
    pub survivor_id: Uuid,
    /// The records merged into it; their ids open the record that stays.
    pub merged_ids: Vec<Uuid>,
}

fn merge_error(error: MergeError) -> ToolCallError {
    let description = match &error {
        MergeError::Conflict(MergeBlock::SameAddressPeople { people }) => format!(
            "merge_conflict: {} people under different companies share an address; change one before merging",
            people.len()
        ),
        MergeError::Conflict(MergeBlock::DifferentCompanies { people }) => format!(
            "merge_conflict: {} people are filed under another company than the contact that stays, with a work address or none; merge the companies first, or keep a contact filed under their company",
            people.len()
        ),
        MergeError::AlreadyMerged {
            record_id,
            current_id,
        } => format!(
            "record_already_merged: {record_id} was merged into {current_id}; preview again with that id"
        ),
        MergeError::RecordHidden(id) => {
            format!("record_hidden: {id} is archived; restore it before merging")
        }
        other => format!("{}: {other}", other.code()),
    };
    ToolCallError {
        description,
        internal_error: anyhow::anyhow!(error),
    }
}

fn review(preview: &MergePreview) -> serde_json::Value {
    let mut review = serde_json::to_value(preview).unwrap_or_default();
    if let Some(object) = review.as_object_mut() {
        object.remove("revision");
    }
    review
}

#[async_trait]
impl<Merges, ESvc> AsyncTool<MergeToolContext<Merges, ESvc>> for PreviewMerge
where
    Merges: RecordMerges,
    ESvc: EntityAccessService,
{
    type Output = PreviewMergeResponse;

    #[tracing::instrument(name = "crm.tool.preview_merge", skip_all, err)]
    async fn call(
        &self,
        service_context: ServiceContext<MergeToolContext<Merges, ESvc>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        let (team, _) =
            caller_team_receipt(&*service_context.entity_access_service, &request_context).await?;
        let targets = MergeTargets::new(
            self.record_type.into(),
            self.survivor_id,
            self.source_ids.iter().copied(),
        )
        .map_err(merge_error)?;
        let preview = service_context
            .merges
            .preview(&team, &targets)
            .await
            .map_err(merge_error)?;
        Ok(PreviewMergeResponse {
            revision: preview.revision.clone(),
            review: review(&preview),
        })
    }
}

#[async_trait]
impl<Merges, ESvc> AsyncTool<MergeToolContext<Merges, ESvc>> for MergeRecords
where
    Merges: RecordMerges,
    ESvc: EntityAccessService,
{
    type Output = MergeRecordsResponse;

    #[tracing::instrument(name = "crm.tool.merge_records", skip_all, err)]
    async fn call(
        &self,
        service_context: ServiceContext<MergeToolContext<Merges, ESvc>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        let (team, _) =
            caller_team_receipt(&*service_context.entity_access_service, &request_context).await?;
        let command = MergeCommand {
            targets: MergeTargets::new(
                self.record_type.into(),
                self.survivor_id,
                self.source_ids.iter().copied(),
            )
            .map_err(merge_error)?,
            revision: self.revision.clone(),
            request_key: self.request_key,
            sharing_rules: self.sharing_rules.into(),
        };
        let outcome = service_context
            .merges
            .commit(&team, &command)
            .await
            .map_err(merge_error)?;
        Ok(MergeRecordsResponse {
            merge_id: outcome.merge_id,
            survivor_id: outcome.survivor_id,
            merged_ids: outcome.merged_ids,
        })
    }
}
