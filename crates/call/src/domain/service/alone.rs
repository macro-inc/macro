//! End calls whose only connected person is one Macro user who stopped
//! choosing to stay.
//!
//! The per-call sweep runs on every service instance, so each transition is a
//! conditional write that one instance wins, and only that instance sends the
//! transition's event. A warned user is re-sent the warning on every sweep so a
//! client that was suspended still learns the deadline. A lone guest never
//! times out: guests have no connection to receive the warning on.

use chrono::{DateTime, TimeDelta, Utc};
use tracing::field::Empty;

use super::*;

/// How long one Macro user may be alone in a call before being warned.
pub(super) const ALONE_WARNING_AFTER: TimeDelta = TimeDelta::minutes(5);

/// How long after the warning the call ends unless the user stays.
pub(super) const ALONE_END_GRACE: TimeDelta = TimeDelta::minutes(2);

/// Who is connected to a call's RTC room, ignoring agents and recorders.
pub(super) struct ConnectedPeople {
    /// Connected Macro users.
    pub(super) users: Vec<MacroUserIdStr<'static>>,
    /// How many non-account guests are connected.
    pub(super) guests: usize,
}

impl<R, C, Cn, E, N, S, Sm, V, Vr, B> CallServiceImpl<R, C, Cn, E, N, S, Sm, V, Vr, B>
where
    R: CallRepository + Clone,
    C: CallRtcClient,
    Cn: ConnectionService,
    E: EntityAccessService,
    N: NotificationIngress,
    S: RecordingStorage,
    Sm: CallSummarizer + Clone,
    V: VoipPushSender,
    Vr: VoiceRepository + Clone,
    B: MacroEventBroker + Clone,
{
    /// Advances the call's alone timeout. Returns whether it ended the call.
    #[tracing::instrument(
        name = "calls.alone_timeout",
        err,
        skip_all,
        fields(call_id = %call.id, alone_secs = Empty, outcome = Empty)
    )]
    pub(super) async fn enforce_alone_timeout(
        &self,
        call: &Call,
        connected: &ConnectedPeople,
        now: DateTime<Utc>,
    ) -> Result<bool, CallError> {
        let span = tracing::Span::current();
        let lone_user = match (connected.users.as_slice(), connected.guests) {
            ([user], 0) => user,
            // Someone may still be reconnecting; keep the alone period.
            ([], 0) => {
                span.record("outcome", "unoccupied");
                return Ok(false);
            }
            _ => {
                let outcome = if self.repo.clear_call_alone(&call.id).await? {
                    for user in &connected.users {
                        self.send_alone_cleared(call, user.copied()).await;
                    }
                    tracing::info!(call_id = %call.id, "alone warning cleared by company");
                    "cleared"
                } else {
                    "accompanied"
                };
                span.record("outcome", outcome);
                return Ok(false);
            }
        };

        let Some(state) = self.repo.mark_call_alone(&call.id, now).await? else {
            span.record("outcome", "inactive");
            return Ok(false);
        };
        span.record("alone_secs", (now - state.alone_since).num_seconds());

        let outcome = match state.warned_at {
            Some(warned_at) if now - warned_at >= ALONE_END_GRACE => {
                return self.end_alone_call(call, lone_user.copied(), now).await;
            }
            Some(warned_at) => {
                self.send_alone_warning(call, lone_user.copied(), warned_at + ALONE_END_GRACE)
                    .await;
                "warning_resent"
            }
            None if now - state.alone_since >= ALONE_WARNING_AFTER => {
                match self
                    .repo
                    .warn_alone_call(&call.id, now, now - ALONE_WARNING_AFTER)
                    .await?
                {
                    Some(warned_at) => {
                        let ends_at = warned_at + ALONE_END_GRACE;
                        self.send_alone_warning(call, lone_user.copied(), ends_at)
                            .await;
                        tracing::info!(call_id = %call.id, %ends_at, "warned the only person in the call");
                        "warned"
                    }
                    // Another instance warned first; the next sweep re-sends.
                    None => "alone",
                }
            }
            None if state.newly_alone => "started",
            None => "alone",
        };
        span.record("outcome", outcome);
        Ok(false)
    }

    /// Ends a call whose warned user's grace period ran out.
    async fn end_alone_call(
        &self,
        call: &Call,
        lone_user: MacroUserIdStr<'_>,
        now: DateTime<Utc>,
    ) -> Result<bool, CallError> {
        let span = tracing::Span::current();
        let archived = match self
            .repo
            .archive_alone_call(&call.id, now - ALONE_END_GRACE)
            .await
        {
            Ok(Some(archived)) => archived,
            // The user chose to stay after this sweep read the warning.
            Ok(None) => {
                span.record("outcome", "stayed");
                return Ok(false);
            }
            // Another instance or webhook archived it first.
            Err(CallError::NotFound(_)) => {
                span.record("outcome", "inactive");
                return Ok(true);
            }
            Err(error) => return Err(error),
        };
        self.rtc_client
            .remove_participant(&call.room_name, lone_user)
            .await
            .inspect_err(|error| {
                tracing::error!(error = ?error, call_id = %call.id, "failed to remove the only person from the timed-out call");
            })
            .ok();
        self.complete_archival(call, &archived, CallArchiveReason::AloneTimeout)
            .await;
        span.record("outcome", "ended");
        tracing::warn!(
            call_id = %call.id,
            duration_ms = archived.duration_ms,
            "ended a call whose only person did not choose to stay"
        );
        Ok(true)
    }

    /// Tells the lone user's devices when the call will end.
    async fn send_alone_warning(
        &self,
        call: &Call,
        user_id: MacroUserIdStr<'_>,
        ends_at: DateTime<Utc>,
    ) {
        self.connection_service
            .send_channel_message(
                &[user_id],
                "call_alone_warning",
                serde_json::json!({
                    "channel_id": call.channel_id,
                    "call_id": call.id,
                    "ends_at": ends_at,
                }),
            )
            .await
            .inspect_err(
                |error| tracing::error!(error = ?error, "failed to send call alone warning"),
            )
            .ok();
    }

    /// Tells a user's devices to dismiss the alone warning.
    pub(super) async fn send_alone_cleared(&self, call: &Call, user_id: MacroUserIdStr<'_>) {
        self.connection_service
            .send_channel_message(
                &[user_id],
                "call_alone_cleared",
                serde_json::json!({
                    "channel_id": call.channel_id,
                    "call_id": call.id,
                }),
            )
            .await
            .inspect_err(
                |error| tracing::error!(error = ?error, "failed to send call alone cleared"),
            )
            .ok();
    }

    /// Restarts the alone period for a participant who chose to stay.
    #[tracing::instrument(err, skip(self, user_id))]
    pub(super) async fn stay_in_active_call(
        &self,
        call_id: &Uuid,
        user_id: MacroUserIdStr<'_>,
    ) -> Result<(), CallError> {
        let call = self
            .repo
            .get_call_by_id(call_id)
            .await
            .map_err(|e| CallError::Internal(e.into()))?
            .ok_or_else(|| CallError::NotFound(call_id.to_string()))?;
        if !self
            .repo
            .reset_call_alone(&call.id, user_id.copied(), Utc::now())
            .await?
        {
            return Err(CallError::NotFound(call_id.to_string()));
        }
        self.send_alone_cleared(&call, user_id).await;
        Ok(())
    }
}
