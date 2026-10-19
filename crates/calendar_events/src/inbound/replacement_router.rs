//! Transport DTOs for the domain-owned confirmed replacement workflow.
use super::mutation_router::CalendarMutationApiError;
use crate::domain::replacement::{CalendarReplacementService, CalendarReplacementView};
use axum::{
    Json, Router,
    extract::{FromRef, Path, Query, State},
    http::StatusCode,
    routing::{get, post},
};
use macro_authorization::{
    MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState, UserOrInternal,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use uuid::Uuid;

/// Shared replacement use case and authentication boundary.
pub struct CalendarReplacementRouterState<S, Auth> {
    service: Arc<S>,
    authorization_state: MacroAuthorizationState<Auth>,
}
impl<S, Auth> Clone for CalendarReplacementRouterState<S, Auth> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            authorization_state: self.authorization_state.clone(),
        }
    }
}
impl<S, Auth> CalendarReplacementRouterState<S, Auth> {
    /// Compose the domain service with authentication at the application root.
    pub fn new(service: Arc<S>, authorization_state: MacroAuthorizationState<Auth>) -> Self {
        Self {
            service,
            authorization_state,
        }
    }
}
impl<S, Auth> FromRef<CalendarReplacementRouterState<S, Auth>> for MacroAuthorizationState<Auth> {
    fn from_ref(state: &CalendarReplacementRouterState<S, Auth>) -> Self {
        state.authorization_state.clone()
    }
}
/// Routes used by preview, confirmation, and recovery UI.
pub fn calendar_replacement_router<
    S: CalendarReplacementService,
    Auth: MacroAuthorizationService,
    T: Send + Sync + 'static,
>(
    state: CalendarReplacementRouterState<S, Auth>,
) -> Router<T> {
    Router::new()
        .route(
            "/events/{event_id}/replacement",
            post(prepare_calendar_replacement::<S, Auth>),
        )
        .route(
            "/events/{event_id}/provider-url",
            get(calendar_event_provider_url::<S, Auth>),
        )
        .route(
            "/replacements/{operation_id}",
            get(calendar_replacement_status::<S, Auth>)
                .delete(discard_calendar_replacement::<S, Auth>),
        )
        .route(
            "/replacements/{operation_id}/confirm",
            post(confirm_calendar_replacement::<S, Auth>),
        )
        .with_state(state)
}
/// Address the calendar copy and optional occurrence.
#[derive(Deserialize, utoipa::ToSchema, utoipa::IntoParams)]
#[serde(rename_all = "camelCase")]
pub struct CalendarProviderEventQuery {
    /// Exact calendar copy; defaults to the canonical copy.
    pub calendar_id: Option<Uuid>,
    /// Original-start key of one occurrence; omitted for the entire series.
    pub recurrence_id: Option<String>,
}
/// A read-only preview request. Confirmation uses the returned operation identity.
#[derive(Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PrepareCalendarReplacementRequest {
    /// Exact calendar copy; defaults to canonical.
    pub calendar_id: Option<Uuid>,
    /// Original-start key; omitted to replace the entire series.
    pub recurrence_id: Option<String>,
    /// Omit the provider conference in the replacement.
    pub remove_conference: bool,
}
/// Provider-validated external event link.
#[derive(Serialize, utoipa::ToSchema)]
pub struct CalendarEventProviderUrl {
    /// None when the event no longer exists at its provider.
    pub url: Option<String>,
}
/// Read and persist an organizer-only preview, without sending invitations.
#[utoipa::path(post,path="/events/{event_id}/replacement",tag="calendar_events",
    params(("event_id"=Uuid,Path)),request_body=PrepareCalendarReplacementRequest,
    responses((status=200,body=CalendarReplacementView),(status=409,body=CalendarMutationApiError)))]
pub async fn prepare_calendar_replacement<
    S: CalendarReplacementService,
    Auth: MacroAuthorizationService,
>(
    State(state): State<CalendarReplacementRouterState<S, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Path(event_id): Path<Uuid>,
    Json(request): Json<PrepareCalendarReplacementRequest>,
) -> Result<Json<CalendarReplacementView>, CalendarMutationApiError> {
    Ok(Json(
        state
            .service
            .prepare_replacement(
                user.authorization.user.macro_user_id.as_ref(),
                event_id,
                request.calendar_id,
                request.recurrence_id,
                request.remove_conference,
            )
            .await?,
    ))
}
/// Explicitly confirm the saved preview, or resume the same confirmed operation.
#[utoipa::path(post,path="/replacements/{operation_id}/confirm",tag="calendar_events",
    params(("operation_id"=Uuid,Path)),responses((status=200,body=CalendarReplacementView),(status=409,body=CalendarMutationApiError)))]
pub async fn confirm_calendar_replacement<
    S: CalendarReplacementService,
    Auth: MacroAuthorizationService,
>(
    State(state): State<CalendarReplacementRouterState<S, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Path(id): Path<Uuid>,
) -> Result<Json<CalendarReplacementView>, CalendarMutationApiError> {
    Ok(Json(
        state
            .service
            .confirm_replacement(user.authorization.user.macro_user_id.as_ref(), id)
            .await?,
    ))
}
/// Read saved progress without performing a provider mutation.
#[utoipa::path(get,path="/replacements/{operation_id}",tag="calendar_events",
    params(("operation_id"=Uuid,Path)),responses((status=200,body=CalendarReplacementView),(status=404,body=CalendarMutationApiError)))]
pub async fn calendar_replacement_status<
    S: CalendarReplacementService,
    Auth: MacroAuthorizationService,
>(
    State(state): State<CalendarReplacementRouterState<S, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Path(id): Path<Uuid>,
) -> Result<Json<CalendarReplacementView>, CalendarMutationApiError> {
    Ok(Json(
        state
            .service
            .replacement_status(user.authorization.user.macro_user_id.as_ref(), id)
            .await?,
    ))
}
/// Discard a preview only if no confirmation has been recorded.
#[utoipa::path(delete,path="/replacements/{operation_id}",tag="calendar_events",
    params(("operation_id"=Uuid,Path)),responses((status=204),(status=409,body=CalendarMutationApiError)))]
pub async fn discard_calendar_replacement<
    S: CalendarReplacementService,
    Auth: MacroAuthorizationService,
>(
    State(state): State<CalendarReplacementRouterState<S, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, CalendarMutationApiError> {
    state
        .service
        .discard_replacement(user.authorization.user.macro_user_id.as_ref(), id)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}
/// Resolve an authorized event's provider link for Outlook-only actions.
#[utoipa::path(get,path="/events/{event_id}/provider-url",tag="calendar_events",
    params(("event_id"=Uuid,Path),CalendarProviderEventQuery),
    responses((status=200,body=CalendarEventProviderUrl),(status=404,body=CalendarMutationApiError)))]
pub async fn calendar_event_provider_url<
    S: CalendarReplacementService,
    Auth: MacroAuthorizationService,
>(
    State(state): State<CalendarReplacementRouterState<S, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Path(event_id): Path<Uuid>,
    Query(request): Query<CalendarProviderEventQuery>,
) -> Result<Json<CalendarEventProviderUrl>, CalendarMutationApiError> {
    Ok(Json(CalendarEventProviderUrl {
        url: state
            .service
            .event_provider_url(
                user.authorization.user.macro_user_id.as_ref(),
                event_id,
                request.calendar_id,
                request.recurrence_id,
            )
            .await?,
    }))
}
