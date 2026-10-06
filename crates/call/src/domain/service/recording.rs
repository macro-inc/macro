//! Recording settings, and applying them when a call starts or a standalone
//! call is joined by someone from outside its host's team.

use super::*;
use crate::domain::recording::{
    CallKind, CallKinds, CallRecordingSettings, RecordingRules, TeamRecordingPolicy,
    UpdateRecordingDefaultsRequest, UpdateTeamRecordingPolicyRequest,
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

    /// Whether a new call of `kind` started by `host` records.
    pub(super) async fn host_records(&self, host: &str, kind: CallKind) -> bool {
        self.host_recording_rules(host)
            .await
            .is_some_and(|rules| rules.records(kind))
    }

    /// The kind of call `meeting`'s session is once `joiner` is in it. Without
    /// a recorder the distinction never matters, so no lookups are made.
    pub(super) async fn meeting_kind(
        &self,
        meeting: &Meeting,
        joiner: MeetingJoiner<'_>,
    ) -> Result<CallKind, CallError> {
        if meeting.channel_id.is_some() {
            return Ok(CallKind::Huddle);
        }
        if self.egress_s3_config.is_none() {
            return Ok(CallKind::InternalMeeting);
        }
        let MeetingJoiner::Account(joiner) = joiner else {
            return Ok(CallKind::ExternalMeeting);
        };
        if joiner.as_ref() == meeting.user_id {
            return Ok(CallKind::InternalMeeting);
        }
        let host = MacroUserIdStr::parse_from_str(&meeting.user_id)
            .map_err(|error| CallError::Internal(error.into()))?;
        let (host_team, joiner_team) =
            tokio::join!(self.user_team(host.copied()), self.user_team(joiner));
        Ok(match (host_team?, joiner_team?) {
            (Some(host), Some(joiner)) if host.team_id == joiner.team_id => {
                CallKind::InternalMeeting
            }
            _ => CallKind::ExternalMeeting,
        })
    }

    /// Apply the external-meeting rules the first time someone from outside
    /// the host's team joins a live standalone call: stop a recording the host
    /// does not keep for external meetings, or start one the host records
    /// only for them.
    ///
    /// A recorder that internal-meeting rules started may still be attaching.
    /// [`start_meeting_recording`](super::meetings::start_meeting_recording)
    /// re-checks this flag after attaching, so one side always stops it.
    pub(super) async fn admit_meeting_kind(
        &self,
        call: &Call,
        kind: CallKind,
    ) -> Result<(), CallError> {
        if kind != CallKind::ExternalMeeting || call.channel_id.is_some() {
            return Ok(());
        }
        let Some(turned) = self.repo.mark_call_external(&call.id).await? else {
            return Ok(());
        };
        let Some(rules) = self.host_recording_rules(&call.created_by).await else {
            return Ok(());
        };
        match turned.egress_id {
            Some(egress_id) if !rules.records(CallKind::ExternalMeeting) => {
                // Awaited so the newcomer gets credentials only once the
                // recorder is told to stop.
                self.rtc_client
                    .stop_egress(&egress_id)
                    .await
                    .inspect_err(|error| {
                        tracing::error!(error = ?error, "failed to stop recording for external meeting");
                    })
                    .ok();
            }
            None if rules.records(CallKind::ExternalMeeting)
                && !rules.records(CallKind::InternalMeeting) =>
            {
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
                            false,
                        )
                        .await;
                    }
                    .instrument(
                        tracing::info_span!("start_external_meeting_recording", call_id = %call_id),
                    ),
                );
            }
            _ => {}
        }
        Ok(())
    }

    pub(super) async fn recording_settings(
        &self,
        actor: MacroUserIdStr<'_>,
    ) -> Result<CallRecordingSettings, CallError> {
        let team = self.user_team(actor.copied()).await?;
        let rules = self
            .repo
            .get_recording_rules(actor, team.map(|team| team.team_id))
            .await?;
        Ok(CallRecordingSettings {
            record_by_default: rules.record_by_default,
            team: team.map(|team| TeamRecordingPolicy {
                blocked: rules.blocked,
                can_edit: team.role >= TeamRole::Admin,
            }),
        })
    }

    pub(super) async fn change_recording_defaults(
        &self,
        actor: MacroUserIdStr<'_>,
        request: UpdateRecordingDefaultsRequest,
    ) -> Result<CallRecordingSettings, CallError> {
        self.repo
            .update_recording_defaults(actor.copied(), request.record_by_default)
            .await?;
        self.recording_settings(actor).await
    }

    pub(super) async fn change_team_recording_policy(
        &self,
        receipt: EntityAccessReceipt<AdminTeamRole>,
        request: UpdateTeamRecordingPolicyRequest,
    ) -> Result<CallRecordingSettings, CallError> {
        let actor = receipt
            .get_authenticated_user()
            .map_err(|_| {
                CallError::Forbidden("Only team admins can change recording rules".to_string())
            })?
            .clone();
        let team_id = Uuid::parse_str(&receipt.entity().entity_id).map_err(|error| {
            CallError::Internal(anyhow::Error::from(error).context("team receipt has no team id"))
        })?;
        self.repo
            .update_team_recording_blocks(&team_id, request.blocked)
            .await?;
        self.recording_settings(actor).await
    }
}
