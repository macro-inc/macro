//! Authenticated task-template REST adapter.
use crate::{
    api::{ApiContext, context::AuthorizationService},
    service::task_templates::service,
};
use axum::{
    Json, Router,
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::get,
};
use macro_authorization::{MacroAuthorizationExtractor, UserOrInternal};
use model::response::ErrorResponse;
use serde::Deserialize;
use task_templates::domain::{
    CreateTaskTemplateRequest, Error, TaskTemplate, UpdateTaskTemplateRequest,
};
use utoipa::ToSchema;
use uuid::Uuid;

pub fn router() -> Router<ApiContext> {
    Router::new()
        .route("/", get(list_task_templates).post(create_task_template))
        .route(
            "/{id}",
            get(get_task_template)
                .put(update_task_template)
                .delete(delete_task_template),
        )
}

#[derive(Debug, thiserror::Error)]
#[error(transparent)]
pub struct ApiError(#[from] Error);
impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let status = match &self.0 {
            Error::NotFound => StatusCode::NOT_FOUND,
            Error::Forbidden => StatusCode::FORBIDDEN,
            Error::Conflict => StatusCode::CONFLICT,
            Error::Invalid => StatusCode::BAD_REQUEST,
            Error::Internal(_) => {
                tracing::error!(error = %self.0, "task template operation failed");
                StatusCode::INTERNAL_SERVER_ERROR
            }
        };
        (
            status,
            Json(ErrorResponse {
                message: self.0.to_string().into(),
            }),
        )
            .into_response()
    }
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListTaskTemplatesQuery {
    pub team_id: Option<Uuid>,
}

#[derive(Deserialize, ToSchema)]
pub struct DeleteTaskTemplateQuery {
    pub revision: i64,
}

#[utoipa::path(get, path = "/task_templates", tag = "task_templates", params(("teamId" = Option<Uuid>, Query)), responses((status = 200, body = Vec<TaskTemplate>), (status = 403, body = ErrorResponse)))]
#[tracing::instrument(skip_all, err)]
pub async fn list_task_templates(
    State(ctx): State<ApiContext>,
    user: MacroAuthorizationExtractor<AuthorizationService, UserOrInternal>,
    Query(query): Query<ListTaskTemplatesQuery>,
) -> Result<Json<Vec<TaskTemplate>>, ApiError> {
    Ok(Json(
        service(ctx.db.clone())
            .list(
                user.authorization.user.macro_user_id.as_ref(),
                query.team_id,
            )
            .await?,
    ))
}

#[utoipa::path(get, path = "/task_templates/{id}", tag = "task_templates", params(("id" = Uuid, Path)), responses((status = 200, body = TaskTemplate), (status = 404, body = ErrorResponse)))]
#[tracing::instrument(skip_all, fields(template_id = %id), err)]
pub async fn get_task_template(
    State(ctx): State<ApiContext>,
    user: MacroAuthorizationExtractor<AuthorizationService, UserOrInternal>,
    Path(id): Path<Uuid>,
) -> Result<Json<TaskTemplate>, ApiError> {
    Ok(Json(
        service(ctx.db.clone())
            .get(user.authorization.user.macro_user_id.as_ref(), id)
            .await?,
    ))
}

#[utoipa::path(post, path = "/task_templates", tag = "task_templates", request_body = CreateTaskTemplateRequest, responses((status = 201, body = TaskTemplate), (status = 400, body = ErrorResponse), (status = 403, body = ErrorResponse), (status = 409, body = ErrorResponse)))]
#[tracing::instrument(skip_all, err)]
pub async fn create_task_template(
    State(ctx): State<ApiContext>,
    user: MacroAuthorizationExtractor<AuthorizationService, UserOrInternal>,
    Json(input): Json<CreateTaskTemplateRequest>,
) -> Result<(StatusCode, Json<TaskTemplate>), ApiError> {
    Ok((
        StatusCode::CREATED,
        Json(
            service(ctx.db.clone())
                .create(user.authorization.user.macro_user_id.as_ref(), input)
                .await?,
        ),
    ))
}

#[utoipa::path(put, path = "/task_templates/{id}", tag = "task_templates", params(("id" = Uuid, Path)), request_body = UpdateTaskTemplateRequest, responses((status = 200, body = TaskTemplate), (status = 404, body = ErrorResponse), (status = 409, body = ErrorResponse)))]
#[tracing::instrument(skip_all, fields(template_id = %id), err)]
pub async fn update_task_template(
    State(ctx): State<ApiContext>,
    user: MacroAuthorizationExtractor<AuthorizationService, UserOrInternal>,
    Path(id): Path<Uuid>,
    Json(input): Json<UpdateTaskTemplateRequest>,
) -> Result<Json<TaskTemplate>, ApiError> {
    Ok(Json(
        service(ctx.db.clone())
            .update(user.authorization.user.macro_user_id.as_ref(), id, input)
            .await?,
    ))
}

#[utoipa::path(delete, path = "/task_templates/{id}", tag = "task_templates", params(("id" = Uuid, Path), ("revision" = i64, Query)), responses((status = 204), (status = 404, body = ErrorResponse), (status = 409, body = ErrorResponse)))]
#[tracing::instrument(skip_all, fields(template_id = %id), err)]
pub async fn delete_task_template(
    State(ctx): State<ApiContext>,
    user: MacroAuthorizationExtractor<AuthorizationService, UserOrInternal>,
    Path(id): Path<Uuid>,
    Query(query): Query<DeleteTaskTemplateQuery>,
) -> Result<StatusCode, ApiError> {
    service(ctx.db.clone())
        .delete(
            user.authorization.user.macro_user_id.as_ref(),
            id,
            query.revision,
        )
        .await?;
    Ok(StatusCode::NO_CONTENT)
}
