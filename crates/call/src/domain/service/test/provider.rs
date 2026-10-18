use super::*;

#[tokio::test]
async fn provider_channel_cannot_create_or_join_a_native_call() {
    let mut repo = MockCallRepository::new();
    repo.expect_channel_allows_calls()
        .times(1)
        .returning(|_| Box::pin(async { Ok(false) }));
    repo.expect_get_call_by_channel_id().times(0);
    repo.expect_create_call().times(0);
    let service = build_get_or_create_service(
        repo,
        StubConnectionService,
        RecordingEventBroker::default(),
        false,
    );
    assert!(matches!(
        service
            .get_or_create_call(&STARTED_EVENT_CHANNEL_ID, user("requester@example.com"))
            .await,
        Err(CallError::InvalidRequest(_))
    ));
}
