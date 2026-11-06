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
    async fn create(&self, _: Uuid, _: Uuid) -> Result<Uuid, CorrelationError> {
        unreachable!()
    }
    async fn find(&self, id: Uuid) -> Result<Option<Correlation>, CorrelationError> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        Ok((id == Uuid::from_u128(1)).then_some(Correlation {
            session_id: Uuid::from_u128(2),
            agent_id: Uuid::from_u128(3),
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
