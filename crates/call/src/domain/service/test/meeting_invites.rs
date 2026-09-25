use super::*;
use crate::domain::meetings::{InviteMeetingUsersRequest, Meeting};

mod access;
use access::TeamAccessService;

const OWNER_EMAIL: &str = "owner@example.com";
const TEAMMATE_EMAIL: &str = "teammate@example.com";
const OTHER_EMAIL: &str = "other@example.com";

fn invitation() -> Meeting {
    let mut meeting = invitation_for_test();
    meeting.user_id = user(OWNER_EMAIL).to_string();
    meeting.call_id = Some(Uuid::now_v7());
    meeting
}

fn request(emails: &[&'static str]) -> InviteMeetingUsersRequest {
    InviteMeetingUsersRequest {
        user_ids: emails.iter().map(|email| user(email)).collect(),
    }
}

fn same_team() -> TeamAccessService {
    let team_id = Uuid::now_v7();
    TeamAccessService {
        teams: [OWNER_EMAIL, TEAMMATE_EMAIL, OTHER_EMAIL]
            .into_iter()
            .map(|email| (user(email).to_string(), team_id))
            .collect(),
        fail_lookup: false,
    }
}

fn service(
    meeting: Option<Meeting>,
    access: TeamAccessService,
    connection: RecordingConnectionService,
    participants: Vec<CallParticipant>,
) -> impl CallService {
    let has_call = meeting
        .as_ref()
        .is_some_and(|meeting| meeting.call_id.is_some());
    let mut repo = MockCallRepository::new();
    repo.expect_get_meeting().returning(move |_| {
        let meeting = meeting.clone();
        Box::pin(async move { Ok(meeting) })
    });
    if has_call {
        repo.expect_get_participants()
            .return_once(move |_| Box::pin(async move { Ok(participants) }));
    }
    repo.expect_add_meeting_invitees()
        .returning(|_, _, _| Box::pin(async { Ok(()) }));
    service_with_repo(repo, access, connection)
}

fn service_with_repo(
    repo: MockCallRepository,
    access: TeamAccessService,
    connection: RecordingConnectionService,
) -> impl CallService {
    CallServiceImpl::<_, _, _, _, _, _, NoopCallSummarizer>::new(
        repo,
        MockCallRtcClient::new(),
        connection,
        access,
        StubNotificationIngress,
        StubRecordingStorage,
        "wss://livekit.example.com",
    )
}

#[tokio::test]
async fn owner_rings_distinct_teammates_in_a_live_session() {
    let meeting = invitation();
    let meeting_id = meeting.id;
    let token = meeting.share_token.clone();
    let connection = RecordingConnectionService::default();
    let service = service(Some(meeting), same_team(), connection.clone(), vec![]);
    service
        .invite_users_to_meeting(
            user(OWNER_EMAIL),
            token.clone(),
            request(&[OWNER_EMAIL, TEAMMATE_EMAIL, TEAMMATE_EMAIL, OTHER_EMAIL]),
        )
        .await
        .unwrap();

    let messages = connection.messages();
    let [sent] = messages.as_slice() else {
        panic!("expected one targeted batch")
    };
    assert_eq!(
        sent.users,
        vec![
            user(TEAMMATE_EMAIL).to_string(),
            user(OTHER_EMAIL).to_string()
        ]
    );
    assert_eq!(sent.message_type, "meeting_invited");
    assert_eq!(sent.message["meeting_id"], json!(meeting_id));
    assert_eq!(sent.message["share_token"], token.as_str());
    assert_eq!(sent.message["created_by"], user(OWNER_EMAIL).as_ref());
    assert_eq!(sent.message["title"], "Design review");
    let invited =
        DateTime::parse_from_rfc3339(sent.message["invited_at"].as_str().unwrap()).unwrap();
    let expires =
        DateTime::parse_from_rfc3339(sent.message["expires_at"].as_str().unwrap()).unwrap();
    assert_eq!(expires - invited, chrono::TimeDelta::seconds(30));
    assert!(sent.message.get("channel_id").is_none());
    assert!(sent.message.get("call_id").is_none());
    // The RTC mock has no expectations: touching room or token allocation fails this test.
}

#[tokio::test]
async fn prejoin_invites_require_starting_a_session_before_any_delivery() {
    let mut meeting = invitation();
    meeting.call_id = None;
    let token = meeting.share_token.clone();
    let connection = RecordingConnectionService::default();
    let service = service(Some(meeting), same_team(), connection.clone(), vec![]);
    assert!(
        !service
            .get_meeting_invite_permissions(user(OWNER_EMAIL), token.clone())
            .await
            .unwrap()
            .can_invite
    );
    assert!(matches!(
        service
            .invite_users_to_meeting(user(OWNER_EMAIL), token, request(&[TEAMMATE_EMAIL]))
            .await,
        Err(CallError::InvalidRequest(_))
    ));
    assert!(connection.messages().is_empty());
}

#[tokio::test]
async fn ownership_and_standalone_scope_are_required() {
    for (actor, channel) in [(OTHER_EMAIL, false), (OWNER_EMAIL, true)] {
        let mut meeting = invitation();
        if channel {
            let call_id = Uuid::now_v7();
            meeting.channel_id = Some(Uuid::now_v7());
            meeting.channel_call_id = Some(call_id);
            meeting.call_id = Some(call_id);
        }
        let token = meeting.share_token.clone();
        let connection = RecordingConnectionService::default();
        let service = service(Some(meeting), same_team(), connection.clone(), vec![]);
        assert!(
            !service
                .get_meeting_invite_permissions(user(actor), token.clone())
                .await
                .unwrap()
                .can_invite
        );
        assert!(matches!(
            service
                .invite_users_to_meeting(user(actor), token, request(&[TEAMMATE_EMAIL]))
                .await,
            Err(CallError::Forbidden(_))
        ));
        assert!(connection.messages().is_empty());
    }
}

#[tokio::test]
async fn owner_permissions_require_a_live_invitation() {
    let meeting = invitation();
    let token = meeting.share_token.clone();
    assert!(
        service(
            Some(meeting),
            same_team(),
            RecordingConnectionService::default(),
            vec![]
        )
        .get_meeting_invite_permissions(user(OWNER_EMAIL), token.clone())
        .await
        .unwrap()
        .can_invite
    );
    let connection = RecordingConnectionService::default();
    let missing = service(None, same_team(), connection.clone(), vec![]);
    assert!(matches!(
        missing
            .get_meeting_invite_permissions(user(OWNER_EMAIL), token.clone())
            .await,
        Err(CallError::NotFound(_))
    ));
    assert!(matches!(
        missing
            .invite_users_to_meeting(user(OWNER_EMAIL), token, request(&[TEAMMATE_EMAIL]))
            .await,
        Err(CallError::NotFound(_))
    ));
    assert!(connection.messages().is_empty());
}

#[tokio::test]
async fn all_recipients_require_membership_before_any_delivery() {
    for missing_membership in [true, false] {
        let mut meeting = invitation();
        meeting.call_id = Some(Uuid::now_v7());
        let token = meeting.share_token.clone();
        let mut access = same_team();
        if missing_membership {
            access.teams.remove(user(OTHER_EMAIL).as_ref());
        } else {
            access
                .teams
                .insert(user(OTHER_EMAIL).to_string(), Uuid::now_v7());
        }
        let connection = RecordingConnectionService::default();
        let service = service(Some(meeting), access, connection.clone(), vec![]);
        assert!(matches!(
            service
                .invite_users_to_meeting(
                    user(OWNER_EMAIL),
                    token,
                    request(&[TEAMMATE_EMAIL, OTHER_EMAIL])
                )
                .await,
            Err(CallError::Forbidden(_))
        ));
        assert!(connection.messages().is_empty());
    }
}

#[tokio::test]
async fn live_invitees_are_persisted_before_delivery_and_failure_prevents_ringing() {
    for persists in [true, false] {
        let mut meeting = invitation();
        let meeting_id = meeting.id;
        let call_id = Uuid::now_v7();
        meeting.call_id = Some(call_id);
        let token = meeting.share_token.clone();
        let connection = RecordingConnectionService::default();
        let before_delivery = connection.clone();
        let mut repo = MockCallRepository::new();
        repo.expect_get_meeting()
            .return_once(move |_| Box::pin(async move { Ok(Some(meeting)) }));
        // Already-connected teammates need no ring. The remaining distinct batch
        // is persisted before any websocket delivery can expose its invitation.
        repo.expect_get_participants().return_once(move |_| {
            Box::pin(async move {
                Ok(vec![CallParticipant {
                    call_id,
                    user_id: user(OTHER_EMAIL).to_string(),
                    joined_at: Utc::now(),
                }])
            })
        });
        repo.expect_add_meeting_invitees()
            .times(1)
            .withf(move |meeting, call, users| {
                *meeting == meeting_id && *call == call_id && users == [user(TEAMMATE_EMAIL)]
            })
            .return_once(move |_, _, _| {
                assert!(before_delivery.messages().is_empty());
                Box::pin(async move {
                    if persists {
                        Ok(())
                    } else {
                        Err(CallError::NotFound("session ended".to_string()))
                    }
                })
            });
        let service = service_with_repo(repo, same_team(), connection.clone());
        let result = service
            .invite_users_to_meeting(
                user(OWNER_EMAIL),
                token,
                request(&[TEAMMATE_EMAIL, TEAMMATE_EMAIL, OTHER_EMAIL]),
            )
            .await;
        assert_eq!(result.is_ok(), persists);
        assert_eq!(connection.messages().len(), usize::from(persists));
    }
}

#[tokio::test]
async fn owner_without_team_and_failed_team_lookup_cannot_deliver() {
    for fails in [true, false] {
        let meeting = invitation();
        let token = meeting.share_token.clone();
        let mut access = same_team();
        access.fail_lookup = fails;
        access.teams.remove(user(OWNER_EMAIL).as_ref());
        let connection = RecordingConnectionService::default();
        let service = service(Some(meeting), access, connection.clone(), vec![]);
        let result = service
            .invite_users_to_meeting(user(OWNER_EMAIL), token, request(&[TEAMMATE_EMAIL]))
            .await;
        if fails {
            assert!(matches!(result, Err(CallError::Internal(_))));
        } else {
            assert!(matches!(result, Err(CallError::Forbidden(_))));
        }
        assert!(connection.messages().is_empty());
    }
}

#[tokio::test]
async fn invitations_skip_users_already_in_this_session() {
    let mut meeting = invitation();
    let call_id = Uuid::now_v7();
    meeting.call_id = Some(call_id);
    let token = meeting.share_token.clone();
    let connection = RecordingConnectionService::default();
    let participants = vec![CallParticipant {
        call_id,
        user_id: user(TEAMMATE_EMAIL).to_string(),
        joined_at: Utc::now(),
    }];
    let service = service(Some(meeting), same_team(), connection.clone(), participants);
    service
        .invite_users_to_meeting(user(OWNER_EMAIL), token, request(&[TEAMMATE_EMAIL]))
        .await
        .unwrap();
    assert!(connection.messages().is_empty());
}

#[tokio::test]
async fn invalid_batches_never_deliver() {
    for request in [
        request(&[]),
        request(&[OWNER_EMAIL]),
        request(&[TEAMMATE_EMAIL; 51]),
    ] {
        let meeting = invitation();
        let token = meeting.share_token.clone();
        let connection = RecordingConnectionService::default();
        let service = service(
            Some(meeting),
            TeamAccessService::default(),
            connection.clone(),
            vec![],
        );
        assert!(matches!(
            service
                .invite_users_to_meeting(user(OWNER_EMAIL), token, request)
                .await,
            Err(CallError::InvalidRequest(_))
        ));
        assert!(connection.messages().is_empty());
    }
}

#[tokio::test]
async fn successful_join_resolves_only_the_answering_users_meeting_ring() {
    for joins in [true, false] {
        let mut meeting = invitation();
        let meeting_id = meeting.id;
        let token = meeting.share_token.clone();
        let mut call = active_call_for_archived_event(OWNER_EMAIL, None);
        call.channel_id = None;
        meeting.call_id = Some(call.id);
        let mut repo = MockCallRepository::new();
        repo.expect_get_meeting()
            .return_once(move |_| Box::pin(async move { Ok(Some(meeting)) }));
        repo.expect_get_call_by_id()
            .return_once(move |_| Box::pin(async move { Ok(Some(call)) }));
        repo.expect_find_active_call_for_user()
            .returning(|_| Box::pin(async { Ok(None) }));
        repo.expect_add_meeting_participant()
            .returning(move |call_id, actor| {
                let participant = CallParticipant {
                    call_id: *call_id,
                    user_id: actor.to_string(),
                    joined_at: Utc::now(),
                };
                Box::pin(async move {
                    if joins {
                        Ok(participant)
                    } else {
                        Err(AddParticipantError::UserAlreadyActive)
                    }
                })
            });
        let mut rtc = MockCallRtcClient::new();
        rtc.expect_generate_token()
            .returning(|_, _| Box::pin(async { Ok("join-token".to_string()) }));
        let connection = RecordingConnectionService::default();
        let service = build_webhook_service_with_connection(
            repo,
            rtc,
            connection.clone(),
            RecordingEventBroker::default(),
        );
        assert_eq!(
            service
                .join_meeting(token, user(TEAMMATE_EMAIL))
                .await
                .is_ok(),
            joins
        );
        let messages = connection.messages();
        if !joins {
            assert!(messages.is_empty());
            continue;
        }
        let [sent] = messages.as_slice() else {
            panic!("expected one answered event")
        };
        assert_eq!(sent.message_type, "meeting_answered");
        assert_eq!(sent.users, vec![user(TEAMMATE_EMAIL).to_string()]);
        assert_eq!(
            sent.message,
            json!({
                "meeting_id": meeting_id, "user_id": user(TEAMMATE_EMAIL),
            })
        );
    }
}
