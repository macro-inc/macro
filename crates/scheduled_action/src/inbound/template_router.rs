use std::sync::Arc;

use axum::extract::{FromRef, Path, State, rejection::JsonRejection};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{post, put};
use axum::{Json, Router};
use entity_access::domain::models::OwnerAccessLevel;
use entity_access::domain::ports::EntityAccessService;
use entity_access::inbound::axum_extractors::ScheduledActionAccessExtractor;
use entity_registry::{CreationPrincipalExtractor, NonUserOwners};
use macro_authorization::{
    MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState, UserOrInternal,
};
use macro_uuid::Uuid;

use crate::domain::models::CreateScheduledAction;
use crate::domain::ports::RoutineTemplateService;
use crate::domain::templates::{RoutineTemplate, ShareRoutineTemplate};
use crate::inbound::axum_router::{ScheduledActionApiError, ScheduledActionResponse};

pub struct RoutineTemplateRouterState<T, Svc, Auth> {
    pub service: Arc<T>,
    pub access_service: Arc<Svc>,
    pub authorization_state: MacroAuthorizationState<Auth>,
}

impl<T, Svc, Auth> Clone for RoutineTemplateRouterState<T, Svc, Auth> {
    fn clone(&self) -> Self {
        Self {
            service: Arc::clone(&self.service),
            access_service: Arc::clone(&self.access_service),
            authorization_state: self.authorization_state.clone(),
        }
    }
}

impl<T, Svc, Auth> FromRef<RoutineTemplateRouterState<T, Svc, Auth>> for Arc<Svc> {
    fn from_ref(state: &RoutineTemplateRouterState<T, Svc, Auth>) -> Self {
        Arc::clone(&state.access_service)
    }
}

impl<T, Svc, Auth> FromRef<RoutineTemplateRouterState<T, Svc, Auth>>
    for MacroAuthorizationState<Auth>
{
    fn from_ref(state: &RoutineTemplateRouterState<T, Svc, Auth>) -> Self {
        state.authorization_state.clone()
    }
}

/// Let the domain apply the rollout to the creation principal; a team bot
/// without an acting user has no enabled user rollout.
impl<T, Svc, Auth> FromRef<RoutineTemplateRouterState<T, Svc, Auth>> for NonUserOwners {
    fn from_ref(_state: &RoutineTemplateRouterState<T, Svc, Auth>) -> Self {
        NonUserOwners::Enabled
    }
}

pub fn routine_template_router<T, Svc, Auth, St>(
    state: RoutineTemplateRouterState<T, Svc, Auth>,
) -> Router<St>
where
    T: RoutineTemplateService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
    St: Send + Sync,
{
    Router::new()
        .route(
            "/scheduled-actions/{id}/template",
            put(share_template::<T, Svc, Auth>)
                .get(get_template::<T, Svc, Auth>)
                .delete(unshare_template::<T, Svc, Auth>),
        )
        .route(
            "/scheduled-actions/{id}/template/activate",
            post(activate_template::<T, Svc, Auth>),
        )
        .with_state(state)
}

#[utoipa::path(
    put,
    path = "/scheduled-actions/{id}/template",
    tag = "scheduled actions",
    operation_id = "share_scheduled_action_template",
    params(("id" = String, Path, description = "ID of the routine to share")),
    request_body = ShareRoutineTemplate,
    responses(
        (status = 200, body = RoutineTemplate),
        (status = 400, body = String),
        (status = 401, body = String),
        (status = 404, body = String),
        (status = 500, body = String),
    )
)]
pub async fn share_template<T, Svc, Auth>(
    State(state): State<RoutineTemplateRouterState<T, Svc, Auth>>,
    ScheduledActionAccessExtractor {
        entity_access_receipt,
        ..
    }: ScheduledActionAccessExtractor<OwnerAccessLevel, Svc, Auth>,
    body: Result<Json<ShareRoutineTemplate>, JsonRejection>,
) -> Result<Json<RoutineTemplate>, ScheduledActionApiError>
where
    T: RoutineTemplateService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    let Json(req) = body.map_err(ScheduledActionApiError::InvalidRequest)?;
    let template = state
        .service
        .share_template(entity_access_receipt, req)
        .await?;
    Ok(Json(template))
}

#[utoipa::path(
    delete,
    path = "/scheduled-actions/{id}/template",
    tag = "scheduled actions",
    operation_id = "unshare_scheduled_action_template",
    params(("id" = String, Path, description = "ID of the shared routine")),
    responses(
        (status = 204),
        (status = 401, body = String),
        (status = 404, body = String),
        (status = 500, body = String),
    )
)]
pub async fn unshare_template<T, Svc, Auth>(
    State(state): State<RoutineTemplateRouterState<T, Svc, Auth>>,
    ScheduledActionAccessExtractor {
        entity_access_receipt,
        ..
    }: ScheduledActionAccessExtractor<OwnerAccessLevel, Svc, Auth>,
) -> Result<StatusCode, ScheduledActionApiError>
where
    T: RoutineTemplateService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    state
        .service
        .unshare_template(entity_access_receipt)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(
    get,
    path = "/scheduled-actions/{id}/template",
    tag = "scheduled actions",
    operation_id = "get_scheduled_action_template",
    params(("id" = String, Path, description = "ID of the shared routine")),
    responses(
        (status = 200, body = RoutineTemplate),
        (status = 401, body = String),
        (status = 404, body = String, description = "The routine is not shared"),
        (status = 500, body = String),
    )
)]
pub async fn get_template<T, Svc, Auth>(
    State(state): State<RoutineTemplateRouterState<T, Svc, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Path(id): Path<Uuid>,
) -> Result<Json<RoutineTemplate>, ScheduledActionApiError>
where
    T: RoutineTemplateService,
    Auth: MacroAuthorizationService,
{
    Ok(Json(
        state
            .service
            .get_template(&user.authorization.user.macro_user_id, id)
            .await?,
    ))
}

#[utoipa::path(
    post,
    path = "/scheduled-actions/{id}/template/activate",
    tag = "scheduled actions",
    operation_id = "activate_scheduled_action_template",
    params(("id" = String, Path, description = "ID of the shared routine")),
    request_body = CreateScheduledAction,
    responses(
        (status = 201, body = ScheduledActionResponse),
        (status = 400, body = String),
        (status = 401, body = String),
        (status = 403, body = String),
        (status = 404, body = String, description = "The routine is not shared"),
        (status = 500, body = String),
    )
)]
pub async fn activate_template<T, Svc, Auth>(
    State(state): State<RoutineTemplateRouterState<T, Svc, Auth>>,
    Path(id): Path<Uuid>,
    CreationPrincipalExtractor { principal, .. }: CreationPrincipalExtractor<Auth>,
    body: Result<Json<CreateScheduledAction>, JsonRejection>,
) -> Result<impl IntoResponse, ScheduledActionApiError>
where
    T: RoutineTemplateService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    let Json(req) = body.map_err(ScheduledActionApiError::InvalidRequest)?;
    let created = state.service.activate_template(&principal, id, req).await?;
    Ok((
        StatusCode::CREATED,
        Json(ScheduledActionResponse::from(created)),
    ))
}
