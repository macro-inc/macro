//! Phones registering for, listing and reporting their owner's place crossings.

use std::sync::Arc;

use axum::extract::{FromRef, Path, State, rejection::JsonRejection};
use axum::http::{HeaderMap, StatusCode, header::AUTHORIZATION};
use axum::response::IntoResponse;
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use lazy_regex::regex_captures;
use macro_authorization::{
    MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState, UserOnly,
};
use macro_uuid::Uuid;

use crate::domain::location::{
    DeviceToken, FenceList, LocationError, LocationReport, LocationReportOutcome,
    LocationRoutineService, RegisteredDevice,
};
use crate::inbound::axum_router::ScheduledActionApiError;

pub struct LocationRouterState<L, Auth> {
    pub service: Arc<L>,
    pub authorization_state: MacroAuthorizationState<Auth>,
}

impl<L, Auth> Clone for LocationRouterState<L, Auth> {
    fn clone(&self) -> Self {
        Self {
            service: Arc::clone(&self.service),
            authorization_state: self.authorization_state.clone(),
        }
    }
}

impl<L, Auth> FromRef<LocationRouterState<L, Auth>> for MacroAuthorizationState<Auth> {
    fn from_ref(state: &LocationRouterState<L, Auth>) -> Self {
        state.authorization_state.clone()
    }
}

pub fn location_router<L, Auth, St>(state: LocationRouterState<L, Auth>) -> Router<St>
where
    L: LocationRoutineService,
    Auth: MacroAuthorizationService,
    St: Send + Sync,
{
    Router::new()
        .route(
            "/scheduled-actions/location/devices",
            post(register_device::<L, Auth>),
        )
        .route(
            "/scheduled-actions/location/devices/{device_id}",
            delete(remove_device::<L, Auth>),
        )
        .route(
            "/scheduled-actions/location/fences",
            get(list_fences::<L, Auth>),
        )
        .route(
            "/scheduled-actions/location/reports",
            post(report_crossing::<L, Auth>),
        )
        .with_state(state)
}

#[utoipa::path(
    post,
    path = "/scheduled-actions/location/devices",
    tag = "scheduled actions",
    operation_id = "register_location_device",
    responses(
        (status = 201, body = RegisteredDevice, description = "The phone's token, shown only here"),
        (status = 401, body = String),
        (status = 500, body = String),
    )
)]
pub(crate) async fn register_device<L, Auth>(
    State(state): State<LocationRouterState<L, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOnly>,
) -> Result<impl IntoResponse, ScheduledActionApiError>
where
    L: LocationRoutineService,
    Auth: MacroAuthorizationService,
{
    let device = state
        .service
        .register_device(&user.authorization.macro_user_id)
        .await?;
    Ok((StatusCode::CREATED, Json(device)))
}

#[utoipa::path(
    delete,
    path = "/scheduled-actions/location/devices/{device_id}",
    tag = "scheduled actions",
    operation_id = "remove_location_device",
    params(("device_id" = String, Path, description = "The phone to stop reporting")),
    responses(
        (status = 204),
        (status = 401, body = String),
        (status = 404, body = String),
        (status = 500, body = String),
    )
)]
pub(crate) async fn remove_device<L, Auth>(
    State(state): State<LocationRouterState<L, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOnly>,
    Path(device_id): Path<Uuid>,
) -> Result<StatusCode, ScheduledActionApiError>
where
    L: LocationRoutineService,
    Auth: MacroAuthorizationService,
{
    state
        .service
        .remove_device(&user.authorization.macro_user_id, device_id)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(
    get,
    path = "/scheduled-actions/location/fences",
    tag = "scheduled actions",
    operation_id = "list_location_fences",
    responses(
        (status = 200, body = FenceList, description = "The places the caller's enabled routines watch"),
        (status = 401, body = String),
        (status = 500, body = String),
    )
)]
pub(crate) async fn list_fences<L, Auth>(
    State(state): State<LocationRouterState<L, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOnly>,
) -> Result<Json<FenceList>, ScheduledActionApiError>
where
    L: LocationRoutineService,
    Auth: MacroAuthorizationService,
{
    Ok(Json(
        state
            .service
            .fences(&user.authorization.macro_user_id)
            .await?,
    ))
}

/// Authorized by the phone's device token (`Authorization: Bearer mloc_…`),
/// not a session: the phone reports from the background, without the app.
#[utoipa::path(
    post,
    path = "/scheduled-actions/location/reports",
    tag = "scheduled actions",
    operation_id = "report_location_crossing",
    request_body = LocationReport,
    responses(
        (status = 202, body = LocationReportOutcome),
        (status = 400, body = String),
        (status = 401, body = String, description = "Unknown device token: the phone should forget it"),
        (status = 404, body = String, description = "Unknown fence: the phone should stop watching it"),
        (status = 500, body = String),
    )
)]
pub(crate) async fn report_crossing<L, Auth>(
    State(state): State<LocationRouterState<L, Auth>>,
    headers: HeaderMap,
    body: Result<Json<LocationReport>, JsonRejection>,
) -> Result<impl IntoResponse, ScheduledActionApiError>
where
    L: LocationRoutineService,
    Auth: MacroAuthorizationService,
{
    let token = headers
        .get(AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| regex_captures!(r"^Bearer (\S+)$", value))
        .and_then(|(_, token)| DeviceToken::parse(token))
        .ok_or(anyhow::Error::from(LocationError::UnknownDevice))?;
    let Json(report) = body.map_err(ScheduledActionApiError::InvalidRequest)?;
    let outcome = state.service.report(token, report).await?;
    Ok((StatusCode::ACCEPTED, Json(outcome)))
}
