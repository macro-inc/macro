use super::meeting_invites::access::TeamAccessService;
use super::*;
use crate::domain::meetings::Meeting;
use crate::domain::recording::{
    CallKinds, CallKindsPatch, CallRecordingSettings, CallTurnedExternal, RecordingRules,
    TeamRecordingPolicy, UpdateRecordingDefaultsRequest, UpdateTeamRecordingPolicyRequest,
};
use crate::domain::service::recording::MeetingJoiner;
use entity_access::domain::models::{AdminTeamRole, TeamRole};

const HOST: &str = "host@example.com";
const TEAMMATE: &str = "teammate@example.com";
const OUTSIDER: &str = "outsider@example.com";
const HOST_TEAM: Uuid = Uuid::from_u128(0x0198a1b2_c3d4_7e5f_8061_000000000001);
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
fn teams() -> TeamAccessService {
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

fn rules(record_by_default: CallKinds, blocked: CallKinds) -> RecordingRules {
    RecordingRules {
        record_by_default,
        blocked,
    }
}

fn kinds(huddles: bool, internal_meetings: bool, external_meetings: bool) -> CallKinds {
    CallKinds {
        huddles,
        internal_meetings,
        external_meetings,
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

fn service<R: CallRtcClient>(
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

fn huddle_repo() -> MockCallRepository {
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

fn started_recording_flag(broker: &RecordingEventBroker) -> bool {
    let events = broker.events();
    let [started] = events.as_slice() else {
        panic!("expected exactly one call event, got {events:?}");
    };
    started.envelope["metadata"]["recording_enabled"]
        .as_bool()
        .expect("recording_enabled is a bool")
}

#[tokio::test]
async fn huddles_record_only_when_the_starter_records_them_and_the_team_allows_it() {
    for (rules, records) in [
        (RecordingRules::default(), true),
        (rules(kinds(false, true, true), CallKinds::NONE), false),
        (rules(CallKinds::ALL, kinds(true, false, false)), false),
    ] {
        let mut repo = huddle_repo();
        expect_host_rules(&mut repo, 1, rules);
        // The mock rejects any recorder attachment the rules did not allow.
        repo.expect_set_egress_id()
            .times(usize::from(records))
            .returning(|_, _| Box::pin(async { Ok(()) }));
        let broker = RecordingEventBroker::default();
        service(repo, MockRtcClient::new(), teams())
            .with_event_broker(broker.clone())
            .get_or_create_call(&STARTED_EVENT_CHANNEL_ID, user(HOST))
            .await
            .unwrap();
        assert_eq!(started_recording_flag(&broker), records);
    }
}

#[tokio::test]
async fn unreadable_rules_never_record() {
    let mut repo = huddle_repo();
    repo.expect_get_recording_rules()
        .times(1)
        .returning(|_, _| Box::pin(async { Err(CallError::Internal(anyhow::anyhow!("db down"))) }));
    repo.expect_set_egress_id().never();
    let broker = RecordingEventBroker::default();
    service(repo, MockRtcClient::new(), teams())
        .with_event_broker(broker.clone())
        .get_or_create_call(&STARTED_EVENT_CHANNEL_ID, user(HOST))
        .await
        .unwrap();
    assert!(!started_recording_flag(&broker));
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

#[tokio::test]
async fn a_guest_starting_a_meeting_makes_it_external_before_the_recorder_decides() {
    for external_allowed in [false, true] {
        let call = live_meeting_call(None);
        let call_id = call.id;
        let mut sequence = mockall::Sequence::new();
        let mut repo = MockCallRepository::new();
        repo.expect_get_meeting_preparation()
            .returning(|_| Box::pin(async { Ok(None) }));
        repo.expect_get_or_create_meeting_call()
            .times(1)
            .return_once(move |_, _| Box::pin(async move { Ok((call, true)) }));
        repo.expect_mark_call_external()
            .times(1)
            .in_sequence(&mut sequence)
            .returning(move |id| {
                assert_eq!(*id, call_id);
                Box::pin(async { Ok(Some(CallTurnedExternal { egress_id: None })) })
            });
        let host_rules = rules(kinds(true, true, external_allowed), CallKinds::NONE);
        repo.expect_get_recording_rules()
            .times(1)
            .in_sequence(&mut sequence)
            .returning(move |_, team| {
                assert_eq!(team, Some(HOST_TEAM));
                Box::pin(async move { Ok(host_rules) })
            });
        let (started, recorder) = tokio::sync::oneshot::channel();
        let mut rtc = MockCallRtcClient::new();
        rtc.expect_create_room()
            .returning(|_| Box::pin(async { Ok(()) }));
        rtc.expect_dispatch_transcription_agent()
            .returning(|_| Box::pin(async { Ok(()) }));
        let mut started = Some(started);
        rtc.expect_start_room_composite_egress()
            .times(usize::from(external_allowed))
            .returning(move |_, _| {
                started.take().unwrap().send(()).unwrap();
                Box::pin(async { Err(anyhow::anyhow!("recorder unavailable")) })
            });
        let service = service(repo, rtc, teams());
        service
            .prepare_meeting_call(&hosted_meeting(None), MeetingJoiner::Guest)
            .await
            .unwrap();
        if external_allowed {
            tokio::time::timeout(Duration::from_secs(2), recorder)
                .await
                .unwrap()
                .unwrap();
        } else {
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    }
}

/// How a join finds the session's external flag.
enum ExternalFlag {
    /// The joiner is a teammate, so the flag is never touched.
    Untouched,
    /// An earlier outsider already flipped it.
    AlreadySet,
    /// This join flips it while `egress` is attached.
    Flips { egress: Option<&'static str> },
}

/// A live standalone session hosted by [`HOST`].
fn join_live_meeting(flag: ExternalFlag, host_rules: Option<RecordingRules>) -> MockCallRepository {
    let call = live_meeting_call(Some(EGRESS));
    let call_id = call.id;
    let meeting = hosted_meeting(Some(call_id));
    let mut repo = MockCallRepository::new();
    repo.expect_get_meeting()
        .return_once(move |_| Box::pin(async move { Ok(Some(meeting)) }));
    repo.expect_get_call_by_id()
        .times(1)
        .return_once(move |_| Box::pin(async move { Ok(Some(call)) }));
    match flag {
        ExternalFlag::Untouched => {
            repo.expect_mark_call_external().never();
        }
        ExternalFlag::AlreadySet => {
            repo.expect_mark_call_external()
                .times(1)
                .returning(|_| Box::pin(async { Ok(None) }));
        }
        ExternalFlag::Flips { egress } => {
            repo.expect_mark_call_external()
                .times(1)
                .returning(move |id| {
                    assert_eq!(*id, call_id);
                    let turned = CallTurnedExternal {
                        egress_id: egress.map(str::to_string),
                    };
                    Box::pin(async move { Ok(Some(turned)) })
                });
        }
    }
    match host_rules {
        Some(host_rules) => expect_host_rules(&mut repo, 1, host_rules),
        None => {
            repo.expect_get_recording_rules().never();
        }
    }
    repo.expect_find_active_call_for_user()
        .returning(|_| Box::pin(async { Ok(None) }));
    repo.expect_add_meeting_participant()
        .returning(|call_id, user_id| {
            let participant = CallParticipant {
                call_id: *call_id,
                user_id: user_id.as_ref().to_string(),
                joined_at: started_event_timestamp(),
            };
            Box::pin(async move { Ok(participant) })
        });
    repo
}

#[tokio::test]
async fn an_outsider_joining_stops_a_recorder_the_host_does_not_keep_for_external_meetings() {
    let repo = join_live_meeting(
        ExternalFlag::Flips {
            egress: Some(EGRESS),
        },
        Some(rules(CallKinds::ALL, kinds(false, false, true))),
    );
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
async fn an_outsider_joining_keeps_a_recorder_the_host_keeps_for_external_meetings() {
    let repo = join_live_meeting(
        ExternalFlag::Flips {
            egress: Some(EGRESS),
        },
        Some(RecordingRules::default()),
    );
    let mut rtc = MockCallRtcClient::new();
    rtc.expect_stop_egress().never();
    rtc.expect_start_room_composite_egress().never();
    rtc.expect_generate_token()
        .returning(|_, _| Box::pin(async { Ok("token".to_string()) }));
    service(repo, rtc, teams())
        .join_meeting(hosted_meeting(None).share_token, user(OUTSIDER))
        .await
        .unwrap();
}

#[tokio::test]
async fn teammates_and_later_outsiders_do_not_reapply_external_rules() {
    for (joiner, flag) in [
        (TEAMMATE, ExternalFlag::Untouched),
        (OUTSIDER, ExternalFlag::AlreadySet),
    ] {
        let repo = join_live_meeting(flag, None);
        let mut rtc = MockCallRtcClient::new();
        rtc.expect_stop_egress().never();
        rtc.expect_generate_token()
            .returning(|_, _| Box::pin(async { Ok("token".to_string()) }));
        service(repo, rtc, teams())
            .join_meeting(hosted_meeting(None).share_token, user(joiner))
            .await
            .unwrap();
    }
}

#[tokio::test]
async fn an_outsider_joining_starts_a_recorder_the_host_keeps_only_for_external_meetings() {
    let repo = join_live_meeting(
        ExternalFlag::Flips { egress: None },
        Some(rules(kinds(true, false, true), CallKinds::NONE)),
    );
    let (attached, attachment) = tokio::sync::oneshot::channel();
    let mut background = MockCallRepository::new();
    background
        .expect_attach_meeting_recording()
        .times(1)
        .returning(|_, egress| {
            assert_eq!(egress, EGRESS);
            Box::pin(async { Ok(true) })
        });
    background
        .expect_get_call_by_id()
        .times(1)
        .return_once(move |_| {
            attached.send(()).unwrap();
            Box::pin(async { Ok(Some(live_meeting_call(Some(EGRESS)))) })
        });
    // Recording only for external meetings, so it never re-checks the flag.
    background.expect_is_call_external().never();
    let mut rtc = MockCallRtcClient::new();
    rtc.expect_start_room_composite_egress()
        .times(1)
        .returning(|_, _| Box::pin(async { Ok(EGRESS.to_string()) }));
    rtc.expect_stop_egress().never();
    rtc.expect_generate_token()
        .returning(|_, _| Box::pin(async { Ok("token".to_string()) }));
    let service = service(repo, rtc, teams());
    configure_repository_clone(&service.repo, background);
    service
        .join_meeting(hosted_meeting(None).share_token, user(OUTSIDER))
        .await
        .unwrap();
    tokio::time::timeout(Duration::from_secs(2), attachment)
        .await
        .unwrap()
        .unwrap();
}

#[tokio::test]
async fn a_recorder_attaching_after_an_outsider_joined_stops_itself() {
    for (stop_if_external, external, stops) in [
        (true, true, true),
        (true, false, false),
        (false, true, false),
    ] {
        let mut repo = MockCallRepository::new();
        repo.expect_attach_meeting_recording()
            .returning(|_, _| Box::pin(async { Ok(true) }));
        repo.expect_get_call_by_id()
            .returning(|_| Box::pin(async { Ok(Some(live_meeting_call(Some(EGRESS)))) }));
        repo.expect_is_call_external()
            .times(usize::from(stop_if_external))
            .returning(move |_| Box::pin(async move { Ok(external) }));
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
            stop_if_external,
        )
        .await;
    }
}

#[tokio::test]
async fn an_unverifiable_audience_stops_a_recorder_that_must_not_record_outsiders() {
    let mut repo = MockCallRepository::new();
    repo.expect_attach_meeting_recording()
        .returning(|_, _| Box::pin(async { Ok(true) }));
    repo.expect_get_call_by_id()
        .returning(|_| Box::pin(async { Ok(Some(live_meeting_call(Some(EGRESS)))) }));
    repo.expect_is_call_external()
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
        true,
    )
    .await;
}

fn settings_repo(team: Option<Uuid>, rules: RecordingRules) -> MockCallRepository {
    let mut repo = MockCallRepository::new();
    repo.expect_get_recording_rules()
        .returning(move |_, requested| {
            assert_eq!(requested, team);
            Box::pin(async move { Ok(rules) })
        });
    repo
}

#[tokio::test]
async fn settings_show_team_blocks_and_who_may_edit_them() {
    let host_rules = rules(kinds(true, false, true), kinds(false, false, true));
    for (role, can_edit) in [
        (TeamRole::Member, false),
        (TeamRole::Admin, true),
        (TeamRole::Owner, true),
    ] {
        let mut access = teams();
        access.roles.insert(user(HOST).to_string(), role);
        let settings = service(
            settings_repo(Some(HOST_TEAM), host_rules),
            MockCallRtcClient::new(),
            access,
        )
        .get_recording_settings(user(HOST))
        .await
        .unwrap();
        assert_eq!(
            settings,
            CallRecordingSettings {
                record_by_default: host_rules.record_by_default,
                team: Some(TeamRecordingPolicy {
                    blocked: host_rules.blocked,
                    can_edit,
                }),
            }
        );
    }
}

#[tokio::test]
async fn settings_without_a_team_have_no_team_policy() {
    let settings = service(
        settings_repo(None, RecordingRules::default()),
        MockCallRtcClient::new(),
        TeamAccessService::default(),
    )
    .get_recording_settings(user(HOST))
    .await
    .unwrap();
    assert_eq!(settings.record_by_default, CallKinds::ALL);
    assert_eq!(settings.team, None);
}

#[tokio::test]
async fn people_change_only_their_own_defaults() {
    let patch = CallKindsPatch {
        huddles: Some(false),
        ..CallKindsPatch::default()
    };
    let mut repo = settings_repo(Some(HOST_TEAM), RecordingRules::default());
    repo.expect_update_recording_defaults()
        .times(1)
        .returning(move |actor, requested| {
            assert_eq!(actor, user(HOST));
            assert_eq!(requested, patch);
            Box::pin(async { Ok(CallKinds::ALL) })
        });
    service(repo, MockCallRtcClient::new(), teams())
        .update_recording_defaults(
            user(HOST),
            UpdateRecordingDefaultsRequest {
                record_by_default: patch,
            },
        )
        .await
        .unwrap();
}

#[tokio::test]
async fn team_blocks_change_the_receipts_team() {
    let patch = CallKindsPatch {
        external_meetings: Some(true),
        ..CallKindsPatch::default()
    };
    let mut repo = settings_repo(Some(HOST_TEAM), RecordingRules::default());
    repo.expect_update_team_recording_blocks()
        .times(1)
        .returning(move |team, requested| {
            assert_eq!(*team, HOST_TEAM);
            assert_eq!(requested, patch);
            Box::pin(async { Ok(CallKinds::NONE) })
        });
    let receipt = EntityAccessReceipt::<AdminTeamRole>::dangerously_assert_authenticated_user(
        user(HOST),
        &HOST_TEAM.to_string(),
        EntityType::Team,
    );
    service(repo, MockCallRtcClient::new(), teams())
        .update_team_recording_policy(receipt, UpdateTeamRecordingPolicyRequest { blocked: patch })
        .await
        .unwrap();
}

#[tokio::test]
async fn team_blocks_need_a_person_behind_the_receipt() {
    let mut repo = MockCallRepository::new();
    repo.expect_update_team_recording_blocks().never();
    let receipt = EntityAccessReceipt::<AdminTeamRole>::dangerously_assert_internal_user(
        &HOST_TEAM.to_string(),
        EntityType::Team,
    );
    let result = service(repo, MockCallRtcClient::new(), teams())
        .update_team_recording_policy(
            receipt,
            UpdateTeamRecordingPolicyRequest {
                blocked: CallKindsPatch::default(),
            },
        )
        .await;
    assert!(matches!(result, Err(CallError::Forbidden(_))));
}
