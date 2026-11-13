//! HTTP routes for dashboards, nested at `/dashboards`.

use std::sync::Arc;

use axum::{
    Json, Router,
    extract::{FromRef, Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, patch, post, put},
};
use macro_authorization::{
    MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState, UserOrInternal,
};
use macro_user_id::user_id::MacroUserIdStr;
use model_error_response::ErrorResponse;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::domain::{
    models::{
        Dashboard, DashboardError, DashboardId, DashboardSummary, DashboardVersion,
        DashboardVersionSummary, Version,
    },
    ports::DashboardService,
};

/// Router state for dashboard routes.
pub struct DashboardRouterState<S, Auth> {
    service: Arc<S>,
    authorization_state: MacroAuthorizationState<Auth>,
}

impl<S, Auth> Clone for DashboardRouterState<S, Auth> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            authorization_state: self.authorization_state.clone(),
        }
    }
}

impl<S, Auth> DashboardRouterState<S, Auth> {
    /// Router state over a shared service and the authorization state.
    pub fn new(service: Arc<S>, authorization_state: MacroAuthorizationState<Auth>) -> Self {
        Self {
            service,
            authorization_state,
        }
    }
}

impl<S, Auth> FromRef<DashboardRouterState<S, Auth>> for MacroAuthorizationState<Auth> {
    fn from_ref(state: &DashboardRouterState<S, Auth>) -> Self {
        state.authorization_state.clone()
    }
}

type Caller<Auth> = MacroAuthorizationExtractor<Auth, UserOrInternal>;

fn actor<Auth: MacroAuthorizationService>(caller: &Caller<Auth>) -> &MacroUserIdStr<'static> {
    &caller.authorization.user.macro_user_id
}

/// The dashboard router, to nest at `/dashboards`.
pub fn dashboards_router<S, Auth, T>(state: DashboardRouterState<S, Auth>) -> Router<T>
where
    S: DashboardService,
    Auth: MacroAuthorizationService,
    T: Send + Sync + 'static,
{
    Router::new()
        .route(
            "/",
            get(list_dashboards_handler::<S, Auth>).post(create_dashboard_handler::<S, Auth>),
        )
        .route(
            "/home",
            put(set_home_dashboard_handler::<S, Auth>)
                .delete(clear_home_dashboard_handler::<S, Auth>),
        )
        .route(
            "/home/{user_id}",
            get(get_home_dashboard_handler::<S, Auth>),
        )
        .route(
            "/{id}",
            get(get_dashboard_handler::<S, Auth>)
                .put(update_dashboard_handler::<S, Auth>)
                .delete(delete_dashboard_handler::<S, Auth>),
        )
        .route(
            "/{id}/panes/{pane_id}",
            patch(patch_dashboard_pane_handler::<S, Auth>),
        )
        .route(
            "/{id}/versions",
            get(list_dashboard_versions_handler::<S, Auth>),
        )
        .route(
            "/{id}/versions/{number}",
            get(get_dashboard_version_handler::<S, Auth>),
        )
        .route(
            "/{id}/versions/{number}/revert",
            post(revert_dashboard_handler::<S, Auth>),
        )
        .with_state(state)
}

/// A new dashboard.
#[derive(Debug, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateDashboardBody {
    /// A dynamic-UI view, in the format of the PresentView schema; widgets may
    /// carry a stable `id` so they can be patched later.
    #[schema(value_type = Object)]
    pub view: serde_json::Value,
}

/// A whole new view.
#[derive(Debug, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateDashboardBody {
    /// The view.
    #[schema(value_type = Object)]
    pub view: serde_json::Value,
    /// Refuse the save when the current version is no longer this one.
    #[serde(default)]
    #[schema(value_type = Option<u32>)]
    pub expected_version: Option<Version>,
}

/// One pane's new widget.
#[derive(Debug, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PatchDashboardPaneBody {
    /// The widget replacing the pane; give it the pane's id to keep the pane
    /// addressable.
    #[schema(value_type = Object)]
    pub widget: serde_json::Value,
    /// Refuse the save when the current version is no longer this one.
    #[serde(default)]
    #[schema(value_type = Option<u32>)]
    pub expected_version: Option<Version>,
}

/// The caller's new home dashboard.
#[derive(Debug, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SetHomeDashboardBody {
    /// A dashboard the caller can edit.
    pub dashboard_id: DashboardId,
}

/// The caller's dashboards.
#[derive(Debug, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct DashboardList {
    /// Most recently saved first.
    pub dashboards: Vec<DashboardSummary>,
}

/// A dashboard's history.
#[derive(Debug, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct DashboardVersionList {
    /// Newest first, at most 100.
    pub versions: Vec<DashboardVersionSummary>,
}

/// Path parameters addressing a dashboard.
#[derive(Debug, Deserialize, utoipa::IntoParams)]
#[into_params(parameter_in = Path)]
pub struct DashboardParams {
    /// Dashboard id.
    pub id: Uuid,
}

/// Path parameters addressing a pane.
#[derive(Debug, Deserialize, utoipa::IntoParams)]
#[into_params(parameter_in = Path)]
pub struct DashboardPaneParams {
    /// Dashboard id.
    pub id: Uuid,
    /// The pane's widget id.
    pub pane_id: String,
}

/// Path parameters addressing a version. Not named `version`: document
/// storage's API-version middleware reads any path parameter by that name.
#[derive(Debug, Deserialize, utoipa::IntoParams)]
#[into_params(parameter_in = Path)]
pub struct DashboardVersionParams {
    /// Dashboard id.
    pub id: Uuid,
    /// Version number.
    pub number: u32,
}

/// Path parameters addressing an account's home dashboard.
#[derive(Debug, Deserialize, utoipa::IntoParams)]
#[into_params(parameter_in = Path)]
pub struct HomeDashboardParams {
    /// The account (`macro|...`).
    pub user_id: String,
}

/// Save a view as a new dashboard the caller owns.
#[utoipa::path(
    post,
    tag = "dashboards",
    operation_id = "create_dashboard",
    path = "/dashboards",
    request_body = CreateDashboardBody,
    responses(
        (status = 200, body = Dashboard),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn create_dashboard_handler<S, Auth>(
    State(state): State<DashboardRouterState<S, Auth>>,
    caller: Caller<Auth>,
    Json(body): Json<CreateDashboardBody>,
) -> Result<Json<Dashboard>, DashboardError>
where
    S: DashboardService,
    Auth: MacroAuthorizationService,
{
    Ok(Json(state.service.create(actor(&caller), body.view).await?))
}

/// List the dashboards the caller owns.
#[utoipa::path(
    get,
    tag = "dashboards",
    operation_id = "list_dashboards",
    path = "/dashboards",
    responses(
        (status = 200, body = DashboardList),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn list_dashboards_handler<S, Auth>(
    State(state): State<DashboardRouterState<S, Auth>>,
    caller: Caller<Auth>,
) -> Result<Json<DashboardList>, DashboardError>
where
    S: DashboardService,
    Auth: MacroAuthorizationService,
{
    let dashboards = state.service.list(actor(&caller)).await?;
    Ok(Json(DashboardList { dashboards }))
}

/// Read a dashboard.
#[utoipa::path(
    get,
    tag = "dashboards",
    operation_id = "get_dashboard",
    path = "/dashboards/{id}",
    params(DashboardParams),
    responses(
        (status = 200, body = Dashboard),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn get_dashboard_handler<S, Auth>(
    State(state): State<DashboardRouterState<S, Auth>>,
    caller: Caller<Auth>,
    Path(params): Path<DashboardParams>,
) -> Result<Json<Dashboard>, DashboardError>
where
    S: DashboardService,
    Auth: MacroAuthorizationService,
{
    Ok(Json(
        state
            .service
            .get(actor(&caller), DashboardId(params.id))
            .await?,
    ))
}

/// Replace a dashboard's view, as a new version.
#[utoipa::path(
    put,
    tag = "dashboards",
    operation_id = "update_dashboard",
    path = "/dashboards/{id}",
    params(DashboardParams),
    request_body = UpdateDashboardBody,
    responses(
        (status = 200, body = Dashboard),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 403, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 409, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn update_dashboard_handler<S, Auth>(
    State(state): State<DashboardRouterState<S, Auth>>,
    caller: Caller<Auth>,
    Path(params): Path<DashboardParams>,
    Json(body): Json<UpdateDashboardBody>,
) -> Result<Json<Dashboard>, DashboardError>
where
    S: DashboardService,
    Auth: MacroAuthorizationService,
{
    Ok(Json(
        state
            .service
            .update(
                actor(&caller),
                DashboardId(params.id),
                body.view,
                body.expected_version,
            )
            .await?,
    ))
}

/// Replace one pane's widget, as a new version.
#[utoipa::path(
    patch,
    tag = "dashboards",
    operation_id = "patch_dashboard_pane",
    path = "/dashboards/{id}/panes/{pane_id}",
    params(DashboardPaneParams),
    request_body = PatchDashboardPaneBody,
    responses(
        (status = 200, body = Dashboard),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 403, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 409, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn patch_dashboard_pane_handler<S, Auth>(
    State(state): State<DashboardRouterState<S, Auth>>,
    caller: Caller<Auth>,
    Path(params): Path<DashboardPaneParams>,
    Json(body): Json<PatchDashboardPaneBody>,
) -> Result<Json<Dashboard>, DashboardError>
where
    S: DashboardService,
    Auth: MacroAuthorizationService,
{
    Ok(Json(
        state
            .service
            .patch_pane(
                actor(&caller),
                DashboardId(params.id),
                params.pane_id,
                body.widget,
                body.expected_version,
            )
            .await?,
    ))
}

/// Delete a dashboard the caller owns.
#[utoipa::path(
    delete,
    tag = "dashboards",
    operation_id = "delete_dashboard",
    path = "/dashboards/{id}",
    params(DashboardParams),
    responses(
        (status = 204),
        (status = 401, body = ErrorResponse),
        (status = 403, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn delete_dashboard_handler<S, Auth>(
    State(state): State<DashboardRouterState<S, Auth>>,
    caller: Caller<Auth>,
    Path(params): Path<DashboardParams>,
) -> Result<StatusCode, DashboardError>
where
    S: DashboardService,
    Auth: MacroAuthorizationService,
{
    state
        .service
        .delete(actor(&caller), DashboardId(params.id))
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

/// List a dashboard's versions, newest first.
#[utoipa::path(
    get,
    tag = "dashboards",
    operation_id = "list_dashboard_versions",
    path = "/dashboards/{id}/versions",
    params(DashboardParams),
    responses(
        (status = 200, body = DashboardVersionList),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn list_dashboard_versions_handler<S, Auth>(
    State(state): State<DashboardRouterState<S, Auth>>,
    caller: Caller<Auth>,
    Path(params): Path<DashboardParams>,
) -> Result<Json<DashboardVersionList>, DashboardError>
where
    S: DashboardService,
    Auth: MacroAuthorizationService,
{
    let versions = state
        .service
        .versions(actor(&caller), DashboardId(params.id))
        .await?;
    Ok(Json(DashboardVersionList { versions }))
}

/// Read one version with its view.
#[utoipa::path(
    get,
    tag = "dashboards",
    operation_id = "get_dashboard_version",
    path = "/dashboards/{id}/versions/{number}",
    params(DashboardVersionParams),
    responses(
        (status = 200, body = DashboardVersion),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn get_dashboard_version_handler<S, Auth>(
    State(state): State<DashboardRouterState<S, Auth>>,
    caller: Caller<Auth>,
    Path(params): Path<DashboardVersionParams>,
) -> Result<Json<DashboardVersion>, DashboardError>
where
    S: DashboardService,
    Auth: MacroAuthorizationService,
{
    Ok(Json(
        state
            .service
            .version(
                actor(&caller),
                DashboardId(params.id),
                Version(params.number),
            )
            .await?,
    ))
}

/// Save an earlier version's view as the newest version.
#[utoipa::path(
    post,
    tag = "dashboards",
    operation_id = "revert_dashboard",
    path = "/dashboards/{id}/versions/{number}/revert",
    params(DashboardVersionParams),
    responses(
        (status = 200, body = Dashboard),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 403, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 409, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn revert_dashboard_handler<S, Auth>(
    State(state): State<DashboardRouterState<S, Auth>>,
    caller: Caller<Auth>,
    Path(params): Path<DashboardVersionParams>,
) -> Result<Json<Dashboard>, DashboardError>
where
    S: DashboardService,
    Auth: MacroAuthorizationService,
{
    Ok(Json(
        state
            .service
            .revert(
                actor(&caller),
                DashboardId(params.id),
                Version(params.number),
            )
            .await?,
    ))
}

/// Make a dashboard the caller can edit the caller's home dashboard: what
/// people see on the account's page.
#[utoipa::path(
    put,
    tag = "dashboards",
    operation_id = "set_home_dashboard",
    path = "/dashboards/home",
    request_body = SetHomeDashboardBody,
    responses(
        (status = 204),
        (status = 401, body = ErrorResponse),
        (status = 403, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn set_home_dashboard_handler<S, Auth>(
    State(state): State<DashboardRouterState<S, Auth>>,
    caller: Caller<Auth>,
    Json(body): Json<SetHomeDashboardBody>,
) -> Result<StatusCode, DashboardError>
where
    S: DashboardService,
    Auth: MacroAuthorizationService,
{
    state
        .service
        .set_home(actor(&caller), body.dashboard_id)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Clear the caller's home dashboard.
#[utoipa::path(
    delete,
    tag = "dashboards",
    operation_id = "clear_home_dashboard",
    path = "/dashboards/home",
    responses(
        (status = 204),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn clear_home_dashboard_handler<S, Auth>(
    State(state): State<DashboardRouterState<S, Auth>>,
    caller: Caller<Auth>,
) -> Result<StatusCode, DashboardError>
where
    S: DashboardService,
    Auth: MacroAuthorizationService,
{
    state.service.clear_home(actor(&caller)).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Read an account's home dashboard, when the caller can read it.
#[utoipa::path(
    get,
    tag = "dashboards",
    operation_id = "get_home_dashboard",
    path = "/dashboards/home/{user_id}",
    params(HomeDashboardParams),
    responses(
        (status = 200, body = Dashboard),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn get_home_dashboard_handler<S, Auth>(
    State(state): State<DashboardRouterState<S, Auth>>,
    caller: Caller<Auth>,
    Path(params): Path<HomeDashboardParams>,
) -> Result<Json<Dashboard>, DashboardError>
where
    S: DashboardService,
    Auth: MacroAuthorizationService,
{
    let user = MacroUserIdStr::try_from(params.user_id)
        .map_err(|_| DashboardError::Invalid("Not a Macro user id.".to_owned()))?;
    Ok(Json(state.service.home(actor(&caller), &user).await?))
}

impl IntoResponse for DashboardError {
    fn into_response(self) -> axum::response::Response {
        let status_code = match &self {
            DashboardError::NotFound => StatusCode::NOT_FOUND,
            DashboardError::Forbidden(_) => StatusCode::FORBIDDEN,
            DashboardError::Invalid(_) => StatusCode::BAD_REQUEST,
            DashboardError::Conflict(_) => StatusCode::CONFLICT,
            DashboardError::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };

        let message = match &self {
            DashboardError::Internal(_) => {
                tracing::error!(error = ?self, "dashboard internal server error");
                "internal server error".to_owned()
            }
            error => error.to_string(),
        };

        (
            status_code,
            Json(ErrorResponse {
                message: message.into(),
            }),
        )
            .into_response()
    }
}
