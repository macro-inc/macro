//! Transport adapter for the read-only Home inference use case.
use super::context::{ApiContext, DcsAuthorizationService};
use axum::{
    Json,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use macro_authorization::{MacroAuthorizationExtractor, UserOrInternal};
use universal_input::domain::{
    ClassifyInputRequest, ClassifyInputResponse, ExtractInputRequest, ExtractInputResponse,
    InputError,
};

pub struct InputApiError(InputError);

impl From<InputError> for InputApiError {
    fn from(error: InputError) -> Self {
        Self(error)
    }
}

impl IntoResponse for InputApiError {
    fn into_response(self) -> Response {
        let status = match &self.0 {
            InputError::InvalidText | InputError::InvalidTimeZone => StatusCode::BAD_REQUEST,
            InputError::Unavailable | InputError::Extraction => StatusCode::SERVICE_UNAVAILABLE,
            InputError::Admission(error) => return (*error).into_response(),
        };
        (
            status,
            Json(serde_json::json!({"error": self.0.to_string()})),
        )
            .into_response()
    }
}

#[utoipa::path(post, path = "/universal-input/classify", request_body = ClassifyInputRequest,
    responses((status = 200, body = ClassifyInputResponse), (status = 400, description = "Invalid input"), (status = 401, description = "Unauthenticated"), (status = 402, description = "AI allowance exhausted"), (status = 503, description = "Detection unavailable")))]
pub async fn classify(
    State(state): State<ApiContext>,
    user: MacroAuthorizationExtractor<DcsAuthorizationService, UserOrInternal>,
    Json(input): Json<ClassifyInputRequest>,
) -> Result<Json<ClassifyInputResponse>, InputApiError> {
    Ok(Json(
        state
            .universal_input
            .classify(user.authorization.user.macro_user_id, input)
            .await?,
    ))
}

#[utoipa::path(post, path = "/universal-input/extract", request_body = ExtractInputRequest,
    responses((status = 200, body = ExtractInputResponse), (status = 400, description = "Invalid input"), (status = 401, description = "Unauthenticated"), (status = 402, description = "AI allowance exhausted"), (status = 503, description = "Extraction unavailable")))]
pub async fn extract(
    State(state): State<ApiContext>,
    user: MacroAuthorizationExtractor<DcsAuthorizationService, UserOrInternal>,
    Json(input): Json<ExtractInputRequest>,
) -> Result<Json<ExtractInputResponse>, InputApiError> {
    Ok(Json(
        state
            .universal_input
            .extract(user.authorization.user.macro_user_id, input)
            .await?,
    ))
}
