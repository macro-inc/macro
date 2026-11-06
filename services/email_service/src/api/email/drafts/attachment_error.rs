use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use email::domain::draft_attachments::AttachmentError;
use model::response::ErrorResponse;

#[derive(Debug, thiserror::Error)]
#[error(transparent)]
pub struct AttachmentApiError(#[from] pub AttachmentError);
impl IntoResponse for AttachmentApiError {
    fn into_response(self) -> Response {
        let status = match &self.0 {
            AttachmentError::NotFound => StatusCode::NOT_FOUND,
            AttachmentError::Forbidden => StatusCode::FORBIDDEN,
            AttachmentError::DeliveryConflict => StatusCode::CONFLICT,
            AttachmentError::Invalid(_) => StatusCode::BAD_REQUEST,
            AttachmentError::Reauthorization => StatusCode::CONFLICT,
            AttachmentError::RateLimited => StatusCode::TOO_MANY_REQUESTS,
            AttachmentError::Infrastructure => StatusCode::SERVICE_UNAVAILABLE,
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
