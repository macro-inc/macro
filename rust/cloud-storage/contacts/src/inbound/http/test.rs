use super::*;
use axum::{Extension, body::Body, http::Request};
use http_body_util::BodyExt;
use model_user::UserContext;
use rate_limit::{
    RateLimitConfig, RateLimitExceeded, RateLimitKey, RateLimitResult, RateLimitServiceImpl,
    domain::models::RateLimitOk,
};
use rootcause::Report;
use std::collections::HashSet;
use tower::ServiceExt;

#[derive(Clone, Debug)]
struct MockService;

impl ContactsServicePort for MockService {
    async fn query_contacts(&self, user_id: MacroUserIdStr<'_>) -> Option<Vec<String>> {
        if user_id.as_ref() == "macro|found@test.com" {
            let contacts = [
                "0bcabd1a-1bf5-48d7-b334-5f7e59e8a9ff",
                "3a90b186-0288-4819-8e1a-8e10cb685c0c",
                "e3cf7c46-60c9-413a-8f27-57c91c3297cf",
            ]
            .into_iter()
            .map(String::from)
            .collect();

            return Some(contacts);
        } else if user_id.as_ref() == "macro|many@test.com" {
            let contacts = [
                "d44caada-98c0-49eb-ab20-6851b824983a",
                "5ab8c770-f2cb-4c6c-bc08-ae64569e324c",
                "79a5557b-7827-4e2e-a6ae-f0935cdb762e",
                "c3f4d826-f8fd-478a-aa66-b5b6bb370cbc",
                "ff038d36-1aef-461a-8aa8-34001fa1abad",
                "c3b1970f-18ee-4dfa-b5fb-e8240e28e51d",
                "9effe035-bb12-4fcc-b479-800e1c2551a8",
            ]
            .into_iter()
            .map(String::from)
            .collect();

            return Some(contacts);
        }

        None
    }

    async fn add_contact(
        &self,
        _caller: MacroUserIdStr<'_>,
        _recipient: MacroUserIdStr<'_>,
    ) -> Result<(), anyhow::Error> {
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

fn test_user_context(user_id: &str) -> UserContext {
    UserContext {
        user_id: user_id.to_string(),
        permissions: None,
        organization_id: None,
        fusion_user_id: "".to_string(),
    }
}

fn build_test_router(
    rate_limiter: RateLimitServiceImpl<MockRateLimitPort>,
    user_id: &str,
) -> Router {
    contacts_router(rate_limiter)
        .with_state(mock_service())
        .layer(Extension(test_user_context(user_id)))
}

#[tokio::test]
async fn test_get_contact() {
    let user_id = "macro|found@test.com";
    let api = build_test_router(allowing_rate_limiter(), user_id);

    let response = api
        .oneshot(
            Request::builder()
                .uri("/contacts")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let body: GetContactsResponse = serde_json::from_slice(&body).unwrap();

    let contact_list: HashSet<String> = [
        "0bcabd1a-1bf5-48d7-b334-5f7e59e8a9ff",
        "3a90b186-0288-4819-8e1a-8e10cb685c0c",
        "e3cf7c46-60c9-413a-8f27-57c91c3297cf",
    ]
    .into_iter()
    .map(String::from)
    .collect();

    assert_eq!(body.contacts.len(), 3, "Not enough contacts");
    for contact in &body.contacts {
        assert!(
            contact_list.contains(contact),
            "Could not find contact: {}",
            contact
        );
    }
}

#[tokio::test]
async fn test_get_contact_not_found() {
    let user_id = "macro|notfound@test.com";
    let api = build_test_router(allowing_rate_limiter(), user_id);

    let response = api
        .oneshot(
            Request::builder()
                .uri("/contacts")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn test_add_contact() {
    let user_id = "macro|sender@test.com";
    let api = build_test_router(allowing_rate_limiter(), user_id);

    let response = api
        .oneshot(
            Request::builder()
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
}

#[tokio::test]
async fn test_add_contact_rate_limited() {
    let user_id = "macro|sender@test.com";
    let api = build_test_router(exceeding_rate_limiter(), user_id);

    let response = api
        .oneshot(
            Request::builder()
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
    let api = build_test_router(exceeding_rate_limiter(), user_id);

    let response = api
        .oneshot(
            Request::builder()
                .uri("/contacts")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
}
