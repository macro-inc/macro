//! Tear down RTC rooms that outlived their call.
//!
//! RTC tokens stay valid for hours and cannot be revoked, and the provider
//! recreates a deleted room when a token for it connects. A client answering a
//! stale ring therefore lands in a room no call tracks. A room is orphaned only
//! when it is named after an archived call: call ids are never reused, so an
//! archived call's room can never host a live session again. Every other room
//! without an active call (meeting preparations, the get-or-create race's
//! candidate room, rooms this deployment did not create) is left alone.

use std::collections::HashSet;
use std::sync::Arc;

use chrono::{DateTime, Utc};
use filter_ast::Expr;
use item_filters::ast::call::CallLiteral;

use super::reconcile::RECONCILE_GRACE;
use super::*;
use crate::domain::meetings::GuestId;

/// A person connected to an RTC room.
pub(super) enum RoomParticipant<'a> {
    /// A Macro user.
    User(MacroUserIdStr<'a>),
    /// A non-account meeting guest.
    Guest(GuestId),
}

impl RoomParticipant<'_> {
    /// Names the kind of participant for logs without identifying them.
    fn kind(&self) -> &'static str {
        match self {
            Self::User(_) => "user",
            Self::Guest(_) => "guest",
        }
    }
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
    /// The archived call a room without an active call belongs to.
    async fn archived_call_for_room(&self, room_name: &str) -> Result<Option<Uuid>, CallError> {
        let Ok(call_id) = Uuid::parse_str(room_name) else {
            return Ok(None);
        };
        let record = self
            .repo
            .get_call_record_by_call_id(&call_id)
            .await
            .map_err(|e| CallError::Internal(e.into()))?;
        Ok(record
            .filter(|record| !record.is_active && record.room_name.as_deref() == Some(room_name))
            .map(|record| record.call_id))
    }

    /// Handles a participant joining a room that has no active call: when the
    /// room belongs to an archived call, removes them and deletes the room.
    pub(super) async fn evict_from_untracked_room(
        &self,
        room_name: &str,
        participant: RoomParticipant<'_>,
    ) -> Result<(), CallError> {
        let participant_kind = participant.kind();
        let Some(call_id) = self.archived_call_for_room(room_name).await? else {
            tracing::warn!(
                room_name,
                call_record_exists = false,
                participant_kind,
                action = "ignored",
                "participant joined an RTC room that belongs to no call"
            );
            return Ok(());
        };
        let removed = match participant {
            RoomParticipant::User(user_id) => {
                self.rtc_client.remove_participant(room_name, user_id).await
            }
            RoomParticipant::Guest(guest_id) => {
                self.rtc_client.remove_guest(room_name, guest_id).await
            }
        };
        removed
            .inspect_err(|error| {
                tracing::error!(error = ?error, %call_id, "failed to remove participant from archived call room");
            })
            .ok();
        self.rtc_client
            .delete_room(room_name)
            .await
            .inspect_err(|error| {
                tracing::error!(error = ?error, %call_id, "failed to delete archived call room");
            })
            .ok();
        tracing::warn!(
            room_name,
            %call_id,
            call_record_exists = true,
            participant_kind,
            action = "evicted",
            "participant joined the RTC room of an archived call; removed it and deleted the room"
        );
        Ok(())
    }

    /// Deletes rooms of archived calls that a stale token recreated, once they
    /// are older than the reconcile grace period.
    #[tracing::instrument(
        name = "calls.sweep_orphan_rooms",
        err,
        skip_all,
        fields(
            rooms_listed = tracing::field::Empty,
            rooms_untracked = tracing::field::Empty,
            rooms_deleted = tracing::field::Empty,
        )
    )]
    pub(super) async fn sweep_orphan_rooms(
        &self,
        active_calls: &[Call],
        now: DateTime<Utc>,
    ) -> Result<(), CallError> {
        let rooms = self
            .rtc_client
            .list_rooms()
            .await
            .map_err(CallError::Internal)?;
        let active_rooms: HashSet<&str> = active_calls
            .iter()
            .map(|call| call.room_name.as_str())
            .collect();
        let mut untracked = 0_usize;
        let mut deleted = 0_usize;
        for room in &rooms {
            if active_rooms.contains(room.name.as_str()) || now - room.created_at < RECONCILE_GRACE
            {
                continue;
            }
            untracked += 1;
            let call_id = match self.archived_call_for_room(&room.name).await {
                Ok(Some(call_id)) => call_id,
                Ok(None) => continue,
                Err(error) => {
                    tracing::warn!(error = ?error, room_name = room.name, "failed to look up the call of an untracked RTC room");
                    continue;
                }
            };
            match self.rtc_client.delete_room(&room.name).await {
                Ok(()) => {
                    deleted += 1;
                    tracing::warn!(
                        room_name = room.name,
                        %call_id,
                        call_record_exists = true,
                        action = "deleted",
                        "deleted an RTC room that outlived its archived call"
                    );
                }
                Err(error) => {
                    tracing::error!(error = ?error, %call_id, "failed to delete archived call room");
                }
            }
        }
        let span = tracing::Span::current();
        span.record("rooms_listed", rooms.len());
        span.record("rooms_untracked", untracked);
        span.record("rooms_deleted", deleted);
        Ok(())
    }

    /// Best-effort: removes a user whose leave found no active call from the
    /// room of the channel's latest call, when that call is archived and the
    /// user is still connected to it.
    pub(super) async fn leave_archived_channel_room(
        &self,
        channel_id: &Uuid,
        user_id: MacroUserIdStr<'_>,
    ) {
        let filter = Some(Arc::new(Expr::Literal(CallLiteral::ChannelId(*channel_id))));
        let latest = match self
            .repo
            .get_call_records_by_user(
                user_id.copied(),
                1,
                &filter,
                CallRecordPage {
                    by_start: true,
                    after: None,
                },
            )
            .await
        {
            Ok(records) => records.into_iter().next(),
            Err(error) => {
                tracing::warn!(error = ?error, %channel_id, "failed to look up the channel's latest call");
                return;
            }
        };
        let Some((call_id, room_name)) = latest
            .filter(|record| !record.is_active)
            .and_then(|record| Some((record.call_id, record.room_name?)))
        else {
            return;
        };
        let connected = match self
            .rtc_client
            .list_participant_identities(&room_name)
            .await
        {
            Ok(connected) => connected.unwrap_or_default(),
            Err(error) => {
                tracing::warn!(error = ?error, %call_id, "failed to list archived call room participants");
                return;
            }
        };
        if !connected
            .iter()
            .any(|identity| identity == user_id.as_ref())
        {
            return;
        }
        match self
            .rtc_client
            .remove_participant(&room_name, user_id)
            .await
        {
            Ok(()) => tracing::warn!(
                room_name,
                %call_id,
                call_record_exists = true,
                participant_kind = "user",
                action = "removed",
                "leave found the user still connected to an archived call's RTC room"
            ),
            Err(error) => {
                tracing::error!(error = ?error, %call_id, "failed to remove participant from archived call room");
            }
        }
    }
}
