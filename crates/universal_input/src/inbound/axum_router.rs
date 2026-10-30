//! Transport adapter for the read-only Command K inference use case.
use crate::domain::{
    ClassifyInputRequest, ClassifyInputResponse, ExtractInputRequest, ExtractInputResponse,
    FieldExtractor, InputError, UniversalInputService,
};
use axum::{
    Json, Router,
    extract::{FromRef, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::post,
};
use jev::domain::YesNoClassifier;
use macro_authorization::{
    MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState, UserOrInternal,
};
use std::sync::Arc;

/// Authenticated inference state; concrete providers are composed by the host.
pub struct UniversalInputRouterState<C, E, A> {
    service: Arc<UniversalInputService<C, E>>,
    authorization: MacroAuthorizationState<A>,
}

impl<C, E, A> Clone for UniversalInputRouterState<C, E, A> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            authorization: self.authorization.clone(),
        }
    }
}

impl<C, E, A> UniversalInputRouterState<C, E, A> {
    /// Attach domain inference and the host's existing authorization service.
    pub fn new(
        service: Arc<UniversalInputService<C, E>>,
        authorization: MacroAuthorizationState<A>,
    ) -> Self {
        Self {
            service,
            authorization,
        }
    }
}

impl<C, E, A> FromRef<UniversalInputRouterState<C, E, A>> for MacroAuthorizationState<A> {
    fn from_ref(state: &UniversalInputRouterState<C, E, A>) -> Self {
        state.authorization.clone()
    }
}

/// Build authenticated inference routes to mount under `/universal_input`.
pub fn axum_router<C, E, A>(state: UniversalInputRouterState<C, E, A>) -> Router
where
    C: YesNoClassifier + 'static,
    E: FieldExtractor + 'static,
    A: MacroAuthorizationService,
{
    Router::new()
        .route("/classify", post(classify::<C, E, A>))
        .route("/extract", post(extract::<C, E, A>))
        .with_state(state)
}

/// Transport mapping for domain inference failures.
pub struct InputApiError(InputError);

impl From<InputError> for InputApiError {
    fn from(error: InputError) -> Self {
        Self(error)
    }
}

impl IntoResponse for InputApiError {
    fn into_response(self) -> Response {
        let status = match &self.0 {
            InputError::InvalidText
            | InputError::InvalidTimeZone
            | InputError::InvalidProperties => StatusCode::BAD_REQUEST,
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

#[utoipa::path(post, path = "/universal_input/classify", request_body = ClassifyInputRequest,
    responses((status = 200, body = ClassifyInputResponse), (status = 400, description = "Invalid input"), (status = 401, description = "Unauthenticated"), (status = 402, description = "AI allowance exhausted"), (status = 503, description = "Detection unavailable")))]
/// Classify a draft for the authenticated user.
pub async fn classify<C, E, A>(
    State(state): State<UniversalInputRouterState<C, E, A>>,
    user: MacroAuthorizationExtractor<A, UserOrInternal>,
    Json(input): Json<ClassifyInputRequest>,
) -> Result<Json<ClassifyInputResponse>, InputApiError>
where
    C: YesNoClassifier,
    E: FieldExtractor,
    A: MacroAuthorizationService,
{
    Ok(Json(
        state
            .service
            .classify(user.authorization.user.macro_user_id, input)
            .await?,
    ))
}

#[utoipa::path(post, path = "/universal_input/extract", request_body = ExtractInputRequest,
    responses((status = 200, body = ExtractInputResponse), (status = 400, description = "Invalid input"), (status = 401, description = "Unauthenticated"), (status = 402, description = "AI allowance exhausted"), (status = 503, description = "Extraction unavailable")))]
/// Extract editable fields for the authenticated user.
pub async fn extract<C, E, A>(
    State(state): State<UniversalInputRouterState<C, E, A>>,
    user: MacroAuthorizationExtractor<A, UserOrInternal>,
    Json(input): Json<ExtractInputRequest>,
) -> Result<Json<ExtractInputResponse>, InputApiError>
where
    C: YesNoClassifier,
    E: FieldExtractor,
    A: MacroAuthorizationService,
{
    Ok(Json(
        state
            .service
            .extract(user.authorization.user.macro_user_id, input)
            .await?,
    ))
}

#[cfg(test)]
mod test;
