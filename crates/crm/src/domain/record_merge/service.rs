//! The merge use case shared by the HTTP routes, the SDK and agent tools.

use std::{collections::HashSet, sync::Arc};

use entity_access::domain::models::MemberTeamRole;
use macro_user_id::user_id::MacroUserIdStr;
use models_properties::EntityType as PropertyEntityType;
use uuid::Uuid;

use super::{MergeCommand, MergeError, MergeOutcome, MergePreview, MergeScope, MergeTargets};
use crate::domain::auth::{CrmMemberAccess, CrmTeamReceipt};

/// One entity property a merge wrote, published after commit so search and
/// open lists catch up.
#[derive(Debug, Clone, PartialEq)]
pub struct ChangedEntityProperty {
    /// The `entity_properties` row.
    pub entity_property_id: Uuid,
    /// The entity holding the property.
    pub entity_id: String,
    /// Its type.
    pub entity_type: PropertyEntityType,
    /// The property definition.
    pub property_definition_id: Uuid,
    /// Its value now.
    pub value: Option<models_properties::service::property_value::PropertyValue>,
    /// Its value before the merge, when it changed.
    pub previous_value: Option<models_properties::service::property_value::PropertyValue>,
    /// When the row was written.
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

/// What a commit did, as the repository reports it.
#[derive(Debug, Clone, PartialEq)]
pub struct MergeCommitted {
    /// The merge, as the log stores it.
    pub outcome: MergeOutcome,
    /// True when the request key had already committed this merge: nothing
    /// was written.
    pub replayed: bool,
    /// Entity properties written, for publication.
    pub changed_properties: Vec<ChangedEntityProperty>,
    /// The teammates whose email sharing rules the merge rewrote, to tell.
    pub sharing_owners: Vec<String>,
}

/// Storage for merges: locks the records, recomputes the review under the
/// locks and moves every owner's rows in one transaction.
pub trait RecordMergeRepository: CrmMemberAccess + Send + Sync + 'static {
    /// The review of a merge, read under the locks a commit takes.
    fn preview(
        &self,
        scope: &MergeScope,
        targets: &MergeTargets,
    ) -> impl Future<Output = Result<MergePreview, MergeError>> + Send;

    /// Commit a merge whose review still has the command's revision.
    fn commit(
        &self,
        scope: &MergeScope,
        command: &MergeCommand,
    ) -> impl Future<Output = Result<MergeCommitted, MergeError>> + Send;
}

/// The rollout gate. Missing or failed evaluations keep merging off.
#[async_trait::async_trait]
pub trait MergeGate: std::fmt::Debug + Send + Sync {
    /// Whether the user may merge records.
    async fn enabled_for(&self, user: MacroUserIdStr<'_>) -> bool;
}

/// Publishes what a commit changed in other domains. Best effort: a failed
/// publication delays search, never the merge.
pub trait MergeEffects: Send + Sync {
    /// Publish the property rows a merge wrote.
    fn properties_changed(&self, changes: &[ChangedEntityProperty]);
}

/// The pipelines a user can open. A review names and counts only those;
/// the commit still moves every entry.
#[async_trait::async_trait]
pub trait MergePipelineAccess: Send + Sync {
    /// Which of `pipelines` the user can open.
    async fn readable(
        &self,
        user: &MacroUserIdStr<'static>,
        pipelines: &[Uuid],
    ) -> Result<HashSet<Uuid>, MergeError>;
}

/// The entities a user can open. A review counts only the references held
/// by those; the commit still moves every reference.
#[async_trait::async_trait]
pub trait MergeReferenceAccess: Send + Sync {
    /// Which of `entities` the user can open.
    async fn readable(
        &self,
        user: &MacroUserIdStr<'static>,
        entities: &[(PropertyEntityType, String)],
    ) -> Result<HashSet<(PropertyEntityType, String)>, MergeError>;
}

/// Tells members their own settings changed with a merge. Best effort: a
/// notice that fails never undoes the merge.
#[async_trait::async_trait]
pub trait MergeNotices: Send + Sync {
    /// Tell each of `owners` once that their email sharing rules in `team_id`
    /// changed because companies were merged.
    async fn sharing_rules_changed(&self, team_id: Uuid, merge_id: Uuid, owners: &[String]);
}

/// The merge operations inbound adapters call.
pub trait RecordMerges: Send + Sync + 'static {
    /// Review a merge.
    fn preview(
        &self,
        access: &CrmTeamReceipt<MemberTeamRole>,
        targets: &MergeTargets,
    ) -> impl Future<Output = Result<MergePreview, MergeError>> + Send;

    /// Commit a reviewed merge.
    fn commit(
        &self,
        access: &CrmTeamReceipt<MemberTeamRole>,
        command: &MergeCommand,
    ) -> impl Future<Output = Result<MergeOutcome, MergeError>> + Send;
}

/// Merges records for team admins and owners while the rollout gate allows.
pub struct RecordMergeService<R> {
    repository: R,
    gate: Option<Arc<dyn MergeGate>>,
    effects: Option<Arc<dyn MergeEffects>>,
    pipelines: Option<Arc<dyn MergePipelineAccess>>,
    references: Option<Arc<dyn MergeReferenceAccess>>,
    notices: Option<Arc<dyn MergeNotices>>,
}

impl<R: RecordMergeRepository> RecordMergeService<R> {
    /// A service that refuses every merge until a gate is attached.
    pub fn new(repository: R) -> Self {
        Self {
            repository,
            gate: None,
            effects: None,
            pipelines: None,
            references: None,
            notices: None,
        }
    }

    /// Attach the rollout gate.
    pub fn with_gate(mut self, gate: Arc<dyn MergeGate>) -> Self {
        self.gate = Some(gate);
        self
    }

    /// Attach the publisher for changes in other domains.
    pub fn with_effects(mut self, effects: Arc<dyn MergeEffects>) -> Self {
        self.effects = Some(effects);
        self
    }

    /// Attach pipeline access; without it a review names no pipeline.
    pub fn with_pipeline_access(mut self, pipelines: Arc<dyn MergePipelineAccess>) -> Self {
        self.pipelines = Some(pipelines);
        self
    }

    /// Attach the notices to members whose settings a merge changes.
    pub fn with_notices(mut self, notices: Arc<dyn MergeNotices>) -> Self {
        self.notices = Some(notices);
        self
    }

    /// Attach entity access; without it a review counts no reference.
    pub fn with_reference_access(mut self, references: Arc<dyn MergeReferenceAccess>) -> Self {
        self.references = Some(references);
        self
    }

    /// How many of the moving references `actor` could see: held by an
    /// entity they can open, in a team or system property or their own.
    async fn visible_references(
        &self,
        actor: &MacroUserIdStr<'static>,
        holders: &[super::ReferenceHolder],
    ) -> Result<u32, MergeError> {
        let Some(access) = &self.references else {
            return Ok(0);
        };
        let own = |holder: &super::ReferenceHolder| {
            holder
                .owner
                .as_deref()
                .is_none_or(|owner| owner.eq_ignore_ascii_case(actor.as_ref()))
        };
        let mut entities: Vec<(PropertyEntityType, String)> = holders
            .iter()
            .filter(|holder| own(holder))
            .map(|holder| (holder.entity_type, holder.entity_id.clone()))
            .collect();
        entities.sort_by(|a, b| (a.0.to_string(), &a.1).cmp(&(b.0.to_string(), &b.1)));
        entities.dedup();
        if entities.is_empty() {
            return Ok(0);
        }
        let readable = access.readable(actor, &entities).await?;
        let visible = holders
            .iter()
            .filter(|holder| {
                own(holder) && readable.contains(&(holder.entity_type, holder.entity_id.clone()))
            })
            .count();
        Ok(u32::try_from(visible).unwrap_or(u32::MAX))
    }

    async fn scope(
        &self,
        access: &CrmTeamReceipt<MemberTeamRole>,
    ) -> Result<MergeScope, MergeError> {
        // A team-scoped agent acts for no one, so it can't hold the role.
        let actor = access
            .receipt()
            .acting_user_id()
            .cloned()
            .ok_or(MergeError::PermissionRequired)?;
        let enabled = match &self.gate {
            Some(gate) => gate.enabled_for(actor.clone()).await,
            None => false,
        };
        if !enabled {
            return Err(MergeError::Unavailable);
        }
        access.check_access(&self.repository).await?;
        if !access.has_admin_role() {
            return Err(MergeError::PermissionRequired);
        }
        Ok(MergeScope {
            team_id: access.team_id(),
            actor,
        })
    }
}

impl<R: RecordMergeRepository> RecordMerges for RecordMergeService<R> {
    #[tracing::instrument(
        name = "crm.merge.preview",
        skip_all,
        fields(team_id = %access.team_id(), record_type = targets.record_type().as_str(), sources = targets.sources().len()),
        err
    )]
    async fn preview(
        &self,
        access: &CrmTeamReceipt<MemberTeamRole>,
        targets: &MergeTargets,
    ) -> Result<MergePreview, MergeError> {
        let scope = self.scope(access).await?;
        let mut preview = self.repository.preview(&scope, targets).await?;
        // Admins aren't granted every pipeline; one they can't open stays
        // out of the review. Its revision still binds them all.
        let mut holders: Vec<Uuid> = preview
            .pipeline_moves
            .iter()
            .map(|moves| moves.pipeline_id)
            .chain(
                preview
                    .shared_pipelines
                    .iter()
                    .map(|shared| shared.pipeline_id),
            )
            .collect();
        holders.sort_unstable();
        holders.dedup();
        let readable = match &self.pipelines {
            Some(pipelines) if !holders.is_empty() => {
                pipelines.readable(&scope.actor, &holders).await?
            }
            _ => HashSet::new(),
        };
        preview
            .shared_pipelines
            .retain(|shared| readable.contains(&shared.pipeline_id));
        preview.moves.pipeline_entries = preview
            .pipeline_moves
            .iter()
            .filter(|moves| readable.contains(&moves.pipeline_id))
            .map(|moves| moves.entries)
            .fold(0u32, u32::saturating_add);
        // Nor does it count teammates' private items or properties that
        // point at a merged company.
        preview.moves.references = self
            .visible_references(&scope.actor, &preview.reference_holders)
            .await?;
        Ok(preview)
    }

    #[tracing::instrument(
        name = "crm.merge.commit",
        skip_all,
        fields(
            team_id = %access.team_id(),
            record_type = command.targets.record_type().as_str(),
            sources = command.targets.sources().len(),
            merge_id = tracing::field::Empty,
            replayed = tracing::field::Empty,
        ),
        err
    )]
    async fn commit(
        &self,
        access: &CrmTeamReceipt<MemberTeamRole>,
        command: &MergeCommand,
    ) -> Result<MergeOutcome, MergeError> {
        let scope = self.scope(access).await?;
        let committed = self.repository.commit(&scope, command).await?;
        let span = tracing::Span::current();
        span.record(
            "merge_id",
            tracing::field::display(committed.outcome.merge_id),
        );
        span.record("replayed", committed.replayed);
        if !committed.replayed
            && !committed.changed_properties.is_empty()
            && let Some(effects) = &self.effects
        {
            effects.properties_changed(&committed.changed_properties);
        }
        // Their sharing history records it too, but only a notice reaches
        // someone who doesn't open it.
        if !committed.replayed
            && !committed.sharing_owners.is_empty()
            && let Some(notices) = &self.notices
        {
            notices
                .sharing_rules_changed(
                    scope.team_id,
                    committed.outcome.merge_id,
                    &committed.sharing_owners,
                )
                .await;
        }
        Ok(committed.outcome)
    }
}
