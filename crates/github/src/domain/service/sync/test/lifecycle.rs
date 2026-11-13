use super::*;

#[tokio::test]
async fn closing_and_reopening_publish_the_stored_lifecycle_details() {
    let repo = StubSyncRepo::new().with_installation_sources(
        "12345",
        vec![GithubAppInstallationSource::User(
            "macro|viewer@example.com".to_string(),
        )],
    );
    let service = make_sync_service_with_repo(repo);
    let mut details = pull_request_details("PR", 10, 2, None, None);
    details.state = "closed".to_string();
    details.merged_at = Some("2026-11-01T12:00:00Z".parse().unwrap());
    service
        .client
        .set_pull_request_details("my-org", "my-repo", 42, details);

    let mut event = ValidatedGithubWebhookEvent::new(
        "pull_request".to_string(),
        serde_json::json!({
            "action": "closed",
            "pull_request": {
                "number": 42, "title": "PR", "state": "closed", "merged": true,
                "merged_by": { "id": 7, "login": "merger" },
                "merged_at": "2026-11-01T12:00:00Z",
                "closed_at": "2026-11-01T12:00:00Z"
            },
            "sender": { "id": 8, "login": "closer" },
            "repository": { "name": "my-repo", "owner": { "login": "my-org" } },
            "installation": { "id": 12345 }
        }),
    );
    service.process_webhook_event(&event).await.unwrap();
    let closed = service.foreign_entity_service.foreign_entities().remove(0);
    assert_eq!(closed.metadata["mergedBy"]["githubUserId"], "7");
    assert_eq!(closed.metadata["closedBy"]["githubUserId"], "8");
    assert_eq!(closed.metadata["closedAt"], "2026-11-01T12:00:00Z");
    assert_eq!(closed.metadata["mergedAt"], "2026-11-01T12:00:00Z");
    assert_eq!(service.realtime.events.lock().unwrap()[0].1, closed);

    service.client.set_pull_request_details(
        "my-org",
        "my-repo",
        42,
        pull_request_details("PR", 10, 2, None, None),
    );
    event.payload["action"] = serde_json::json!("reopened");
    event.payload["pull_request"]["state"] = serde_json::json!("open");
    event.payload["pull_request"]["merged"] = serde_json::json!(false);
    for field in ["merged_by", "merged_at", "closed_at"] {
        event.payload["pull_request"][field] = serde_json::Value::Null;
    }
    service.process_webhook_event(&event).await.unwrap();
    let reopened = service.foreign_entity_service.foreign_entities().remove(0);
    assert_eq!(reopened.id, closed.id);
    assert_eq!(reopened.metadata["status"], "open");
    for field in ["mergedBy", "closedBy", "mergedAt", "closedAt"] {
        assert!(reopened.metadata[field].is_null());
    }
    assert_eq!(service.realtime.events.lock().unwrap()[1].1, reopened);
}
