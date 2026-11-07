use axum::{
    body::Body,
    http::{Response, StatusCode},
};

use model::response::GenericResponse;

/// Generic wrapper for error responses in middleware
pub fn error_handler(message: &str, status_code: StatusCode) -> Response<Body> {
    GenericResponse::builder()
        .is_error(true)
        .message(message)
        .send(status_code)
}
