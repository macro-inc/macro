use axum::{
    Json,
    http::{StatusCode, header::RETRY_AFTER},
    response::{IntoResponse, Response},
};
use email::domain::draft_attachments::AttachmentError;
use model::response::ErrorResponse;

#[derive(Debug, thiserror::Error)]
#[error(transparent)]
pub struct AttachmentApiError(#[from] pub AttachmentError);
impl IntoResponse for AttachmentApiError {
    fn into_response(self) -> Response {
        if matches!(self.0, AttachmentError::ContentTooLarge) {
            return (
                StatusCode::PAYLOAD_TOO_LARGE,
                Json(crate::api::email::provider_error::ContentTooLargeResponse::default()),
            )
                .into_response();
        }
        let status = match &self.0 {
            AttachmentError::ContentTooLarge => StatusCode::PAYLOAD_TOO_LARGE,
            AttachmentError::NotFound => StatusCode::NOT_FOUND,
            AttachmentError::Forbidden => StatusCode::FORBIDDEN,
            AttachmentError::DeliveryConflict => StatusCode::CONFLICT,
            AttachmentError::Invalid(_) => StatusCode::BAD_REQUEST,
            AttachmentError::Reauthorization => StatusCode::CONFLICT,
            AttachmentError::RateLimited => StatusCode::TOO_MANY_REQUESTS,
            AttachmentError::Infrastructure | AttachmentError::Contended => {
                StatusCode::SERVICE_UNAVAILABLE
            }
        };
        let body = Json(ErrorResponse {
            message: self.to_string().into(),
        });
        // A 409 here means the draft changed under its approval, so a busy
        // inbox answers 503 and says when to retry instead.
        if matches!(self.0, AttachmentError::Contended) {
            return (status, [(RETRY_AFTER, "5")], body).into_response();
        }
        (status, body).into_response()
    }
}

#[cfg(test)]
mod test;
