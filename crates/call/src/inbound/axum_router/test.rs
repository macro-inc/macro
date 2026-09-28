use axum::http::StatusCode;
use axum::response::IntoResponse;

use crate::domain::models::CallError;

#[test]
fn maps_domain_errors_to_status_codes() {
    let cases = [
        (
            CallError::NotFound("call".to_string()),
            StatusCode::NOT_FOUND,
        ),
        (CallError::NotInCall, StatusCode::BAD_REQUEST),
        (
            CallError::AlreadyInCall("channel".to_string()),
            StatusCode::CONFLICT,
        ),
        (CallError::Auth, StatusCode::UNAUTHORIZED),
        (
            CallError::InvalidRequest("view only".to_string()),
            StatusCode::BAD_REQUEST,
        ),
        // Team sharing by anyone but the call's creator.
        (
            CallError::Forbidden("not the creator".to_string()),
            StatusCode::FORBIDDEN,
        ),
        // Stale team-share facts: reload and retry.
        (
            CallError::Conflict("stale".to_string()),
            StatusCode::CONFLICT,
        ),
        (
            CallError::Internal(anyhow::anyhow!("boom")),
            StatusCode::INTERNAL_SERVER_ERROR,
        ),
    ];

    for (error, status) in cases {
        let description = format!("{error:?}");
        assert_eq!(error.into_response().status(), status, "{description}");
    }
}

mod public_routes {
    use std::sync::Arc;
    use std::time::Duration;

    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use rate_limit::domain::models::{RateLimitOk, RateLimitResult};
    use rate_limit::{RateLimitConfig, RateLimitExceeded, RateLimitKey, RateLimitService};
    use tower::ServiceExt;

    use crate::domain::ports::MockCallService;
    use crate::inbound::axum_router::{WebhookRouterState, webhook_router};

    /// Deterministic limiter: `allow` decides every check; nothing is counted.
    #[derive(Clone)]
    struct StubRateLimiter {
        allow: bool,
    }

    impl RateLimitService for StubRateLimiter {
        async fn check_rate_limit(
            &self,
            key: RateLimitKey,
            config: RateLimitConfig,
        ) -> Result<RateLimitResult, rootcause::Report> {
            Ok(if self.allow {
                Ok(RateLimitOk::new_testing_value(1, key, config))
            } else {
                Err(RateLimitExceeded {
                    current_count: 121,
                    max_count: 120,
                    retry_after: Duration::from_secs(30),
                })
            })
        }

        async fn rollback_ticket(&self, _ticket: RateLimitOk) -> Result<(), rootcause::Report> {
            Ok(())
        }
    }

    /// A service with no expectations: any call panics the test, proving the
    /// route rejected the request at the boundary.
    fn untouched_service_router(allow: bool) -> axum::Router {
        webhook_router(
            WebhookRouterState::new(Arc::new(MockCallService::new())),
            StubRateLimiter { allow },
        )
    }

    fn request(method: &str, uri: &str) -> Request<Body> {
        Request::builder()
            .method(method)
            .uri(uri)
            .header("x-forwarded-for", "203.0.113.9")
            .header("content-type", "application/json")
            .body(Body::from("{\"displayName\":\"Ada\"}"))
            .unwrap()
    }

    #[tokio::test]
    async fn malformed_tokens_are_rejected_without_touching_the_service() {
        for (method, uri) in [
            ("GET", "/join/not-a-token"),
            ("POST", "/join/not-a-token"),
            // Right length, wrong alphabet.
            ("GET", &format!("/join/{}", "g".repeat(64))[..]),
        ] {
            let response = untouched_service_router(true)
                .oneshot(request(method, uri))
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::NOT_FOUND, "{method} {uri}");
        }
        // Leave authenticates the bearer before parsing the token, so a
        // malformed token with a bearer present still 404s service-free.
        let mut with_bearer = request("POST", "/join/not-a-token/leave");
        with_bearer
            .headers_mut()
            .insert("authorization", "Bearer bogus".parse().unwrap());
        let response = untouched_service_router(true)
            .oneshot(with_bearer)
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn exhausted_ip_budget_returns_429_before_any_token_handling() {
        let valid_token = "a".repeat(64);
        for (method, uri) in [
            ("GET", format!("/join/{valid_token}")),
            ("POST", format!("/join/{valid_token}")),
            ("POST", format!("/join/{valid_token}/leave")),
        ] {
            let response = untouched_service_router(false)
                .oneshot(request(method, &uri))
                .await
                .unwrap();
            assert_eq!(
                response.status(),
                StatusCode::TOO_MANY_REQUESTS,
                "{method} {uri}"
            );
        }
    }

    #[tokio::test]
    async fn leave_requires_a_bearer_token() {
        let response = untouched_service_router(true)
            .oneshot(request("POST", &format!("/join/{}/leave", "a".repeat(64))))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn livekit_routes_share_no_budget_with_anonymous_traffic() {
        // The exhausted limiter must not affect the LiveKit-authenticated
        // webhook route; it fails on its own signature check instead.
        let mut service = MockCallService::new();
        service
            .expect_process_webhook_event()
            .times(1)
            .returning(|_, _| Box::pin(async { Err(crate::domain::models::CallError::Auth) }));
        let router = webhook_router(
            WebhookRouterState::new(Arc::new(service)),
            StubRateLimiter { allow: false },
        );
        let mut webhook_request = request("POST", "/webhook");
        webhook_request
            .headers_mut()
            .insert("authorization", "Bearer not-livekit".parse().unwrap());
        let response = router.oneshot(webhook_request).await.unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }
}
