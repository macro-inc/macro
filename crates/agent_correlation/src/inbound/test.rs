use super::*;
use crate::domain::Correlation;
use async_trait::async_trait;
use axum::http::Request;
use macro_auth::macro_api_token::{EncodeMacroApiTokenArgs, encode_macro_api_token};
use std::sync::atomic::{AtomicUsize, Ordering};

const PRIVATE: &str = include_str!(
    "../../../../tooling/xtask/crates/xtask_local/src/local/identity/macro-api-token.local.private.pem"
);
const PUBLIC: &str = include_str!(
    "../../../../tooling/xtask/crates/xtask_local/src/local/identity/macro-api-token.local.public.pem"
);

struct Repository {
    calls: AtomicUsize,
}
#[async_trait]
impl CorrelationRepository for Repository {
    async fn create(
        &self,
        _: Uuid,
        _: Uuid,
        _: Option<crate::scope::SessionScope>,
    ) -> Result<Uuid, CorrelationError> {
        unreachable!()
    }
    async fn find(&self, id: Uuid) -> Result<Option<Correlation>, CorrelationError> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        // 1: an unscoped session; 6: a generation session.
        Ok([1, 6].contains(&id.as_u128()).then_some(Correlation {
            session_id: Uuid::from_u128(2),
            agent_id: Uuid::from_u128(3),
            scope: (id == Uuid::from_u128(6)).then_some(crate::scope::SessionScope::Generation),
        }))
    }
}
fn token(correlation: Option<Uuid>, agent: Option<Uuid>) -> String {
    encode_macro_api_token(EncodeMacroApiTokenArgs {
        fusionauth_id: "fixture".into(),
        macro_user_id: "macro|owner@example.com".into(),
        organization_id: None,
        issuer: "fixture".into(),
        private_key: PRIVATE.into(),
        expiry_seconds: 60,
        agent_id: agent,
        agent_via: None,
        agent_correlation_id: correlation,
        agent_session_id: None,
        routine_id: None,
    })
    .unwrap()
}

#[tokio::test]
async fn optional_claim_is_validated_before_a_handler_can_use_it() {
    let repository = Arc::new(Repository {
        calls: AtomicUsize::new(0),
    });
    let state = CorrelationState {
        jwt: JwtValidationArgs::testing_macro_token("fixture", PUBLIC),
        repository: repository.clone(),
    };
    for bearer in [None, Some(token(None, None))] {
        let mut request = Request::builder()
            .uri("/")
            .header("x-agent-correlation-id", Uuid::from_u128(1).to_string());
        if let Some(bearer) = bearer {
            request = request.header("authorization", format!("Bearer {bearer}"));
        }
        let (mut parts, _) = request.body(()).unwrap().into_parts();
        assert!(
            AgentCorrelationExtractor::from_request_parts(&mut parts, &state)
                .await
                .unwrap()
                .0
                .is_none()
        );
    }
    assert_eq!(repository.calls.load(Ordering::SeqCst), 0);
    for (id, agent, expected) in [
        (1, Some(3), StatusCode::OK),
        (1, Some(4), StatusCode::FORBIDDEN),
        (5, Some(3), StatusCode::NOT_FOUND),
        (1, None, StatusCode::BAD_REQUEST),
    ] {
        let bearer = token(Some(Uuid::from_u128(id)), agent.map(Uuid::from_u128));
        let (mut parts, _) = Request::builder()
            .uri("/")
            .header("authorization", format!("Bearer {bearer}"))
            .body(())
            .unwrap()
            .into_parts();
        let status = match AgentCorrelationExtractor::from_request_parts(&mut parts, &state).await {
            Ok(AgentCorrelationExtractor(found)) => {
                assert_eq!(found, Some(Uuid::from_u128(id)));
                StatusCode::OK
            }
            Err(error) => error.into_response().status(),
        };
        assert_eq!(status, expected);
    }
}

fn routine_token(routine: Uuid, correlation: Option<Uuid>, agent: Option<Uuid>) -> String {
    encode_macro_api_token(EncodeMacroApiTokenArgs {
        fusionauth_id: "fixture".into(),
        macro_user_id: "macro|owner@example.com".into(),
        organization_id: None,
        issuer: "fixture".into(),
        private_key: PRIVATE.into(),
        expiry_seconds: 60,
        agent_id: agent,
        agent_via: None,
        agent_correlation_id: correlation,
        agent_session_id: None,
        routine_id: Some(routine),
    })
    .unwrap()
}

#[tokio::test]
async fn propagate_scopes_the_signed_routine_beside_the_correlation() {
    use tower::ServiceExt;

    let repository = Arc::new(Repository {
        calls: AtomicUsize::new(0),
    });
    let state = CorrelationState {
        jwt: JwtValidationArgs::testing_macro_token("fixture", PUBLIC),
        repository: repository.clone(),
    };
    let app = axum::Router::new()
        .route(
            "/",
            axum::routing::post(|| async {
                Json(serde_json::json!({
                    "correlation": crate::context::current(),
                    "routine": crate::context::current_routine(),
                }))
            }),
        )
        .layer(axum::middleware::from_fn_with_state(state, propagate));
    let routine = Uuid::from_u128(0x7001);
    // A routine payload spliced onto another token's signature is not verified.
    let plain = token(None, None);
    let signed = routine_token(routine, None, None);
    let [header, _, signature]: [&str; 3] =
        plain.split('.').collect::<Vec<_>>().try_into().unwrap();
    let forged = format!("{header}.{}.{signature}", signed.split('.').nth(1).unwrap());
    for (bearer, correlation, routine_id) in [
        (Some(signed), None, Some(routine)),
        (
            Some(routine_token(
                routine,
                Some(Uuid::from_u128(1)),
                Some(Uuid::from_u128(3)),
            )),
            Some(Uuid::from_u128(1)),
            Some(routine),
        ),
        (Some(token(None, None)), None, None),
        (Some(forged), None, None),
        (None, None, None),
    ] {
        let mut request = Request::builder().method("POST").uri("/");
        if let Some(bearer) = bearer {
            request = request.header("authorization", format!("Bearer {bearer}"));
        }
        let response = app
            .clone()
            .oneshot(request.body(axum::body::Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&body).unwrap(),
            serde_json::json!({ "correlation": correlation, "routine": routine_id }),
        );
    }
    // Only the correlation is looked up; the routine's signature is its authority.
    assert_eq!(repository.calls.load(Ordering::SeqCst), 1);
    assert_eq!(crate::context::current_routine(), None);
}

/// A scoped session's request outside its scope is refused before any
/// handler runs; inside it, and any unscoped session's, goes through.
#[tokio::test]
async fn a_scoped_session_is_refused_outside_its_scope() {
    use tower::ServiceExt;

    let state = CorrelationState {
        jwt: JwtValidationArgs::testing_macro_token("fixture", PUBLIC),
        repository: Arc::new(Repository {
            calls: AtomicUsize::new(0),
        }),
    };
    let ran = Arc::new(AtomicUsize::new(0));
    let handler = {
        let ran = Arc::clone(&ran);
        move || {
            let ran = Arc::clone(&ran);
            async move {
                ran.fetch_add(1, Ordering::SeqCst);
                StatusCode::OK
            }
        }
    };
    let app = axum::Router::new()
        .route("/email/messages", axum::routing::post(handler.clone()))
        .route(
            "/scheduled-action/suggestions",
            axum::routing::post(handler.clone()),
        )
        .route("/email/threads", axum::routing::get(handler))
        .layer(axum::middleware::from_fn_with_state(state, propagate));
    for (correlation, method, path, expected) in [
        (6, "POST", "/email/messages", StatusCode::FORBIDDEN),
        (6, "POST", "/scheduled-action/suggestions", StatusCode::OK),
        (6, "GET", "/email/threads", StatusCode::OK),
        (1, "POST", "/email/messages", StatusCode::OK),
    ] {
        let bearer = token(Some(Uuid::from_u128(correlation)), Some(Uuid::from_u128(3)));
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(method)
                    .uri(path)
                    .header("authorization", format!("Bearer {bearer}"))
                    .body(axum::body::Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), expected, "{correlation} {method} {path}");
    }
    assert_eq!(ran.load(Ordering::SeqCst), 3);
    // The extractor refuses the same way.
    let bearer = token(Some(Uuid::from_u128(6)), Some(Uuid::from_u128(3)));
    let (mut parts, _) = Request::builder()
        .method("POST")
        .uri("/email/messages")
        .header("authorization", format!("Bearer {bearer}"))
        .body(())
        .unwrap()
        .into_parts();
    let state = CorrelationState {
        jwt: JwtValidationArgs::testing_macro_token("fixture", PUBLIC),
        repository: Arc::new(Repository {
            calls: AtomicUsize::new(0),
        }),
    };
    let refused = AgentCorrelationExtractor::from_request_parts(&mut parts, &state).await;
    assert_eq!(
        refused.err().unwrap().into_response().status(),
        StatusCode::FORBIDDEN
    );
}
