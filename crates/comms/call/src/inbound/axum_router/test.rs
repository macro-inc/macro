use axum::http::StatusCode;
use axum::response::IntoResponse;

use crate::domain::models::CallError;
use entity_access::domain::models::{AccessLevel, EntityPermission};

use super::DeclineCallPermission;

#[test]
fn maps_domain_errors_to_status_codes() {
    let cases = [
        (
            CallError::NotFound("call".to_string()),
            StatusCode::NOT_FOUND,
        ),
        (CallError::NotInCall, StatusCode::BAD_REQUEST),
        (CallError::Ended, StatusCode::GONE),
        (CallError::InOtherCall, StatusCode::CONFLICT),
        (CallError::AlreadyConnected, StatusCode::CONFLICT),
        (CallError::RateLimited, StatusCode::TOO_MANY_REQUESTS),
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

#[test]
fn token_routes_refuse_code_execution_header() {
    let mut headers = axum::http::HeaderMap::new();
    headers.insert(
        macro_authorization::CODE_EXECUTION_HEADER,
        "1".parse().unwrap(),
    );
    assert!(matches!(
        super::refuse_code_execution_token(&headers),
        Err(CallError::Forbidden(_))
    ));
}

/// The entity-access service resolves a call to an access level, never a
/// channel role, so the decline route must accept a plain viewer.
#[test]
fn decline_accepts_the_permission_call_access_resolves_to() {
    let viewer = EntityPermission::AccessLevel {
        access_level: AccessLevel::View,
    };
    assert!(viewer.satisfies::<DeclineCallPermission>());
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
            ("GET", "/join/not-a-token/participants"),
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
            ("GET", format!("/join/{valid_token}/participants")),
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

#[cfg(test)]
mod authenticated_join_routes {
    use std::sync::Arc;

    use axum::{
        body::Body,
        http::{Request, StatusCode},
    };
    use entity_access::domain::ports::NoOpEntityAccessService;
    use macro_authorization::{
        CredentialOrigin, InternalIdentityClaims, MacroAuthorizationError,
        MacroAuthorizationService, MacroAuthorizationState, ValidatedCredential,
    };
    use model_user::UserContext;
    use rootcause::Report;
    use tower::ServiceExt;
    use uuid::Uuid;

    use crate::domain::{
        models::{CallError, CallTokenResponse},
        ports::MockCallService,
    };
    use crate::inbound::axum_router::{CallRouterState, call_router};

    #[derive(Clone)]
    struct Auth;

    impl MacroAuthorizationService for Auth {
        async fn authorize(
            &self,
            jwt: &str,
        ) -> Result<UserContext, Report<MacroAuthorizationError>> {
            let user_id = match jwt {
                "member" => "macro|member@example.com",
                "program" => "macro|member@example.com",
                "viewer" => "macro|viewer@example.com",
                _ => return Err(Report::new(MacroAuthorizationError::InvalidCredentials)),
            };
            Ok(UserContext {
                user_id: user_id.to_string(),
                fusion_user_id: "00000000-0000-0000-0000-000000000001".to_string(),
                permissions: None,
                organization_id: None,
            })
        }

        async fn authorize_identity(
            &self,
            jwt: &str,
        ) -> Result<ValidatedCredential, Report<MacroAuthorizationError>> {
            self.authorize(jwt).await.map(|context| {
                let mut credential = ValidatedCredential::session(context);
                if jwt == "program" {
                    credential.origin = CredentialOrigin::UserApiKey;
                }
                credential
            })
        }

        async fn authorize_internal(
            &self,
            _key: &str,
            _claims: InternalIdentityClaims,
        ) -> Result<Option<UserContext>, Report<MacroAuthorizationError>> {
            Err(Report::new(MacroAuthorizationError::InvalidCredentials))
        }
    }

    fn router_with_flag(mut service: MockCallService, enabled: bool) -> axum::Router {
        service
            .expect_programmatic_calls_enabled()
            .returning(move |_| Box::pin(async move { enabled }));
        call_router(CallRouterState::new(
            Arc::new(service),
            Arc::new(NoOpEntityAccessService),
            MacroAuthorizationState::new(Arc::new(Auth)),
        ))
    }

    fn router(service: MockCallService) -> axum::Router {
        router_with_flag(service, true)
    }

    fn join(call_id: Uuid, actor: &str) -> Request<Body> {
        Request::post(format!("/record/{call_id}/join"))
            .header("authorization", format!("Bearer {actor}"))
            .header("content-type", "application/json")
            .body(Body::from("{}"))
            .unwrap()
    }

    #[tokio::test]
    async fn join_route_is_absent_when_programmatic_calls_are_disabled() {
        let call_id = Uuid::now_v7();
        let mut service = MockCallService::new();
        service.expect_join_call().never();

        let response = router_with_flag(service, false)
            .oneshot(join(call_id, "member"))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn join_route_returns_forbidden_for_view_only_access() {
        let call_id = Uuid::now_v7();
        let mut service = MockCallService::new();
        service.expect_join_call().times(1).returning(|_, _, _, _| {
            Box::pin(async {
                Err(CallError::Forbidden(
                    "view access does not admit a participant".to_string(),
                ))
            })
        });

        let response = router(service)
            .oneshot(join(call_id, "viewer"))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn join_route_returns_a_token_for_joinable_access() {
        let call_id = Uuid::now_v7();
        let mut service = MockCallService::new();
        service
            .expect_join_call()
            .times(1)
            .returning(move |_, _, _, _| {
                Box::pin(async move {
                    Ok(CallTokenResponse {
                        started: false,
                        participant_id: "macro|member@example.com".to_string(),
                        share_token: None,
                        call_id,
                        channel_id: None,
                        token: "test-token".to_string(),
                        room_name: call_id.to_string(),
                        server_url: "wss://example.com".to_string(),
                    })
                })
            });

        let response = router(service)
            .oneshot(join(call_id, "member"))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn meeting_join_without_body_uses_app_options_and_person_client() {
        let call_id = Uuid::now_v7();
        let mut service = MockCallService::new();
        service
            .expect_join_meeting_with_options()
            .times(1)
            .returning(move |_, _, request, is_program, _| {
                assert!(matches!(
                    request.on_other_call,
                    crate::domain::models::OnOtherCall::Switch
                ));
                assert!(request.replace);
                assert!(!is_program);
                Box::pin(async move {
                    Ok(CallTokenResponse {
                        started: false,
                        participant_id: "macro|member@example.com".to_string(),
                        share_token: None,
                        call_id,
                        channel_id: None,
                        token: "test-token".to_string(),
                        room_name: call_id.to_string(),
                        server_url: "wss://example.com".to_string(),
                    })
                })
            });

        let response = router(service)
            .oneshot(
                Request::post(format!("/meetings/join/{}", "a".repeat(64)))
                    .header("authorization", "Bearer program")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
    }
}
