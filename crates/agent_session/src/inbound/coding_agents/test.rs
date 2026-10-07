use super::*;
use axum::body::{Body, to_bytes};
use macro_authorization::{
    INTERNAL_API_KEY_HEADER, InternalAuthConfig, JwtValidator, MacroAuthorizationError,
    MacroAuthorizationServiceImpl, NoBotAuthorizer, NoUserApiKeyAuthorizer, ValidatedIdentity,
};
use rootcause::Report;
use serde_json::{Value, json};
use std::{future::Future, pin::Pin, sync::Mutex};
use tower::ServiceExt;
use uuid::Uuid;

const USER: &str = "macro|coding-owner@example.com";
const KEY: &str = "coding-test-internal-key";

#[derive(Clone)]
struct UserCredentials;

impl JwtValidator for UserCredentials {
    fn validate(&self, _: &str) -> Result<ValidatedIdentity, Report<MacroAuthorizationError>> {
        Ok(ValidatedIdentity {
            user_id: USER.into(),
            fusion_user_id: "fusion-owner".into(),
            organization_id: None,
            permissions: None,
        })
    }
}

#[derive(Default)]
struct ServiceSpy {
    seen: Mutex<Vec<Value>>,
    error: Option<CodingAgentError>,
}

impl CodingAgentService for ServiceSpy {
    fn list(
        &self,
        user_id: MacroUserIdStr<'static>,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<CodingAgent>, CodingAgentError>> + Send + '_>> {
        Box::pin(async move {
            self.seen.lock().unwrap().push(json!({"user_id":user_id}));
            if let Some(error) = &self.error {
                return Err(error.clone());
            }
            Ok(Vec::new())
        })
    }

    fn dispatch(
        &self,
        command: DispatchCodingAgentRequest,
    ) -> Pin<Box<dyn Future<Output = Result<DispatchedCodingAgent, CodingAgentError>> + Send + '_>>
    {
        Box::pin(async move {
            self.seen.lock().unwrap().push(json!(command));
            if let Some(error) = &self.error {
                return Err(error.clone());
            }
            Ok(DispatchedCodingAgent {
                agent_session_id: Uuid::now_v7(),
                agent_id: command.agent_id.unwrap(),
                agent_name: "Coding agent".into(),
            })
        })
    }
}

fn app(service: Arc<ServiceSpy>) -> Router {
    coding_agents_router(CodingAgentsState::new(
        service,
        MacroAuthorizationState::new(Arc::new(MacroAuthorizationServiceImpl::new(
            UserCredentials,
            InternalAuthConfig {
                api_key: KEY.into(),
                default_user_id: None,
            },
            NoBotAuthorizer,
            NoUserApiKeyAuthorizer,
        ))),
    ))
}

fn command(operation: &str) -> Value {
    match operation {
        "list" => json!({"user_id": USER}),
        _ => json!({"user_id": USER,"agent_id":Uuid::now_v7(),"prompt":"Fix the regression"}),
    }
}

fn request(operation: &str, command: Value, header: Option<(&str, &str)>) -> Request {
    let mut request = Request::builder()
        .method("POST")
        .uri(format!("/internal/coding-agents/{operation}"))
        .header("content-type", "application/json");
    if let Some((name, value)) = header {
        request = request.header(name, value);
    }
    request.body(Body::from(command.to_string())).unwrap()
}

async fn body(response: Response) -> Value {
    serde_json::from_slice(&to_bytes(response.into_body(), 1024).await.unwrap()).unwrap()
}

#[tokio::test]
async fn internal_credentials_are_required_before_discovery_or_dispatch() {
    let service = Arc::new(ServiceSpy::default());
    for operation in ["list", "dispatch"] {
        for (header, expected) in [
            (None, StatusCode::UNAUTHORIZED),
            (
                Some((INTERNAL_API_KEY_HEADER, "wrong")),
                StatusCode::UNAUTHORIZED,
            ),
            (
                Some(("authorization", "Bearer user")),
                StatusCode::FORBIDDEN,
            ),
        ] {
            let response = app(service.clone())
                .oneshot(request(operation, command(operation), header))
                .await
                .unwrap();
            assert_eq!(response.status(), expected);
        }
    }
    assert!(service.seen.lock().unwrap().is_empty());
}

#[tokio::test]
async fn authenticated_commands_preserve_user_and_task_identity() {
    let service = Arc::new(ServiceSpy::default());
    for operation in ["list", "dispatch"] {
        let command = command(operation);
        let response = app(service.clone())
            .oneshot(request(
                operation,
                command.clone(),
                Some((INTERNAL_API_KEY_HEADER, KEY)),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(service.seen.lock().unwrap().last(), Some(&command));
        if operation == "list" {
            assert_eq!(body(response).await, json!({"agents":[]}));
        } else {
            let output = body(response).await;
            assert_eq!(output["agent_id"], command["agent_id"]);
            assert!(output["agent_session_id"].is_string());
        }
    }
}

#[tokio::test]
async fn malformed_identity_and_oversized_tasks_never_reach_the_domain() {
    let service = Arc::new(ServiceSpy::default());
    for operation in ["list", "dispatch"] {
        for invalid in [None, Some(json!("invalid-user")), Some(Value::Null)] {
            let mut command = command(operation);
            command.as_object_mut().unwrap().remove("user_id");
            if let Some(invalid) = invalid {
                command["user_id"] = invalid;
            }
            let response = app(service.clone())
                .oneshot(request(
                    operation,
                    command,
                    Some((INTERNAL_API_KEY_HEADER, KEY)),
                ))
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::BAD_REQUEST);
            assert_eq!(body(response).await, json!({"code":"invalid_command"}));
        }
    }
    let mut command = command("dispatch");
    command["prompt"] = json!("x".repeat(MAX_COMMAND_BYTES));
    let response = app(service.clone())
        .oneshot(request(
            "dispatch",
            command,
            Some((INTERNAL_API_KEY_HEADER, KEY)),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    assert!(service.seen.lock().unwrap().is_empty());
}

#[tokio::test]
async fn domain_failure_preserves_session_identity_and_sanitized_reason() {
    let error = CodingAgentError::DispatchFailed {
        agent_session_id: Uuid::now_v7(),
        reason: crate::domain::routines::RoutineSessionError::PromptDeliveryUnknown,
    };
    let service = Arc::new(ServiceSpy {
        error: Some(error.clone()),
        ..Default::default()
    });
    let response = app(service)
        .oneshot(request(
            "dispatch",
            command("dispatch"),
            Some((INTERNAL_API_KEY_HEADER, KEY)),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::BAD_GATEWAY);
    assert_eq!(body(response).await, json!(error));
}

#[tokio::test]
async fn dispatch_timeout_does_not_invite_automatic_retry() {
    let response = bounded_response(true, Duration::ZERO, std::future::pending()).await;
    assert_eq!(response.status(), StatusCode::GATEWAY_TIMEOUT);
    assert_eq!(
        body(response).await,
        json!({"code":"dispatch_delivery_unknown"})
    );
}
