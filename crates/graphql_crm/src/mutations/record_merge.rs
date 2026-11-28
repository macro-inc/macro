use std::sync::Arc;

use async_graphql::{Enum, ErrorExtensions, ID, InputObject, SimpleObject, Value};
use crm::domain::{
    auth::CrmTeamReceipt,
    record_merge::{
        MergeCommand, MergeError, MergeOutcome, MergeRecordType, MergeTargets, SharingRulesChoice,
        service::RecordMerges,
    },
};
use entity_access::domain::ports::EntityAccessService;
use graphql_entity_mutation::GraphqlEntityMutationResult;
use graphql_soup::SoupEntityEdges;
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::EntityType;

use super::{WriteFuture, coded_error, parse_id};

/// The type of CRM record combined by a merge.
#[derive(Clone, Copy, Enum, Eq, PartialEq)]
enum CrmMergeRecordType {
    /// The merge combines companies.
    Company,
    /// The merge combines contacts.
    Contact,
}

/// How to preserve a teammate's email sharing for the source records.
#[derive(Clone, Copy, Enum, Eq, PartialEq)]
enum CrmMergeSharing {
    /// Keep sharing exactly the domains or addresses previously shared.
    Keep,
    /// Remove sharing rules attached to source records.
    Stop,
}

/// Confirmation of a reviewed CRM merge.
#[derive(InputObject)]
pub(super) struct CommitCrmMergeInput {
    /// What type of CRM record to combine.
    record_type: CrmMergeRecordType,
    /// The record that stays.
    pub(super) survivor_id: ID,
    /// The records to merge into the survivor.
    source_ids: Vec<ID>,
    /// The review revision the caller confirmed.
    revision: String,
    /// The same key must be used for every delivery of this confirmation.
    request_key: ID,
    /// What happens to teammates' email sharing rules on the source records.
    sharing_rules: CrmMergeSharing,
}

impl CommitCrmMergeInput {
    fn into_command(self) -> async_graphql::Result<MergeCommand> {
        let record_type = match self.record_type {
            CrmMergeRecordType::Company => MergeRecordType::Company,
            CrmMergeRecordType::Contact => MergeRecordType::Contact,
        };
        let survivor_id = parse_id(&self.survivor_id, "survivorId")?;
        let source_ids = self
            .source_ids
            .iter()
            .map(|id| parse_id(id, "sourceIds"))
            .collect::<async_graphql::Result<Vec<_>>>()?;
        Ok(MergeCommand {
            targets: MergeTargets::new(record_type, survivor_id, source_ids)
                .map_err(merge_error)?,
            revision: self.revision,
            request_key: parse_id(&self.request_key, "requestKey")?,
            sharing_rules: match self.sharing_rules {
                CrmMergeSharing::Keep => SharingRulesChoice::Keep,
                CrmMergeSharing::Stop => SharingRulesChoice::Stop,
            },
        })
    }
}

/// The committed merge's identity and cache effects.
#[derive(SimpleObject)]
pub(super) struct CrmMergePayload<E: SoupEntityEdges> {
    /// The merge log identifier.
    merge_id: ID,
    /// The record that stays.
    survivor_id: ID,
    /// Source records removed by the merge.
    merged_ids: Vec<ID>,
    /// Source tombstones and the primary Soup row for the survivor.
    result: Option<GraphqlEntityMutationResult<E>>,
}

impl<E: SoupEntityEdges> From<MergeOutcome> for CrmMergePayload<E> {
    fn from(outcome: MergeOutcome) -> Self {
        let entity_type = match outcome.record_type {
            MergeRecordType::Company => EntityType::CrmCompany,
            MergeRecordType::Contact => EntityType::CrmContact,
        };
        let survivor_id = outcome.survivor_id.to_string();
        let merged_ids: Vec<_> = outcome
            .merged_ids
            .iter()
            .map(|id| ID(id.to_string()))
            .collect();
        let result = GraphqlEntityMutationResult::from_updated_and_deleted_entities(
            [entity_type.with_entity_string(survivor_id.clone())],
            merged_ids
                .iter()
                .map(|id| entity_type.with_entity_string(id.to_string())),
        );
        Self {
            merge_id: ID(outcome.merge_id.to_string()),
            survivor_id: ID(survivor_id),
            merged_ids,
            result: Some(result),
        }
    }
}

pub(super) trait CrmMergeWriteApi: Send + Sync {
    fn commit(
        &self,
        viewer: MacroUserIdStr<'static>,
        input: CommitCrmMergeInput,
    ) -> WriteFuture<'_, MergeOutcome>;
}

pub(super) struct CrmMergeWriteAdapter<M, A> {
    pub(super) merges: Arc<M>,
    pub(super) access: Arc<A>,
}

impl<M: RecordMerges, A: EntityAccessService> CrmMergeWriteApi for CrmMergeWriteAdapter<M, A> {
    fn commit(
        &self,
        viewer: MacroUserIdStr<'static>,
        input: CommitCrmMergeInput,
    ) -> WriteFuture<'_, MergeOutcome> {
        Box::pin(async move {
            let command = input.into_command()?;
            let receipt = CrmTeamReceipt::for_user(self.access.as_ref(), viewer)
                .await
                .map_err(|error| super::access_error(error, "merge_permission_required"))?;
            self.merges
                .commit(&receipt, &command)
                .await
                .map_err(merge_error)
        })
    }
}

fn merge_error(error: MergeError) -> async_graphql::Error {
    let code = error.code();
    if code == "storage_error" {
        tracing::error!(?error, "CRM merge failed");
        return coded_error("CRM merge failed", code);
    }
    coded_error(error.to_string(), code).extend_with(|_, extensions| match &error {
        MergeError::AlreadyMerged { current_id, .. } => {
            extensions.set("currentId", current_id.to_string());
        }
        MergeError::Conflict(block) => {
            if let Ok(block) = serde_json::to_value(block).and_then(Value::from_json) {
                extensions.set("blocked", block);
            }
        }
        _ => {}
    })
}
