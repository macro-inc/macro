//! Call settings, and applying recording and sharing rules when a call starts
//! or a standalone call changes kind: when its third participant, or its first
//! from outside its host's team, joins.

use super::*;
use crate::domain::recording::{
    CallKind, CallKinds, CallPreferences, CallSettings, MeetingKindChange, RecordingRules,
    ShareAudience, ShareByDefault, TeamCallPolicy, UpdateCallSettingsRequest,
    UpdateTeamCallPolicyRequest,
};
use entity_access::domain::models::{AdminTeamRole, TeamRole, UserTeamInfo};
use tracing::Instrument;

/// Someone about to receive credentials for a standalone call.
#[derive(Debug)]
pub(super) enum MeetingJoiner<'a> {
    /// A signed-in Macro user.
    Account(MacroUserIdStr<'a>),
    /// A guest without a Macro account, who is never on the host's team.
    Guest,
}

/// How a new huddle begins.
#[derive(Debug, Default, PartialEq, Eq)]
pub(super) struct HuddleStart {
    /// It starts recording.
    pub record: bool,
    /// It dispatches a transcriber.
    pub transcribe: bool,
    /// It starts with "Share with team" on.
    pub share: bool,
    /// Members of its two-person direct message who refuse being recorded or
    /// transcribed there.
    pub refused_by: Vec<String>,
}

/// What a failed rules lookup falls back to: recording nothing is safer than
/// recording a call the host's team may have blocked.
const RECORD_NOTHING: RecordingRules = RecordingRules {
    record_by_default: CallKinds::NONE,
    blocked: CallKinds::ALL,
};

impl<
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
> CallServiceImpl<R, C, Cn, E, N, S, Sm, V, Vr, B>
{
    async fn user_team(&self, user: MacroUserIdStr<'_>) -> Result<Option<UserTeamInfo>, CallError> {
        self.entity_access_service
            .get_user_team(&user)
            .await
            .map_err(|error| CallError::Internal(error.into()))
    }

    /// The rules for calls `host` starts, or `None` when this deployment has
    /// no recorder.
    pub(super) async fn host_recording_rules(&self, host: &str) -> Option<RecordingRules> {
        self.egress_s3_config.as_ref()?;
        let rules = async {
            let host = MacroUserIdStr::parse_from_str(host)
                .map_err(|error| CallError::Internal(error.into()))?;
            let team = self.user_team(host.copied()).await?;
            self.repo
                .get_recording_rules(host, team.map(|team| team.team_id))
                .await
        }
        .await;
        Some(rules.unwrap_or_else(|error| {
            tracing::error!(error = ?error, "failed to load recording rules; not recording");
            RECORD_NOTHING
        }))
    }

    /// `host`'s call settings with their team's blocks.
    async fn host_call_preferences(
        &self,
        host: MacroUserIdStr<'_>,
    ) -> Result<CallPreferences, CallError> {
        let team = self.user_team(host.copied()).await?;
        self.repo
            .get_call_preferences(host, team.map(|team| team.team_id))
            .await
    }

    /// Whether `host`'s team forbids sharing their huddles with it.
    pub(super) async fn huddle_sharing_blocked(&self, host: &str) -> Result<bool, CallError> {
        let host = MacroUserIdStr::parse_from_str(host)
            .map_err(|error| CallError::Internal(error.into()))?;
        Ok(self
            .host_call_preferences(host)
            .await?
            .huddle_sharing_blocked)
    }

    /// Which members of a two-person direct message refuse being recorded or
    /// transcribed there; `None` when the channel is anything else.
    async fn direct_message_refusers(
        &self,
        channel_id: &Uuid,
    ) -> Result<Option<Vec<String>>, CallError> {
        let Some(participants) = self
            .repo
            .get_direct_message_participants(channel_id)
            .await?
        else {
            return Ok(None);
        };
        // Bots can be direct-message participants; only people count.
        let people: Vec<String> = participants
            .into_iter()
            .filter(|participant| MacroUserIdStr::parse_from_str(participant).is_ok())
            .collect();
        if people.len() != 2 {
            return Ok(None);
        }
        Ok(Some(self.repo.get_one_on_one_refusers(&people).await?))
    }

    /// How a huddle `host` just started in `channel_id` begins. A failed
    /// lookup records, transcribes and shares nothing rather than risk going
    /// against someone's settings.
    pub(super) async fn huddle_start(
        &self,
        host: MacroUserIdStr<'_>,
        channel_id: &Uuid,
    ) -> HuddleStart {
        let preferences = self
            .host_call_preferences(host)
            .await
            .inspect_err(|error| {
                tracing::error!(error = ?error, "failed to load huddle host settings");
            })
            .ok();
        let refused_by = self
            .direct_message_refusers(channel_id)
            .await
            .inspect_err(|error| {
                tracing::error!(error = ?error, "failed to check one-on-one refusals");
            });
        let Ok(refused_by) = refused_by else {
            return HuddleStart::default();
        };
        // A two-person direct message is a one-on-one.
        let (kind, allowed) = match &refused_by {
            None => (CallKind::Huddle, true),
            Some(refusers) => (CallKind::OneOnOne, refusers.is_empty()),
        };
        HuddleStart {
            record: allowed
                && self.egress_s3_config.is_some()
                && preferences.is_some_and(|preferences| preferences.recording.records(kind)),
            transcribe: allowed,
            share: preferences.is_some_and(|preferences| preferences.shares_huddle_with_team(kind)),
            refused_by: refused_by.unwrap_or_default(),
        }
    }

    /// Share `call`, a live standalone call that is now `kind`, with whoever
    /// its host shares that kind with once it ends. A failed lookup shares it
    /// only with its participants.
    pub(super) async fn share_meeting(&self, call: &Call, kind: CallKind) {
        if kind == CallKind::Huddle {
            return;
        }
        let audience = async {
            let host = MacroUserIdStr::parse_from_str(&call.created_by)
                .map_err(|error| CallError::Internal(error.into()))?;
            self.host_call_preferences(host).await
        }
        .await
        .map(|preferences| preferences.share_by_default.audience(kind))
        .unwrap_or_else(|error| {
            tracing::error!(error = ?error, "failed to load meeting sharing; sharing with participants");
            ShareAudience::Participants
        });
        self.repo
            .set_meeting_audience(&call.id, kind, audience)
            .await
            .inspect_err(|error| {
                tracing::error!(error = ?error, ?kind, "failed to store meeting sharing");
            })
            .ok();
    }

    /// Dispatch `call`'s one transcriber unless it already has one. A failed
    /// claim transcribes nothing rather than risk a second transcriber.
    pub(super) async fn start_meeting_transcriber(&self, call: &Call) {
        let claimed = self
            .repo
            .claim_meeting_transcriber(&call.id)
            .await
            .inspect_err(|error| {
                tracing::error!(error = ?error, "failed to claim meeting transcriber");
            })
            .unwrap_or(false);
        if !claimed {
            return;
        }
        let rtc = self.rtc_client.clone();
        let room_name = call.room_name.clone();
        tokio::spawn(
            async move {
                rtc.dispatch_transcription_agent(&room_name)
                    .await
                    .inspect_err(|error| {
                        tracing::error!(error = ?error, "failed to dispatch meeting transcription agent");
                    })
                    .ok();
            }
            .instrument(tracing::info_span!("start_meeting_transcriber", call_id = %call.id)),
        );
    }

    /// Once a standalone call has its second participant, decide its
    /// one-on-one: if either person refuses, it neither records nor
    /// transcribes and everyone in it is told why; otherwise it transcribes,
    /// and records if its host records one-on-ones.
    async fn settle_one_on_one(&self, call: &Call) -> Result<(), CallError> {
        let Some(attendance) = self.repo.get_meeting_attendance(&call.id).await? else {
            return Ok(());
        };
        if attendance.more_than_two || attendance.external {
            return Ok(());
        }
        let participants = self.repo.get_meeting_participant_ids(&call.id).await?;
        if participants.len() != 2 {
            return Ok(());
        }
        let refused_by = self.repo.get_one_on_one_refusers(&participants).await?;
        if !refused_by.is_empty() {
            if self
                .repo
                .record_one_on_one_refusals(&call.id, &refused_by)
                .await?
            {
                self.send_recording_refusals(call, &refused_by).await;
            }
            return Ok(());
        }
        self.start_meeting_transcriber(call).await;
        if let Some(rules) = self.host_recording_rules(&call.created_by).await
            && rules.records(CallKind::OneOnOne)
            && self.claim_meeting_recorder(call).await
        {
            self.spawn_meeting_recording(call, rules, CallKind::OneOnOne);
        }
        Ok(())
    }

    /// Tell everyone in `call` who refuses recording it; empty once nobody's
    /// refusal applies any more.
    async fn send_recording_refusals(&self, call: &Call, refused_by: &[String]) {
        self.send_call_participant_event(
            &call.id,
            "call_recording_refusals_changed",
            &serde_json::json!({
                "call_id": call.id,
                "channel_id": call.channel_id,
                "refused_by": refused_by,
            }),
        )
        .await;
    }

    /// Start `call`'s recorder in the background for a session of kind
    /// `since`; see [`start_meeting_recording`](super::meetings::start_meeting_recording).
    pub(super) fn spawn_meeting_recording(
        &self,
        call: &Call,
        rules: RecordingRules,
        since: CallKind,
    ) {
        let rtc = self.rtc_client.clone();
        let repo = self.repo.clone();
        let config = self.egress_s3_config.clone();
        let room_name = call.room_name.clone();
        let call_id = call.id;
        tokio::spawn(
            async move {
                super::meetings::start_meeting_recording(
                    &repo,
                    rtc.as_ref(),
                    call_id,
                    &room_name,
                    config.as_ref(),
                    rules,
                    since,
                )
                .await;
            }
            .instrument(tracing::info_span!("start_meeting_recording", call_id = %call_id, ?since)),
        );
    }

    /// The kind of call `meeting`'s session would be with only `joiner` in it:
    /// a huddle for a channel's meeting, an external meeting for someone from
    /// outside the host's team, and otherwise a one-on-one.
    pub(super) async fn meeting_kind(
        &self,
        meeting: &Meeting,
        joiner: MeetingJoiner<'_>,
    ) -> Result<CallKind, CallError> {
        if meeting.channel_id.is_some() {
            return Ok(CallKind::Huddle);
        }
        let MeetingJoiner::Account(joiner) = joiner else {
            return Ok(CallKind::ExternalMeeting);
        };
        if joiner.as_ref() == meeting.user_id {
            return Ok(CallKind::OneOnOne);
        }
        let host = MacroUserIdStr::parse_from_str(&meeting.user_id)
            .map_err(|error| CallError::Internal(error.into()))?;
        let (host_team, joiner_team) =
            tokio::join!(self.user_team(host.copied()), self.user_team(joiner));
        Ok(match (host_team?, joiner_team?) {
            (Some(host), Some(joiner)) if host.team_id == joiner.team_id => CallKind::OneOnOne,
            _ => CallKind::ExternalMeeting,
        })
    }

    /// Apply the external-meeting rules the first time someone from outside
    /// the host's team is about to join a live standalone call.
    pub(super) async fn admit_meeting_kind(
        &self,
        call: &Call,
        kind: CallKind,
    ) -> Result<(), CallError> {
        if kind != CallKind::ExternalMeeting || call.channel_id.is_some() {
            return Ok(());
        }
        let Some(change) = self.repo.mark_call_external(&call.id).await? else {
            return Ok(());
        };
        self.apply_meeting_kind_change(call, kind, change).await;
        Ok(())
    }

    /// Apply the one-on-one rules when a live standalone call gets its second
    /// participant, and the internal-meeting rules when it gets its third.
    /// Call it once the joiner is recorded as a participant and before they
    /// receive credentials.
    pub(super) async fn admit_meeting_participant(&self, call: &Call) -> Result<(), CallError> {
        if call.channel_id.is_some() {
            return Ok(());
        }
        let Some(change) = self.repo.mark_call_more_than_two(&call.id).await? else {
            return self.settle_one_on_one(call).await;
        };
        self.apply_meeting_kind_change(call, CallKind::InternalMeeting, change)
            .await;
        Ok(())
    }

    /// Share `call` with whoever its host shares `kind` with, and stop the
    /// recording when it just became a `kind` its host does not record, or
    /// start one when the host records it and the call has not recorded yet.
    ///
    /// A recorder may still be attaching, invisible to `change`.
    /// [`start_meeting_recording`](super::meetings::start_meeting_recording)
    /// re-checks the call's kind after attaching, so one side always stops it.
    async fn apply_meeting_kind_change(
        &self,
        call: &Call,
        kind: CallKind,
        change: MeetingKindChange,
    ) {
        self.share_meeting(call, kind).await;
        // Refusals only hold in one-on-ones, so a call past one transcribes.
        self.send_recording_refusals(call, &[]).await;
        self.start_meeting_transcriber(call).await;
        let Some(rules) = self.host_recording_rules(&call.created_by).await else {
            return;
        };
        if !rules.records(kind) {
            if let Some(egress_id) = change.egress_id {
                // Awaited so the newcomer gets credentials only once the
                // recorder is told to stop.
                self.rtc_client
                    .stop_egress(&egress_id)
                    .await
                    .inspect_err(|error| {
                        tracing::error!(error = ?error, ?kind, "failed to stop meeting recording");
                    })
                    .ok();
            }
            return;
        }
        if self.claim_meeting_recorder(call).await {
            self.spawn_meeting_recording(call, rules, kind);
        }
    }

    /// Whether `call` may start its one recorder. A failed claim records
    /// nothing rather than risk a second recorder.
    pub(super) async fn claim_meeting_recorder(&self, call: &Call) -> bool {
        self.repo
            .claim_meeting_recorder(&call.id)
            .await
            .inspect_err(|error| {
                tracing::error!(error = ?error, "failed to claim meeting recorder; not recording");
            })
            .unwrap_or(false)
    }

    pub(super) async fn call_settings(
        &self,
        actor: MacroUserIdStr<'_>,
    ) -> Result<CallSettings, CallError> {
        let team = self.user_team(actor.copied()).await?;
        let preferences = self
            .repo
            .get_call_preferences(actor, team.map(|team| team.team_id))
            .await?;
        Ok(CallSettings {
            record_by_default: preferences.recording.record_by_default,
            share_by_default: preferences.share_by_default,
            refuse_one_on_one_recording: preferences.refuses_one_on_one_recording,
            team: team.map(|team| TeamCallPolicy {
                recording_blocked: preferences.recording.blocked,
                huddle_sharing_blocked: preferences.huddle_sharing_blocked,
                can_edit: team.role >= TeamRole::Admin,
            }),
        })
    }

    pub(super) async fn change_call_settings(
        &self,
        actor: MacroUserIdStr<'_>,
        request: UpdateCallSettingsRequest,
    ) -> Result<CallSettings, CallError> {
        if let Err(kind) = ShareByDefault::default().patched(request.share_by_default) {
            let kind = match kind {
                CallKind::Huddle => "Huddles",
                CallKind::OneOnOne => "1:1s",
                CallKind::InternalMeeting => "Internal meetings",
                CallKind::ExternalMeeting => "External meetings",
            };
            return Err(CallError::InvalidRequest(format!(
                "{kind} can't be shared with that audience"
            )));
        }
        self.repo
            .update_call_preferences(actor.copied(), request)
            .await?;
        self.call_settings(actor).await
    }

    pub(super) async fn change_team_call_policy(
        &self,
        receipt: EntityAccessReceipt<AdminTeamRole>,
        request: UpdateTeamCallPolicyRequest,
    ) -> Result<CallSettings, CallError> {
        let actor = receipt
            .get_authenticated_user()
            .map_err(|_| {
                CallError::Forbidden("Only team admins can change call policies".to_string())
            })?
            .clone();
        let team_id = Uuid::parse_str(&receipt.entity().entity_id).map_err(|error| {
            CallError::Internal(anyhow::Error::from(error).context("team receipt has no team id"))
        })?;
        self.repo.update_team_call_policy(&team_id, request).await?;
        if request.huddle_sharing_blocked == Some(true) {
            // Huddles already running would otherwise be shared when they end.
            self.repo.unshare_live_team_huddles(&team_id).await?;
        }
        self.call_settings(actor).await
    }
}
