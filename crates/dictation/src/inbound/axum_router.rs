//! Authenticated HTTP endpoint for dictation.
//!
//! The adapter only extracts identity, syntax-validates the request, and maps
//! domain errors to status codes. Recording validation and provider policy live
//! in the domain service.

use crate::domain::{DictationError, DictationService, LanguageHint, MAX_AUDIO_BYTES, Transcript};
use axum::{
    Json, RequestPartsExt, Router,
    body::Bytes,
    extract::{DefaultBodyLimit, FromRef, FromRequestParts, Query, State},
    http::{StatusCode, header},
    response::{IntoResponse, Response},
    routing::post,
};
use axum_extra::extract::Cached;
use macro_authorization::{
    MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState, UserOnly,
};
use model_error_response::ErrorResponse;
use rate_limit::{
    RateLimitConfig, RateLimitKey, RateLimitResult, RateLimitService,
    domain::models::RateLimitOk,
    inbound::{RateLimitExtractable, RateLimitExtractor},
};
use rootcause::Report;
use serde::{Deserialize, Serialize};
use std::{sync::Arc, time::Duration};

/// Authenticated attempts per hour, including provider failures and retries.
const PER_USER_TRANSCRIPTIONS_PER_HOUR: u64 = 60;

/// State for the dictation router.
pub struct DictationRouterState<S, R, Auth> {
    service: Arc<S>,
    rate_limiter: R,
    authorization_state: MacroAuthorizationState<Auth>,
}

impl<S, R: Clone, Auth> Clone for DictationRouterState<S, R, Auth> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            rate_limiter: self.rate_limiter.clone(),
            authorization_state: self.authorization_state.clone(),
        }
    }
}

impl<S: DictationService, R: RateLimitService + Clone, Auth> DictationRouterState<S, R, Auth> {
    /// Create dictation router state.
    pub fn new(
        service: S,
        rate_limiter: R,
        authorization_state: MacroAuthorizationState<Auth>,
    ) -> Self {
        Self {
            service: Arc::new(service),
            rate_limiter,
            authorization_state,
        }
    }
}

impl<S, R, Auth> FromRef<DictationRouterState<S, R, Auth>> for Arc<S> {
    fn from_ref(state: &DictationRouterState<S, R, Auth>) -> Self {
        state.service.clone()
    }
}

impl<S, R, Auth> FromRef<DictationRouterState<S, R, Auth>> for MacroAuthorizationState<Auth> {
    fn from_ref(state: &DictationRouterState<S, R, Auth>) -> Self {
        state.authorization_state.clone()
    }
}

impl<S, R, Auth> RateLimitService for DictationRouterState<S, R, Auth>
where
    S: Send + Sync + 'static,
    R: RateLimitService,
    Auth: MacroAuthorizationService,
{
    async fn check_rate_limit(
        &self,
        key: RateLimitKey,
        config: RateLimitConfig,
    ) -> Result<RateLimitResult, Report> {
        let limit = config.max_count;
        let window_seconds = config.window.as_secs();
        let result = self.rate_limiter.check_rate_limit(key, config).await?;
        if result.is_err() {
            tracing::warn!(limit, window_seconds, "dictation rate limit exceeded");
        }
        Ok(result)
    }

    async fn rollback_ticket(&self, ticket: RateLimitOk) -> Result<(), Report> {
        self.rate_limiter.rollback_ticket(ticket).await
    }
}

/// Per-user transcription rate limit. Only signed-in users may dictate; bots,
/// harnesses, and internal callers are rejected by the `UserOnly` policy.
pub struct PerUserDictationRateLimit<Auth>(MacroAuthorizationExtractor<Auth, UserOnly>);

impl<S, Auth> RateLimitExtractable<S> for PerUserDictationRateLimit<Auth>
where
    S: Send + Sync + 'static,
    Auth: MacroAuthorizationService,
    MacroAuthorizationState<Auth>: FromRef<S>,
{
    fn config() -> RateLimitConfig {
        RateLimitConfig {
            max_count: PER_USER_TRANSCRIPTIONS_PER_HOUR,
            window: Duration::from_secs(3600),
        }
    }

    fn key(&self) -> RateLimitKey {
        RateLimitKey::builder(&"per-user-dictation")
            .append(&self.0.authorization.macro_user_id.as_ref())
            .finish()
    }
}

impl<S, Auth> FromRequestParts<S> for PerUserDictationRateLimit<Auth>
where
    S: Send + Sync + 'static,
    Auth: MacroAuthorizationService,
    MacroAuthorizationState<Auth>: FromRef<S>,
{
    type Rejection = Response;

    async fn from_request_parts(
        parts: &mut axum::http::request::Parts,
        state: &S,
    ) -> Result<Self, Self::Rejection> {
        let Cached(authorization): Cached<MacroAuthorizationExtractor<Auth, UserOnly>> = parts
            .extract_with_state(state)
            .await
            .map_err(IntoResponse::into_response)?;
        // This runs before the body is buffered and before rate-limit rejection.
        tracing::Span::current().record(
            "user_id",
            authorization.authorization.macro_user_id.as_ref(),
        );
        Ok(Self(authorization))
    }
}

/// Create the dictation router. Mount under `/dictation`.
pub fn dictation_router<S, R, Auth, T>(state: DictationRouterState<S, R, Auth>) -> Router<T>
where
    S: DictationService,
    R: RateLimitService + Clone,
    Auth: MacroAuthorizationService,
    T: Send + Sync + 'static,
{
    Router::new()
        .route("/transcribe", post(transcribe_handler::<S, R, Auth>))
        .layer(DefaultBodyLimit::max(MAX_AUDIO_BYTES))
        .layer(axum::middleware::from_fn(trace_request))
        .with_state(state)
}

/// Covers extractor failures as well as the handler, under the shared HTTP span.
#[tracing::instrument(name = "dictation.request", skip_all, fields(
    user_id = tracing::field::Empty,
    http.response.status_code = tracing::field::Empty,
))]
async fn trace_request(request: axum::extract::Request, next: axum::middleware::Next) -> Response {
    let response = next.run(request).await;
    tracing::Span::current().record("http.response.status_code", response.status().as_u16());
    response
}

/// Query parameters for transcription.
#[derive(Debug, Deserialize)]
pub struct TranscribeQuery {
    /// Optional ISO 639-1 recognition hint.
    pub language: Option<String>,
}

/// Transcription result.
#[derive(Debug, Serialize, Deserialize, utoipa::ToSchema)]
pub struct TranscribeResponse {
    /// Recognized text.
    pub text: String,
}

impl From<Transcript> for TranscribeResponse {
    fn from(transcript: Transcript) -> Self {
        Self {
            text: transcript.text,
        }
    }
}

/// OpenAPI representation of the raw encoded audio body extracted as `Bytes`.
#[derive(utoipa::ToSchema)]
#[schema(value_type = String, format = Binary)]
pub struct EncodedAudioBody(
    /// Browser-encoded audio bytes.
    pub Vec<u8>,
);

/// Transcribe a transient recording with OpenAI Whisper.
///
/// Available to every signed-in user on every plan; does not consume chat
/// credits. Audio and transcripts are never persisted.
#[utoipa::path(
    post,
    tag = "dictation",
    operation_id = "transcribe_dictation",
    path = "/dictation/transcribe",
    params(("language" = Option<String>, Query, description = "ISO 639-1 language hint")),
    request_body(content = inline(EncodedAudioBody), content_type = "audio/webm", description = "Encoded WebM, MP4, Ogg, or WAV audio up to 8 MiB and five minutes"),
    responses(
        (status = 200, body = TranscribeResponse),
        (status = 400, description = "Empty, oversized, or malformed request", body = ErrorResponse),
        (status = 401, description = "Missing or invalid credentials", body = ErrorResponse),
        (status = 403, description = "Only signed-in users may dictate", body = ErrorResponse),
        (status = 413, description = "Body exceeds 8 MiB"),
        (status = 415, description = "Unsupported audio container", body = ErrorResponse),
        (status = 429, description = "Per-user hourly rate limit exceeded"),
        (status = 502, description = "Provider failure", body = ErrorResponse),
        (status = 503, description = "Transcription capacity exhausted; retry after the Retry-After delay", body = ErrorResponse),
    )
)]
pub async fn transcribe_handler<S, R, Auth>(
    Cached(user): Cached<MacroAuthorizationExtractor<Auth, UserOnly>>,
    _limit: RateLimitExtractor<PerUserDictationRateLimit<Auth>, DictationRouterState<S, R, Auth>>,
    State(service): State<Arc<S>>,
    Query(query): Query<TranscribeQuery>,
    audio: Bytes,
) -> Result<Json<TranscribeResponse>, DictationError>
where
    S: DictationService,
    R: RateLimitService + Clone,
    Auth: MacroAuthorizationService,
{
    let language = query
        .language
        .as_deref()
        .map(str::parse::<LanguageHint>)
        .transpose()
        .inspect_err(|error| tracing::warn!(error = ?error, "invalid dictation language hint"))?;
    let transcript = service
        .transcribe(user.authorization.macro_user_id, audio, language)
        .await?;
    Ok(Json(transcript.into()))
}

impl IntoResponse for DictationError {
    fn into_response(self) -> Response {
        let status = match self {
            Self::InvalidSize | Self::InvalidLanguage | Self::InvalidAudio | Self::TooLong => {
                StatusCode::BAD_REQUEST
            }
            Self::UnsupportedAudio => StatusCode::UNSUPPORTED_MEDIA_TYPE,
            Self::Busy => StatusCode::SERVICE_UNAVAILABLE,
            Self::Provider => StatusCode::BAD_GATEWAY,
        };
        let mut response = (
            status,
            Json(ErrorResponse {
                message: self.to_string().into(),
            }),
        )
            .into_response();
        if matches!(self, Self::Busy) {
            response
                .headers_mut()
                .insert(header::RETRY_AFTER, header::HeaderValue::from_static("1"));
        }
        response
    }
}

#[cfg(test)]
mod test;
