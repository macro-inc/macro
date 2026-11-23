use super::*;

#[tokio::test]
async fn subscribed_events_are_verified_and_published_without_needing_a_sync_handler() {
    let TestGithubSyncService { service, .. } = make_sync_service();
    let published = Arc::new(Mutex::new(Vec::new()));
    let service = service.with_webhook_publisher(RecordingPublisher(Arc::clone(&published)));
    let registration: serde_json::Value =
        serde_json::from_str(include_str!("../../../../../app-webhooks.json")).unwrap();
    let events = registration["default_events"].as_array().unwrap();
    // Optional sender and action are absent on some deliveries. The sync
    // handlers must not prevent these installation facts reaching routines.
    let body = serde_json::to_vec(&serde_json::json!({
        "installation": { "id": 12345 },
        "repository": { "id": 42, "full_name": "example/repository" },
        "ref": "refs/heads/main",
    }))
    .unwrap();
    let mut mac = HmacSha256::new_from_slice(service.config.webhook_secret.as_bytes()).unwrap();
    mac.update(&body);
    let signature = hex::encode(mac.finalize().into_bytes());

    for event in events {
        let name = event.as_str().unwrap();
        let verified = service
            .validate_webhook_event(name, &signature, &body)
            .await
            .unwrap()
            .with_delivery_id(Some(format!("delivery-{name}")));
        service.process_webhook_event(&verified).await.unwrap();
    }

    let published = published.lock().unwrap();
    assert_eq!(published.len(), events.len());
    for (delivery, event) in published.iter().zip(events) {
        assert_eq!(delivery.event, event.as_str().unwrap());
        assert_eq!(delivery.installation_id, 12345);
        assert_eq!(delivery.action, None);
        assert_eq!(delivery.sender, None);
        assert_eq!(
            delivery.repository.as_ref().unwrap().full_name,
            "example/repository"
        );
        assert_eq!(delivery.payload.as_ref().unwrap()["ref"], "refs/heads/main");
        assert_eq!(
            delivery.delivery_id,
            Some(format!("delivery-{}", delivery.event))
        );
    }
}

#[tokio::test]
async fn changed_signed_payload_is_rejected_before_publication() {
    let TestGithubSyncService { service, .. } = make_sync_service();
    let body = br#"{"installation":{"id":12345},"ref":"refs/heads/main"}"#;
    let mut mac = HmacSha256::new_from_slice(service.config.webhook_secret.as_bytes()).unwrap();
    mac.update(body);
    let signature = hex::encode(mac.finalize().into_bytes());

    assert!(matches!(
        service
            .validate_webhook_event(
                "push",
                &signature,
                br#"{"installation":{"id":54321},"ref":"refs/heads/main"}"#,
            )
            .await,
        Err(GithubError::InvalidWebhookSignature)
    ));
}

struct RecordingPublisher(Arc<Mutex<Vec<crate::domain::models::GithubWebhookReceived>>>);

impl crate::domain::ports::GithubWebhookPublisher for RecordingPublisher {
    fn publish_received(
        &self,
        delivery: crate::domain::models::GithubWebhookReceived,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<(), GithubError>> + Send + '_>>
    {
        self.0.lock().unwrap().push(delivery);
        Box::pin(async { Ok(()) })
    }
}

#[tokio::test]
async fn every_installation_delivery_is_published_even_events_sync_ignores() {
    let TestGithubSyncService { service, .. } = make_sync_service();
    let published = Arc::new(Mutex::new(Vec::new()));
    let service = service.with_webhook_publisher(RecordingPublisher(Arc::clone(&published)));

    let workflow_run = ValidatedGithubWebhookEvent::new(
        "workflow_run".to_string(),
        serde_json::json!({
            "action": "completed",
            "installation": { "id": 12345 },
            "workflow_run": { "name": "CI", "conclusion": "failure" },
        }),
    )
    .with_delivery_id(Some("delivery-1".to_string()));
    let app_level = ValidatedGithubWebhookEvent::new(
        "github_app_authorization".to_string(),
        serde_json::json!({ "action": "revoked" }),
    );

    service.process_webhook_event(&workflow_run).await.unwrap();
    service.process_webhook_event(&app_level).await.unwrap();

    let published = published.lock().unwrap();
    assert_eq!(published.len(), 1);
    assert_eq!(published[0].event, "workflow_run");
    assert_eq!(published[0].delivery_id.as_deref(), Some("delivery-1"));
    assert_eq!(published[0].installation_id, 12345);
}
