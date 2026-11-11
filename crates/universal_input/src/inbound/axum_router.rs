//! Transport adapter for the read-only Command K inference use case.
use crate::domain::{
    ClassifyInputRequest, ClassifyInputResponse, ExtractInputRequest, ExtractInputResponse,
    FieldExtractor, InputError, UniversalInputService,
    temporal::thread_due_date::{
        ThreadDueDateRequest, ThreadDueDateResponse, ThreadDueDateService, ThreadFactExtractor,
    },
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
    InternalOnly, MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState,
    UserOrInternal,
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

/// Internal due date state; concrete extraction is composed by the host.
pub struct ThreadDueDateRouterState<E, A> {
    service: Arc<ThreadDueDateService<E>>,
    authorization: MacroAuthorizationState<A>,
}

impl<E, A> Clone for ThreadDueDateRouterState<E, A> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            authorization: self.authorization.clone(),
        }
    }
}

impl<E, A> ThreadDueDateRouterState<E, A> {
    /// Attach the domain use case and the host's existing authorization service.
    pub fn new(
        service: Arc<ThreadDueDateService<E>>,
        authorization: MacroAuthorizationState<A>,
    ) -> Self {
        Self {
            service,
            authorization,
        }
    }
}

impl<E, A> FromRef<ThreadDueDateRouterState<E, A>> for MacroAuthorizationState<A> {
    fn from_ref(state: &ThreadDueDateRouterState<E, A>) -> Self {
        state.authorization.clone()
    }
}

/// Build the internal due date route to mount under `/universal_input`. It meters
/// as background Focus usage, which no allowance pays for, so only services reach it.
pub fn thread_due_date_router<E, A>(state: ThreadDueDateRouterState<E, A>) -> Router
where
    E: ThreadFactExtractor + 'static,
    A: MacroAuthorizationService,
{
    Router::new()
        .route("/thread-due-date", post(thread_due_date::<E, A>))
        .with_state(state)
}

/// Read a thread's due date for the acting user who owns it.
async fn thread_due_date<E, A>(
    State(state): State<ThreadDueDateRouterState<E, A>>,
    internal: MacroAuthorizationExtractor<A, InternalOnly>,
    Json(input): Json<ThreadDueDateRequest>,
) -> Result<Json<ThreadDueDateResponse>, Response>
where
    E: ThreadFactExtractor,
    A: MacroAuthorizationService,
{
    let Some(owner) = internal.authorization.acting_user else {
        // Usage is the owner's: never guess whom to meter it against.
        return Err(StatusCode::BAD_REQUEST.into_response());
    };
    let response = state
        .service
        .due_date(owner.macro_user_id, input)
        .await
        .map_err(|error| InputApiError::from(error).into_response())?;
    Ok(Json(response))
}

#[cfg(test)]
mod test;
