use super::*;

#[tokio::test]
async fn saved_draft_returns_the_selected_sender_instead_of_the_inbox_address() {
    let response = schema(Arc::new(CapturingEmailMutationService::default()))
        .execute(format!(
            r#"mutation {{ saveEmailDraft(input: {{
            draftId: "{}", subject: "Alias", senderEmail: "resident@example.com"
        }}) {{ draft {{ from {{ email }} }} }} }}"#,
            Uuid::now_v7()
        ))
        .await;
    assert!(response.errors.is_empty(), "{:?}", response.errors);
    assert_eq!(
        response.data.into_json().unwrap()["saveEmailDraft"]["draft"]["from"]["email"],
        "resident@example.com"
    );
}

#[tokio::test]
async fn malformed_sender_is_rejected_before_the_service_is_called() {
    let service = Arc::new(CapturingEmailMutationService::default());
    let response = schema(service.clone())
        .execute(format!(
            r#"mutation {{ saveEmailDraft(input: {{
            draftId: "{}", subject: "Alias", senderEmail: "not-an-email"
        }}) {{ draftId }} }}"#,
            Uuid::now_v7()
        ))
        .await;
    assert_eq!(response.errors.len(), 1);
    assert!(service.calls.lock().unwrap().is_empty());
    assert_eq!(
        response.errors[0].extensions.as_ref().unwrap().get("code"),
        Some(&async_graphql::Value::from("INVALID_SENDER"))
    );
}

#[tokio::test]
async fn send_returns_confirmed_identity_without_fallible_post_commit_hydration() {
    let service = Arc::new(CapturingEmailMutationService {
        thread_load_fails: true,
        ..Default::default()
    });
    let draft_id = Uuid::now_v7();
    let inbox_id = Uuid::now_v7();
    let response = schema(service.clone()).execute(
        async_graphql::Request::new(
            "mutation LegacySend($input: SendEmailMessageInput!) { sendEmailMessage(input: $input) { messageId threadId linkId sendTime } }",
        ).variables(async_graphql::Variables::from_json(serde_json::json!({
            "input": {"draft": {
                "draftId": draft_id.to_string(), "linkId": inbox_id.to_string(),
                "subject": "Alias", "senderEmail": "resident@example.com"
            }, "includeSignature": false}
        }))),
    ).await;
    assert!(response.errors.is_empty(), "{:?}", response.errors);
    assert_eq!(
        response.data.into_json().unwrap()["sendEmailMessage"],
        serde_json::json!({
            "messageId": draft_id.to_string(), "threadId": TEST_THREAD_ID.to_string(), "linkId": inbox_id.to_string(), "sendTime": null,
        })
    );
    assert_eq!(
        *service.send_inputs.lock().unwrap(),
        vec![(Some("resident@example.com".to_owned()), Some(false))]
    );
    assert!(
        matches!(&service.calls.lock().unwrap()[0], CapturedMutation::Draft { user_id, link_id: Some(id), .. } if user_id == "macro|viewer@example.com" && *id == inbox_id)
    );
}

#[tokio::test]
async fn unauthenticated_send_never_reaches_the_domain() {
    let service = Arc::new(CapturingEmailMutationService::default());
    let schema = Schema::build(
        QueryRoot,
        GraphqlEmailMutation::<CapturingEmailMutationService, TestEmailThreadOutput>::new(),
        EmptySubscription,
    )
    .data(service.clone())
    .finish();
    let response = schema.execute(format!(r#"mutation {{ sendEmailMessage(input: {{ draft: {{ draftId: "{}", subject: "s" }} }}) {{ messageId }} }}"#, Uuid::now_v7())).await;
    assert!(!response.errors.is_empty());
    assert!(service.calls.lock().unwrap().is_empty());
}
