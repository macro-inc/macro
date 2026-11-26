use super::*;
use crate::domain::mcp::models::{
    McpDeliveryProfile, McpEndpointFailure, McpSubscriptionId, McpSubscriptionKey,
};
use axum::body::{Body, to_bytes};
use axum::http::Request;
use chrono::{TimeZone as _, Utc};
use macro_authorization::{
    INTERNAL_API_KEY_HEADER, INTERNAL_MACRO_USER_ID_HEADER, InternalIdentityClaims,
    MacroAuthorizationError,
};
use model_user::UserContext;
use rootcause::Report;
use serde_json::json;
use std::sync::{Arc, Mutex};
use tower::ServiceExt as _;

const INTERNAL_KEY: &str = "internal-key";
const USER: &str = "macro|subscriber@example.com";
const SECRET: &str = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";

#[derive(Clone, Default)]
struct FakeAuthorization;

impl MacroAuthorizationService for FakeAuthorization {
    async fn authorize(&self, _jwt: &str) -> Result<UserContext, Report<MacroAuthorizationError>> {
        Ok(UserContext {
            user_id: USER.to_owned(),
            ..UserContext::default()
        })
    }

    async fn authorize_identity(
        &self,
        jwt: &str,
    ) -> Result<macro_authorization::ValidatedCredential, Report<MacroAuthorizationError>> {
        self.authorize(jwt)
            .await
            .map(macro_authorization::ValidatedCredential::session)
    }

    async fn authorize_bot(
        &self,
        _bot_token: &str,
        _bot_scope: macro_authorization::BotScope,
        _acting_user: Option<macro_authorization::BotActingUserClaims>,
    ) -> Result<macro_authorization::BotAuthentication, Report<MacroAuthorizationError>> {
        Err(Report::new(MacroAuthorizationError::InvalidCredentials))
    }

    async fn authorize_internal(
        &self,
        provided_key: &str,
        claims: InternalIdentityClaims,
    ) -> Result<Option<UserContext>, Report<MacroAuthorizationError>> {
        if provided_key != INTERNAL_KEY {
            return Err(Report::new(MacroAuthorizationError::InvalidCredentials));
        }
        Ok(claims.user_id.map(|user_id| UserContext {
            user_id,
            fusion_user_id: claims.fusion_user_id.unwrap_or_default(),
            organization_id: claims.organization_id,
            permissions: None,
        }))
    }
}

#[derive(Debug)]
enum Call {
    Subscribe(String, McpSubscribeRequest),
    Unsubscribe(McpSubscriptionKey),
}

#[derive(Clone, Default)]
struct FakeService {
    calls: Arc<Mutex<Vec<Call>>>,
    error: Arc<Mutex<Option<McpSubscriptionError>>>,
}

impl FakeService {
    fn failing(error: McpSubscriptionError) -> Self {
        let service = Self::default();
        *service.error.lock().expect("lock") = Some(error);
        service
    }

    fn take_error(&self) -> Result<(), McpSubscriptionError> {
        self.error.lock().expect("lock").take().map_or(Ok(()), Err)
    }
}

impl McpEventSubscriptionService for FakeService {
    async fn subscribe(
        &self,
        user_id: MacroUserIdStr<'static>,
        request: McpSubscribeRequest,
    ) -> Result<McpSubscribeResult, McpSubscriptionError> {
        self.take_error()?;
        let filter = request.filter.clone();
        self.calls
            .lock()
            .expect("lock")
            .push(Call::Subscribe(user_id.as_ref().to_owned(), request));
        Ok(McpSubscribeResult {
            profile: McpDeliveryProfile::default(),
            id: McpSubscriptionId::from_stored("sub_1".to_owned()),
            refresh_before: Utc
                .with_ymd_and_hms(2026, 1, 1, 0, 0, 0)
                .single()
                .expect("valid"),
            filter,
        })
    }

    async fn unsubscribe(&self, key: McpSubscriptionKey) -> Result<(), McpSubscriptionError> {
        self.take_error()?;
        self.calls
            .lock()
            .expect("lock")
            .push(Call::Unsubscribe(key));
        Ok(())
    }
}

fn subscribe_body() -> serde_json::Value {
    json!({
        "eventType": "macro.events",
        "arguments": { "query": "mentions" },
        "endpointUrl": "https://hooks.example.com/a",
        "filter": { "anyOf": [{ "events": ["message.mentioned"] }] },
        "secret": SECRET,
        "secretCiphertext": { "ciphertext": "AAE=", "kmsKeyId": "key", "encryptionVersion": 1 },
        "ttl": { "kind": "millis", "value": 60000 }
    })
}

async fn send(
    service: FakeService,
    method: &str,
    uri: &str,
    headers: &[(&str, &str)],
    body: serde_json::Value,
) -> (StatusCode, serde_json::Value) {
    let router = mcp_subscription_router::<_, _, ()>(McpSubscriptionRouterState::new(
        service,
        MacroAuthorizationState::new(Arc::new(FakeAuthorization)),
    ));
    let mut request = Request::builder()
        .method(method)
        .uri(uri)
        .header("content-type", "application/json");
    for (name, value) in headers {
        request = request.header(*name, *value);
    }
    let response = router
        .oneshot(request.body(Body::from(body.to_string())).expect("request"))
        .await
        .expect("response");
    let status = response.status();
    let bytes = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("body");
    let json = serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null);
    (status, json)
}

const AS_USER: [(&str, &str); 2] = [
    (INTERNAL_API_KEY_HEADER, INTERNAL_KEY),
    (INTERNAL_MACRO_USER_ID_HEADER, USER),
];

#[tokio::test]
async fn subscribe_passes_the_acting_user_and_the_request() {
    let service = FakeService::default();
    let (status, body) = send(
        service.clone(),
        "PUT",
        MCP_EVENT_SUBSCRIPTIONS_PATH,
        &AS_USER,
        subscribe_body(),
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["id"], "sub_1");
    assert_eq!(body["filter"]["anyOf"][0]["events"][0], "message.mentioned");
    let calls = service.calls.lock().expect("lock");
    let [Call::Subscribe(user, request)] = calls.as_slice() else {
        panic!("one subscribe call, got {calls:?}");
    };
    assert_eq!(user, USER);
    assert_eq!(request.endpoint_url, "https://hooks.example.com/a");
    assert_eq!(request.secret.expose().as_str(), SECRET);
    assert_eq!(request.secret_ciphertext.ciphertext, vec![0, 1]);
}

#[tokio::test]
async fn unsubscribe_names_the_acting_users_key() {
    let service = FakeService::default();
    let (status, _) = send(
        service.clone(),
        "POST",
        MCP_EVENT_UNSUBSCRIBE_PATH,
        &AS_USER,
        json!({
            "eventType": "macro.events",
            "arguments": { "query": "mentions" },
            "endpointUrl": "https://hooks.example.com/a"
        }),
    )
    .await;

    assert_eq!(status, StatusCode::NO_CONTENT);
    let calls = service.calls.lock().expect("lock");
    let [Call::Unsubscribe(key)] = calls.as_slice() else {
        panic!("one unsubscribe call, got {calls:?}");
    };
    assert_eq!(key.user_id.as_ref(), USER);
    assert_eq!(key.arguments, json!({ "query": "mentions" }));
}

#[tokio::test]
async fn only_the_internal_key_with_an_acting_user_is_admitted() {
    let service = FakeService::default();
    let (user_token, _) = send(
        service.clone(),
        "PUT",
        MCP_EVENT_SUBSCRIPTIONS_PATH,
        &[("authorization", "Bearer valid")],
        subscribe_body(),
    )
    .await;
    assert_eq!(user_token, StatusCode::FORBIDDEN);

    let (wrong_key, _) = send(
        service.clone(),
        "PUT",
        MCP_EVENT_SUBSCRIPTIONS_PATH,
        &[
            (INTERNAL_API_KEY_HEADER, "nope"),
            (INTERNAL_MACRO_USER_ID_HEADER, USER),
        ],
        subscribe_body(),
    )
    .await;
    assert_eq!(wrong_key, StatusCode::UNAUTHORIZED);

    let (no_user, body) = send(
        service.clone(),
        "PUT",
        MCP_EVENT_SUBSCRIPTIONS_PATH,
        &[(INTERNAL_API_KEY_HEADER, INTERNAL_KEY)],
        subscribe_body(),
    )
    .await;
    assert_eq!(no_user, StatusCode::BAD_REQUEST);
    assert_eq!(body["code"], "invalid_params");
    assert!(service.calls.lock().expect("lock").is_empty());
}

#[tokio::test]
async fn a_malformed_secret_is_refused() {
    let mut body = subscribe_body();
    body["secret"] = json!("not-a-secret");
    let (status, _) = send(
        FakeService::default(),
        "PUT",
        MCP_EVENT_SUBSCRIPTIONS_PATH,
        &AS_USER,
        body,
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn errors_carry_their_code() {
    for (error, status, expected) in [
        (
            McpSubscriptionError::NotFound,
            StatusCode::NOT_FOUND,
            json!({ "code": "not_found" }),
        ),
        (
            McpSubscriptionError::ResourceExhausted { max: 50 },
            StatusCode::TOO_MANY_REQUESTS,
            json!({ "code": "resource_exhausted", "max": 50 }),
        ),
        (
            McpSubscriptionError::CallbackEndpoint(McpEndpointFailure::ChallengeFailed),
            StatusCode::BAD_GATEWAY,
            json!({ "code": "callback_endpoint_error", "reason": "challenge_failed" }),
        ),
    ] {
        let (actual_status, body) = send(
            FakeService::failing(error),
            "PUT",
            MCP_EVENT_SUBSCRIPTIONS_PATH,
            &AS_USER,
            subscribe_body(),
        )
        .await;
        assert_eq!(actual_status, status);
        assert_eq!(body, expected);
        assert!(serde_json::from_value::<McpSubscriptionErrorBody>(body).is_ok());
    }
}
