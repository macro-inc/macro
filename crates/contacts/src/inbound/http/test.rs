use super::*;
use axum::{
    body::Body,
    http::{Request, header},
};
use http_body_util::BodyExt;
use macro_authorization::{
    INTERNAL_API_KEY_HEADER, INTERNAL_MACRO_USER_ID_HEADER, InternalAuthConfig, JwtValidator,
    MacroAuthorizationError, MacroAuthorizationServiceImpl, ValidatedIdentity,
};
use rate_limit::{
    RateLimitConfig, RateLimitExceeded, RateLimitKey, RateLimitResult, RateLimitServiceImpl,
    domain::models::RateLimitOk,
};
use rootcause::Report;
use std::collections::HashSet;
use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering},
};
use tower::ServiceExt;

const FOUND_USER_ID: &str = "macro|found@test.com";
const NOT_FOUND_USER_ID: &str = "macro|notfound@test.com";
const SENDER_USER_ID: &str = "macro|sender@test.com";
const VALID_INTERNAL_KEY: &str = "valid-internal-key";

struct MockService;

impl ContactsService for MockService {
    async fn query_contacts(
        &self,
        user_id: MacroUserIdStr<'_>,
    ) -> Result<Vec<MacroUserIdStr<'static>>, Report> {
        if user_id.as_ref() != FOUND_USER_ID {
            return Ok(Vec::new());
        }

        Ok([
            "macro|contact1@test.com",
            "macro|contact2@test.com",
            "macro|contact3@test.com",
        ]
        .into_iter()
        .map(|user_id| MacroUserIdStr::try_from(user_id.to_string()).unwrap())
        .collect())
    }

    async fn add_contact_nodes(&self, _nodes: ContactsNodes) -> Result<(), Report> {
        Ok(())
    }
}

#[derive(Clone, Default)]
struct FakeJwtValidator {
    validation_count: Arc<AtomicUsize>,
}

impl FakeJwtValidator {
    fn validation_count(&self) -> usize {
        self.validation_count.load(Ordering::SeqCst)
    }
}

impl JwtValidator for FakeJwtValidator {
    fn validate(&self, jwt: &str) -> Result<ValidatedIdentity, Report<MacroAuthorizationError>> {
        self.validation_count.fetch_add(1, Ordering::SeqCst);

        let user_id = match jwt {
            "found" => FOUND_USER_ID,
            "not-found" => NOT_FOUND_USER_ID,
            "sender" => SENDER_USER_ID,
            _ => return Err(Report::new(MacroAuthorizationError::InvalidCredentials)),
        };

        Ok(ValidatedIdentity {
            user_id: user_id.to_string(),
            fusion_user_id: "fusion-user-id".to_string(),
            permissions: None,
            organization_id: None,
        })
    }
}

#[derive(Clone)]
struct MockRateLimitPort {
    should_exceed: bool,
}

impl rate_limit::RateLimitPort for MockRateLimitPort {
    async fn check(
        &self,
        key: RateLimitKey,
        config: RateLimitConfig,
    ) -> Result<RateLimitResult, Report> {
        if self.should_exceed {
            return Ok(Err(RateLimitExceeded {
                current_count: config.max_count.saturating_add(1),
                max_count: config.max_count,
                retry_after: config.window,
            }));
        }

        Ok(Ok(RateLimitOk::new_testing_value(0, key, config)))
    }

    async fn decrement(&self, _key: &RateLimitKey) -> Result<(), Report> {
        Ok(())
    }
}

fn rate_limiter(should_exceed: bool) -> RateLimitServiceImpl<MockRateLimitPort> {
    RateLimitServiceImpl {
        repo: MockRateLimitPort { should_exceed },
    }
}

fn build_test_router(should_exceed: bool) -> (Router, FakeJwtValidator) {
    let validator = FakeJwtValidator::default();
    let authorization_service = MacroAuthorizationServiceImpl::new(
        validator.clone(),
        InternalAuthConfig {
            api_key: VALID_INTERNAL_KEY.to_string(),
            default_user_id: None,
        },
    );
    let state = ContactsRouterState {
        contacts_service: Arc::new(MockService),
        rate_limit_service: rate_limiter(should_exceed),
        authorization_state: MacroAuthorizationState::new(Arc::new(authorization_service)),
    };

    (contacts_router::<_, _, _, ()>(state), validator)
}

fn bearer_get_request(token: &str) -> Request<Body> {
    Request::get("/contacts")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::empty())
        .unwrap()
}

fn add_contact_request(token: &str) -> Request<Body> {
    Request::post("/contacts")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            serde_json::json!({"user_id": "macro|recipient@example.com"}).to_string(),
        ))
        .unwrap()
}

#[tokio::test]
async fn bearer_get_returns_contacts() {
    let (api, validator) = build_test_router(false);

    let response = api.oneshot(bearer_get_request("found")).await.unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(validator.validation_count(), 1);
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let body: GetContactsResponse = serde_json::from_slice(&body).unwrap();
    let expected_contacts: HashSet<&str> = [
        "macro|contact1@test.com",
        "macro|contact2@test.com",
        "macro|contact3@test.com",
    ]
    .into_iter()
    .collect();

    assert_eq!(body.contacts.len(), expected_contacts.len());
    for contact in &body.contacts {
        assert!(expected_contacts.contains(contact.as_ref()));
    }
}

#[tokio::test]
async fn bearer_get_returns_not_found() {
    let (api, _) = build_test_router(false);

    let response = api.oneshot(bearer_get_request("not-found")).await.unwrap();

    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn bearer_post_adds_contact_and_validates_once() {
    let (api, validator) = build_test_router(false);

    let response = api.oneshot(add_contact_request("sender")).await.unwrap();

    assert_eq!(response.status(), StatusCode::NO_CONTENT);
    assert_eq!(validator.validation_count(), 1);
}

#[tokio::test]
async fn post_rate_limit_is_preserved() {
    let (api, validator) = build_test_router(true);

    let response = api.oneshot(add_contact_request("sender")).await.unwrap();

    assert_eq!(response.status(), StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(validator.validation_count(), 1);
}

#[tokio::test]
async fn get_is_not_affected_by_post_rate_limit() {
    let (api, _) = build_test_router(true);

    let response = api.oneshot(bearer_get_request("found")).await.unwrap();

    assert_eq!(response.status(), StatusCode::OK);
}

#[tokio::test]
async fn missing_credentials_are_rejected() {
    let (api, validator) = build_test_router(false);
    let request = Request::get("/contacts").body(Body::empty()).unwrap();

    let response = api.oneshot(request).await.unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(validator.validation_count(), 0);
}

#[tokio::test]
async fn invalid_credentials_are_rejected() {
    let (api, validator) = build_test_router(false);

    let response = api.oneshot(bearer_get_request("invalid")).await.unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(validator.validation_count(), 1);
}

#[tokio::test]
async fn internal_acting_user_is_authenticated() {
    let (api, validator) = build_test_router(false);
    let request = Request::get("/contacts")
        .header(INTERNAL_API_KEY_HEADER, VALID_INTERNAL_KEY)
        .header(INTERNAL_MACRO_USER_ID_HEADER, FOUND_USER_ID)
        .body(Body::empty())
        .unwrap();

    let response = api.oneshot(request).await.unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(validator.validation_count(), 0);
}

#[tokio::test]
async fn internal_request_without_an_identity_is_rejected() {
    let (api, validator) = build_test_router(false);
    let request = Request::get("/contacts")
        .header(INTERNAL_API_KEY_HEADER, VALID_INTERNAL_KEY)
        .body(Body::empty())
        .unwrap();

    let response = api.oneshot(request).await.unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(validator.validation_count(), 0);
}
