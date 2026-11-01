//! The authenticated sequences API, nested at `/email/sequences`.

use std::sync::Arc;

use axum::{
    Json, Router,
    extract::{FromRef, Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
};
use macro_authorization::{
    MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState, UserOnly,
};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::domain::{
    models::{
        ContactEnrollment, EnrollResult, EnrollmentAction, EnrollmentDetail, EnrollmentSummary,
        Sequence, SequenceError, SequenceSummary,
    },
    ports::{NewSequence, SequencesApi},
    render::Problem,
    service::{EnrollRequest, SequencePatch},
};

/// Router state: the service and authorization.
pub struct SequencesRouterState<Api, Auth> {
    service: Arc<Api>,
    authorization_state: MacroAuthorizationState<Auth>,
}

impl<Api, Auth> Clone for SequencesRouterState<Api, Auth> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            authorization_state: self.authorization_state.clone(),
        }
    }
}

impl<Api, Auth> SequencesRouterState<Api, Auth> {
    /// Router state over a shared service.
    pub fn new(service: Arc<Api>, authorization_state: MacroAuthorizationState<Auth>) -> Self {
        Self {
            service,
            authorization_state,
        }
    }
}

impl<Api, Auth> FromRef<SequencesRouterState<Api, Auth>> for MacroAuthorizationState<Auth> {
    fn from_ref(state: &SequencesRouterState<Api, Auth>) -> Self {
        state.authorization_state.clone()
    }
}

/// The owner's sequences.
#[derive(Debug, Serialize, ToSchema)]
pub struct ListSequencesResponse {
    /// Most recently changed first.
    pub sequences: Vec<SequenceSummary>,
}

/// A sequence with its enrollments.
#[derive(Debug, Serialize, ToSchema)]
pub struct SequenceDetailResponse {
    /// The sequence.
    pub sequence: Sequence,
    /// Its enrollments, newest first.
    pub enrollments: Vec<EnrollmentSummary>,
}

/// What enrolling each contact did.
#[derive(Debug, Serialize, ToSchema)]
pub struct EnrollResponse {
    /// One result per requested contact.
    pub results: Vec<EnrollResult>,
}

/// An owner action on an enrollment.
#[derive(Debug, Deserialize, ToSchema)]
pub struct EnrollmentActionRequest {
    /// What to do.
    pub action: EnrollmentAction,
}

/// A CRM person's enrollments across the team.
#[derive(Debug, Serialize, ToSchema)]
pub struct ContactEnrollmentsResponse {
    /// Newest first.
    pub enrollments: Vec<ContactEnrollment>,
}

/// What went wrong, for the client to show.
#[derive(Debug, Clone, Copy, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum SequenceErrorCode {
    /// No such sequence, enrollment or contact for the caller.
    NotFound,
    /// The sequence changed since the caller read it.
    VersionConflict,
    /// The status change isn't allowed.
    InvalidTransition,
    /// The sequence is invalid; see `problem`.
    InvalidSequence,
    /// Contacts can only join an active sequence.
    SequenceNotActive,
    /// Too many contacts in one request.
    TooManyContacts,
    /// The start time isn't usable.
    InvalidStart,
    /// The time zone isn't an IANA zone.
    InvalidTimezone,
    /// The action doesn't apply to the enrollment's status.
    ActionUnavailable,
    /// A step is being delivered; try again shortly.
    StepInDelivery,
    /// The caller isn't in a team.
    NoTeam,
    /// The team has CRM turned off.
    CrmDisabled,
    /// Something else failed.
    Internal,
}

/// An error response.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SequenceErrorResponse {
    /// Machine-readable code.
    pub code: SequenceErrorCode,
    /// Developer-facing message.
    pub message: String,
    /// For `invalid_sequence`: what is wrong.
    pub problem: Option<Problem>,
    /// For `invalid_sequence`: the 1-based step.
    pub position: Option<usize>,
    /// For `unknown_token`: the tokens.
    pub tokens: Vec<String>,
}

impl IntoResponse for SequenceError {
    fn into_response(self) -> Response {
        let (status, code) = match &self {
            SequenceError::NotFound => (StatusCode::NOT_FOUND, SequenceErrorCode::NotFound),
            SequenceError::VersionConflict => {
                (StatusCode::CONFLICT, SequenceErrorCode::VersionConflict)
            }
            SequenceError::InvalidTransition => {
                (StatusCode::CONFLICT, SequenceErrorCode::InvalidTransition)
            }
            SequenceError::Invalid(_) => {
                (StatusCode::BAD_REQUEST, SequenceErrorCode::InvalidSequence)
            }
            SequenceError::SequenceNotActive => {
                (StatusCode::CONFLICT, SequenceErrorCode::SequenceNotActive)
            }
            SequenceError::TooManyContacts => {
                (StatusCode::BAD_REQUEST, SequenceErrorCode::TooManyContacts)
            }
            SequenceError::InvalidStart => {
                (StatusCode::BAD_REQUEST, SequenceErrorCode::InvalidStart)
            }
            SequenceError::InvalidTimezone => {
                (StatusCode::BAD_REQUEST, SequenceErrorCode::InvalidTimezone)
            }
            SequenceError::ActionUnavailable => {
                (StatusCode::CONFLICT, SequenceErrorCode::ActionUnavailable)
            }
            SequenceError::StepInDelivery => {
                (StatusCode::CONFLICT, SequenceErrorCode::StepInDelivery)
            }
            SequenceError::NoTeam => (StatusCode::FORBIDDEN, SequenceErrorCode::NoTeam),
            SequenceError::CrmDisabled => (StatusCode::FORBIDDEN, SequenceErrorCode::CrmDisabled),
            SequenceError::Internal(_) => {
                tracing::error!(error = ?self, "sequences request failed");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    SequenceErrorCode::Internal,
                )
            }
        };
        let (problem, position, tokens) = match &self {
            SequenceError::Invalid(invalid) => (
                Some(invalid.problem),
                invalid.position,
                invalid.tokens.clone(),
            ),
            _ => (None, None, Vec::new()),
        };
        let message = match &self {
            SequenceError::Internal(_) => "internal server error".to_owned(),
            error => error.to_string(),
        };
        (
            status,
            Json(SequenceErrorResponse {
                code,
                message,
                problem,
                position,
                tokens,
            }),
        )
            .into_response()
    }
}

type Caller<Auth> = MacroAuthorizationExtractor<Auth, UserOnly>;

fn user_id<Auth: MacroAuthorizationService>(caller: &Caller<Auth>) -> &str {
    caller.authorization.macro_user_id.as_ref()
}

/// Build the router; nest it at `/sequences` under the email routes.
pub fn sequences_router<Api, Auth, T>(state: SequencesRouterState<Api, Auth>) -> Router<T>
where
    Api: SequencesApi,
    Auth: MacroAuthorizationService,
    T: Send + Sync + 'static,
{
    Router::new()
        .route(
            "/",
            get(list_sequences::<Api, Auth>).post(create_sequence::<Api, Auth>),
        )
        .route(
            "/{id}",
            get(get_sequence::<Api, Auth>)
                .patch(update_sequence::<Api, Auth>)
                .delete(delete_sequence::<Api, Auth>),
        )
        .route("/{id}/enrollments", post(enroll_contacts::<Api, Auth>))
        .route(
            "/enrollments/{id}",
            get(get_enrollment::<Api, Auth>).patch(update_enrollment::<Api, Auth>),
        )
        .route(
            "/contacts/{crm_contact_id}",
            get(contact_enrollments::<Api, Auth>),
        )
        .with_state(state)
}

/// List the caller's sequences.
#[utoipa::path(get, tag = "sequences", operation_id = "list_sequences", path = "/email/sequences",
    responses((status = 200, body = ListSequencesResponse), (status = 403, body = SequenceErrorResponse)))]
pub async fn list_sequences<Api: SequencesApi, Auth: MacroAuthorizationService>(
    State(state): State<SequencesRouterState<Api, Auth>>,
    caller: Caller<Auth>,
) -> Result<Json<ListSequencesResponse>, SequenceError> {
    Ok(Json(ListSequencesResponse {
        sequences: state.service.list(user_id(&caller)).await?,
    }))
}

/// Create a draft sequence.
#[utoipa::path(post, tag = "sequences", operation_id = "create_sequence", path = "/email/sequences",
    request_body = NewSequence,
    responses((status = 200, body = Sequence), (status = 400, body = SequenceErrorResponse),
              (status = 403, body = SequenceErrorResponse)))]
pub async fn create_sequence<Api: SequencesApi, Auth: MacroAuthorizationService>(
    State(state): State<SequencesRouterState<Api, Auth>>,
    caller: Caller<Auth>,
    Json(input): Json<NewSequence>,
) -> Result<Json<Sequence>, SequenceError> {
    Ok(Json(state.service.create(user_id(&caller), input).await?))
}

/// A sequence with its enrollments.
#[utoipa::path(get, tag = "sequences", operation_id = "get_sequence", path = "/email/sequences/{id}",
    params(("id" = Uuid, Path)),
    responses((status = 200, body = SequenceDetailResponse), (status = 404, body = SequenceErrorResponse)))]
pub async fn get_sequence<Api: SequencesApi, Auth: MacroAuthorizationService>(
    State(state): State<SequencesRouterState<Api, Auth>>,
    caller: Caller<Auth>,
    Path(id): Path<Uuid>,
) -> Result<Json<SequenceDetailResponse>, SequenceError> {
    let (sequence, enrollments) = state.service.get(user_id(&caller), id).await?;
    Ok(Json(SequenceDetailResponse {
        sequence,
        enrollments,
    }))
}

/// Edit a draft or paused sequence, or change its status.
#[utoipa::path(patch, tag = "sequences", operation_id = "update_sequence", path = "/email/sequences/{id}",
    params(("id" = Uuid, Path)), request_body = SequencePatch,
    responses((status = 200, body = Sequence), (status = 400, body = SequenceErrorResponse),
              (status = 404, body = SequenceErrorResponse), (status = 409, body = SequenceErrorResponse)))]
pub async fn update_sequence<Api: SequencesApi, Auth: MacroAuthorizationService>(
    State(state): State<SequencesRouterState<Api, Auth>>,
    caller: Caller<Auth>,
    Path(id): Path<Uuid>,
    Json(patch): Json<SequencePatch>,
) -> Result<Json<Sequence>, SequenceError> {
    Ok(Json(
        state.service.update(user_id(&caller), id, patch).await?,
    ))
}

/// Delete a sequence, withdrawing its unsent steps.
#[utoipa::path(delete, tag = "sequences", operation_id = "delete_sequence", path = "/email/sequences/{id}",
    params(("id" = Uuid, Path)),
    responses((status = 204), (status = 404, body = SequenceErrorResponse)))]
pub async fn delete_sequence<Api: SequencesApi, Auth: MacroAuthorizationService>(
    State(state): State<SequencesRouterState<Api, Auth>>,
    caller: Caller<Auth>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, SequenceError> {
    state.service.delete(user_id(&caller), id).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Enroll CRM people into an active sequence.
#[utoipa::path(post, tag = "sequences", operation_id = "enroll_contacts", path = "/email/sequences/{id}/enrollments",
    params(("id" = Uuid, Path)), request_body = EnrollRequest,
    responses((status = 200, body = EnrollResponse), (status = 400, body = SequenceErrorResponse),
              (status = 404, body = SequenceErrorResponse), (status = 409, body = SequenceErrorResponse)))]
pub async fn enroll_contacts<Api: SequencesApi, Auth: MacroAuthorizationService>(
    State(state): State<SequencesRouterState<Api, Auth>>,
    caller: Caller<Auth>,
    Path(id): Path<Uuid>,
    Json(request): Json<EnrollRequest>,
) -> Result<Json<EnrollResponse>, SequenceError> {
    Ok(Json(EnrollResponse {
        results: state.service.enroll(user_id(&caller), id, request).await?,
    }))
}

/// An enrollment with its rendered steps and what happened to each.
#[utoipa::path(get, tag = "sequences", operation_id = "get_enrollment", path = "/email/sequences/enrollments/{id}",
    params(("id" = Uuid, Path)),
    responses((status = 200, body = EnrollmentDetail), (status = 404, body = SequenceErrorResponse)))]
pub async fn get_enrollment<Api: SequencesApi, Auth: MacroAuthorizationService>(
    State(state): State<SequencesRouterState<Api, Auth>>,
    caller: Caller<Auth>,
    Path(id): Path<Uuid>,
) -> Result<Json<EnrollmentDetail>, SequenceError> {
    Ok(Json(state.service.enrollment(user_id(&caller), id).await?))
}

/// Pause, resume, stop or unsubscribe an enrollment.
#[utoipa::path(patch, tag = "sequences", operation_id = "update_enrollment", path = "/email/sequences/enrollments/{id}",
    params(("id" = Uuid, Path)), request_body = EnrollmentActionRequest,
    responses((status = 200, body = EnrollmentSummary), (status = 404, body = SequenceErrorResponse),
              (status = 409, body = SequenceErrorResponse)))]
pub async fn update_enrollment<Api: SequencesApi, Auth: MacroAuthorizationService>(
    State(state): State<SequencesRouterState<Api, Auth>>,
    caller: Caller<Auth>,
    Path(id): Path<Uuid>,
    Json(request): Json<EnrollmentActionRequest>,
) -> Result<Json<EnrollmentSummary>, SequenceError> {
    Ok(Json(
        state
            .service
            .act(user_id(&caller), id, request.action)
            .await?,
    ))
}

/// A CRM person's enrollments across the team, without step content.
#[utoipa::path(get, tag = "sequences", operation_id = "contact_enrollments", path = "/email/sequences/contacts/{crm_contact_id}",
    params(("crm_contact_id" = Uuid, Path)),
    responses((status = 200, body = ContactEnrollmentsResponse), (status = 404, body = SequenceErrorResponse)))]
pub async fn contact_enrollments<Api: SequencesApi, Auth: MacroAuthorizationService>(
    State(state): State<SequencesRouterState<Api, Auth>>,
    caller: Caller<Auth>,
    Path(crm_contact_id): Path<Uuid>,
) -> Result<Json<ContactEnrollmentsResponse>, SequenceError> {
    Ok(Json(ContactEnrollmentsResponse {
        enrollments: state
            .service
            .contact_enrollments(user_id(&caller), crm_contact_id)
            .await?,
    }))
}
