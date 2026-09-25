use super::*;

#[tokio::test]
async fn active_meeting_discovery_is_scoped_to_the_authenticated_actor() {
    let meeting = invitation_for_test();
    let meeting_id = meeting.id;
    let creator = meeting.user_id.clone();
    let public_metadata = serde_json::to_value(&meeting).unwrap();
    assert!(public_metadata.get("createdBy").is_none());
    assert!(public_metadata.get("userId").is_none());
    let mut repo = MockCallRepository::new();
    repo.expect_list_active_meetings()
        .with(mockall::predicate::eq("macro|attendee@example.com"))
        .times(1)
        .return_once(move |_| Box::pin(async move { Ok(vec![meeting]) }));
    let service = build_get_or_create_service(
        repo,
        StubConnectionService,
        RecordingEventBroker::default(),
        false,
    );

    let meetings = service
        .list_active_meetings(user("attendee@example.com"))
        .await
        .unwrap();

    assert_eq!(meetings.len(), 1);
    assert_eq!(meetings[0].meeting.id, meeting_id);
    assert_eq!(meetings[0].created_by, creator);
    assert_ne!(meetings[0].created_by, "macro|attendee@example.com");
    let active_metadata = serde_json::to_value(&meetings[0]).unwrap();
    assert_eq!(active_metadata["createdBy"], creator);
    let mut expected = public_metadata;
    expected["createdBy"] = serde_json::json!(creator);
    assert_eq!(active_metadata, expected);
}

#[tokio::test]
async fn active_meeting_discovery_preserves_repository_errors() {
    let mut repo = MockCallRepository::new();
    repo.expect_list_active_meetings()
        .with(mockall::predicate::eq("macro|attendee@example.com"))
        .times(1)
        .return_once(|_| {
            Box::pin(async { Err(CallError::Internal(anyhow::anyhow!("database unavailable"))) })
        });
    let service = build_get_or_create_service(
        repo,
        StubConnectionService,
        RecordingEventBroker::default(),
        false,
    );

    assert!(matches!(
        service
            .list_active_meetings(user("attendee@example.com"))
            .await,
        Err(CallError::Internal(_))
    ));
}
