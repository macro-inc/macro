//! Reconcile RTC presence after missed leave webhooks and archive empty calls.

use std::collections::HashSet;

use chrono::{DateTime, TimeDelta, Utc};

use super::*;
use crate::domain::meetings::GuestId;

/// Someone who joined within this window may still be connecting, so their
/// absence from the RTC room is not yet evidence that they left.
pub(super) const RECONCILE_GRACE: TimeDelta = TimeDelta::minutes(2);

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
    /// Marks participants and guests who are no longer connected as left,
    /// then archives the call if that leaves it empty.
    #[tracing::instrument(err, skip(self, call), fields(call_id = %call.id))]
    pub(super) async fn reconcile_call(
        &self,
        call: &Call,
        now: DateTime<Utc>,
    ) -> Result<(), CallError> {
        let settled = |joined_at: DateTime<Utc>| now - joined_at >= RECONCILE_GRACE;
        let connected: HashSet<String> = self
            .rtc_client
            .list_participant_identities(&call.room_name)
            .await
            .map_err(CallError::Internal)?
            // A room that no longer exists has no one in it.
            .unwrap_or_default()
            .into_iter()
            .collect();
        let connected_guests: HashSet<GuestId> = connected
            .iter()
            .filter_map(|identity| GuestId::parse_rtc_identity(identity))
            .collect();

        let participants = self
            .repo
            .get_participants(&call.id)
            .await
            .map_err(|e| CallError::Internal(e.into()))?;
        for participant in participants {
            if !settled(participant.joined_at) || connected.contains(&participant.user_id) {
                continue;
            }
            let user_id = MacroUserIdStr::parse_from_str(&participant.user_id)
                .map_err(|e| CallError::Internal(e.into()))?;
            tracing::info!(user_id = %participant.user_id, "marking disconnected participant as left");
            self.repo
                .remove_participant(&call.id, user_id)
                .await
                .map_err(|e| CallError::Internal(e.into()))?;
        }

        let guests = self
            .repo
            .get_active_guests(&call.id)
            .await
            .map_err(|e| CallError::Internal(e.into()))?;
        for (guest_id, joined_at) in guests {
            if !settled(joined_at) || connected_guests.contains(&guest_id) {
                continue;
            }
            tracing::info!(%guest_id, "marking disconnected guest as left");
            self.repo.reconcile_guest(&call.id, guest_id, false).await?;
        }

        // A call created moments ago may not have anyone connected yet.
        if settled(call.created_at) {
            self.finish_empty_call(call).await?;
        }
        Ok(())
    }
}
