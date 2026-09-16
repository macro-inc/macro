//! Authenticated dictation endpoint, available on every plan.
use super::{ApiContext, context::AuthorizationService};
use axum::{
    Json, Router,
    body::Bytes,
    extract::{DefaultBodyLimit, Query, State},
    http::{HeaderMap, StatusCode, header::CONTENT_TYPE},
    response::{IntoResponse, Response},
    routing::post,
};
use dictation::domain::{AudioFormat, DictationError, MAX_AUDIO_BYTES, Recording};
use macro_authorization::{MacroAuthorizationExtractor, UserOnly};
use serde::{Deserialize, Serialize};

pub fn router() -> Router<ApiContext> {
    Router::new()
        .route("/transcribe", post(transcribe))
        .layer(DefaultBodyLimit::max(MAX_AUDIO_BYTES))
}

#[derive(Deserialize)]
pub struct TranscribeQuery {
    language: Option<String>,
}

#[derive(Serialize, utoipa::ToSchema)]
pub struct TranscribeResponse {
    text: String,
}

/// Transcribe a transient recording with OpenAI Whisper. Does not consume chat credits.
#[utoipa::path(post, path = "/dictation/transcribe", tag = "dictation",
    request_body(content = Vec<u8>, content_type = "audio/webm"),
    responses((status = 200, body = TranscribeResponse), (status = 400), (status = 401), (status = 413), (status = 429), (status = 502)))]
pub async fn transcribe(
    _user: MacroAuthorizationExtractor<AuthorizationService, UserOnly>,
    State(state): State<ApiContext>,
    Query(query): Query<TranscribeQuery>,
    headers: HeaderMap,
    bytes: Bytes,
) -> Result<Json<TranscribeResponse>, TranscribeError> {
    let format = AudioFormat::from_content_type(
        headers
            .get(CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .unwrap_or_default(),
    )?;
    let text = state
        .dictation_service
        .transcribe(Recording {
            bytes: bytes.to_vec(),
            format,
            language: query.language,
        })
        .await?;
    Ok(Json(TranscribeResponse { text }))
}

pub struct TranscribeError(DictationError);
impl From<DictationError> for TranscribeError {
    fn from(error: DictationError) -> Self {
        Self(error)
    }
}
impl IntoResponse for TranscribeError {
    fn into_response(self) -> Response {
        let status = match self.0 {
            DictationError::InvalidSize | DictationError::InvalidLanguage => {
                StatusCode::BAD_REQUEST
            }
            DictationError::UnsupportedAudio => StatusCode::UNSUPPORTED_MEDIA_TYPE,
            DictationError::Busy => StatusCode::TOO_MANY_REQUESTS,
            DictationError::Provider => StatusCode::BAD_GATEWAY,
        };
        (
            status,
            Json(serde_json::json!({ "message": self.0.to_string() })),
        )
            .into_response()
    }
}
