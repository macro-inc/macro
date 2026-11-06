//! Consent for team-sharing changes: a channel call's sharing only changes once
//! everyone on the call agrees, in either direction, live or archived. Every
//! entry point that changes sharing goes through here.

use super::*;
use crate::domain::models::{CallTeamShareState, PendingTeamShareChange, TeamShareChange};

fn opposite_change_conflict() -> CallError {
    CallError::Conflict("the opposite change is awaiting approval".to_string())
}

/// Who a change still waits on: everyone required who has not agreed to it.
fn waiting_on(approvers: Vec<String>, approved_by: &[String]) -> Vec<String> {
    approvers
        .into_iter()
        .filter(|approver| !approved_by.contains(approver))
        .collect()
}

impl<
    R: CallRepository,
    C: CallRtcClient,
    Cn: ConnectionService,
    E: EntityAccessService,
    N: NotificationIngress,
    S: RecordingStorage,
    Sm: CallSummarizer,
    V: VoipPushSender,
    Vr: VoiceRepository,
    B: MacroEventBroker,
> CallServiceImpl<R, C, Cn, E, N, S, Sm, V, Vr, B>
{
    /// Hold a proposed team-sharing change for the other participants' approval.
    ///
    /// Returns `false` when consent has nothing to say and the caller applies the
    /// change itself: the call has no channel, the value is not changing, or
    /// nobody else is on the call. Otherwise opens a request with the actor as
    /// its requester and returns `true`. Proposing a change that is already open
    /// is not an approval: those only come through
    /// [`CallService::respond_to_team_share_change`], which an agent acting for
    /// its person cannot reach.
    #[tracing::instrument(err, skip(self, record), fields(call_id = %record.call_id))]
    pub(super) async fn hold_team_share_change(
        &self,
        record: &CallRecord,
        actor: Option<&MacroUserIdStr<'static>>,
        shared: bool,
    ) -> Result<bool, CallError> {
        if record.channel_id.is_none() || shared == record.share_with_team {
            return Ok(false);
        }

        let call_id = record.call_id;
        if let Some(open) = self.repo.get_team_share_change(&call_id).await? {
            if open.shared != shared {
                return Err(opposite_change_conflict());
            }
            return Ok(true);
        }

        let approvers = self.repo.team_share_approvers(&call_id).await?;
        let nobody_else = approvers
            .iter()
            .all(|approver| actor.is_some_and(|actor| approver == actor.as_ref()));
        if nobody_else {
            return Ok(false);
        }

        let actor = actor.ok_or_else(|| {
            CallError::Forbidden("only a person can propose a team-sharing change".to_string())
        })?;
        let change = self
            .repo
            .approve_team_share_change(&call_id, shared, actor.copied())
            .await?
            .ok_or_else(opposite_change_conflict)?;
        tracing::info!(%call_id, shared, "team-sharing change awaits approval");
        self.send_team_share_change_updated(record, &approvers, &change)
            .await;
        Ok(true)
    }

    /// Add `actor`'s approval, then apply the change if nobody is left.
    async fn approve_and_settle(
        &self,
        record: &CallRecord,
        approvers: &[String],
        shared: bool,
        actor: &MacroUserIdStr<'static>,
    ) -> Result<(), CallError> {
        let call_id = record.call_id;
        let change = self
            .repo
            .approve_team_share_change(&call_id, shared, actor.copied())
            .await?
            .ok_or_else(opposite_change_conflict)?;

        if !waiting_on(approvers.to_vec(), &change.approved_by).is_empty() {
            tracing::info!(%call_id, shared, "team-sharing change awaits approval");
            self.send_team_share_change_updated(record, approvers, &change)
                .await;
            return Ok(());
        }

        self.apply_approved_change(record, actor, shared).await?;
        // Cleared only after the change applied, so a failure can be retried.
        self.repo.clear_team_share_change(&call_id).await?;
        tracing::info!(%call_id, shared, "team-sharing change approved by everyone");
        self.send_team_share_change_updated(record, approvers, &change)
            .await;
        Ok(())
    }

    /// Write the approved value. An archived call's canonical sharing belongs to
    /// its creator, whose agreement is part of what was just collected.
    async fn apply_approved_change(
        &self,
        record: &CallRecord,
        actor: &MacroUserIdStr<'static>,
        shared: bool,
    ) -> Result<(), CallError> {
        let call_id = record.call_id;
        let team_share = if record.is_active {
            None
        } else {
            let creator = MacroUserIdStr::parse_from_str(&record.created_by)
                .map_err(|error| CallError::Internal(anyhow::anyhow!("{error:?}")))?;
            let facts = self.repo.get_team_share_facts(&call_id).await?;
            authorize_team_share(
                Some(&creator),
                &facts,
                TeamShareRequest {
                    access_level: None,
                    legacy_enabled: Some(shared),
                },
                TeamShareLevel::View,
            )?
        };
        self.repo
            .patch_call_record(
                &call_id,
                &EditCallRecordRepoArgs {
                    share_permission: None,
                    custom_name: None,
                    team_share,
                    live_share_with_team: record.is_active.then_some(shared),
                },
            )
            .await?;

        self.publish_call_event(&CallMacroEvent::record_updated(CallRecordUpdatedMetadata {
            call_id,
            channel_id: record.channel_id,
            actor_user_id: Some(actor.clone()),
            custom_name: None,
            share_with_team: Some(shared),
        }));
        if record.is_active {
            self.send_call_participant_event(
                &call_id,
                "call_share_with_team_toggled",
                &serde_json::json!({
                    "call_id": call_id,
                    "channel_id": record.channel_id,
                    "share_with_team": shared,
                    "toggled_by": actor,
                }),
            )
            .await;
        }
        Ok(())
    }

    /// Tell everyone involved to reload the change (best-effort). Unlike the
    /// participant event this also reaches people who have left the call.
    async fn send_team_share_change_updated(
        &self,
        record: &CallRecord,
        approvers: &[String],
        change: &TeamShareChange,
    ) {
        let users: Vec<MacroUserIdStr<'static>> = approvers
            .iter()
            .chain(std::iter::once(&change.requested_by))
            .filter_map(|user| {
                MacroUserIdStr::parse_from_str(user)
                    .map(CowLike::into_owned)
                    .ok()
            })
            .collect();
        let message_type = "call_share_with_team_change_updated";
        let _ = self
            .connection_service
            .send_channel_message(
                &users,
                message_type,
                serde_json::json!({
                    "call_id": record.call_id,
                    "channel_id": record.channel_id,
                }),
            )
            .await
            .inspect_err(|error| {
                tracing::error!(error = ?error, message_type, "failed to send call event");
            });
    }

    /// The call's team sharing and any change awaiting approval.
    pub(super) async fn team_share_state(
        &self,
        call_id: &Uuid,
    ) -> Result<CallTeamShareState, CallError> {
        let record = self.record_for_team_share(call_id).await?;
        let pending = match self.repo.get_team_share_change(call_id).await? {
            Some(change) => {
                let approvers = self.repo.team_share_approvers(call_id).await?;
                Some(PendingTeamShareChange {
                    shared: change.shared,
                    waiting_on: waiting_on(approvers, &change.approved_by),
                    requested_by: change.requested_by,
                })
            }
            None => None,
        };
        Ok(CallTeamShareState {
            shared: record.share_with_team,
            pending,
        })
    }

    /// See [`CallService::respond_to_team_share_change`].
    #[tracing::instrument(err, skip(self, actor))]
    pub(super) async fn answer_team_share_change(
        &self,
        call_id: &Uuid,
        actor: &MacroUserIdStr<'static>,
        approve: bool,
    ) -> Result<(), CallError> {
        let Some(change) = self.repo.get_team_share_change(call_id).await? else {
            return Ok(());
        };
        let record = self.record_for_team_share(call_id).await?;
        let approvers = self.repo.team_share_approvers(call_id).await?;
        let is_requester = change.requested_by == actor.as_ref();
        if !is_requester && !approvers.iter().any(|approver| approver == actor.as_ref()) {
            return Err(CallError::Forbidden(
                "only the people on this call can answer its team-sharing change".to_string(),
            ));
        }

        if approve {
            self.approve_and_settle(&record, &approvers, change.shared, actor)
                .await?;
            return Ok(());
        }

        self.repo.clear_team_share_change(call_id).await?;
        tracing::info!(%call_id, shared = change.shared, "team-sharing change declined");
        self.send_team_share_change_updated(&record, &approvers, &change)
            .await;
        Ok(())
    }

    async fn record_for_team_share(&self, call_id: &Uuid) -> Result<CallRecord, CallError> {
        self.repo
            .get_call_record_by_call_id(call_id)
            .await
            .map_err(|error| CallError::Internal(error.into()))?
            .ok_or_else(|| CallError::NotFound(call_id.to_string()))
    }
}
