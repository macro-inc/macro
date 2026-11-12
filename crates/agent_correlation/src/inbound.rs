//! Optional attribution extraction and request-scoped propagation.

use crate::{
    context::Attribution,
    domain::{CorrelationError, CorrelationRepository, validate},
};
use axum::{
    Json,
    extract::{FromRef, FromRequestParts, Request, State},
    http::{StatusCode, request::Parts},
    middleware::Next,
    response::{IntoResponse, Response},
};
use macro_auth::{
    headers::AccessTokenExtractor,
    macro_api_token::MacroApiToken,
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

/// Optional signed invocation attribution. It grants no authorization.
pub struct AgentCorrelationExtractor(pub Option<Uuid>, pub Option<crate::AgentVerb>);

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
        let token = verified_api_token(parts, &state.jwt).await;
        let id = accept_correlation(&state, token.as_ref()).await?;
        Ok(Self(id, id.and_then(|_| sdk_verb(parts))))
    }
}

/// The request's Macro API token, only if its signature verifies.
async fn verified_api_token(parts: &mut Parts, jwt: &JwtValidationArgs) -> Option<MacroApiToken> {
    let query = parts
        .uri
        .query()
        .and_then(|q| serde_urlencoded::from_str::<QueryToken>(q).ok())
        .and_then(|q| q.token);
    let token = match query {
        Some(token) => token,
        None => AccessTokenExtractor::from_request_parts(parts, &())
            .await
            .ok()?
            .as_ref()
            .to_owned(),
    };
    // Authentication remains the route's responsibility. Public webhooks and
    // non-Macro credentials may share the listener; only a verified Macro
    // JWT can introduce attribution, never an unsigned header or claim.
    match macro_auth::middleware::decode_jwt::handler(jwt, &token) {
        Ok(JwtToken::MacroApiToken(token)) => Some(token),
        _ => None,
    }
}

/// The SDK's display verb. Callers read it only after the correlation that
/// makes it meaningful has been validated; an unknown value is absent.
fn sdk_verb(parts: &Parts) -> Option<crate::AgentVerb> {
    parts
        .headers
        .get("x-macro-sdk-verb")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse().ok())
}

/// Validate the token's correlation claim against its agent session.
async fn accept_correlation(
    state: &CorrelationState,
    token: Option<&MacroApiToken>,
) -> Result<Option<Uuid>, CorrelationRejection> {
    let Some((id, agent)) =
        token.and_then(|token| Some((token.agent_correlation_id?, token.agent_id)))
    else {
        return Ok(None);
    };
    let correlation = validate(state.repository.as_ref(), id, agent)
        .await
        .map_err(CorrelationRejection)?;
    tracing::info!(agent_correlation_id = %id, agent_session_id = %correlation.session_id, "accepted agent attribution");
    Ok(Some(id))
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

/// Validate before invoking any handler, then isolate attribution to this request:
/// the code-mode correlation and the signed routine a request acts for.
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
    let token = verified_api_token(&mut parts, &state.jwt).await;
    let correlation_id = match accept_correlation(&state, token.as_ref()).await {
        Ok(id) => id,
        Err(error) => return error.into_response(),
    };
    // The routine claim needs no lookup: the token's signature is its authority.
    let attribution = Attribution {
        correlation_id,
        routine_id: token.as_ref().and_then(|token| token.routine_id),
        channel_mention_id: token.as_ref().and_then(|token| token.channel_mention_id),
        verb: correlation_id.and_then(|_| sdk_verb(&parts)),
    };
    crate::context::scope_attribution(attribution, next.run(Request::from_parts(parts, body)))
        .instrument(tracing::info_span!(
            "agent_sdk_request",
            agent_correlation_id = correlation_id.map(|id| id.to_string()),
            routine_id = attribution.routine_id.map(|id| id.to_string()),
            channel_mention_id = attribution.channel_mention_id.map(|id| id.to_string()),
        ))
        .await
}

#[cfg(test)]
mod test;
