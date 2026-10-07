use super::*;
use models_forms::UpdateForm;

impl<
    C: AuthoringCore,
    D: DatabasesService,
    J: AuthoringJournal,
    B: AuthoringBooking,
    A: AuthoringAccess,
    E: AuthoringEditor,
> AuthoringWorkflow<C, D, J, B, A, E>
{
    pub(super) async fn set_access(
        &self,
        actor: Viewer,
        intent: SetAccess,
    ) -> Result<MutationResult, AuthoringError> {
        let owner = self
            .receipt::<OwnerAccessLevel>(&actor, intent.form_id)
            .await?;
        if let Some(operation) = self
            .journal
            .operation(
                &actor.user_id,
                AuthoringOperationId::from_uuid(intent.request_id.into_uuid()),
            )
            .await?
        {
            if operation.intent != Intent::Access(intent) {
                return Err(AuthoringError::new(
                    Code::IdempotencyConflict,
                    "requestId",
                    "Use a new requestId for changed access settings.",
                ));
            }
            return Ok(operation.result);
        }
        let receipt = owner
            .try_into_requirement::<EditAccessLevel>()
            .map_err(failure)?;
        let mut latest = self
            .core
            .authoring_snapshot(receipt.clone())
            .await
            .map_err(form_failure)?;
        latest.grants = self.journal.grants(intent.form_id).await?;
        if review_revision(&actor.user_id, &latest)? != intent.base_revision {
            return Err(stale("baseRevision"));
        }
        if intent.draft.channel_grants.len() > 100 {
            return Err(AuthoringError::new(
                Code::InvalidAccess,
                "channelGrants",
                "Change at most 100 channels at once.",
            ));
        }
        let mut channels = std::collections::HashSet::new();
        for change in &intent.draft.channel_grants {
            let id = match change {
                GrantChange::Upsert { channel_id, .. } | GrantChange::Remove { channel_id } => {
                    channel_id
                }
            };
            if !channels.insert(id) {
                return Err(AuthoringError::new(
                    Code::InvalidAccess,
                    "channelGrants",
                    "Each channel may appear only once.",
                ));
            }
        }
        let exposes = (intent.draft.status == models_forms::FormStatus::Open
            && latest.form.status != models_forms::FormStatus::Open)
            || (intent.draft.audience == models_forms::Audience::Public
                && latest.form.audience != models_forms::Audience::Public)
            || (intent.draft.tally_visible && !latest.form.tally_visible)
            || latest
                .form
                .closes_at
                .is_some_and(|old| intent.draft.closes_at.is_none_or(|new| new > old))
            || intent
                .draft
                .channel_grants
                .iter()
                .any(|change| match change {
                    GrantChange::Remove { .. } => false,
                    GrantChange::Upsert { channel_id, access } => latest
                        .grants
                        .iter()
                        .find(|g| g.channel_id == *channel_id)
                        .is_none_or(|old| {
                            old.access == GrantAccess::View && *access == GrantAccess::Edit
                        }),
                });
        if exposes {
            if !latest.projected {
                return Err(AuthoringError::new(
                    Code::InvalidDraft,
                    "draft",
                    "Repair the draft and ReadForm again before opening or broadening access.",
                ));
            }
            validate::canonical_preserving(
                &latest.layout,
                &latest.columns,
                &managed(&latest),
                intent.draft.audience,
                Some(&latest.layout),
            )?;
            self.targets(&actor, &latest.layout).await?;
        }
        // Booking readiness can involve remote calls. Make the freshness check
        // against the durable document after them, immediately before PG CAS.
        // Subsequent collaborative edits remain live; this is not a frozen release.
        let mut checked = self
            .core
            .authoring_snapshot(receipt.clone())
            .await
            .map_err(form_failure)?;
        checked.grants = self.journal.grants(intent.form_id).await?;
        if checked.form != latest.form
            || !revision_matches(&checked.revision, &latest.revision).map_err(failure)?
            || checked.columns != latest.columns
            || checked.grants != latest.grants
        {
            return Err(stale("baseRevision"));
        }
        latest = checked;
        let operation = Self::operation(Intent::Access(intent.clone()), intent.form_id, None);
        let mut operation = match self.journal.claim(&actor.user_id, operation).await? {
            Claim::Existing(operation) => return Ok(operation.result),
            Claim::New(operation) => operation,
        };
        let result = async {
            self.journal.settings(&latest, &UpdateForm { audience: Some(intent.draft.audience), status: Some(intent.draft.status), closes_at: Some(intent.draft.closes_at), tally_visible: Some(intent.draft.tally_visible), ..Default::default() }, &intent.draft.channel_grants, true, exposes).await?;
            self.core.authoring_changed(receipt.clone(), !intent.draft.channel_grants.is_empty()).await;
            self.phase(&actor, &mut operation, OperationPhase::SettingsApplied).await?;
            let snapshot = self.core.authoring_snapshot(receipt).await.map_err(form_failure)?;
            if !revision_matches(&snapshot.revision, &latest.revision).map_err(failure)? {
                operation.result.diagnostics.push(AuthoringError::new(Code::ConcurrentFieldChange, "draft", "Access settings were saved. A subsequent live editor change is reflected in the returned draft; this review did not freeze publication.").into());
            }
            Ok(snapshot)
        }.await;
        self.outcome(&actor, operation, result).await
    }
}
