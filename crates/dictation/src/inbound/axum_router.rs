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
    http::StatusCode,
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
    inbound::{RateLimitExtractable, rate_limit_middleware},
};
use rootcause::Report;
use serde::{Deserialize, Serialize};
use std::{sync::Arc, time::Duration};

/// Transcriptions one user may start per hour. Recordings are capped at five
/// minutes, so this bounds provider spend per user at well under $2/hour.
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
        self.rate_limiter.check_rate_limit(key, config).await
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
        .route("/transcribe", post(transcribe_handler::<S, Auth>))
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            rate_limit_middleware::<
                DictationRouterState<S, R, Auth>,
                PerUserDictationRateLimit<Auth>,
                DictationRouterState<S, R, Auth>,
            >,
        ))
        .layer(DefaultBodyLimit::max(MAX_AUDIO_BYTES))
        .with_state(state)
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
    request_body(content = Vec<u8>, content_type = "audio/webm", description = "Encoded WebM, MP4, Ogg, or WAV audio up to 8 MiB"),
    responses(
        (status = 200, body = TranscribeResponse),
        (status = 400, description = "Empty, oversized, or malformed request", body = ErrorResponse),
        (status = 401, description = "Missing or invalid credentials", body = ErrorResponse),
        (status = 403, description = "Only signed-in users may dictate", body = ErrorResponse),
        (status = 413, description = "Body exceeds 8 MiB"),
        (status = 415, description = "Unsupported audio container", body = ErrorResponse),
        (status = 429, description = "Per-user rate limit or provider capacity exceeded"),
        (status = 502, description = "Provider failure", body = ErrorResponse),
    )
)]
pub async fn transcribe_handler<S, Auth>(
    Cached(user): Cached<MacroAuthorizationExtractor<Auth, UserOnly>>,
    State(service): State<Arc<S>>,
    Query(query): Query<TranscribeQuery>,
    audio: Bytes,
) -> Result<Json<TranscribeResponse>, DictationError>
where
    S: DictationService,
    Auth: MacroAuthorizationService,
{
    let language = query
        .language
        .as_deref()
        .map(str::parse::<LanguageHint>)
        .transpose()?;
    let transcript = service
        .transcribe(user.authorization.macro_user_id, audio, language)
        .await?;
    Ok(Json(transcript.into()))
}

impl IntoResponse for DictationError {
    fn into_response(self) -> Response {
        let status = match self {
            Self::InvalidSize | Self::InvalidLanguage => StatusCode::BAD_REQUEST,
            Self::UnsupportedAudio => StatusCode::UNSUPPORTED_MEDIA_TYPE,
            Self::Busy => StatusCode::TOO_MANY_REQUESTS,
            Self::Provider => StatusCode::BAD_GATEWAY,
        };
        (
            status,
            Json(ErrorResponse {
                message: self.to_string().into(),
            }),
        )
            .into_response()
    }
}

#[cfg(test)]
mod test;
