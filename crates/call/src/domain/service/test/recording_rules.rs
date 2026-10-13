use super::meeting_invites::access::TeamAccessService;
use super::*;
use crate::domain::meetings::Meeting;
use crate::domain::recording::CallKind::{
    self, ExternalMeeting, Huddle, InternalMeeting, OneOnOne,
};
use crate::domain::recording::{
    CallKinds, CallPreferences, MeetingAttendance, MeetingKindChange, RecordingRules,
    ShareAudience, ShareByDefault,
};
use crate::domain::service::recording::MeetingJoiner;
use tokio::sync::oneshot;

pub(super) const HOST: &str = "host@example.com";
pub(super) const TEAMMATE: &str = "teammate@example.com";
pub(super) const OUTSIDER: &str = "outsider@example.com";
pub(super) const HOST_TEAM: Uuid = Uuid::from_u128(0x0198a1b2_c3d4_7e5f_8061_000000000001);
const OTHER_TEAM: Uuid = Uuid::from_u128(0x0198a1b2_c3d4_7e5f_8061_000000000002);
const EGRESS: &str = "meeting-egress";

fn egress_config() -> EgressS3Config {
    EgressS3Config {
        bucket: "recordings".into(),
        region: "us-east-1".into(),
        access_key: "access-key".into(),
        secret: "secret".into(),
    }
}

/// The host and a teammate share a team; the outsider is on another one.
pub(super) fn teams() -> TeamAccessService {
    TeamAccessService {
        teams: [
            (user(HOST).to_string(), HOST_TEAM),
            (user(TEAMMATE).to_string(), HOST_TEAM),
            (user(OUTSIDER).to_string(), OTHER_TEAM),
        ]
        .into(),
        ..TeamAccessService::default()
    }
}

pub(super) fn rules(record_by_default: CallKinds, blocked: CallKinds) -> RecordingRules {
    RecordingRules {
        record_by_default,
        blocked,
    }
}

/// Exactly the kinds in `only`.
pub(super) fn kinds(only: &[CallKind]) -> CallKinds {
    CallKinds {
        huddles: only.contains(&Huddle),
        one_on_ones: only.contains(&OneOnOne),
        internal_meetings: only.contains(&InternalMeeting),
        external_meetings: only.contains(&ExternalMeeting),
    }
}

/// Every recording-rules read must name the host and the host's team.
fn expect_host_rules(repo: &mut MockCallRepository, times: usize, rules: RecordingRules) {
    repo.expect_get_recording_rules()
        .times(times)
        .returning(move |host, team| {
            assert_eq!(host, user(HOST));
            assert_eq!(team, Some(HOST_TEAM));
            Box::pin(async move { Ok(rules) })
        });
}

/// Every settings read for a huddle's host must name the host and their team.
pub(super) fn expect_host_preferences(
    repo: &mut MockCallRepository,
    times: usize,
    preferences: CallPreferences,
) {
    repo.expect_get_call_preferences()
        .times(times)
        .returning(move |host, team| {
            assert_eq!(host, user(HOST));
            assert_eq!(team, Some(HOST_TEAM));
            Box::pin(async move { Ok(preferences) })
        });
}

/// Realtime messages to a call's participants find nobody to tell.
pub(super) fn expect_participant_events(repo: &mut MockCallRepository) {
    repo.expect_get_participants()
        .returning(|_| Box::pin(async { Ok(Vec::new()) }));
}

pub(super) fn service<R: CallRtcClient>(
    repo: MockCallRepository,
    rtc: R,
    access: TeamAccessService,
) -> CallServiceImpl<
    MockCallRepository,
    R,
    StubConnectionService,
    TeamAccessService,
    StubNotificationIngress,
    StubRecordingStorage,
    NoopCallSummarizer,
> {
    CallServiceImpl::new(
        repo,
        rtc,
        StubConnectionService,
        access,
        StubNotificationIngress,
        StubRecordingStorage,
        "wss://livekit.example.com",
    )
    .with_egress(egress_config())
}

fn huddle(created_by: &str) -> Call {
    started_event_call(created_by)
}

/// A huddle [`HOST`] starts in [`STARTED_EVENT_CHANNEL_ID`].
pub(super) fn huddle_repo() -> MockCallRepository {
    let mut repo = MockCallRepository::new();
    repo.expect_get_call_by_channel_id()
        .times(1)
        .returning(|_| Box::pin(async { Ok(None) }));
    let call = huddle(user(HOST).as_ref());
    repo.expect_create_call()
        .times(1)
        .return_once(move |_, _, _, _| Box::pin(async move { Ok(Some(call)) }));
    repo.expect_find_active_call_for_user()
        .returning(|_| Box::pin(async { Ok(None) }));
    repo.expect_add_participant().returning(|call_id, user_id| {
        let participant = CallParticipant {
            call_id: *call_id,
            user_id: user_id.as_ref().to_string(),
            joined_at: started_event_timestamp(),
        };
        Box::pin(async move { Ok(participant) })
    });
    repo
}

/// The huddle's channel is not a direct message.
pub(super) fn not_a_direct_message(repo: &mut MockCallRepository) {
    repo.expect_get_direct_message_participants()
        .returning(|_| Box::pin(async { Ok(None) }));
}

fn started_recording_flag(broker: &RecordingEventBroker) -> bool {
    let events = broker.events();
    let [started] = events.as_slice() else {
        panic!("expected exactly one call event, got {events:?}");
    };
    started.envelope["metadata"]["recording_enabled"]
        .as_bool()
        .expect("recording_enabled is a bool")
}

fn recording(rules: RecordingRules) -> CallPreferences {
    CallPreferences {
        recording: rules,
        ..CallPreferences::default()
    }
}

#[tokio::test]
async fn huddles_record_only_when_the_starter_records_them_and_the_team_allows_it() {
    for (rules, records) in [
        (RecordingRules::default(), true),
        (
            rules(
                kinds(&[OneOnOne, InternalMeeting, ExternalMeeting]),
                CallKinds::NONE,
            ),
            false,
        ),
        (rules(CallKinds::ALL, kinds(&[Huddle])), false),
    ] {
        let mut repo = huddle_repo();
        expect_host_preferences(&mut repo, 1, recording(rules));
        not_a_direct_message(&mut repo);
        expect_live_share(&mut repo, false);
        // The mock rejects any recorder attachment the rules did not allow.
        repo.expect_set_egress_id()
            .times(usize::from(records))
            .returning(|_, _| Box::pin(async { Ok(()) }));
        let broker = RecordingEventBroker::default();
        let service =
            service(repo, MockRtcClient::new(), teams()).with_event_broker(broker.clone());
        service
            .get_or_create_call(&STARTED_EVENT_CHANNEL_ID, user(HOST))
            .await
            .unwrap();
        assert_eq!(started_recording_flag(&broker), records);
        // Transcription does not follow the recording settings.
        assert_eq!(service.rtc_client.transcribed_rooms().len(), 1);
    }
}

#[tokio::test]
async fn unreadable_settings_never_record_or_share() {
    let mut repo = huddle_repo();
    repo.expect_get_call_preferences()
        .times(1)
        .returning(|_, _| Box::pin(async { Err(CallError::Internal(anyhow::anyhow!("db down"))) }));
    not_a_direct_message(&mut repo);
    repo.expect_set_egress_id().never();
    repo.expect_patch_call_record()
        .times(1)
        .returning(|_, args| {
            assert_eq!(args.live_share_with_team, Some(false));
            Box::pin(async { Ok(()) })
        });
    let broker = RecordingEventBroker::default();
    service(repo, MockRtcClient::new(), teams())
        .with_event_broker(broker.clone())
        .get_or_create_call(&STARTED_EVENT_CHANNEL_ID, user(HOST))
        .await
        .unwrap();
    assert!(!started_recording_flag(&broker));
}

/// The huddle's channel is a direct message between `members`, of whom
/// `refusers` refuse one-on-one recording.
fn direct_message(repo: &mut MockCallRepository, members: &[&str], refusers: Option<&[&str]>) {
    let members: Vec<String> = members.iter().map(|member| member.to_string()).collect();
    repo.expect_get_direct_message_participants()
        .returning(move |_| {
            let members = members.clone();
            Box::pin(async move { Ok(Some(members)) })
        });
    match refusers {
        Some(refusers) => {
            let refusers: Vec<String> = refusers.iter().map(|id| id.to_string()).collect();
            repo.expect_get_one_on_one_refusers()
                .times(1)
                .returning(move |people| {
                    // Bots never count as one of the two people.
                    assert_eq!(people, [user(HOST).to_string(), user(TEAMMATE).to_string()]);
                    let refusers = refusers.clone();
                    Box::pin(async move { Ok(refusers) })
                });
        }
        None => {
            repo.expect_get_one_on_one_refusers().never();
        }
    }
}

#[tokio::test]
async fn a_two_person_direct_message_huddle_is_kept_private_when_either_member_refuses() {
    let (host, teammate) = (user(HOST).to_string(), user(TEAMMATE).to_string());
    let mut repo = huddle_repo();
    expect_host_preferences(&mut repo, 1, CallPreferences::default());
    direct_message(&mut repo, &[&host, &teammate, "bot-1"], Some(&[&teammate]));
    expect_live_share(&mut repo, false);
    repo.expect_record_one_on_one_refusals()
        .times(1)
        .returning(move |_, refused_by| {
            assert_eq!(refused_by, [user(TEAMMATE).to_string()]);
            Box::pin(async { Ok(true) })
        });
    repo.expect_set_egress_id().never();
    let broker = RecordingEventBroker::default();
    let service = service(repo, MockRtcClient::new(), teams()).with_event_broker(broker.clone());
    service
        .get_or_create_call(&STARTED_EVENT_CHANNEL_ID, user(HOST))
        .await
        .unwrap();
    assert!(!started_recording_flag(&broker));
    assert!(service.rtc_client.transcribed_rooms().is_empty());
}

#[tokio::test]
async fn direct_message_huddles_record_and_transcribe_when_nobody_refuses() {
    let (host, teammate, outsider) = (
        user(HOST).to_string(),
        user(TEAMMATE).to_string(),
        user(OUTSIDER).to_string(),
    );
    for (members, refusers) in [
        (vec![host.as_str(), teammate.as_str()], Some(&[][..])),
        // A group direct message is not a one-on-one.
        (
            vec![host.as_str(), teammate.as_str(), outsider.as_str()],
            None,
        ),
    ] {
        let mut repo = huddle_repo();
        expect_host_preferences(&mut repo, 1, CallPreferences::default());
        direct_message(&mut repo, &members, refusers);
        repo.expect_record_one_on_one_refusals().never();
        expect_live_share(&mut repo, false);
        repo.expect_set_egress_id()
            .times(1)
            .returning(|_, _| Box::pin(async { Ok(()) }));
        let broker = RecordingEventBroker::default();
        let service =
            service(repo, MockRtcClient::new(), teams()).with_event_broker(broker.clone());
        service
            .get_or_create_call(&STARTED_EVENT_CHANNEL_ID, user(HOST))
            .await
            .unwrap();
        assert!(started_recording_flag(&broker));
        assert_eq!(service.rtc_client.transcribed_rooms().len(), 1);
    }
}

#[tokio::test]
async fn a_two_person_direct_message_huddle_follows_the_one_on_one_settings() {
    let (host, teammate) = (user(HOST).to_string(), user(TEAMMATE).to_string());
    let one_on_ones_to_the_team = ShareByDefault {
        one_on_ones: ShareAudience::Team,
        ..ShareByDefault::default()
    };
    for (preferences, records, shared) in [
        // Recording huddles says nothing about one-on-ones.
        (
            CallPreferences {
                recording: rules(kinds(&[Huddle]), CallKinds::NONE),
                share_by_default: one_on_ones_to_the_team,
                ..CallPreferences::default()
            },
            false,
            true,
        ),
        (
            CallPreferences {
                recording: rules(kinds(&[OneOnOne]), CallKinds::NONE),
                ..CallPreferences::default()
            },
            true,
            false,
        ),
        // A team block on huddle sharing covers direct messages too.
        (
            CallPreferences {
                share_by_default: one_on_ones_to_the_team,
                huddle_sharing_blocked: true,
                ..CallPreferences::default()
            },
            true,
            false,
        ),
    ] {
        let mut repo = huddle_repo();
        expect_host_preferences(&mut repo, 1, preferences);
        direct_message(&mut repo, &[&host, &teammate], Some(&[]));
        repo.expect_record_one_on_one_refusals().never();
        repo.expect_set_egress_id()
            .times(usize::from(records))
            .returning(|_, _| Box::pin(async { Ok(()) }));
        expect_live_share(&mut repo, shared);
        let broker = RecordingEventBroker::default();
        let service =
            service(repo, MockRtcClient::new(), teams()).with_event_broker(broker.clone());
        service
            .get_or_create_call(&STARTED_EVENT_CHANNEL_ID, user(HOST))
            .await
            .unwrap();
        assert_eq!(started_recording_flag(&broker), records);
        assert_eq!(service.rtc_client.transcribed_rooms().len(), 1);
    }
}

/// A new huddle starts with "Share with team" on, so one its host does not
/// share is turned off once.
pub(super) fn expect_live_share(repo: &mut MockCallRepository, shared: bool) {
    repo.expect_patch_call_record()
        .times(usize::from(!shared))
        .returning(|_, args| {
            assert_eq!(args.live_share_with_team, Some(false));
            assert!(args.team_share.is_none());
            Box::pin(async { Ok(()) })
        });
}

fn hosted_meeting(call_id: Option<Uuid>) -> Meeting {
    let mut meeting = invitation_for_test();
    meeting.user_id = user(HOST).to_string();
    meeting.call_id = call_id;
    meeting
}

fn live_meeting_call(egress_id: Option<&str>) -> Call {
    let mut call = active_call_for_archived_event(user(HOST).as_ref(), egress_id);
    call.channel_id = None;
    call
}

fn attendance(more_than_two: bool, external: bool) -> MeetingAttendance {
    MeetingAttendance {
        more_than_two,
        external,
    }
}

/// The host's untouched settings are read once per kind in `kinds` the
/// meeting becomes, and it is shared with each kind's default audience.
fn expect_meeting_audiences(repo: &mut MockCallRepository, kinds: &[CallKind]) {
    repo.expect_get_call_preferences()
        .times(kinds.len())
        .returning(|host, team| {
            assert_eq!(host, user(HOST));
            assert_eq!(team, Some(HOST_TEAM));
            Box::pin(async { Ok(CallPreferences::default()) })
        });
    let mut expected = kinds.to_vec().into_iter();
    repo.expect_set_meeting_audience()
        .times(kinds.len())
        .returning(move |_, kind, audience| {
            assert_eq!(Some(kind), expected.next());
            assert_eq!(audience, ShareByDefault::default().audience(kind));
            Box::pin(async { Ok(()) })
        });
}

/// A recorder that attaches to a live meeting with `seen` attendance, and
/// signals once it has re-checked that attendance.
fn attaching_recorder(seen: MeetingAttendance) -> (MockCallRepository, oneshot::Receiver<()>) {
    let (checked, check) = oneshot::channel();
    let mut repo = MockCallRepository::new();
    repo.expect_attach_meeting_recording()
        .times(1)
        .returning(|_, egress| {
            assert_eq!(egress, EGRESS);
            Box::pin(async { Ok(true) })
        });
    repo.expect_get_meeting_attendance()
        .times(1)
        .return_once(move |_| {
            checked.send(()).unwrap();
            Box::pin(async move { Ok(Some(seen)) })
        });
    (repo, check)
}

/// Expect `call`'s transcriber claim, answering `claimed`.
fn expect_transcriber_claim(repo: &mut MockCallRepository, claimed: bool) {
    repo.expect_claim_meeting_transcriber()
        .times(1)
        .returning(move |_| Box::pin(async move { Ok(claimed) }));
}

/// An RTC client that expects one transcriber dispatch, signalled through the
/// returned receiver because it runs in the background.
fn transcribing_rtc() -> (MockCallRtcClient, oneshot::Receiver<()>) {
    let (dispatched, dispatch) = oneshot::channel();
    let mut dispatched = Some(dispatched);
    let mut rtc = token_minting_rtc();
    rtc.expect_dispatch_transcription_agent()
        .times(1)
        .returning(move |_| {
            dispatched.take().unwrap().send(()).unwrap();
            Box::pin(async { Ok(()) })
        });
    (rtc, dispatch)
}

async fn received(signal: oneshot::Receiver<()>) {
    tokio::time::timeout(Duration::from_secs(2), signal)
        .await
        .unwrap()
        .unwrap();
}

#[tokio::test]
async fn a_meeting_waits_for_its_second_person_unless_it_starts_external() {
    for (joiner, records, starts_media) in [
        (MeetingJoiner::Account(user(HOST)), CallKinds::ALL, false),
        (
            MeetingJoiner::Account(user(TEAMMATE)),
            CallKinds::ALL,
            false,
        ),
        (MeetingJoiner::Guest, kinds(&[ExternalMeeting]), true),
        (MeetingJoiner::Guest, kinds(&[OneOnOne]), true),
    ] {
        let guest = matches!(joiner, MeetingJoiner::Guest);
        let recording = guest && records.contains(ExternalMeeting);
        let call = live_meeting_call(None);
        let call_id = call.id;
        let mut sequence = mockall::Sequence::new();
        let mut repo = MockCallRepository::new();
        repo.expect_get_meeting_preparation()
            .returning(|_| Box::pin(async { Ok(None) }));
        repo.expect_get_or_create_meeting_call()
            .times(1)
            .return_once(move |_, _| Box::pin(async move { Ok((call, true)) }));
        // A guest makes the call external before the recorder decides.
        if guest {
            repo.expect_mark_call_external()
                .times(1)
                .in_sequence(&mut sequence)
                .returning(move |id| {
                    assert_eq!(*id, call_id);
                    Box::pin(async { Ok(Some(MeetingKindChange { egress_id: None })) })
                });
        } else {
            repo.expect_mark_call_external().never();
        }
        expect_meeting_audiences(&mut repo, &[if guest { ExternalMeeting } else { OneOnOne }]);
        let host_rules = rules(records, CallKinds::NONE);
        repo.expect_get_recording_rules()
            .times(1)
            .in_sequence(&mut sequence)
            .returning(move |_, team| {
                assert_eq!(team, Some(HOST_TEAM));
                Box::pin(async move { Ok(host_rules) })
            });
        if recording {
            repo.expect_claim_meeting_recorder()
                .times(1)
                .in_sequence(&mut sequence)
                .returning(|_| Box::pin(async { Ok(true) }));
        } else {
            repo.expect_claim_meeting_recorder().never();
        }
        if starts_media {
            expect_transcriber_claim(&mut repo, true);
        } else {
            repo.expect_claim_meeting_transcriber().never();
        }
        let (started, recorder) = oneshot::channel();
        let (transcribed, transcriber) = oneshot::channel();
        let mut rtc = MockCallRtcClient::new();
        rtc.expect_create_room()
            .returning(|_| Box::pin(async { Ok(()) }));
        let mut transcribed = Some(transcribed);
        rtc.expect_dispatch_transcription_agent()
            .times(usize::from(starts_media))
            .returning(move |_| {
                transcribed.take().unwrap().send(()).unwrap();
                Box::pin(async { Ok(()) })
            });
        let mut started = Some(started);
        rtc.expect_start_room_composite_egress()
            .times(usize::from(recording))
            .returning(move |_, _| {
                started.take().unwrap().send(()).unwrap();
                Box::pin(async { Err(anyhow::anyhow!("recorder unavailable")) })
            });
        let broker = RecordingEventBroker::default();
        let service = service(repo, rtc, teams()).with_event_broker(broker.clone());
        service
            .prepare_meeting_call(&hosted_meeting(None), joiner)
            .await
            .unwrap();
        assert_eq!(started_recording_flag(&broker), recording);
        if recording {
            received(recorder).await;
        }
        if starts_media {
            received(transcriber).await;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}

/// How a join finds one of a live meeting's attendance flags.
#[derive(Clone, Copy)]
enum Flag {
    /// The join never checks it.
    Untouched,
    /// The join checks it and leaves it as it was.
    Unchanged,
    /// This join flips it while `egress` is attached.
    Flips { egress: Option<&'static str> },
}

impl Flag {
    fn change(self) -> Option<MeetingKindChange> {
        match self {
            Flag::Untouched | Flag::Unchanged => None,
            Flag::Flips { egress } => Some(MeetingKindChange {
                egress_id: egress.map(str::to_string),
            }),
        }
    }

    fn times(self) -> usize {
        usize::from(!matches!(self, Flag::Untouched))
    }
}

/// What a join that did not change the call's kind finds when it settles the
/// one-on-one.
enum Settle {
    /// The join changed the call's kind, so it never settles.
    Skipped,
    /// The call is already past its one-on-one.
    Past(MeetingAttendance),
    /// Still a one-on-one that these people have joined, of whom `refusers`
    /// refuse recording.
    OneOnOne {
        participants: Vec<String>,
        refusers: Vec<String>,
    },
}

/// A join to a live standalone session hosted by [`HOST`] with [`EGRESS`]
/// attached. `external` is checked before credentials are minted and
/// `more_than_two` after the joiner is recorded as a participant.
fn join_live_meeting(
    external: Flag,
    more_than_two: Flag,
    settle: Settle,
    host_rules: Option<RecordingRules>,
) -> MockCallRepository {
    let call = live_meeting_call(Some(EGRESS));
    let call_id = call.id;
    let meeting = hosted_meeting(Some(call_id));
    let mut repo = MockCallRepository::new();
    repo.expect_get_meeting()
        .return_once(move |_| Box::pin(async move { Ok(Some(meeting)) }));
    repo.expect_get_call_by_id()
        .times(1)
        .return_once(move |_| Box::pin(async move { Ok(Some(call)) }));
    repo.expect_mark_call_external()
        .times(external.times())
        .returning(move |id| {
            assert_eq!(*id, call_id);
            let change = external.change();
            Box::pin(async move { Ok(change) })
        });
    let mut sequence = mockall::Sequence::new();
    repo.expect_add_meeting_participant()
        .times(1)
        .in_sequence(&mut sequence)
        .returning(|call_id, user_id| {
            let participant = CallParticipant {
                call_id: *call_id,
                user_id: user_id.as_ref().to_string(),
                joined_at: started_event_timestamp(),
            };
            Box::pin(async move { Ok(participant) })
        });
    repo.expect_mark_call_more_than_two()
        .times(1)
        .in_sequence(&mut sequence)
        .returning(move |id| {
            assert_eq!(*id, call_id);
            let change = more_than_two.change();
            Box::pin(async move { Ok(change) })
        });
    match settle {
        Settle::Skipped => {
            repo.expect_get_meeting_attendance().never();
        }
        Settle::Past(seen) => {
            repo.expect_get_meeting_attendance()
                .times(1)
                .returning(move |_| Box::pin(async move { Ok(Some(seen)) }));
            repo.expect_get_meeting_participant_ids().never();
        }
        Settle::OneOnOne {
            participants,
            refusers,
        } => {
            repo.expect_get_meeting_attendance()
                .times(1)
                .returning(|_| Box::pin(async { Ok(Some(MeetingAttendance::default())) }));
            let decides = participants.len() == 2;
            repo.expect_get_meeting_participant_ids()
                .times(1)
                .returning(move |_| {
                    let participants = participants.clone();
                    Box::pin(async move { Ok(participants) })
                });
            repo.expect_get_one_on_one_refusers()
                .times(usize::from(decides))
                .returning(move |_| {
                    let refusers = refusers.clone();
                    Box::pin(async move { Ok(refusers) })
                });
        }
    }
    match host_rules {
        Some(host_rules) => expect_host_rules(&mut repo, 1, host_rules),
        None => {
            repo.expect_get_recording_rules().never();
        }
    }
    // A join that changes the call's kind shares it with that kind's audience.
    let changes = [
        (external, ExternalMeeting),
        (more_than_two, InternalMeeting),
    ]
    .into_iter()
    .filter(|(flag, _)| flag.change().is_some())
    .map(|(_, kind)| kind)
    .collect::<Vec<_>>();
    expect_meeting_audiences(&mut repo, &changes);
    repo.expect_find_active_call_for_user()
        .returning(|_| Box::pin(async { Ok(None) }));
    repo
}

fn token_minting_rtc() -> MockCallRtcClient {
    let mut rtc = MockCallRtcClient::new();
    rtc.expect_generate_token()
        .returning(|_, _| Box::pin(async { Ok("token".to_string()) }));
    rtc
}

fn people(ids: &[&'static str]) -> Vec<String> {
    ids.iter().map(|id| user(id).to_string()).collect()
}

#[tokio::test]
async fn an_outsider_joining_stops_a_recorder_the_host_does_not_keep_for_external_meetings() {
    let mut repo = join_live_meeting(
        Flag::Flips {
            egress: Some(EGRESS),
        },
        Flag::Unchanged,
        Settle::Past(attendance(false, true)),
        Some(rules(CallKinds::ALL, kinds(&[ExternalMeeting]))),
    );
    expect_participant_events(&mut repo);
    expect_transcriber_claim(&mut repo, false);
    let mut sequence = mockall::Sequence::new();
    let mut rtc = MockCallRtcClient::new();
    rtc.expect_stop_egress()
        .with(mockall::predicate::eq(EGRESS))
        .times(1)
        .in_sequence(&mut sequence)
        .returning(|_| Box::pin(async { Ok(()) }));
    // Credentials are minted only after the recorder was told to stop.
    rtc.expect_generate_token()
        .times(1)
        .in_sequence(&mut sequence)
        .returning(|_, _| Box::pin(async { Ok("token".to_string()) }));
    service(repo, rtc, teams())
        .join_meeting(hosted_meeting(None).share_token, user(OUTSIDER))
        .await
        .unwrap();
}

#[tokio::test]
async fn a_third_teammate_joining_stops_a_recorder_the_host_keeps_only_for_one_on_ones() {
    for host_rules in [
        rules(kinds(&[OneOnOne, ExternalMeeting]), CallKinds::NONE),
        // A team block on internal meetings stops it the same way.
        rules(CallKinds::ALL, kinds(&[InternalMeeting])),
    ] {
        let mut repo = join_live_meeting(
            Flag::Untouched,
            Flag::Flips {
                egress: Some(EGRESS),
            },
            Settle::Skipped,
            Some(host_rules),
        );
        expect_participant_events(&mut repo);
        expect_transcriber_claim(&mut repo, false);
        repo.expect_claim_meeting_recorder().never();
        let mut rtc = token_minting_rtc();
        rtc.expect_stop_egress()
            .with(mockall::predicate::eq(EGRESS))
            .times(1)
            .returning(|_| Box::pin(async { Ok(()) }));
        rtc.expect_start_room_composite_egress().never();
        // The stop is awaited, so it has happened by the time the join answers.
        service(repo, rtc, teams())
            .join_meeting(hosted_meeting(None).share_token, user(TEAMMATE))
            .await
            .unwrap();
    }
}

#[tokio::test]
async fn a_change_to_a_recorded_kind_keeps_the_running_recorder() {
    for (external, more_than_two, settle, joiner) in [
        (
            Flag::Flips {
                egress: Some(EGRESS),
            },
            Flag::Unchanged,
            Settle::Past(attendance(false, true)),
            OUTSIDER,
        ),
        (
            Flag::Untouched,
            Flag::Flips {
                egress: Some(EGRESS),
            },
            Settle::Skipped,
            TEAMMATE,
        ),
    ] {
        let mut repo = join_live_meeting(
            external,
            more_than_two,
            settle,
            Some(RecordingRules::default()),
        );
        expect_participant_events(&mut repo);
        // The recorder and transcriber that started earlier hold the claims.
        expect_transcriber_claim(&mut repo, false);
        repo.expect_claim_meeting_recorder()
            .times(1)
            .returning(|_| Box::pin(async { Ok(false) }));
        let mut rtc = token_minting_rtc();
        rtc.expect_stop_egress().never();
        rtc.expect_start_room_composite_egress().never();
        rtc.expect_dispatch_transcription_agent().never();
        service(repo, rtc, teams())
            .join_meeting(hosted_meeting(None).share_token, user(joiner))
            .await
            .unwrap();
    }
}

#[tokio::test]
async fn joins_that_change_nothing_do_not_reapply_rules() {
    // An outsider joining a call that is already external.
    let repo = join_live_meeting(
        Flag::Unchanged,
        Flag::Unchanged,
        Settle::Past(attendance(false, true)),
        None,
    );
    let mut rtc = token_minting_rtc();
    rtc.expect_stop_egress().never();
    service(repo, rtc, teams())
        .join_meeting(hosted_meeting(None).share_token, user(OUTSIDER))
        .await
        .unwrap();
}

#[tokio::test]
async fn a_change_to_a_kind_recorded_on_its_own_starts_a_recorder() {
    for (external, more_than_two, settle, joiner, records, seen) in [
        (
            Flag::Flips { egress: None },
            Flag::Unchanged,
            Settle::Past(attendance(false, true)),
            OUTSIDER,
            kinds(&[Huddle, ExternalMeeting]),
            attendance(false, true),
        ),
        (
            Flag::Untouched,
            Flag::Flips { egress: None },
            Settle::Skipped,
            TEAMMATE,
            kinds(&[InternalMeeting]),
            attendance(true, false),
        ),
    ] {
        let mut repo = join_live_meeting(
            external,
            more_than_two,
            settle,
            Some(rules(records, CallKinds::NONE)),
        );
        expect_participant_events(&mut repo);
        expect_transcriber_claim(&mut repo, true);
        repo.expect_claim_meeting_recorder()
            .times(1)
            .returning(|_| Box::pin(async { Ok(true) }));
        let (background, check) = attaching_recorder(seen);
        let (mut rtc, dispatch) = transcribing_rtc();
        rtc.expect_start_room_composite_egress()
            .times(1)
            .returning(|_, _| Box::pin(async { Ok(EGRESS.to_string()) }));
        // Nothing the session has been since then is unrecorded.
        rtc.expect_stop_egress().never();
        let service = service(repo, rtc, teams());
        configure_repository_clone(&service.repo, background);
        service
            .join_meeting(hosted_meeting(None).share_token, user(joiner))
            .await
            .unwrap();
        received(check).await;
        received(dispatch).await;
        tokio::task::yield_now().await;
    }
}

#[tokio::test]
async fn a_stopped_recording_is_not_resumed() {
    // Recorded as a one-on-one, stopped when it grew, then joined by an
    // outsider: external meetings record, but the call already used its claim.
    let mut repo = join_live_meeting(
        Flag::Flips {
            egress: Some(EGRESS),
        },
        Flag::Unchanged,
        Settle::Past(attendance(true, true)),
        Some(rules(kinds(&[OneOnOne, ExternalMeeting]), CallKinds::NONE)),
    );
    expect_participant_events(&mut repo);
    expect_transcriber_claim(&mut repo, false);
    repo.expect_claim_meeting_recorder()
        .times(1)
        .returning(|_| Box::pin(async { Ok(false) }));
    let mut rtc = token_minting_rtc();
    rtc.expect_start_room_composite_egress().never();
    rtc.expect_stop_egress().never();
    service(repo, rtc, teams())
        .join_meeting(hosted_meeting(None).share_token, user(OUTSIDER))
        .await
        .unwrap();
}

#[tokio::test]
async fn a_second_teammate_starts_the_one_on_ones_transcriber_and_recorder() {
    let mut repo = join_live_meeting(
        Flag::Untouched,
        Flag::Unchanged,
        Settle::OneOnOne {
            participants: people(&[HOST, TEAMMATE]),
            refusers: Vec::new(),
        },
        Some(RecordingRules::default()),
    );
    expect_transcriber_claim(&mut repo, true);
    repo.expect_claim_meeting_recorder()
        .times(1)
        .returning(|_| Box::pin(async { Ok(true) }));
    repo.expect_record_one_on_one_refusals().never();
    let (background, check) = attaching_recorder(MeetingAttendance::default());
    let (mut rtc, dispatch) = transcribing_rtc();
    rtc.expect_start_room_composite_egress()
        .times(1)
        .returning(|_, _| Box::pin(async { Ok(EGRESS.to_string()) }));
    rtc.expect_stop_egress().never();
    let service = service(repo, rtc, teams());
    configure_repository_clone(&service.repo, background);
    service
        .join_meeting(hosted_meeting(None).share_token, user(TEAMMATE))
        .await
        .unwrap();
    received(check).await;
    received(dispatch).await;
    tokio::task::yield_now().await;
}

#[tokio::test]
async fn a_refusal_keeps_the_one_on_one_from_recording_or_transcribing() {
    let mut repo = join_live_meeting(
        Flag::Untouched,
        Flag::Unchanged,
        Settle::OneOnOne {
            participants: people(&[HOST, TEAMMATE]),
            refusers: people(&[TEAMMATE]),
        },
        None,
    );
    repo.expect_record_one_on_one_refusals()
        .times(1)
        .returning(|_, refused_by| {
            assert_eq!(refused_by, people(&[TEAMMATE]));
            Box::pin(async { Ok(true) })
        });
    // Everyone in the call is told why it is not recording.
    repo.expect_get_participants()
        .times(1)
        .returning(|_| Box::pin(async { Ok(Vec::new()) }));
    repo.expect_claim_meeting_transcriber().never();
    repo.expect_claim_meeting_recorder().never();
    let mut rtc = token_minting_rtc();
    rtc.expect_dispatch_transcription_agent().never();
    rtc.expect_start_room_composite_egress().never();
    service(repo, rtc, teams())
        .join_meeting(hosted_meeting(None).share_token, user(TEAMMATE))
        .await
        .unwrap();
    tokio::time::sleep(Duration::from_millis(20)).await;
}

#[tokio::test]
async fn someone_alone_in_a_meeting_settles_nothing() {
    let mut repo = join_live_meeting(
        Flag::Untouched,
        Flag::Unchanged,
        Settle::OneOnOne {
            participants: people(&[HOST]),
            refusers: Vec::new(),
        },
        None,
    );
    repo.expect_claim_meeting_transcriber().never();
    repo.expect_claim_meeting_recorder().never();
    repo.expect_record_one_on_one_refusals().never();
    service(repo, token_minting_rtc(), teams())
        .join_meeting(hosted_meeting(None).share_token, user(HOST))
        .await
        .unwrap();
}

#[tokio::test]
async fn a_failed_participant_count_turns_the_join_away() {
    let call = live_meeting_call(Some(EGRESS));
    let call_id = call.id;
    let meeting = hosted_meeting(Some(call_id));
    let mut repo = MockCallRepository::new();
    repo.expect_get_meeting()
        .return_once(move |_| Box::pin(async move { Ok(Some(meeting)) }));
    repo.expect_get_call_by_id()
        .return_once(move |_| Box::pin(async move { Ok(Some(call)) }));
    repo.expect_find_active_call_for_user()
        .returning(|_| Box::pin(async { Ok(None) }));
    repo.expect_add_meeting_participant()
        .times(1)
        .returning(|call_id, user_id| {
            let participant = CallParticipant {
                call_id: *call_id,
                user_id: user_id.as_ref().to_string(),
                joined_at: started_event_timestamp(),
            };
            Box::pin(async move { Ok(participant) })
        });
    repo.expect_mark_call_more_than_two()
        .times(1)
        .returning(|_| Box::pin(async { Err(CallError::Internal(anyhow::anyhow!("db down"))) }));
    repo.expect_remove_participant()
        .times(1)
        .returning(move |id, user_id| {
            assert_eq!(*id, call_id);
            assert_eq!(user_id, user(TEAMMATE));
            Box::pin(async { Ok(()) })
        });
    let result = service(repo, token_minting_rtc(), teams())
        .join_meeting(hosted_meeting(None).share_token, user(TEAMMATE))
        .await;
    assert!(matches!(result, Err(CallError::Internal(_))));
}

#[tokio::test]
async fn an_attaching_recorder_stops_if_the_call_became_an_unrecorded_kind() {
    let internal_only = kinds(&[OneOnOne, InternalMeeting]);
    let one_on_ones_only = kinds(&[OneOnOne]);
    let skips_internal = kinds(&[OneOnOne, ExternalMeeting]);
    for (records, since, seen, stops) in [
        (internal_only, OneOnOne, attendance(false, false), false),
        (internal_only, OneOnOne, attendance(true, false), false),
        (internal_only, OneOnOne, attendance(false, true), true),
        (one_on_ones_only, OneOnOne, attendance(true, false), true),
        // It recorded while the call was internal, though it is external now.
        (skips_internal, OneOnOne, attendance(true, true), true),
        (skips_internal, OneOnOne, attendance(false, true), false),
        (
            kinds(&[InternalMeeting]),
            InternalMeeting,
            attendance(true, false),
            false,
        ),
        (
            kinds(&[ExternalMeeting]),
            ExternalMeeting,
            attendance(true, true),
            false,
        ),
    ] {
        let mut repo = MockCallRepository::new();
        repo.expect_attach_meeting_recording()
            .returning(|_, _| Box::pin(async { Ok(true) }));
        repo.expect_get_meeting_attendance()
            .times(1)
            .returning(move |_| Box::pin(async move { Ok(Some(seen)) }));
        let mut rtc = MockCallRtcClient::new();
        rtc.expect_start_room_composite_egress()
            .returning(|_, _| Box::pin(async { Ok(EGRESS.to_string()) }));
        rtc.expect_stop_egress()
            .times(usize::from(stops))
            .returning(|_| Box::pin(async { Ok(()) }));
        crate::domain::service::meetings::start_meeting_recording(
            &repo,
            &rtc,
            ARCHIVED_EVENT_CALL_ID,
            "room",
            Some(&egress_config()),
            rules(records, CallKinds::NONE),
            since,
        )
        .await;
    }
}

#[tokio::test]
async fn an_unverifiable_audience_stops_an_attaching_recorder() {
    let mut repo = MockCallRepository::new();
    repo.expect_attach_meeting_recording()
        .returning(|_, _| Box::pin(async { Ok(true) }));
    repo.expect_get_meeting_attendance()
        .returning(|_| Box::pin(async { Err(CallError::Internal(anyhow::anyhow!("db down"))) }));
    let mut rtc = MockCallRtcClient::new();
    rtc.expect_start_room_composite_egress()
        .returning(|_, _| Box::pin(async { Ok(EGRESS.to_string()) }));
    rtc.expect_stop_egress()
        .times(1)
        .returning(|_| Box::pin(async { Ok(()) }));
    crate::domain::service::meetings::start_meeting_recording(
        &repo,
        &rtc,
        ARCHIVED_EVENT_CALL_ID,
        "room",
        Some(&egress_config()),
        RecordingRules::default(),
        OneOnOne,
    )
    .await;
}
