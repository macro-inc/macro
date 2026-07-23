use std::{
    borrow::Cow,
    sync::{Arc, Mutex},
};

use ::axum::{
    Json, Router,
    body::Body,
    extract::FromRef,
    http::{HeaderValue, Request, StatusCode},
    response::IntoResponse,
    routing::get,
};
use bot_id::BotId;
use http_body_util::BodyExt;
use rootcause::Report;
use serde_json::{Value, json};
use tower::ServiceExt;
use uuid::Uuid;

use super::*;
use crate::{
    BotActingUserClaims, BotAuthentication, BotScope, InternalIdentityClaims, MacroAuthorization,
    MacroAuthorizationError, MacroAuthorizationService, MacroUserAuthentication,
};

const VALID_USER_ID: &str = "macro|valid@example.com";
const COOKIE_USER_ID: &str = "macro|cookie@example.com";
const QUERY_USER_ID: &str = "macro|query@example.com";
const BEARER_USER_ID: &str = "macro|bearer@example.com";
const OPTIONAL_USER_ID: &str = "macro|optional@example.com";
const STANDARD_INTERNAL_USER_ID: &str = "macro|standard-internal@example.com";
const LEGACY_INTERNAL_USER_ID: &str = "macro|legacy-internal@example.com";
const BOT_ACTING_USER_ID: &str = "macro|bot-acting@example.com";
const VALID_INTERNAL_KEY: &str = "valid-internal-key";
const BOT_ID: BotId = BotId::new_from_uuid(Uuid::from_u128(1));
const BOT_TOKEN_ID: Uuid = Uuid::from_u128(2);
const BOT_TEAM_ID: Uuid = Uuid::from_u128(3);
const ACCESS_TOKEN_COOKIE: &str = "macro-access-token";

#[derive(Clone, Debug, Eq, PartialEq)]
enum AuthorizationCall {
    Jwt(String),
    Bot {
        token: String,
        bot_scope: BotScope,
        claims: Option<BotActingUserClaims>,
    },
    Internal {
        provided_key: String,
        claims: InternalIdentityClaims,
    },
}

#[derive(Clone, Default)]
struct FakeAuthorizationService {
    calls: Arc<Mutex<Vec<AuthorizationCall>>>,
}

impl FakeAuthorizationService {
    fn calls(&self) -> Vec<AuthorizationCall> {
        self.calls.lock().expect("calls lock poisoned").clone()
    }
}

impl MacroAuthorizationService for FakeAuthorizationService {
    async fn authorize(&self, jwt: &str) -> Result<UserContext, Report<MacroAuthorizationError>> {
        self.calls
            .lock()
            .expect("calls lock poisoned")
            .push(AuthorizationCall::Jwt(jwt.to_string()));

        match jwt {
            "valid" => Ok(user_context(VALID_USER_ID, None)),
            "cookie" => Ok(user_context(COOKIE_USER_ID, None)),
            "query" => Ok(user_context(QUERY_USER_ID, None)),
            "bearer" => Ok(user_context(BEARER_USER_ID, None)),
            "optional" => Ok(user_context(OPTIONAL_USER_ID, None)),
            "organization" => Ok(user_context(VALID_USER_ID, Some(42))),
            "malformed-user" => Ok(user_context("not-a-macro-user-id", None)),
            "empty-user" => Ok(user_context("", None)),
            "expired" => Err(Report::new(MacroAuthorizationError::CredentialsExpired)),
            _ => Err(Report::new(MacroAuthorizationError::InvalidCredentials)),
        }
    }

    async fn authorize_bot(
        &self,
        token: &str,
        bot_scope: BotScope,
        claims: Option<BotActingUserClaims>,
    ) -> Result<BotAuthentication, Report<MacroAuthorizationError>> {
        self.calls
            .lock()
            .expect("calls lock poisoned")
            .push(AuthorizationCall::Bot {
                token: token.to_owned(),
                bot_scope,
                claims: claims.clone(),
            });

        match token {
            "bot-bare" => Ok(bot_authentication(bot_scope, None)),
            "bot-acting" => Ok(bot_authentication(bot_scope, Some(BOT_ACTING_USER_ID))),
            "bot-expired" => Err(Report::new(MacroAuthorizationError::CredentialsExpired)),
            "bot-forbidden" => Err(Report::new(
                MacroAuthorizationError::ActingUserNotAuthorized,
            )),
            "bot-scope-forbidden" => {
                Err(Report::new(MacroAuthorizationError::BotScopeNotAuthorized))
            }
            "bot-unavailable" => Err(Report::new(MacroAuthorizationError::Unavailable)),
            _ => Err(Report::new(MacroAuthorizationError::InvalidCredentials)),
        }
    }

    async fn authorize_internal(
        &self,
        provided_key: &str,
        claims: InternalIdentityClaims,
    ) -> Result<Option<UserContext>, Report<MacroAuthorizationError>> {
        self.calls
            .lock()
            .expect("calls lock poisoned")
            .push(AuthorizationCall::Internal {
                provided_key: provided_key.to_string(),
                claims: claims.clone(),
            });

        if provided_key != VALID_INTERNAL_KEY {
            return Err(Report::new(MacroAuthorizationError::InvalidCredentials));
        }

        let Some(user_id) = claims.user_id else {
            return Ok(None);
        };

        Ok(Some(UserContext {
            user_id,
            fusion_user_id: claims.fusion_user_id.unwrap_or_default(),
            permissions: None,
            organization_id: claims.organization_id,
        }))
    }
}

fn user_context(user_id: &str, organization_id: Option<i32>) -> UserContext {
    UserContext {
        user_id: user_id.to_string(),
        fusion_user_id: "fusion-user-id".to_string(),
        permissions: None,
        organization_id,
    }
}

fn bot_authentication(bot_scope: BotScope, acting_user_id: Option<&str>) -> BotAuthentication {
    BotAuthentication {
        bot_id: BOT_ID,
        token_id: BOT_TOKEN_ID,
        bot_scope,
        team_id: (bot_scope == BotScope::Team).then_some(BOT_TEAM_ID),
        acting_user: acting_user_id.map(|user_id| MacroUserAuthentication {
            macro_user_id: MacroUserIdStr::try_from(user_id.to_owned())
                .expect("valid bot acting user id"),
            user_context: user_context(user_id, Some(42)),
        }),
    }
}

#[derive(Clone)]
struct TestState {
    authorization: MacroAuthorizationState<FakeAuthorizationService>,
    _unrelated_state: &'static str,
}

impl FromRef<TestState> for MacroAuthorizationState<FakeAuthorizationService> {
    fn from_ref(state: &TestState) -> Self {
        state.authorization.clone()
    }
}

async fn required_handler(
    extractor: MacroAuthorizationExtractor<FakeAuthorizationService, UserOrInternal>,
) -> Json<Value> {
    let extractor = extractor.clone();
    let acting_entity = extractor.acting_entity().to_string();
    let authorization = &extractor.authorization;
    let variant = match authorization.caller {
        UserOrInternalCaller::User => "user",
        UserOrInternalCaller::Internal => "internal",
    };

    Json(json!({
        "authorization": {
            "variant": variant,
            "macro_user_id": authorization.user.macro_user_id.to_string(),
            "user_context": authorization.user.user_context,
        },
        "acting_entity": acting_entity,
        "macro_user_id": authorization.user.macro_user_id.to_string(),
        "user_context": authorization.user.user_context,
        "is_internal_access": authorization.caller == UserOrInternalCaller::Internal,
    }))
}

async fn optional_handler(
    extractor: OptionalMacroAuthorizationExtractor<FakeAuthorizationService, UserOrInternalService>,
) -> Json<Value> {
    let extractor = extractor.clone();
    let acting_entity = extractor
        .acting_entity()
        .map(|acting_entity| acting_entity.to_string());
    let authorization = extractor
        .authorization
        .as_ref()
        .map(user_or_internal_service_json);
    let acting_user = extractor
        .authorization
        .as_ref()
        .and_then(UserOrInternalServiceAuthorization::acting_user);

    Json(json!({
        "authorization": authorization,
        "acting_entity": acting_entity,
        "macro_user_id": acting_user.map(|user| user.macro_user_id.to_string()),
        "user_context": acting_user.map(|user| user.user_context.clone()).unwrap_or_default(),
        "is_internal_access": extractor
            .authorization
            .as_ref()
            .is_some_and(UserOrInternalServiceAuthorization::is_internal),
    }))
}

fn user_or_internal_service_json(authorization: &UserOrInternalServiceAuthorization) -> Value {
    let variant = if authorization.is_internal() {
        "internal"
    } else {
        "user"
    };
    let acting_user = authorization.acting_user();

    json!({
        "variant": variant,
        "macro_user_id": acting_user.map(|user| user.macro_user_id.to_string()),
        "user_context": acting_user.map(|user| &user.user_context),
    })
}

async fn user_handler(
    extractor: MacroAuthorizationExtractor<FakeAuthorizationService, UserOnly>,
) -> Json<Value> {
    let extractor = extractor.clone();
    let acting_entity = extractor.acting_entity().to_string();

    Json(json!({
        "acting_entity": acting_entity,
        "macro_user_id": extractor.authorization.macro_user_id.to_string(),
        "user_context": extractor.authorization.user_context,
    }))
}

async fn internal_handler(
    extractor: MacroAuthorizationExtractor<FakeAuthorizationService, InternalOnly>,
) -> Json<Value> {
    let extractor = extractor.clone();
    Json(json!({
        "acting_entity": extractor.acting_entity().to_string(),
        "authorized": true,
    }))
}

async fn bot_handler(
    extractor: MacroAuthorizationExtractor<FakeAuthorizationService, BotOnly>,
) -> Json<Value> {
    let extractor = extractor.clone();
    let acting_entity = extractor.acting_entity().to_string();
    Json(bot_json(&extractor.authorization, &acting_entity))
}

async fn optional_bot_handler(
    extractor: OptionalMacroAuthorizationExtractor<FakeAuthorizationService, BotOnly>,
) -> Json<Value> {
    Json(
        extractor
            .authorization
            .map(|bot| bot_json(&bot, &bot.bot_id.to_string()))
            .unwrap_or(Value::Null),
    )
}

async fn policy_handler<Policy>(
    extractor: MacroAuthorizationExtractor<FakeAuthorizationService, Policy>,
) -> Json<Value>
where
    Policy: AuthorizationPolicy,
{
    Json(json!({ "acting_entity": extractor.acting_entity().to_string() }))
}

async fn optional_policy_handler<Policy>(
    extractor: OptionalMacroAuthorizationExtractor<FakeAuthorizationService, Policy>,
) -> Json<Value>
where
    Policy: AuthorizationPolicy,
{
    Json(json!({
        "acting_entity": extractor
            .acting_entity()
            .map(|acting_entity| acting_entity.to_string()),
    }))
}

fn bot_json(bot: &BotAuthentication, acting_entity: &str) -> Value {
    json!({
        "acting_entity": acting_entity,
        "bot_id": bot.bot_id.to_string(),
        "token_id": bot.token_id.to_string(),
        "bot_scope": bot.bot_scope.as_str(),
        "team_id": bot.team_id.map(|team_id| team_id.to_string()),
        "acting_user_id": bot
            .acting_user
            .as_ref()
            .map(|user| user.macro_user_id.to_string()),
    })
}

fn test_router() -> (Router, FakeAuthorizationService) {
    let service = FakeAuthorizationService::default();
    let state = TestState {
        authorization: MacroAuthorizationState::new(Arc::new(service.clone())),
        _unrelated_state: "composite state",
    };
    let router = Router::new()
        .route("/required", get(required_handler))
        .route("/optional", get(optional_handler))
        .route("/user", get(user_handler))
        .route("/internal", get(internal_handler))
        .route("/bot", get(bot_handler))
        .route("/optional-bot", get(optional_bot_handler))
        .route(
            "/required/user-or-internal",
            get(policy_handler::<UserOrInternal>),
        )
        .route(
            "/required/user-or-internal-service",
            get(policy_handler::<UserOrInternalService>),
        )
        .route("/required/acting-user", get(policy_handler::<ActingUser>))
        .route("/required/user-only", get(policy_handler::<UserOnly>))
        .route("/required/bot-only", get(policy_handler::<BotOnly>))
        .route(
            "/required/internal-only",
            get(policy_handler::<InternalOnly>),
        )
        .route(
            "/required/any-principal",
            get(policy_handler::<AnyPrincipal>),
        )
        .route(
            "/optional/user-or-internal",
            get(optional_policy_handler::<UserOrInternal>),
        )
        .route(
            "/optional/user-or-internal-service",
            get(optional_policy_handler::<UserOrInternalService>),
        )
        .route(
            "/optional/acting-user",
            get(optional_policy_handler::<ActingUser>),
        )
        .route(
            "/optional/user-only",
            get(optional_policy_handler::<UserOnly>),
        )
        .route(
            "/optional/bot-only",
            get(optional_policy_handler::<BotOnly>),
        )
        .route(
            "/optional/internal-only",
            get(optional_policy_handler::<InternalOnly>),
        )
        .route(
            "/optional/any-principal",
            get(optional_policy_handler::<AnyPrincipal>),
        )
        .with_state(state);

    (router, service)
}

async fn send(router: &Router, request: Request<Body>) -> (StatusCode, Value) {
    let response = router.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let body = serde_json::from_slice(&body).expect("response should contain JSON");

    (status, body)
}

fn request(path: &str) -> ::axum::http::request::Builder {
    Request::get(path)
}

fn bot_request(path: &str, token: &str) -> ::axum::http::request::Builder {
    request(path)
        .header(BOT_TOKEN_HEADER, token)
        .header(BOT_SCOPE_HEADER, BotScope::User.as_str())
}

fn empty_body(request: ::axum::http::request::Builder) -> Request<Body> {
    request.body(Body::empty()).unwrap()
}

fn assert_clone_without_service_clone<T: Clone>() {}

fn assert_display_and_error<T: std::fmt::Display + std::error::Error>() {}

#[test]
fn rejection_is_displayable_error_with_client_safe_message() {
    assert_display_and_error::<MacroAuthorizationRejection>();

    let rejection = MacroAuthorizationRejection {
        status: StatusCode::INTERNAL_SERVER_ERROR,
        message: Cow::Borrowed("client-safe message"),
    };

    assert_eq!(rejection.to_string(), "client-safe message");
}

#[tokio::test]
async fn rejection_response_preserves_status_and_cow_message() {
    let cases = [
        MacroAuthorizationRejection {
            status: StatusCode::IM_A_TEAPOT,
            message: Cow::Borrowed("borrowed message"),
        },
        MacroAuthorizationRejection {
            status: StatusCode::FORBIDDEN,
            message: Cow::Owned("owned message".to_string()),
        },
    ];

    for rejection in cases {
        let expected_status = rejection.status;
        let expected_body = format!(r#"{{"message":"{}"}}"#, rejection.message);
        let response = rejection.into_response();
        let status = response.status();
        let body = response
            .into_body()
            .collect()
            .await
            .expect("rejection response body should be readable")
            .to_bytes();

        assert_eq!(status, expected_status);
        assert_eq!(body.as_ref(), expected_body.as_bytes());
    }
}

#[test]
fn state_and_extractors_are_clone_without_requiring_service_clone() {
    struct NotClone;

    assert_clone_without_service_clone::<MacroAuthorizationState<NotClone>>();
    assert_clone_without_service_clone::<MacroAuthorizationExtractor<NotClone, AnyPrincipal>>();
    assert_clone_without_service_clone::<OptionalMacroAuthorizationExtractor<NotClone, AnyPrincipal>>(
    );
}

#[tokio::test]
async fn extractors_report_the_authenticating_entity() {
    let (router, _service) = test_router();
    let requests = [
        (
            empty_body(request("/required").header("authorization", "Bearer valid")),
            Some(VALID_USER_ID.to_string()),
        ),
        (
            empty_body(bot_request("/required/acting-user", "bot-acting")),
            Some(BOT_ID.to_string()),
        ),
        (
            empty_body(
                request("/required")
                    .header(INTERNAL_API_KEY_HEADER, VALID_INTERNAL_KEY)
                    .header(INTERNAL_MACRO_USER_ID_HEADER, STANDARD_INTERNAL_USER_ID),
            ),
            Some("internal".to_string()),
        ),
        (
            empty_body(request("/optional").header("authorization", "Bearer optional")),
            Some(OPTIONAL_USER_ID.to_string()),
        ),
        (
            empty_body(bot_request("/optional/any-principal", "bot-bare")),
            Some(BOT_ID.to_string()),
        ),
        (
            empty_body(request("/optional").header(INTERNAL_API_KEY_HEADER, VALID_INTERNAL_KEY)),
            Some("internal".to_string()),
        ),
        (empty_body(request("/optional")), None),
        (
            empty_body(request("/user").header("authorization", "Bearer valid")),
            Some(VALID_USER_ID.to_string()),
        ),
        (
            empty_body(bot_request("/bot", "bot-bare")),
            Some(BOT_ID.to_string()),
        ),
        (
            empty_body(request("/internal").header(INTERNAL_API_KEY_HEADER, VALID_INTERNAL_KEY)),
            Some("internal".to_string()),
        ),
    ];

    for (request, expected) in requests {
        let (status, body) = send(&router, request).await;

        assert_eq!(status, StatusCode::OK);
        assert_eq!(
            body["acting_entity"],
            expected.map(Value::String).unwrap_or(Value::Null)
        );
    }
}

#[allow(deprecated)]
#[tokio::test]
async fn internal_accepts_standard_and_legacy_api_keys_without_identity_headers() {
    let (router, service) = test_router();

    for header in [INTERNAL_API_KEY_HEADER, LEGACY_DSS_INTERNAL_API_KEY_HEADER] {
        let request = empty_body(request("/internal").header(header, VALID_INTERNAL_KEY));
        let (status, body) = send(&router, request).await;

        assert_eq!(status, StatusCode::OK);
        assert_eq!(
            body,
            json!({ "acting_entity": "internal", "authorized": true })
        );
    }

    assert_eq!(
        service.calls(),
        [
            AuthorizationCall::Internal {
                provided_key: VALID_INTERNAL_KEY.to_string(),
                claims: InternalIdentityClaims::default(),
            },
            AuthorizationCall::Internal {
                provided_key: VALID_INTERNAL_KEY.to_string(),
                claims: InternalIdentityClaims::default(),
            },
        ]
    );
}

#[tokio::test]
async fn internal_forwards_identity_headers_to_create_user_context() {
    let (router, service) = test_router();
    let request = empty_body(
        request("/internal")
            .header(INTERNAL_API_KEY_HEADER, VALID_INTERNAL_KEY)
            .header(INTERNAL_MACRO_USER_ID_HEADER, STANDARD_INTERNAL_USER_ID)
            .header(INTERNAL_MACRO_ORGANIZATION_ID_HEADER, "42")
            .header(INTERNAL_FUSIONAUTH_USER_ID_HEADER, "fusion-user"),
    );

    let (status, body) = send(&router, request).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        body,
        json!({ "acting_entity": "internal", "authorized": true })
    );
    assert_eq!(
        service.calls(),
        [AuthorizationCall::Internal {
            provided_key: VALID_INTERNAL_KEY.to_string(),
            claims: InternalIdentityClaims {
                user_id: Some(STANDARD_INTERNAL_USER_ID.to_string()),
                fusion_user_id: Some("fusion-user".to_string()),
                organization_id: Some(42),
            },
        }]
    );
}

#[tokio::test]
async fn internal_only_requires_credentials_and_forbids_valid_user_credentials() {
    let (router, service) = test_router();

    let (status, body) = send(&router, empty_body(request("/internal"))).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(body, json!({ "message": "unauthorized" }));

    let user_request = empty_body(request("/internal").header("authorization", "Bearer valid"));
    let (status, body) = send(&router, user_request).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(body, json!({ "message": "forbidden" }));

    assert_eq!(
        service.calls(),
        [AuthorizationCall::Jwt("valid".to_string())]
    );
}

#[tokio::test]
async fn internal_rejects_invalid_api_key() {
    let (router, service) = test_router();
    let request = empty_body(request("/internal").header(INTERNAL_API_KEY_HEADER, "invalid"));

    let (status, body) = send(&router, request).await;

    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(body, json!({ "message": "unauthorized" }));
    assert_eq!(
        service.calls(),
        [AuthorizationCall::Internal {
            provided_key: "invalid".to_string(),
            claims: InternalIdentityClaims::default(),
        }]
    );
}

#[allow(deprecated)]
#[tokio::test]
async fn internal_standard_key_takes_precedence_over_legacy_key() {
    let (router, service) = test_router();
    let request = empty_body(
        request("/internal")
            .header(INTERNAL_API_KEY_HEADER, "invalid-standard-key")
            .header(LEGACY_DSS_INTERNAL_API_KEY_HEADER, VALID_INTERNAL_KEY),
    );

    let (status, body) = send(&router, request).await;

    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(body, json!({ "message": "unauthorized" }));
    assert_eq!(
        service.calls(),
        [AuthorizationCall::Internal {
            provided_key: "invalid-standard-key".to_string(),
            claims: InternalIdentityClaims::default(),
        }]
    );
}

#[tokio::test]
async fn user_accepts_query_bearer_and_cookie_credentials() {
    let (router, service) = test_router();
    let requests = [
        (
            empty_body(request("/user?macro-api-token=query")),
            QUERY_USER_ID,
        ),
        (
            empty_body(request("/user").header("authorization", "Bearer bearer")),
            BEARER_USER_ID,
        ),
        (
            empty_body(request("/user").header("cookie", format!("{ACCESS_TOKEN_COOKIE}=cookie"))),
            COOKIE_USER_ID,
        ),
    ];

    for (request, expected_user_id) in requests {
        let (status, body) = send(&router, request).await;

        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["macro_user_id"], expected_user_id);
        assert_eq!(body["user_context"]["user_id"], expected_user_id);
    }

    assert_eq!(
        service.calls(),
        [
            AuthorizationCall::Jwt("query".to_string()),
            AuthorizationCall::Jwt("bearer".to_string()),
            AuthorizationCall::Jwt("cookie".to_string()),
        ]
    );
}

#[tokio::test]
async fn user_rejects_missing_and_invalid_user_credentials() {
    let (router, service) = test_router();

    let (status, body) = send(&router, empty_body(request("/user"))).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(body, json!({ "message": "unauthorized" }));

    let (status, body) = send(
        &router,
        empty_body(request("/user").header("authorization", "Bearer expired")),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(body, json!({ "message": "jwt expired" }));

    assert_eq!(
        service.calls(),
        [AuthorizationCall::Jwt("expired".to_string())]
    );
}

#[tokio::test]
async fn required_extracts_valid_bearer_and_preserves_organization() {
    let (router, service) = test_router();
    let request = empty_body(request("/required").header("authorization", "Bearer organization"));

    let (status, body) = send(&router, request).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["authorization"]["variant"], "user");
    assert_eq!(
        body["authorization"]["macro_user_id"],
        body["macro_user_id"]
    );
    assert_eq!(body["authorization"]["user_context"], body["user_context"]);
    assert_eq!(body["macro_user_id"], VALID_USER_ID);
    assert_eq!(body["user_context"]["organization_id"], 42);
    assert_eq!(body["is_internal_access"], false);
    assert_eq!(
        service.calls(),
        [AuthorizationCall::Jwt("organization".to_string())]
    );
}

#[tokio::test]
async fn required_extracts_valid_cookie() {
    let (router, service) = test_router();
    let request =
        empty_body(request("/required").header("cookie", format!("{ACCESS_TOKEN_COOKIE}=cookie")));

    let (status, body) = send(&router, request).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["macro_user_id"], COOKIE_USER_ID);
    assert_eq!(body["is_internal_access"], false);
    assert_eq!(
        service.calls(),
        [AuthorizationCall::Jwt("cookie".to_string())]
    );
}

#[tokio::test]
async fn query_token_takes_precedence_over_bearer_and_cookie() {
    let (router, service) = test_router();
    let request = empty_body(
        request("/required?macro-api-token=query")
            .header("authorization", "Bearer invalid")
            .header("cookie", format!("{ACCESS_TOKEN_COOKIE}=invalid")),
    );

    let (status, body) = send(&router, request).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["macro_user_id"], QUERY_USER_ID);
    assert_eq!(
        service.calls(),
        [AuthorizationCall::Jwt("query".to_string())]
    );
}

#[tokio::test]
async fn bearer_token_takes_precedence_over_cookie() {
    let (router, service) = test_router();
    let request = empty_body(
        request("/required")
            .header("authorization", "Bearer bearer")
            .header("cookie", format!("{ACCESS_TOKEN_COOKIE}=invalid")),
    );

    let (status, body) = send(&router, request).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["macro_user_id"], BEARER_USER_ID);
    assert_eq!(
        service.calls(),
        [AuthorizationCall::Jwt("bearer".to_string())]
    );
}

#[tokio::test]
async fn malformed_query_remains_an_explicit_user_credential() {
    let (router, service) = test_router();
    let malformed_query = "macro-api-token=query&macro-api-token=invalid";

    let bearer_request = empty_body(
        request(&format!("/required?{malformed_query}")).header("authorization", "Bearer bearer"),
    );
    let (status, body) = send(&router, bearer_request).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["macro_user_id"], BEARER_USER_ID);

    let cookie_request = empty_body(
        request(&format!("/required?{malformed_query}"))
            .header("cookie", format!("{ACCESS_TOKEN_COOKIE}=cookie")),
    );
    let (status, body) = send(&router, cookie_request).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(body, json!({ "message": "unauthorized" }));

    let (status, body) = send(
        &router,
        empty_body(request(&format!("/optional?{malformed_query}"))),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(body, json!({ "message": "unauthorized" }));
    assert_eq!(
        service.calls(),
        [AuthorizationCall::Jwt("bearer".to_string())]
    );
}

#[tokio::test]
async fn required_rejects_missing_credentials() {
    let (router, service) = test_router();

    let (status, body) = send(&router, empty_body(request("/required"))).await;

    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(body, json!({ "message": "unauthorized" }));
    assert!(service.calls().is_empty());
}

#[tokio::test]
async fn optional_returns_default_context_for_missing_credentials() {
    let (router, service) = test_router();

    let (status, body) = send(&router, empty_body(request("/optional"))).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["authorization"], Value::Null);
    assert_eq!(body["macro_user_id"], Value::Null);
    assert_eq!(body["user_context"]["user_id"], "");
    assert_eq!(body["user_context"]["fusion_user_id"], "");
    assert_eq!(body["user_context"]["organization_id"], Value::Null);
    assert_eq!(body["user_context"]["permissions"], Value::Null);
    assert_eq!(body["is_internal_access"], false);
    assert!(service.calls().is_empty());
}

#[tokio::test]
async fn required_rejects_invalid_credentials() {
    let (router, service) = test_router();
    let request = empty_body(request("/required").header("authorization", "Bearer invalid"));

    let (status, body) = send(&router, request).await;

    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(body, json!({ "message": "unauthorized" }));
    assert_eq!(
        service.calls(),
        [AuthorizationCall::Jwt("invalid".to_string())]
    );
}

#[tokio::test]
async fn optional_rejects_supplied_invalid_credentials() {
    let (router, service) = test_router();
    let request = empty_body(request("/optional").header("authorization", "Bearer invalid"));

    let (status, body) = send(&router, request).await;

    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(body, json!({ "message": "unauthorized" }));
    assert_eq!(
        service.calls(),
        [AuthorizationCall::Jwt("invalid".to_string())]
    );
}

#[tokio::test]
async fn required_and_optional_reject_expired_credentials() {
    let (router, service) = test_router();

    for path in ["/required", "/optional"] {
        let request = empty_body(request(path).header("authorization", "Bearer expired"));
        let (status, body) = send(&router, request).await;

        assert_eq!(status, StatusCode::UNAUTHORIZED);
        assert_eq!(body, json!({ "message": "jwt expired" }));
    }

    assert_eq!(
        service.calls(),
        [
            AuthorizationCall::Jwt("expired".to_string()),
            AuthorizationCall::Jwt("expired".to_string()),
        ]
    );
}

#[tokio::test]
async fn required_rejects_malformed_user_id() {
    let (router, service) = test_router();
    let request = empty_body(request("/required").header("authorization", "Bearer malformed-user"));

    let (status, body) = send(&router, request).await;

    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(body, json!({ "message": "invalid user id" }));
    assert_eq!(
        service.calls(),
        [AuthorizationCall::Jwt("malformed-user".to_string())]
    );
}

#[tokio::test]
async fn optional_rejects_empty_user_id_from_authorized_context() {
    let (router, service) = test_router();
    let request = empty_body(request("/optional").header("authorization", "Bearer empty-user"));

    let (status, body) = send(&router, request).await;

    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(body, json!({ "message": "invalid user id" }));
    assert_eq!(
        service.calls(),
        [AuthorizationCall::Jwt("empty-user".to_string())]
    );
}

#[tokio::test]
async fn optional_returns_authenticated_output() {
    let (router, service) = test_router();
    let request = empty_body(request("/optional").header("authorization", "Bearer optional"));

    let (status, body) = send(&router, request).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["authorization"]["variant"], "user");
    assert_eq!(
        body["authorization"]["macro_user_id"],
        body["macro_user_id"]
    );
    assert_eq!(body["authorization"]["user_context"], body["user_context"]);
    assert_eq!(body["macro_user_id"], OPTIONAL_USER_ID);
    assert_eq!(body["user_context"]["user_id"], OPTIONAL_USER_ID);
    assert_eq!(body["user_context"]["fusion_user_id"], "fusion-user-id");
    assert_eq!(body["is_internal_access"], false);
    assert_eq!(
        service.calls(),
        [AuthorizationCall::Jwt("optional".to_string())]
    );
}

#[tokio::test]
async fn standard_internal_headers_authorize_matching_claims() {
    let (router, service) = test_router();
    let request = empty_body(
        request("/required")
            .header(INTERNAL_API_KEY_HEADER, VALID_INTERNAL_KEY)
            .header(INTERNAL_MACRO_USER_ID_HEADER, STANDARD_INTERNAL_USER_ID)
            .header(INTERNAL_MACRO_ORGANIZATION_ID_HEADER, "42")
            .header(INTERNAL_FUSIONAUTH_USER_ID_HEADER, "standard-fusion-id"),
    );

    let (status, body) = send(&router, request).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["authorization"]["variant"], "internal");
    assert_eq!(
        body["authorization"]["macro_user_id"],
        body["macro_user_id"]
    );
    assert_eq!(body["authorization"]["user_context"], body["user_context"]);
    assert_eq!(body["macro_user_id"], STANDARD_INTERNAL_USER_ID);
    assert_eq!(body["user_context"]["fusion_user_id"], "standard-fusion-id");
    assert_eq!(body["user_context"]["organization_id"], 42);
    assert_eq!(body["is_internal_access"], true);
    assert_eq!(
        service.calls(),
        [AuthorizationCall::Internal {
            provided_key: VALID_INTERNAL_KEY.to_string(),
            claims: InternalIdentityClaims {
                user_id: Some(STANDARD_INTERNAL_USER_ID.to_string()),
                fusion_user_id: Some("standard-fusion-id".to_string()),
                organization_id: Some(42),
            },
        }]
    );
}

#[allow(deprecated)]
#[tokio::test]
async fn legacy_dss_headers_authorize_matching_claims() {
    let (router, service) = test_router();
    let request = empty_body(
        request("/required")
            .header(LEGACY_DSS_INTERNAL_API_KEY_HEADER, VALID_INTERNAL_KEY)
            .header(
                LEGACY_DSS_INTERNAL_MACRO_USER_ID_HEADER,
                LEGACY_INTERNAL_USER_ID,
            ),
    );

    let (status, body) = send(&router, request).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["macro_user_id"], LEGACY_INTERNAL_USER_ID);
    assert_eq!(body["user_context"]["fusion_user_id"], "");
    assert_eq!(body["user_context"]["organization_id"], Value::Null);
    assert_eq!(body["is_internal_access"], true);
    assert_eq!(
        service.calls(),
        [AuthorizationCall::Internal {
            provided_key: VALID_INTERNAL_KEY.to_string(),
            claims: InternalIdentityClaims {
                user_id: Some(LEGACY_INTERNAL_USER_ID.to_string()),
                ..InternalIdentityClaims::default()
            },
        }]
    );
}

#[allow(deprecated)]
#[tokio::test]
async fn internal_identity_headers_are_not_mixed_between_conventions() {
    let (router, service) = test_router();

    let standard_request = empty_body(
        request("/optional")
            .header(INTERNAL_API_KEY_HEADER, VALID_INTERNAL_KEY)
            .header(
                LEGACY_DSS_INTERNAL_MACRO_USER_ID_HEADER,
                LEGACY_INTERNAL_USER_ID,
            ),
    );
    let (status, body) = send(&router, standard_request).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["macro_user_id"], Value::Null);
    assert_eq!(body["is_internal_access"], true);

    let legacy_request = empty_body(
        request("/optional")
            .header(LEGACY_DSS_INTERNAL_API_KEY_HEADER, VALID_INTERNAL_KEY)
            .header(INTERNAL_MACRO_USER_ID_HEADER, STANDARD_INTERNAL_USER_ID)
            .header(INTERNAL_MACRO_ORGANIZATION_ID_HEADER, "42")
            .header(INTERNAL_FUSIONAUTH_USER_ID_HEADER, "standard-fusion-id"),
    );
    let (status, body) = send(&router, legacy_request).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["macro_user_id"], Value::Null);
    assert_eq!(body["is_internal_access"], true);

    assert_eq!(
        service.calls(),
        [
            AuthorizationCall::Internal {
                provided_key: VALID_INTERNAL_KEY.to_string(),
                claims: InternalIdentityClaims::default(),
            },
            AuthorizationCall::Internal {
                provided_key: VALID_INTERNAL_KEY.to_string(),
                claims: InternalIdentityClaims::default(),
            },
        ]
    );
}

#[allow(deprecated)]
#[tokio::test]
async fn standard_convention_takes_precedence_when_both_keys_are_present() {
    let (router, service) = test_router();
    let request = empty_body(
        request("/required")
            .header(INTERNAL_API_KEY_HEADER, VALID_INTERNAL_KEY)
            .header(LEGACY_DSS_INTERNAL_API_KEY_HEADER, "invalid-legacy-key")
            .header(INTERNAL_MACRO_USER_ID_HEADER, STANDARD_INTERNAL_USER_ID)
            .header(
                LEGACY_DSS_INTERNAL_MACRO_USER_ID_HEADER,
                LEGACY_INTERNAL_USER_ID,
            ),
    );

    let (status, body) = send(&router, request).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["macro_user_id"], STANDARD_INTERNAL_USER_ID);
    assert_eq!(
        service.calls(),
        [AuthorizationCall::Internal {
            provided_key: VALID_INTERNAL_KEY.to_string(),
            claims: InternalIdentityClaims {
                user_id: Some(STANDARD_INTERNAL_USER_ID.to_string()),
                ..InternalIdentityClaims::default()
            },
        }]
    );
}

#[tokio::test]
async fn invalid_internal_key_rejects_without_cookie_fallback() {
    let (router, service) = test_router();
    let request = empty_body(
        request("/required")
            .header(INTERNAL_API_KEY_HEADER, "invalid-internal-key")
            .header("cookie", format!("{ACCESS_TOKEN_COOKIE}=cookie")),
    );

    let (status, body) = send(&router, request).await;

    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(body, json!({ "message": "unauthorized" }));
    assert_eq!(
        service.calls(),
        [AuthorizationCall::Internal {
            provided_key: "invalid-internal-key".to_string(),
            claims: InternalIdentityClaims::default(),
        }]
    );
}

#[tokio::test]
async fn malformed_internal_key_rejects_without_cookie_fallback() {
    let (router, service) = test_router();
    let malformed_key = HeaderValue::from_bytes(b"\xff").unwrap();
    let request = empty_body(
        request("/required")
            .header(INTERNAL_API_KEY_HEADER, malformed_key)
            .header("cookie", format!("{ACCESS_TOKEN_COOKIE}=cookie")),
    );

    let (status, body) = send(&router, request).await;

    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(body, json!({ "message": "unauthorized" }));
    assert!(service.calls().is_empty());
}

#[tokio::test]
async fn identityless_internal_request_is_rejected_by_required_extractor() {
    let (router, service) = test_router();
    let request =
        empty_body(request("/required").header(INTERNAL_API_KEY_HEADER, VALID_INTERNAL_KEY));

    let (status, body) = send(&router, request).await;

    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(body, json!({ "message": "unauthorized" }));
    assert_eq!(
        service.calls(),
        [AuthorizationCall::Internal {
            provided_key: VALID_INTERNAL_KEY.to_string(),
            claims: InternalIdentityClaims::default(),
        }]
    );
}

#[tokio::test]
async fn identityless_internal_request_is_preserved_by_optional_extractor() {
    let (router, service) = test_router();
    let request =
        empty_body(request("/optional").header(INTERNAL_API_KEY_HEADER, VALID_INTERNAL_KEY));

    let (status, body) = send(&router, request).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["authorization"]["variant"], "internal");
    assert_eq!(body["authorization"]["macro_user_id"], Value::Null);
    assert_eq!(body["authorization"]["user_context"], Value::Null);
    assert_eq!(body["macro_user_id"], Value::Null);
    assert_eq!(body["user_context"]["user_id"], "");
    assert_eq!(body["user_context"]["fusion_user_id"], "");
    assert_eq!(body["user_context"]["organization_id"], Value::Null);
    assert_eq!(body["user_context"]["permissions"], Value::Null);
    assert_eq!(body["is_internal_access"], true);
    assert_eq!(
        service.calls(),
        [AuthorizationCall::Internal {
            provided_key: VALID_INTERNAL_KEY.to_string(),
            claims: InternalIdentityClaims::default(),
        }]
    );
}

#[tokio::test]
async fn malformed_internal_organization_is_ignored() {
    let (router, service) = test_router();
    let request = empty_body(
        request("/required")
            .header(INTERNAL_API_KEY_HEADER, VALID_INTERNAL_KEY)
            .header(INTERNAL_MACRO_USER_ID_HEADER, STANDARD_INTERNAL_USER_ID)
            .header(INTERNAL_MACRO_ORGANIZATION_ID_HEADER, "not-an-integer"),
    );

    let (status, body) = send(&router, request).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["macro_user_id"], STANDARD_INTERNAL_USER_ID);
    assert_eq!(body["user_context"]["organization_id"], Value::Null);
    assert_eq!(body["is_internal_access"], true);
    assert_eq!(
        service.calls(),
        [AuthorizationCall::Internal {
            provided_key: VALID_INTERNAL_KEY.to_string(),
            claims: InternalIdentityClaims {
                user_id: Some(STANDARD_INTERNAL_USER_ID.to_string()),
                ..InternalIdentityClaims::default()
            },
        }]
    );
}

#[test]
fn bot_header_constants_use_the_resolved_names() {
    assert_eq!(BOT_TOKEN_HEADER, "x-macro-bot-token");
    assert_eq!(BOT_SCOPE_HEADER, "x-macro-bot-scope");
    assert_eq!(
        BOT_FOR_MACRO_USER_ID_HEADER,
        "x-macro-bot-for-macro-user-id"
    );
    assert_eq!(
        BOT_FOR_FUSIONAUTH_USER_ID_HEADER,
        "x-macro-bot-for-fusionauth-user-id"
    );
    assert_eq!(
        BOT_FOR_ORGANIZATION_ID_HEADER,
        "x-macro-bot-for-organization-id"
    );
}

#[tokio::test]
async fn acting_user_and_any_principal_accept_bot_with_verified_acting_user() {
    let (router, service) = test_router();

    for path in ["/required/acting-user", "/optional/any-principal"] {
        let request = empty_body(
            bot_request(path, "bot-acting")
                .header(BOT_FOR_MACRO_USER_ID_HEADER, BOT_ACTING_USER_ID)
                .header(BOT_FOR_FUSIONAUTH_USER_ID_HEADER, "fusion-claimed")
                .header(BOT_FOR_ORGANIZATION_ID_HEADER, "42"),
        );
        let (status, body) = send(&router, request).await;

        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["acting_entity"], BOT_ID.to_string());
    }

    let claims = Some(BotActingUserClaims {
        user_id: Some(BOT_ACTING_USER_ID.to_owned()),
        fusion_user_id: Some("fusion-claimed".to_owned()),
        organization_id: Some(42),
    });
    assert_eq!(
        service.calls(),
        [
            AuthorizationCall::Bot {
                token: "bot-acting".to_owned(),
                bot_scope: BotScope::User,
                claims: claims.clone(),
            },
            AuthorizationCall::Bot {
                token: "bot-acting".to_owned(),
                bot_scope: BotScope::User,
                claims,
            },
        ]
    );
}

#[tokio::test]
async fn bare_bot_is_forbidden_by_no_bot_policies_and_accepted_by_bot_only() {
    let (router, service) = test_router();

    let (status, body) = send(&router, empty_body(bot_request("/required", "bot-bare"))).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(body, json!({ "message": "forbidden" }));

    let (status, body) = send(&router, empty_body(bot_request("/optional", "bot-bare"))).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(body, json!({ "message": "forbidden" }));

    for path in ["/bot", "/optional-bot"] {
        let (status, body) = send(&router, empty_body(bot_request(path, "bot-bare"))).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["bot_id"], BOT_ID.to_string());
        assert_eq!(body["token_id"], BOT_TOKEN_ID.to_string());
        assert_eq!(body["bot_scope"], BotScope::User.as_str());
        assert_eq!(body["team_id"], Value::Null);
        assert_eq!(body["acting_user_id"], Value::Null);
    }

    assert_eq!(
        service.calls(),
        vec![
            AuthorizationCall::Bot {
                token: "bot-bare".to_owned(),
                bot_scope: BotScope::User,
                claims: None,
            };
            4
        ]
    );
}

#[tokio::test]
async fn bot_scope_is_required_and_must_be_user_or_team() {
    let (router, service) = test_router();

    for request in [
        request("/bot").header(BOT_TOKEN_HEADER, "bot-bare"),
        request("/bot")
            .header(BOT_TOKEN_HEADER, "bot-bare")
            .header(BOT_SCOPE_HEADER, ""),
        request("/bot")
            .header(BOT_TOKEN_HEADER, "bot-bare")
            .header(BOT_SCOPE_HEADER, "organization"),
    ] {
        let (status, body) = send(&router, empty_body(request)).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(body, json!({ "message": "invalid bot scope" }));
    }

    let malformed_scope = HeaderValue::from_bytes(b"\xff").unwrap();
    let request = empty_body(
        request("/bot")
            .header(BOT_TOKEN_HEADER, "bot-bare")
            .header(BOT_SCOPE_HEADER, malformed_scope),
    );
    let (status, body) = send(&router, request).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body, json!({ "message": "invalid bot scope" }));
    assert!(service.calls().is_empty());
}

#[tokio::test]
async fn team_bot_scope_is_forwarded_and_returned() {
    let (router, service) = test_router();
    let request = empty_body(
        request("/bot")
            .header(BOT_TOKEN_HEADER, "bot-bare")
            .header(BOT_SCOPE_HEADER, BotScope::Team.as_str()),
    );

    let (status, body) = send(&router, request).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["bot_scope"], BotScope::Team.as_str());
    assert_eq!(body["team_id"], BOT_TEAM_ID.to_string());
    assert_eq!(
        service.calls(),
        [AuthorizationCall::Bot {
            token: "bot-bare".to_owned(),
            bot_scope: BotScope::Team,
            claims: None,
        }]
    );
}

#[tokio::test]
async fn missing_malformed_and_blank_bot_tokens_follow_required_and_optional_contracts() {
    let (router, service) = test_router();

    let (status, body) = send(&router, empty_body(request("/bot"))).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(body, json!({ "message": "unauthorized" }));

    let (status, body) = send(&router, empty_body(request("/optional-bot"))).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, Value::Null);

    for path in ["/required", "/optional", "/bot", "/optional-bot"] {
        let malformed_token = HeaderValue::from_bytes(b"\xff").unwrap();
        let (status, body) = send(
            &router,
            empty_body(
                request(path)
                    .header(BOT_TOKEN_HEADER, malformed_token)
                    .header(BOT_SCOPE_HEADER, BotScope::User.as_str()),
            ),
        )
        .await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
        assert_eq!(body, json!({ "message": "unauthorized" }));

        for blank_token in ["", "   "] {
            let (status, body) = send(&router, empty_body(bot_request(path, blank_token))).await;
            assert_eq!(status, StatusCode::UNAUTHORIZED);
            assert_eq!(body, json!({ "message": "unauthorized" }));
        }
    }

    assert!(service.calls().is_empty());
}

#[tokio::test]
async fn bot_authorization_errors_have_generic_status_specific_responses() {
    let (router, service) = test_router();

    for token in ["bot-invalid", "bot-expired", "bot-revoked"] {
        for path in ["/required", "/optional", "/bot", "/optional-bot"] {
            let (status, body) = send(&router, empty_body(bot_request(path, token))).await;
            assert_eq!(status, StatusCode::UNAUTHORIZED);
            assert_eq!(body, json!({ "message": "unauthorized" }));
        }
    }

    for path in ["/required", "/optional", "/bot", "/optional-bot"] {
        for token in ["bot-forbidden", "bot-scope-forbidden"] {
            let (status, body) = send(&router, empty_body(bot_request(path, token))).await;
            assert_eq!(status, StatusCode::FORBIDDEN);
            assert_eq!(body, json!({ "message": "forbidden" }));
        }

        let (status, body) = send(&router, empty_body(bot_request(path, "bot-unavailable"))).await;
        assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
        assert_eq!(body, json!({ "message": "internal server error" }));
    }

    assert_eq!(service.calls().len(), 24);
    assert!(
        service
            .calls()
            .iter()
            .all(|call| matches!(call, AuthorizationCall::Bot { .. }))
    );
}

#[tokio::test]
async fn bot_claim_headers_are_strictly_parsed_before_authorization() {
    let (router, service) = test_router();
    let malformed_header = HeaderValue::from_bytes(b"\xff").unwrap();

    for header in [
        BOT_FOR_MACRO_USER_ID_HEADER,
        BOT_FOR_FUSIONAUTH_USER_ID_HEADER,
        BOT_FOR_ORGANIZATION_ID_HEADER,
    ] {
        let (status, body) = send(
            &router,
            empty_body(bot_request("/bot", "bot-acting").header(header, malformed_header.clone())),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(body, json!({ "message": "invalid bot claims" }));
    }

    for organization_id in ["not-an-integer", "", "2147483648"] {
        let (status, body) = send(
            &router,
            empty_body(
                bot_request("/bot", "bot-acting")
                    .header(BOT_FOR_ORGANIZATION_ID_HEADER, organization_id),
            ),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(body, json!({ "message": "invalid bot claims" }));
    }

    assert!(service.calls().is_empty());
}

#[tokio::test]
async fn bot_claims_without_a_user_identifier_reach_the_authorizer() {
    let (router, service) = test_router();
    let request = empty_body(
        bot_request("/bot", "bot-forbidden").header(BOT_FOR_ORGANIZATION_ID_HEADER, "42"),
    );

    let (status, body) = send(&router, request).await;

    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(body, json!({ "message": "forbidden" }));
    assert_eq!(
        service.calls(),
        [AuthorizationCall::Bot {
            token: "bot-forbidden".to_owned(),
            bot_scope: BotScope::User,
            claims: Some(BotActingUserClaims {
                user_id: None,
                fusion_user_id: None,
                organization_id: Some(42),
            }),
        }]
    );
}

#[tokio::test]
async fn every_combination_of_multiple_explicit_credential_types_is_ambiguous() {
    for path in [
        "/required/user-or-internal",
        "/required/user-or-internal-service",
        "/required/acting-user",
        "/required/user-only",
        "/required/bot-only",
        "/required/internal-only",
        "/required/any-principal",
        "/optional/user-or-internal",
        "/optional/user-or-internal-service",
        "/optional/acting-user",
        "/optional/user-only",
        "/optional/bot-only",
        "/optional/internal-only",
        "/optional/any-principal",
    ] {
        let (router, service) = test_router();
        let path_with_query = format!("{path}?macro-api-token=query");
        let requests = [
            empty_body(
                request(path)
                    .header(INTERNAL_API_KEY_HEADER, VALID_INTERNAL_KEY)
                    .header("authorization", "Bearer valid"),
            ),
            empty_body(bot_request(path, "bot-acting").header("authorization", "Bearer valid")),
            empty_body(
                request(path)
                    .header(INTERNAL_API_KEY_HEADER, VALID_INTERNAL_KEY)
                    .header(BOT_TOKEN_HEADER, "bot-acting")
                    .header(BOT_SCOPE_HEADER, BotScope::User.as_str()),
            ),
            empty_body(
                request(path)
                    .header(INTERNAL_API_KEY_HEADER, VALID_INTERNAL_KEY)
                    .header(BOT_TOKEN_HEADER, "bot-acting")
                    .header(BOT_SCOPE_HEADER, BotScope::User.as_str())
                    .header("authorization", "Bearer valid"),
            ),
            empty_body(
                request(&path_with_query).header(INTERNAL_API_KEY_HEADER, VALID_INTERNAL_KEY),
            ),
            empty_body(bot_request(&path_with_query, "bot-acting")),
        ];

        for request in requests {
            let (status, body) = send(&router, request).await;
            assert_eq!(status, StatusCode::BAD_REQUEST);
            assert_eq!(body, json!({ "message": "ambiguous credentials" }));
        }

        assert!(service.calls().is_empty());
    }
}

#[tokio::test]
async fn explicit_credentials_win_over_ambient_cookies_without_fallback() {
    let (router, service) = test_router();

    let valid_bot_request = empty_body(
        bot_request("/required", "bot-acting")
            .header("cookie", format!("{ACCESS_TOKEN_COOKIE}=cookie")),
    );
    let (status, body) = send(&router, valid_bot_request).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(body, json!({ "message": "forbidden" }));

    let invalid_bot_request = empty_body(
        bot_request("/required", "bot-invalid")
            .header("cookie", format!("{ACCESS_TOKEN_COOKIE}=cookie")),
    );
    let (status, body) = send(&router, invalid_bot_request).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(body, json!({ "message": "unauthorized" }));

    let malformed_user_request = empty_body(
        request("/required")
            .header("authorization", "Basic deliberate-but-malformed")
            .header("cookie", format!("{ACCESS_TOKEN_COOKIE}=cookie")),
    );
    let (status, body) = send(&router, malformed_user_request).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(body, json!({ "message": "unauthorized" }));

    assert_eq!(
        service.calls(),
        [
            AuthorizationCall::Bot {
                token: "bot-acting".to_owned(),
                bot_scope: BotScope::User,
                claims: None,
            },
            AuthorizationCall::Bot {
                token: "bot-invalid".to_owned(),
                bot_scope: BotScope::User,
                claims: None,
            },
        ]
    );
}

#[derive(Clone, Copy, Debug)]
enum PrincipalCredentials {
    User,
    BotWithActingUser,
    BotWithoutActingUser,
    InternalWithActingUser,
    InternalWithoutActingUser,
    Anonymous,
}

const PRINCIPAL_CREDENTIALS: [PrincipalCredentials; 6] = [
    PrincipalCredentials::User,
    PrincipalCredentials::BotWithActingUser,
    PrincipalCredentials::BotWithoutActingUser,
    PrincipalCredentials::InternalWithActingUser,
    PrincipalCredentials::InternalWithoutActingUser,
    PrincipalCredentials::Anonymous,
];

fn principal_request(path: &str, credentials: PrincipalCredentials) -> Request<Body> {
    let request = match credentials {
        PrincipalCredentials::User => request(path).header("authorization", "Bearer valid"),
        PrincipalCredentials::BotWithActingUser => bot_request(path, "bot-acting"),
        PrincipalCredentials::BotWithoutActingUser => bot_request(path, "bot-bare"),
        PrincipalCredentials::InternalWithActingUser => request(path)
            .header(INTERNAL_API_KEY_HEADER, VALID_INTERNAL_KEY)
            .header(INTERNAL_MACRO_USER_ID_HEADER, STANDARD_INTERNAL_USER_ID),
        PrincipalCredentials::InternalWithoutActingUser => {
            request(path).header(INTERNAL_API_KEY_HEADER, VALID_INTERNAL_KEY)
        }
        PrincipalCredentials::Anonymous => request(path),
    };

    empty_body(request)
}

#[tokio::test]
async fn required_policy_matrix_enforces_principal_and_acting_user_contracts() {
    let policies = [
        (
            "/required/user-or-internal",
            [
                StatusCode::OK,
                StatusCode::FORBIDDEN,
                StatusCode::FORBIDDEN,
                StatusCode::OK,
                StatusCode::UNAUTHORIZED,
                StatusCode::UNAUTHORIZED,
            ],
        ),
        (
            "/required/user-or-internal-service",
            [
                StatusCode::OK,
                StatusCode::FORBIDDEN,
                StatusCode::FORBIDDEN,
                StatusCode::OK,
                StatusCode::OK,
                StatusCode::UNAUTHORIZED,
            ],
        ),
        (
            "/required/acting-user",
            [
                StatusCode::OK,
                StatusCode::OK,
                StatusCode::UNAUTHORIZED,
                StatusCode::OK,
                StatusCode::UNAUTHORIZED,
                StatusCode::UNAUTHORIZED,
            ],
        ),
        (
            "/required/user-only",
            [
                StatusCode::OK,
                StatusCode::FORBIDDEN,
                StatusCode::FORBIDDEN,
                StatusCode::FORBIDDEN,
                StatusCode::FORBIDDEN,
                StatusCode::UNAUTHORIZED,
            ],
        ),
        (
            "/required/bot-only",
            [
                StatusCode::FORBIDDEN,
                StatusCode::OK,
                StatusCode::OK,
                StatusCode::FORBIDDEN,
                StatusCode::FORBIDDEN,
                StatusCode::UNAUTHORIZED,
            ],
        ),
        (
            "/required/internal-only",
            [
                StatusCode::FORBIDDEN,
                StatusCode::FORBIDDEN,
                StatusCode::FORBIDDEN,
                StatusCode::OK,
                StatusCode::OK,
                StatusCode::UNAUTHORIZED,
            ],
        ),
        (
            "/required/any-principal",
            [
                StatusCode::OK,
                StatusCode::OK,
                StatusCode::OK,
                StatusCode::OK,
                StatusCode::OK,
                StatusCode::UNAUTHORIZED,
            ],
        ),
    ];

    assert_policy_matrix(policies).await;
}

#[tokio::test]
async fn optional_policy_matrix_enforces_credentials_but_allows_anonymous_requests() {
    let policies = [
        (
            "/optional/user-or-internal",
            [
                StatusCode::OK,
                StatusCode::FORBIDDEN,
                StatusCode::FORBIDDEN,
                StatusCode::OK,
                StatusCode::UNAUTHORIZED,
                StatusCode::OK,
            ],
        ),
        (
            "/optional/user-or-internal-service",
            [
                StatusCode::OK,
                StatusCode::FORBIDDEN,
                StatusCode::FORBIDDEN,
                StatusCode::OK,
                StatusCode::OK,
                StatusCode::OK,
            ],
        ),
        (
            "/optional/acting-user",
            [
                StatusCode::OK,
                StatusCode::OK,
                StatusCode::UNAUTHORIZED,
                StatusCode::OK,
                StatusCode::UNAUTHORIZED,
                StatusCode::OK,
            ],
        ),
        (
            "/optional/user-only",
            [
                StatusCode::OK,
                StatusCode::FORBIDDEN,
                StatusCode::FORBIDDEN,
                StatusCode::FORBIDDEN,
                StatusCode::FORBIDDEN,
                StatusCode::OK,
            ],
        ),
        (
            "/optional/bot-only",
            [
                StatusCode::FORBIDDEN,
                StatusCode::OK,
                StatusCode::OK,
                StatusCode::FORBIDDEN,
                StatusCode::FORBIDDEN,
                StatusCode::OK,
            ],
        ),
        (
            "/optional/internal-only",
            [
                StatusCode::FORBIDDEN,
                StatusCode::FORBIDDEN,
                StatusCode::FORBIDDEN,
                StatusCode::OK,
                StatusCode::OK,
                StatusCode::OK,
            ],
        ),
        (
            "/optional/any-principal",
            [
                StatusCode::OK,
                StatusCode::OK,
                StatusCode::OK,
                StatusCode::OK,
                StatusCode::OK,
                StatusCode::OK,
            ],
        ),
    ];

    assert_policy_matrix(policies).await;
}

async fn assert_policy_matrix<const N: usize>(policies: [(&str, [StatusCode; 6]); N]) {
    let (router, _service) = test_router();

    for (path, expected_statuses) in policies {
        for (credentials, expected_status) in
            PRINCIPAL_CREDENTIALS.into_iter().zip(expected_statuses)
        {
            let (status, body) = send(&router, principal_request(path, credentials)).await;
            assert_eq!(
                status, expected_status,
                "unexpected status for {path} with {credentials:?}: {body}"
            );

            match expected_status {
                StatusCode::UNAUTHORIZED => {
                    assert_eq!(body, json!({ "message": "unauthorized" }));
                }
                StatusCode::FORBIDDEN => {
                    assert_eq!(body, json!({ "message": "forbidden" }));
                }
                StatusCode::OK => {}
                status => panic!("unexpected matrix status {status}"),
            }
        }
    }
}

#[test]
fn policies_report_typed_acting_entity_variants_with_display_parity() {
    let user = macro_user_authentication(VALID_USER_ID);
    let internal_user = macro_user_authentication(STANDARD_INTERNAL_USER_ID);
    let bot = bot_authentication(BotScope::User, Some(BOT_ACTING_USER_ID));

    let direct_user = MacroAuthorization::User(user.clone());
    let user_or_internal = UserOrInternal::narrow(direct_user.clone()).unwrap();
    assert_eq!(
        UserOrInternal::acting_entity(&user_or_internal),
        UserOrInternalEntity::User(VALID_USER_ID)
    );
    assert_display_parity::<UserOrInternal>(direct_user);

    let internal = MacroAuthorization::Internal(Some(internal_user.clone()));
    let user_or_internal = UserOrInternal::narrow(internal.clone()).unwrap();
    assert_eq!(
        UserOrInternal::acting_entity(&user_or_internal),
        UserOrInternalEntity::Internal
    );
    assert_display_parity::<UserOrInternal>(internal.clone());

    let internal_service = UserOrInternalService::narrow(internal.clone()).unwrap();
    assert!(internal_service.is_internal());
    assert_eq!(
        internal_service
            .acting_user()
            .map(|user| user.macro_user_id.as_ref()),
        Some(STANDARD_INTERNAL_USER_ID)
    );
    assert_eq!(
        UserOrInternalService::acting_entity(&internal_service),
        UserOrInternalEntity::Internal
    );
    assert_display_parity::<UserOrInternalService>(internal.clone());

    let bot_principal = MacroAuthorization::Bot(bot.clone());
    let acting_user = ActingUser::narrow(bot_principal.clone()).unwrap();
    assert!(matches!(acting_user.principal, MacroAuthorization::Bot(_)));
    assert_eq!(acting_user.user.macro_user_id.as_ref(), BOT_ACTING_USER_ID);
    assert_eq!(
        ActingUser::acting_entity(&acting_user),
        ActingEntity::Bot(BOT_ID)
    );
    assert_display_parity::<ActingUser>(bot_principal.clone());

    let user_only = UserOnly::narrow(MacroAuthorization::User(user.clone())).unwrap();
    assert_eq!(UserOnly::acting_entity(&user_only), VALID_USER_ID);
    assert_display_parity::<UserOnly>(MacroAuthorization::User(user));

    let bot_only = BotOnly::narrow(bot_principal.clone()).unwrap();
    assert_eq!(BotOnly::acting_entity(&bot_only), BOT_ID);
    assert_display_parity::<BotOnly>(bot_principal.clone());

    let internal_only = InternalOnly::narrow(internal.clone()).unwrap();
    assert_eq!(
        internal_only
            .acting_user
            .as_ref()
            .map(|user| user.macro_user_id.as_ref()),
        Some(STANDARD_INTERNAL_USER_ID)
    );
    assert_eq!(InternalOnly::acting_entity(&internal_only), InternalEntity);
    assert_display_parity::<InternalOnly>(internal.clone());

    let any_principal = AnyPrincipal::narrow(bot_principal.clone()).unwrap();
    assert_eq!(
        AnyPrincipal::acting_entity(&any_principal),
        ActingEntity::Bot(BOT_ID)
    );
    assert_display_parity::<AnyPrincipal>(bot_principal);
}

fn macro_user_authentication(user_id: &str) -> MacroUserAuthentication {
    MacroUserAuthentication {
        macro_user_id: MacroUserIdStr::try_from(user_id.to_owned()).expect("valid Macro user ID"),
        user_context: user_context(user_id, None),
    }
}

fn assert_display_parity<Policy: AuthorizationPolicy>(authorization: MacroAuthorization) {
    let expected = ActingEntity::from(&authorization).to_string();
    let output = Policy::narrow(authorization).expect("principal should satisfy policy");

    assert_eq!(Policy::acting_entity(&output).to_string(), expected);
}
