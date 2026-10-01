use super::*;
use crate::api::context::test::{
    ADMISSION_TEST_USER, TestAdmission, admission_errors, test_api_context, test_model_access,
};
use macro_db_migrator::MACRO_DB_MIGRATIONS;

fn admission_request(chat_id: Option<String>) -> HttpSendChatMessageRequest {
    HttpSendChatMessageRequest {
        content: "hello".into(),
        chat_id,
        model: chat::domain::models::FREE_MODEL.into(),
        additional_instructions: None,
        attachments: None,
        toolset: ToolSet::None,
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn admission_rejects_before_chat_creation_or_streaming(pool: sqlx::PgPool) {
    let ctx = test_api_context(pool.clone()).await;
    for error in admission_errors() {
        // Exercise both new-chat paths: omitted ID and a missing chat.
        for chat_id in [None, Some(uuid::Uuid::now_v7().to_string())] {
            let admission = TestAdmission::rejecting(error);
            let mut state = (*ctx).clone();
            state.ai_admission = admission.clone();
            let model_access = test_model_access(&state).await;
            let result = send_chat_message_inner(
                state,
                model_access,
                MacroUserIdStr::parse_from_str(ADMISSION_TEST_USER).unwrap(),
                BearerToken(String::new()),
                admission_request(chat_id),
            )
            .await
            .unwrap_err();
            assert_eq!(result.status, Some(admission_status(error)));
            assert_eq!(result.code.as_deref(), Some(error.code()));
            assert_eq!(result.error, error.to_string());
            assert!(result.stream_id.is_some());
            assert_eq!(
                *admission.calls.lock().unwrap(),
                vec![(ADMISSION_TEST_USER.into(), ai_usage::AiFeature::Chat)]
            );
        }
    }
    assert_eq!(
        sqlx::query_scalar!("SELECT count(*) FROM \"Chat\"")
            .fetch_one(&pool)
            .await
            .unwrap(),
        Some(0)
    );
    assert_eq!(
        sqlx::query_scalar!("SELECT count(*) FROM \"ChatMessage\"")
            .fetch_one(&pool)
            .await
            .unwrap(),
        Some(0)
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn permission_failures_precede_admission(pool: sqlx::PgPool) {
    let ctx = test_api_context(pool.clone()).await;
    let chat_id = uuid::Uuid::now_v7().to_string();
    sqlx::query!(
        r#"INSERT INTO "Chat" (id, "userId", name) VALUES ($1, 'macro|other@example.com', 'Private chat')"#,
        chat_id
    ).execute(&pool).await.unwrap();

    for error in admission_errors() {
        let admission = TestAdmission::rejecting(error);
        let mut state = (*ctx).clone();
        state.ai_admission = admission.clone();
        let result = send_chat_message_inner(
            state.clone(),
            test_model_access(&state).await,
            MacroUserIdStr::parse_from_str(ADMISSION_TEST_USER).unwrap(),
            BearerToken(String::new()),
            admission_request(Some(chat_id.clone())),
        )
        .await
        .unwrap_err();
        assert!(result.error.starts_with("Permission check failed:"));
        assert!(result.code.is_none());
        assert_eq!(result.into_response().status(), StatusCode::BAD_REQUEST);

        let mut request = admission_request(None);
        request.model = "anthropic/claude-opus-5".into();
        let result = send_chat_message_inner(
            state.clone(),
            test_model_access(&state).await,
            MacroUserIdStr::parse_from_str(ADMISSION_TEST_USER).unwrap(),
            BearerToken(String::new()),
            request,
        )
        .await
        .unwrap_err();
        assert_eq!(result.status, Some(StatusCode::FORBIDDEN));
        assert!(result.code.is_none());
        assert!(admission.calls.lock().unwrap().is_empty());
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn disabled_admission_allows_authorized_request_to_reach_chat_creation(pool: sqlx::PgPool) {
    let ctx = test_api_context(pool.clone()).await;
    let model_access = test_model_access(&ctx).await;
    let mut state = (*ctx).clone();
    state.ai_admission = Arc::new(ai_billing::BillingAdmissionService::new(
        ctx.ai_billing.clone(),
        ai_usage::AiUsageEnforcement::default(),
    ));
    // Closed billing storage must not block disabled admission. Execution then
    // stops at chat creation without starting real AI work.
    pool.close().await;
    let error = send_chat_message_inner(
        state,
        model_access,
        MacroUserIdStr::parse_from_str(ADMISSION_TEST_USER).unwrap(),
        BearerToken(String::new()),
        admission_request(None),
    )
    .await
    .unwrap_err();
    assert_eq!(error.error, "Failed to create chat");
    assert!(error.code.is_none());
}

#[test]
fn send_chat_message_request_accepts_arbitrary_model_string() {
    let request: HttpSendChatMessageRequest = serde_json::from_value(serde_json::json!({
        "content": "hello",
        "model": "custom-provider/custom-model",
    }))
    .unwrap();

    assert_eq!(request.model, "custom-provider/custom-model");
}

fn text(s: &str) -> AssistantMessagePart {
    AssistantMessagePart::Text { text: s.into() }
}
fn call(id: &str) -> AssistantMessagePart {
    AssistantMessagePart::ToolCall {
        name: "t".into(),
        json: serde_json::json!({}),
        id: id.into(),
    }
}
fn resp(id: &str) -> AssistantMessagePart {
    AssistantMessagePart::ToolCallResponseJson {
        name: "t".into(),
        json: serde_json::json!({}),
        id: id.into(),
    }
}
fn cancelled_err(id: &str) -> AssistantMessagePart {
    AssistantMessagePart::ToolCallErr {
        name: "t".into(),
        id: id.into(),
        description: "cancelled".to_string(),
    }
}

#[test]
fn noop_when_no_tool_calls() {
    let parts = vec![text("a"), text("b")];
    assert_eq!(resolve_pending_tool_calls(parts.clone()), parts);
}

#[test]
fn noop_when_all_tool_calls_resolved() {
    let parts = vec![text("a"), call("1"), resp("1"), text("b")];
    assert_eq!(resolve_pending_tool_calls(parts.clone()), parts);
}

#[test]
fn inserts_cancelled_err_after_trailing_unmatched_call() {
    let parts = vec![text("a"), call("1")];
    let out = resolve_pending_tool_calls(parts);
    assert_eq!(out, vec![text("a"), call("1"), cancelled_err("1")]);
}

#[test]
fn inserts_cancelled_err_immediately_after_unmatched_call() {
    let parts = vec![text("a"), call("1"), text("b")];
    let out = resolve_pending_tool_calls(parts);
    assert_eq!(
        out,
        vec![text("a"), call("1"), cancelled_err("1"), text("b")]
    );
}

#[test]
fn leaves_resolved_calls_alone_resolves_pending_ones() {
    let parts = vec![
        text("a"),
        call("1"),
        resp("1"),
        text("b"),
        call("2"),
        text("c"),
    ];
    let out = resolve_pending_tool_calls(parts);
    assert_eq!(
        out,
        vec![
            text("a"),
            call("1"),
            resp("1"),
            text("b"),
            call("2"),
            cancelled_err("2"),
            text("c"),
        ]
    );
}

#[test]
fn resolves_multiple_unmatched_calls() {
    let parts = vec![call("1"), text("x"), call("2")];
    let out = resolve_pending_tool_calls(parts);
    assert_eq!(
        out,
        vec![
            call("1"),
            cancelled_err("1"),
            text("x"),
            call("2"),
            cancelled_err("2"),
        ]
    );
}

#[test]
fn empty_input_stays_empty() {
    assert!(resolve_pending_tool_calls(vec![]).is_empty());
}
