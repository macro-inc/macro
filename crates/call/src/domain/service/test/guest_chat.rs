use super::*;
use crate::domain::meetings::MeetingRtcParticipant;
use messages::domain::{ports::MessageError, service::guest_chat::GuestCallAuthorizer};

#[tokio::test]
async fn guest_chat_rejects_invalid_credentials_before_reading_calls() {
    let mut rtc = MockCallRtcClient::new();
    rtc.expect_verify_access_token()
        .returning(|_| Err(anyhow::anyhow!("expired")));
    let service = build_webhook_service(
        MockCallRepository::new(),
        rtc,
        RecordingEventBroker::default(),
    );
    assert!(matches!(
        service.authorize(Uuid::now_v7(), "expired").await,
        Err(MessageError::Forbidden)
    ));
}

#[tokio::test]
async fn guest_chat_checks_room_call_type_and_both_membership_sources() {
    // Every failure stops before requesting facts beyond the failed boundary.
    for scenario in [
        "valid",
        "member",
        "ended",
        "wrong-room",
        "channel",
        "left",
        "disconnected",
    ] {
        let call_id = Uuid::now_v7();
        let guest_id = GuestId::generate();
        let mut rtc = MockCallRtcClient::new();
        rtc.expect_verify_access_token().returning(move |_| {
            Ok(VerifiedRingToken {
                identity: if scenario == "member" {
                    "macro|member@example.com".into()
                } else {
                    guest_id.to_string()
                },
                room: Some(
                    if scenario == "wrong-room" {
                        "other"
                    } else {
                        "guest-room"
                    }
                    .into(),
                ),
            })
        });
        let mut repo = MockCallRepository::new();
        if scenario != "member" {
            repo.expect_get_call_by_id()
                .withf(move |id| *id == call_id)
                .times(1)
                .returning(move |_| {
                    Box::pin(async move {
                        Ok((scenario != "ended").then(|| Call {
                            id: call_id,
                            channel_id: (scenario == "channel").then(Uuid::now_v7),
                            room_name: "guest-room".into(),
                            created_by: "macro|owner@example.com".into(),
                            created_at: Utc::now(),
                            egress_id: None,
                        }))
                    })
                });
        }
        if matches!(scenario, "valid" | "left" | "disconnected") {
            repo.expect_get_active_guests()
                .times(1)
                .returning(move |_| {
                    Box::pin(async move {
                        Ok(if scenario == "left" {
                            vec![]
                        } else {
                            vec![(guest_id, Utc::now())]
                        })
                    })
                });
        }
        if matches!(scenario, "valid" | "disconnected") {
            rtc.expect_list_meeting_participants()
                .times(1)
                .returning(move |_| {
                    Box::pin(async move {
                        Ok(Some(if scenario == "disconnected" {
                            vec![]
                        } else {
                            vec![MeetingRtcParticipant {
                                identity: guest_id.to_string(),
                                name: "Visitor".into(),
                            }]
                        }))
                    })
                });
        }
        let service = build_webhook_service(repo, rtc, RecordingEventBroker::default());
        let result = service.authorize(call_id, "session").await;
        if scenario == "valid" {
            let access = result.unwrap();
            assert_eq!(access.guest_id, guest_id.as_uuid());
            assert_eq!(access.name, "Visitor");
        } else {
            assert!(matches!(result, Err(MessageError::Forbidden)), "{scenario}");
        }
    }
}
