pub(crate) mod quota;

use super::*;
use ai_billing::DenyReason;
use ai_billing::domain::{AiAdmissionError, AiAdmissionService, UnconfiguredAiAdmissionService};
use ai_usage::AiFeature;
use axum::extract::FromRequestParts;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use std::sync::Mutex;

/// A paid-account billing result, independent of model permissions.
pub(crate) struct RejectAdmission {
    pub reason: Option<DenyReason>,
    pub calls: Mutex<Vec<(String, AiFeature)>>,
}

impl RejectAdmission {
    pub fn new(reason: Option<DenyReason>) -> Arc<Self> {
        Arc::new(Self {
            reason,
            calls: Mutex::new(Vec::new()),
        })
    }
}

impl AiAdmissionService for RejectAdmission {
    fn admit<'a>(
        &'a self,
        user: &'a MacroUserIdStr<'_>,
        feature: AiFeature,
    ) -> std::pin::Pin<
        Box<dyn std::future::Future<Output = Result<(), AiAdmissionError>> + Send + 'a>,
    > {
        Box::pin(async move {
            self.calls.lock().unwrap().push((user.to_string(), feature));
            match self.reason {
                Some(reason) => Err(AiAdmissionError::Denied(reason)),
                None => UnconfiguredAiAdmissionService.admit(user, feature).await,
            }
        })
    }
}

pub(crate) const ACTING_USER: &str = "macro|paid-without-professional@example.com";

pub(crate) async fn internal_extractors(
    ctx: &ApiContext,
) -> (
    DcsChatModelAccess,
    MacroAuthorizationExtractor<DcsAuthorizationService, UserOrInternal>,
) {
    let (mut parts, _) = Request::builder()
        .header(macro_authorization::INTERNAL_API_KEY_HEADER, "testing")
        .header(
            macro_authorization::INTERNAL_MACRO_USER_ID_HEADER,
            ACTING_USER,
        )
        .body(())
        .unwrap()
        .into_parts();
    let access = DcsChatModelAccess::from_request_parts(&mut parts, ctx)
        .await
        .unwrap_or_else(|_| panic!("internal acting user must have model access"));
    assert!(!access.professional());
    let user = MacroAuthorizationExtractor::from_request_parts(&mut parts, ctx)
        .await
        .unwrap_or_else(|_| panic!("internal acting user must authenticate"));
    (access, user)
}

/// Any stream interaction on a rejected request fails the test.
pub(crate) struct NoStreams;

#[async_trait::async_trait]
impl stream::domain::StreamRepo for NoStreams {
    async fn append(
        &self,
        _: &StreamId,
        _: serde_json::Value,
    ) -> stream::domain::Result<stream::domain::ItemId> {
        panic!("rejected request must not append to a stream")
    }
    async fn stream_from_beginning(
        &self,
        _: &StreamId,
    ) -> stream::domain::Result<stream::domain::ItemStream> {
        panic!("rejected request must not read a stream")
    }
    async fn close(&self, _: &StreamId) -> stream::domain::Result<()> {
        panic!("rejected request must not close a stream")
    }
    async fn active_streams(&self, _: &str) -> stream::domain::Result<Vec<StreamId>> {
        panic!("rejected request must not access streams")
    }
    async fn notify(&self) -> tokio::sync::broadcast::Receiver<stream::domain::StreamEvent> {
        panic!("rejected request must not register a stream")
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn billing_rejects_internal_paid_actor_without_professional_permission_before_side_effects(
    pool: sqlx::PgPool,
) {
    let mut ctx = (*crate::api::context::test_api_context(pool.clone()).await).clone();
    ctx.stream_repo = Arc::new(NoStreams);
    let mut extractors = Vec::new();
    for _ in 0..8 {
        let (access, user) = internal_extractors(&ctx).await;
        assert!(access.has_access(chat::domain::models::FREE_MODEL));
        extractors.push((access, user));
    }
    // A closed pool makes chat/message writes impossible. Rejection must still
    // be the billing result, not a downstream persistence/provider error.
    pool.close().await;

    for reason in [
        Some(DenyReason::AllowanceExhausted),
        Some(DenyReason::OverageLimitReached),
        Some(DenyReason::OveragePaymentFailed),
        None,
    ] {
        for chat_id in [None, Some("existing-chat".to_string())] {
            let admission = RejectAdmission::new(reason);
            ctx.tool_service_context.admission = admission.clone();
            let (access, user) = extractors.pop().unwrap();
            let error = send_chat_message(
                State(ctx.clone()),
                access,
                user,
                Extension(BearerToken(String::new())),
                Json(HttpSendChatMessageRequest {
                    content: "hello".to_string(),
                    chat_id,
                    model: chat::domain::models::FREE_MODEL.to_string(),
                    additional_instructions: None,
                    attachments: None,
                    toolset: ToolSet::None,
                }),
            )
            .await
            .unwrap_err();
            let expected_status = if reason.is_some() {
                StatusCode::PAYMENT_REQUIRED
            } else {
                StatusCode::SERVICE_UNAVAILABLE
            };
            assert_eq!(error.status, Some(expected_status));
            assert_eq!(
                error.code.as_deref(),
                Some(reason.map(|r| r.code()).unwrap_or("ai_billing_unavailable"))
            );
            assert!(error.stream_id.is_some());
            assert_eq!(
                *admission.calls.lock().unwrap(),
                vec![(ACTING_USER.to_string(), AiFeature::Chat)]
            );
            let response = error.into_response();
            assert_eq!(response.status(), expected_status);
            let body = axum::body::to_bytes(response.into_body(), usize::MAX)
                .await
                .unwrap();
            let body: serde_json::Value = serde_json::from_slice(&body).unwrap();
            assert!(body["stream_id"].is_string());
            assert!(!body["error"].as_str().unwrap().contains("not configured"));
        }
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn model_authorization_still_precedes_billing(pool: sqlx::PgPool) {
    let mut ctx = (*crate::api::context::test_api_context(pool.clone()).await).clone();
    let (access, user) = internal_extractors(&ctx).await;
    pool.close().await;
    let admission = RejectAdmission::new(None);
    ctx.tool_service_context.admission = admission.clone();
    let request = serde_json::from_value(serde_json::json!({
        "content": "hello",
        "model": "anthropic/claude-opus-5",
    }))
    .unwrap();
    let error = send_chat_message(
        State(ctx),
        access,
        user,
        Extension(BearerToken(String::new())),
        Json(request),
    )
    .await
    .unwrap_err();
    assert_eq!(error.status, Some(StatusCode::FORBIDDEN));
    assert!(admission.calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn unauthenticated_requests_cannot_reach_admission() {
    use tower::ServiceExt;
    let pool = sqlx::postgres::PgPoolOptions::new()
        .connect_lazy("postgres://unused:unused@127.0.0.1:1/unused")
        .unwrap();
    pool.close().await;
    let mut ctx = (*crate::api::context::test_api_context(pool).await).clone();
    let admission = RejectAdmission::new(None);
    ctx.tool_service_context.admission = admission.clone();
    let router = axum::Router::new()
        .route("/chat", axum::routing::post(send_chat_message))
        .route(
            "/structured",
            axum::routing::post(crate::api::structured_completion::structured_completion),
        )
        .layer(Extension(BearerToken(String::new())))
        .with_state(ctx);
    for path in ["/chat", "/structured"] {
        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(path)
                    .header("content-type", "application/json")
                    .body(axum::body::Body::from("{}"))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }
    assert!(admission.calls.lock().unwrap().is_empty());
}

#[test]
fn openapi_documents_both_admission_failures() {
    use utoipa::OpenApi;
    let schema = serde_json::to_value(crate::api::swagger::ApiDoc::openapi()).unwrap();
    for (path, body) in [
        ("/stream/chat/message", "ChatMessageError"),
        ("/structured-completion", "StructuredCompletionError"),
    ] {
        for status in ["402", "503"] {
            assert_eq!(
                schema["paths"][path]["post"]["responses"][status]["content"]["application/json"]["schema"]
                    ["$ref"],
                format!("#/components/schemas/{body}")
            );
        }
    }
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
