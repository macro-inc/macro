use super::*;
use crate::domain::meetings::MeetingRtcParticipant;

#[tokio::test]
async fn meeting_preview_requires_a_valid_invitation() {
    let mut repo = MockCallRepository::new();
    repo.expect_get_meeting()
        .times(1)
        .returning(|_| Box::pin(async { Ok(None) }));
    let service = build_webhook_service(
        repo,
        MockCallRtcClient::new(),
        RecordingEventBroker::default(),
    );
    assert!(matches!(
        service
            .get_meeting_participants(invitation_for_test().share_token, None)
            .await,
        Err(CallError::NotFound(_))
    ));
}

#[tokio::test]
async fn meeting_preview_rejects_guests_for_channel_calls() {
    let mut meeting = invitation_for_test();
    meeting.channel_id = Some(Uuid::now_v7());
    let token = meeting.share_token.clone();
    let mut repo = MockCallRepository::new();
    repo.expect_get_meeting()
        .times(1)
        .return_once(move |_| Box::pin(async move { Ok(Some(meeting)) }));
    let service = build_webhook_service(
        repo,
        MockCallRtcClient::new(),
        RecordingEventBroker::default(),
    );
    assert!(matches!(
        service.get_meeting_participants(token, None).await,
        Err(CallError::Forbidden(_))
    ));
}

#[tokio::test]
async fn meeting_preview_does_not_create_an_idle_call() {
    let mut meeting = invitation_for_test();
    meeting.call_id = None;
    let token = meeting.share_token.clone();
    let mut repo = MockCallRepository::new();
    repo.expect_get_meeting()
        .times(1)
        .return_once(move |_| Box::pin(async move { Ok(Some(meeting)) }));
    let service = build_webhook_service(
        repo,
        MockCallRtcClient::new(),
        RecordingEventBroker::default(),
    );
    assert!(
        service
            .get_meeting_participants(token, None)
            .await
            .unwrap()
            .participants
            .is_empty()
    );
}

#[tokio::test]
async fn meeting_preview_only_exposes_connected_humans_display_data() {
    for channel_link in [false, true] {
        let mut meeting = invitation_for_test();
        let call_id = Uuid::now_v7();
        meeting.call_id = Some(call_id);
        meeting.channel_id = channel_link.then(Uuid::now_v7);
        let token = meeting.share_token.clone();
        let mut repo = MockCallRepository::new();
        repo.expect_get_meeting()
            .times(1)
            .return_once(move |_| Box::pin(async move { Ok(Some(meeting)) }));
        repo.expect_get_call_by_id().times(1).return_once(move |_| {
            Box::pin(async move {
                Ok(Some(Call {
                    id: call_id,
                    channel_id: None,
                    room_name: "preview-room".to_string(),
                    created_by: "macro|owner@example.com".to_string(),
                    created_at: Utc::now(),
                    egress_id: None,
                }))
            })
        });
        repo.expect_get_user_display_name()
            .withf(|id| id.as_ref() == "macro|member@example.com")
            .times(1)
            .returning(|_| Box::pin(async { Ok(Some("Member Name".to_string())) }));
        repo.expect_get_user_profile_picture()
            .times(1)
            .returning(|_| {
                Box::pin(async { Ok(Some("https://example.com/avatar.png".to_string())) })
            });
        let mut rtc = MockCallRtcClient::new();
        rtc.expect_list_meeting_participants()
            .with(mockall::predicate::eq("preview-room"))
            .times(1)
            .returning(|_| {
                Box::pin(async {
                    Ok(Some(vec![
                        MeetingRtcParticipant {
                            identity: "macro|member@example.com".to_string(),
                            name: String::new(),
                        },
                        MeetingRtcParticipant {
                            identity: GuestId::generate().to_string(),
                            name: "Guest Name".to_string(),
                        },
                        MeetingRtcParticipant {
                            identity: "transcription-agent".to_string(),
                            name: "Recorder".to_string(),
                        },
                    ]))
                })
            });
        let service = build_webhook_service(repo, rtc, RecordingEventBroker::default());
        let result = service
            .get_meeting_participants(token, channel_link.then(|| user("viewer@example.com")))
            .await
            .unwrap();
        let json = serde_json::to_value(&result).unwrap();
        assert_eq!(
            json,
            json!({ "participants": [
            { "displayName": "Guest Name", "avatarUrl": null },
            { "displayName": "Member Name", "avatarUrl": "https://example.com/avatar.png" },
        ] })
        );
    }
}
