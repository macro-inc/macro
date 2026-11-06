//! Optional attribution extraction and request-scoped propagation.

use crate::domain::{CorrelationError, CorrelationRepository, validate};
use axum::{
    Json,
    extract::{FromRef, FromRequestParts, Request, State},
    http::{StatusCode, request::Parts},
    middleware::Next,
    response::{IntoResponse, Response},
};
use macro_auth::{
    headers::AccessTokenExtractor,
    middleware::decode_jwt::{JwtToken, JwtValidationArgs},
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tracing::Instrument;
use uuid::Uuid;

/// Resources used exclusively for verifying optional attribution.
#[derive(Clone)]
pub struct CorrelationState {
    /// Existing JWT verifier configuration.
    pub jwt: JwtValidationArgs,
    /// Primary-database mapping lookup.
    pub repository: Arc<dyn CorrelationRepository>,
}

#[cfg(feature = "postgres")]
impl CorrelationState {
    /// Compose attribution validation from an existing primary pool and verifier.
    pub fn new(pool: sqlx::PgPool, jwt: JwtValidationArgs) -> Self {
        Self {
            jwt,
            repository: Arc::new(crate::outbound::PgCorrelationRepository(pool)),
        }
    }
}

/// An optional signed and validated invocation ID. It grants no authorization.
pub struct AgentCorrelationExtractor(pub Option<Uuid>);

#[derive(Deserialize)]
struct QueryToken {
    #[serde(rename = "macro-api-token")]
    token: Option<String>,
}

impl<S: Send + Sync> FromRequestParts<S> for AgentCorrelationExtractor
where
    CorrelationState: FromRef<S>,
{
    type Rejection = CorrelationRejection;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let state = CorrelationState::from_ref(state);
        let query = parts
            .uri
            .query()
            .and_then(|q| serde_urlencoded::from_str::<QueryToken>(q).ok())
            .and_then(|q| q.token);
        let token = match query {
            Some(token) => Some(token),
            None => AccessTokenExtractor::from_request_parts(parts, &())
                .await
                .ok()
                .map(|token| token.as_ref().to_owned()),
        };
        let Some(token) = token else {
            return Ok(Self(None));
        };
        // Authentication remains the route's responsibility. Public webhooks and
        // non-Macro credentials may share the listener; only a verified Macro
        // JWT can introduce attribution, never an unsigned header or claim.
        let Ok(JwtToken::MacroApiToken(token)) =
            macro_auth::middleware::decode_jwt::handler(&state.jwt, &token)
        else {
            return Ok(Self(None));
        };
        let Some(id) = token.agent_correlation_id else {
            return Ok(Self(None));
        };
        let correlation = validate(state.repository.as_ref(), id, token.agent_id)
            .await
            .map_err(CorrelationRejection)?;
        tracing::info!(agent_correlation_id = %id, agent_session_id = %correlation.session_id, "accepted agent attribution");
        Ok(Self(Some(id)))
    }
}

/// A client-safe attribution failure, separate from authorization failures.
#[derive(Debug)]
pub struct CorrelationRejection(CorrelationError);

impl IntoResponse for CorrelationRejection {
    fn into_response(self) -> Response {
        #[derive(Serialize)]
        struct ErrorBody {
            message: String,
        }
        let status = match &self.0 {
            CorrelationError::MissingAgent => StatusCode::BAD_REQUEST,
            CorrelationError::NotFound => StatusCode::NOT_FOUND,
            CorrelationError::AgentMismatch => StatusCode::FORBIDDEN,
            CorrelationError::Unavailable(error) => {
                tracing::error!(?error, "agent correlation lookup failed");
                StatusCode::SERVICE_UNAVAILABLE
            }
        };
        (
            status,
            Json(ErrorBody {
                message: self.0.to_string(),
            }),
        )
            .into_response()
    }
}

/// Validate before invoking any handler, then isolate correlation to this request.
pub fn propagate(
    state: State<CorrelationState>,
    request: Request,
    next: Next,
) -> impl Future<Output = Response> + Send {
    propagate_request(state, request, next)
}

async fn propagate_request(
    State(state): State<CorrelationState>,
    request: Request,
    next: Next,
) -> Response {
    let (mut parts, body) = request.into_parts();
    match AgentCorrelationExtractor::from_request_parts(&mut parts, &state).await {
        Ok(AgentCorrelationExtractor(id)) => {
            crate::context::scope(id, next.run(Request::from_parts(parts, body)))
                .instrument(tracing::info_span!(
                    "agent_sdk_request",
                    agent_correlation_id = id.map(|id| id.to_string())
                ))
                .await
        }
        Err(error) => error.into_response(),
    }
}

#[cfg(test)]
mod test;
