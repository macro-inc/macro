use super::access::TeamAccessService;
use super::*;
use tokio::sync::{Notify, mpsc};

struct SlowConnectionService {
    release: Arc<Notify>,
    events: mpsc::UnboundedSender<&'static str>,
}

impl ConnectionService for SlowConnectionService {
    async fn send_invalidation_event<'a, T: std::fmt::Debug + serde::Serialize + Send>(
        &self,
        _: InvalidationEvent<'a, T>,
    ) -> Result<(), ConnectionError> {
        unreachable!()
    }

    async fn send_channel_message<'a>(
        &self,
        users: &[MacroUserIdStr<'a>],
        message_type: &str,
        message: serde_json::Value,
    ) -> Result<(), ConnectionError> {
        match message_type {
            "call_answered" => Ok(()),
            "call_started" => {
                assert_eq!(users, &[user("recipient@example.com")]);
                assert_eq!(message["call_id"], json!(STARTED_EVENT_CALL_ID));
                self.events.send("notification").unwrap();
                self.release.notified().await;
                Ok(())
            }
            _ => panic!("unexpected call event"),
        }
    }
}

struct RecordingNotificationIngress(mpsc::UnboundedSender<&'static str>);

impl NotificationIngress for RecordingNotificationIngress {
    async fn send_notification<
        'a,
        T: notification::domain::models::Notification + Clone + 'static,
        U: serde::Serialize + Send + Sync + 'static,
    >(
        &self,
        _: notification::domain::models::request::SendNotificationRequest<'a, T, U>,
    ) -> Result<
        Option<notification::domain::models::NotificationResult<'a>>,
        rootcause::Report<notification::domain::service::SendNotificationError>,
    > {
        self.0.send("push").unwrap();
        Ok(None)
    }
}

async fn next_event(events: &mut mpsc::UnboundedReceiver<&'static str>) -> &'static str {
    tokio::time::timeout(Duration::from_secs(2), events.recv())
        .await
        .expect("background task should progress")
        .expect("event sender is alive")
}

#[tokio::test]
async fn channel_token_does_not_wait_for_media_or_recipient_notifications() {
    let (events, mut received) = mpsc::unbounded_channel();
    let release_agent = Arc::new(Notify::new());
    let release_recorder = Arc::new(Notify::new());
    let release_notifications = Arc::new(Notify::new());
    let call = started_event_call(STARTED_EVENT_CREATOR);
    let repo = mock_get_or_create_repo(GetOrCreateScenario::CreatorWins, call.clone());
    let mut rtc = MockCallRtcClient::new();
    rtc.expect_create_room()
        .times(1)
        .returning(|_| Box::pin(async { Ok(()) }));
    rtc.expect_generate_token()
        .times(1)
        .returning(|_, _| Box::pin(async { Ok("token".into()) }));
    let gate = release_agent.clone();
    let sender = events.clone();
    rtc.expect_dispatch_transcription_agent()
        .times(1)
        .return_once(move |_| {
            Box::pin(async move {
                sender.send("transcription").unwrap();
                gate.notified().await;
                sender.send("transcription_done").unwrap();
                // A best-effort failure must not invalidate issued credentials.
                Err(anyhow::anyhow!("agent unavailable"))
            })
        });
    let gate = release_recorder.clone();
    let sender = events.clone();
    rtc.expect_start_room_composite_egress()
        .times(1)
        .return_once(move |_, _| {
            Box::pin(async move {
                sender.send("recording").unwrap();
                gate.notified().await;
                Ok("egress".into())
            })
        });
    let mut background_repo = MockCallRepository::new();
    background_repo
        .expect_get_call_by_id()
        .times(2)
        .returning(move |_| {
            let call = call.clone();
            Box::pin(async move { Ok(Some(call)) })
        });
    let sender = events.clone();
    background_repo
        .expect_attach_meeting_recording()
        .times(1)
        .return_once(move |id, egress| {
            assert_eq!(*id, STARTED_EVENT_CALL_ID);
            assert_eq!(egress, "egress");
            Box::pin(async move {
                sender.send("attached").unwrap();
                Ok(true)
            })
        });
    background_repo
        .expect_resolve_channel_name_for_viewers()
        .times(1)
        .returning(|_, _| Box::pin(async { Ok(HashMap::new()) }));
    background_repo
        .expect_get_user_profile_picture()
        .times(1)
        .returning(|_| Box::pin(async { Ok(None) }));
    background_repo
        .expect_get_user_display_name()
        .times(1)
        .returning(|_| Box::pin(async { Ok(None) }));
    let service = CallServiceImpl::<_, _, _, _, _, _, NoopCallSummarizer>::new(
        repo,
        rtc,
        SlowConnectionService {
            release: release_notifications.clone(),
            events: events.clone(),
        },
        TeamAccessService {
            channel_users: vec![user("requester@example.com"), user("recipient@example.com")],
            ..Default::default()
        },
        RecordingNotificationIngress(events),
        StubRecordingStorage,
        "wss://example.com",
    )
    .with_egress(EgressS3Config {
        bucket: "test".into(),
        region: "test".into(),
        access_key: "test".into(),
        secret: "test".into(),
    });
    configure_repository_clone(&service.repo, background_repo);
    let token = tokio::time::timeout(
        Duration::from_millis(200),
        service.get_or_create_call(&STARTED_EVENT_CHANNEL_ID, user("requester@example.com")),
    )
    .await
    .expect("credentials must not wait for background services")
    .unwrap();
    assert_eq!(token.token, "token");
    let mut started = HashSet::new();
    for _ in 0..3 {
        started.insert(next_event(&mut received).await);
    }
    assert_eq!(
        started,
        HashSet::from(["transcription", "recording", "notification"])
    );
    release_recorder.notify_one();
    assert_eq!(next_event(&mut received).await, "attached");
    release_notifications.notify_one();
    assert_eq!(next_event(&mut received).await, "push");
    release_agent.notify_one();
    assert_eq!(next_event(&mut received).await, "transcription_done");
    tokio::task::yield_now().await;
}

#[tokio::test]
async fn existing_and_race_losing_joins_do_not_start_background_services() {
    for scenario in [
        GetOrCreateScenario::ExistingCall,
        GetOrCreateScenario::RaceLoses,
    ] {
        let repo = mock_get_or_create_repo(scenario, started_event_call(STARTED_EVENT_CREATOR));
        let mut rtc = MockCallRtcClient::new();
        if matches!(scenario, GetOrCreateScenario::RaceLoses) {
            rtc.expect_create_room()
                .times(1)
                .returning(|_| Box::pin(async { Ok(()) }));
            rtc.expect_delete_room()
                .times(1)
                .returning(|_| Box::pin(async { Ok(()) }));
        }
        rtc.expect_generate_token()
            .times(1)
            .returning(|_, _| Box::pin(async { Ok("token".into()) }));
        rtc.expect_dispatch_transcription_agent().never();
        rtc.expect_start_room_composite_egress().never();
        let service: BaseWebhookCallService<StubConnectionService> = CallServiceImpl::new(
            repo,
            rtc,
            StubConnectionService,
            NoOpEntityAccessService,
            StubNotificationIngress,
            StubRecordingStorage,
            "wss://example.com",
        );
        service
            .get_or_create_call(&STARTED_EVENT_CHANNEL_ID, user("requester@example.com"))
            .await
            .unwrap();
        tokio::task::yield_now().await;
    }
}

#[tokio::test]
async fn ended_call_does_not_ring_recipients() {
    let mut repo = MockCallRepository::new();
    repo.expect_get_call_by_id()
        .times(1)
        .returning(|_| Box::pin(async { Ok(None) }));
    let mut rtc = MockCallRtcClient::new();
    rtc.expect_dispatch_transcription_agent()
        .times(1)
        .returning(|_| Box::pin(async { Ok(()) }));
    rtc.expect_start_room_composite_egress().never();
    let connection = RecordingConnectionService::default();
    let startup = super::super::channel_startup::ChannelCallStartup {
        repo,
        rtc_client: Arc::new(rtc),
        connection_service: Arc::new(connection.clone()),
        entity_access_service: TeamAccessService {
            channel_users: vec![user("recipient@example.com")],
            ..Default::default()
        },
        notification_ingress: Arc::new(StubNotificationIngress),
        voip_push_sender: Arc::new(()),
        server_url: "wss://example.com".into(),
        ring_status_base_url: None,
        egress_s3_config: None,
    };
    startup
        .spawn(
            started_event_call(STARTED_EVENT_CREATOR),
            STARTED_EVENT_CHANNEL_ID,
            user("requester@example.com"),
        )
        .await
        .unwrap();
    assert!(connection.messages().is_empty());
}
