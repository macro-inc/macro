use axum::{
    Json,
    extract::{Request, State},
    http::StatusCode,
    middleware::Next,
    response::{IntoResponse, Response},
};
use model::response::ErrorResponse;

/// Whether the legacy comment tables still accept writes through this service.
#[derive(Debug, Clone, Copy)]
pub struct LegacyCommentWrites {
    pub enabled: bool,
}

/// Shown to clients that still write through the legacy comment endpoints
/// while the final import into the shared message store runs.
pub const DISABLED_MESSAGE: &str = "Document comments are read-only while they move to the new message store. Refresh the app in a few minutes and try again.";

/// Answers 503 for legacy comment writes once the operator has frozen them.
pub async fn handler(
    State(switch): State<LegacyCommentWrites>,
    request: Request,
    next: Next,
) -> Response {
    if switch.enabled {
        return next.run(request).await;
    }
    (
        StatusCode::SERVICE_UNAVAILABLE,
        Json(ErrorResponse {
            message: DISABLED_MESSAGE.into(),
        }),
    )
        .into_response()
}

#[cfg(test)]
mod test;
