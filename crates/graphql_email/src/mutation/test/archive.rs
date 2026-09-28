use super::*;

#[tokio::test]
async fn archive_reply_failure_is_retryable_after_the_write_commits() {
    let service = Arc::new(CapturingEmailMutationService {
        thread_load_fails: true,
        ..Default::default()
    });
    let response = schema(service.clone()).execute(format!(
        r#"mutation {{ setEmailThreadArchived(input: {{threadId: "{}", archived: true}}) {{id}} }}"#,
        Uuid::from_u128(42),
    )).await;
    assert_eq!(service.calls.lock().unwrap().len(), 1);
    assert_eq!(response.errors.len(), 1);
    assert_eq!(
        response.errors[0]
            .extensions
            .as_ref()
            .unwrap()
            .get("retryable"),
        Some(&async_graphql::Value::Boolean(true))
    );
}

#[tokio::test]
async fn archive_and_undo_forward_identity_and_state_to_the_service() {
    for archived in [true, false] {
        let service = Arc::new(CapturingEmailMutationService::default());
        let thread_id = Uuid::from_u128(42);
        let response = schema(service.clone()).execute(format!(
            r#"mutation {{ setEmailThreadArchived(input: {{ threadId: "{thread_id}", archived: {archived} }}) {{ id }} }}"#
        )).await;
        assert!(response.errors.is_empty(), "{:?}", response.errors);
        assert_eq!(
            response.data.into_json().unwrap()["setEmailThreadArchived"]["id"],
            thread_id.to_string()
        );
        assert_eq!(
            *service.calls.lock().unwrap(),
            vec![CapturedMutation::Archive {
                user_id: "macro|viewer@example.com".into(),
                thread_id,
                archived,
            }]
        );
    }
}

#[tokio::test]
async fn archive_rejects_invalid_identity_and_ids_before_domain_writes() {
    let service = Arc::new(CapturingEmailMutationService::default());
    let unauthenticated = Schema::build(
        QueryRoot,
        GraphqlEmailMutation::<CapturingEmailMutationService, TestEmailThreadOutput>::new(),
        EmptySubscription,
    )
    .data(service.clone())
    .finish();
    let query = format!(
        r#"mutation {{ setEmailThreadArchived(input: {{threadId: "{}", archived: true}}) {{id}} }}"#,
        Uuid::from_u128(42)
    );
    assert!(!unauthenticated.execute(query).await.errors.is_empty());
    assert!(!schema(service.clone()).execute(
        r#"mutation { setEmailThreadArchived(input: {threadId: "bad-id", archived: true}) {id} }"#
    ).await.errors.is_empty());
    assert!(service.calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn archive_does_not_report_success_when_the_service_rejects_the_write() {
    let service = Arc::new(CapturingEmailMutationService {
        reject_archive: true,
        ..Default::default()
    });
    let response = schema(service).execute(format!(
        r#"mutation {{ setEmailThreadArchived(input: {{threadId: "{}", archived: true}}) {{id}} }}"#, Uuid::from_u128(42)
    )).await;
    assert_eq!(response.errors.len(), 1);
    assert_eq!(response.errors[0].message, "email thread not found");
    assert_eq!(response.data, async_graphql::Value::Null);
}
