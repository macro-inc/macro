#[allow(unused_imports)]
use super::*;
use axum::{body::Body, http::Request};
use http_body_util::BodyExt;
use macro_authorization::{
    MacroAuthorizationServiceImpl,
    testing::{FakeMacroAuthorizationService, bearer, test_user_context},
};
use rate_limit::{
    RateLimitConfig, RateLimitExceeded, RateLimitKey, RateLimitResult, RateLimitServiceImpl,
    domain::models::RateLimitOk,
};
use rootcause::Report;
use std::collections::HashSet;
use tower::ServiceExt;

#[derive(Clone, Debug)]
struct MockService;

impl ContactsService for MockService {
    async fn query_contacts(
        &self,
        user_id: MacroUserIdStr<'_>,
    ) -> Result<Vec<MacroUserIdStr<'static>>, rootcause::Report> {
        if user_id.as_ref() == "macro|found@test.com" {
            let contacts = [
                "macro|contact1@test.com",
                "macro|contact2@test.com",
                "macro|contact3@test.com",
            ]
            .into_iter()
            .map(|s| MacroUserIdStr::try_from(s.to_string()).unwrap())
            .collect();
            return Ok(contacts);
        } else if user_id.as_ref() == "macro|many@test.com" {
            let contacts = [
                "macro|contact4@test.com",
                "macro|contact5@test.com",
                "macro|contact6@test.com",
                "macro|contact7@test.com",
                "macro|contact8@test.com",
                "macro|contact9@test.com",
                "macro|contact10@test.com",
            ]
            .into_iter()
            .map(|s| MacroUserIdStr::try_from(s.to_string()).unwrap())
            .collect();
            return Ok(contacts);
        }

        Ok(vec![])
    }

    async fn add_contact_nodes(&self, _nodes: ContactsNodes) -> Result<(), rootcause::Report> {
        Ok(())
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
            Ok(Err(RateLimitExceeded {
                current_count: config.max_count.saturating_add(1),
                max_count: config.max_count,
                retry_after: config.window,
            }))
        } else {
            Ok(Ok(RateLimitOk::new_testing_value(0, key, config)))
        }
    }

    async fn decrement(&self, _key: &RateLimitKey) -> Result<(), Report> {
        Ok(())
    }
}

fn allowing_rate_limiter() -> RateLimitServiceImpl<MockRateLimitPort> {
    RateLimitServiceImpl {
        repo: MockRateLimitPort {
            should_exceed: false,
        },
    }
}

fn exceeding_rate_limiter() -> RateLimitServiceImpl<MockRateLimitPort> {
    RateLimitServiceImpl {
        repo: MockRateLimitPort {
            should_exceed: true,
        },
    }
}

fn mock_service() -> Arc<MockService> {
    Arc::new(MockService)
}

const TEST_TOKEN: &str = "test-token";

fn build_test_router(
    rate_limiter: RateLimitServiceImpl<MockRateLimitPort>,
    user_id: &str,
) -> (Router, FakeMacroAuthorizationService) {
    let authorization = FakeMacroAuthorizationService::always(test_user_context(user_id));
    let router = contacts_router(ContactsRouterState {
        service: mock_service(),
        rate_limiter,
        authorization: MacroAuthorizationServiceImpl::new(authorization.clone()),
    });
    (router, authorization)
}

fn authenticated_request() -> axum::http::request::Builder {
    bearer(Request::builder(), TEST_TOKEN)
}

#[tokio::test]
async fn test_get_contact() {
    let user_id = "macro|found@test.com";
    let (api, _) = build_test_router(allowing_rate_limiter(), user_id);

    let response = api
        .oneshot(
            authenticated_request()
                .uri("/contacts")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let body: GetContactsResponse = serde_json::from_slice(&body).unwrap();

    let contact_list: HashSet<&str> = [
        "macro|contact1@test.com",
        "macro|contact2@test.com",
        "macro|contact3@test.com",
    ]
    .into_iter()
    .collect();

    assert_eq!(body.contacts.len(), 3, "Not enough contacts");
    for contact in &body.contacts {
        assert!(
            contact_list.contains(contact.as_ref()),
            "Could not find contact: {}",
            contact.as_ref()
        );
    }
}

#[tokio::test]
async fn test_get_contact_not_found() {
    let user_id = "macro|notfound@test.com";
    let (api, _) = build_test_router(allowing_rate_limiter(), user_id);

    let response = api
        .oneshot(
            authenticated_request()
                .uri("/contacts")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn test_add_contact_rate_limit_primes_handler_authorization() {
    let user_id = "macro|sender@test.com";
    let (api, authorization) = build_test_router(allowing_rate_limiter(), user_id);

    let response = api
        .oneshot(
            authenticated_request()
                .method("POST")
                .uri("/contacts")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::json!({"user_id": "macro|recipient@example.com"}).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NO_CONTENT);
    assert_eq!(authorization.calls(), [TEST_TOKEN]);
}

#[tokio::test]
async fn test_add_contact_rate_limited() {
    let user_id = "macro|sender@test.com";
    let (api, _) = build_test_router(exceeding_rate_limiter(), user_id);

    let response = api
        .oneshot(
            authenticated_request()
                .method("POST")
                .uri("/contacts")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::json!({"user_id": "macro|recipient@example.com"}).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::TOO_MANY_REQUESTS);
}

#[tokio::test]
async fn test_get_not_affected_by_rate_limit() {
    let user_id = "macro|found@test.com";
    let (api, _) = build_test_router(exceeding_rate_limiter(), user_id);

    let response = api
        .oneshot(
            authenticated_request()
                .uri("/contacts")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
}
