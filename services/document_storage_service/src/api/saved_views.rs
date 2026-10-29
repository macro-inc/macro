use axum::Json;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, patch, post};
use axum::{Router, routing::get};
use macro_authorization::{MacroAuthorizationExtractor, UserOrInternal};
use model::response::ErrorResponse;
use saved_views::domain::Error as DomainError;
use saved_views::{ExcludedDefaultViewStorage, PgViewStorage};

pub use saved_views::{ExcludedDefaultView, View, ViewPatch};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::api::ApiContext;
use crate::api::context::AuthorizationService;
use crate::service::saved_views::service;

pub fn router() -> Router<ApiContext> {
    Router::new()
        .route("/", get(get_views_handler))
        .route("/", post(create_view_handler))
        .route("/{saved_view_id}", delete(delete_view_handler))
        .route("/{saved_view_id}", patch(patch_view_handler))
        .route("/exclude_default", post(exclude_default_view_handler))
}

#[derive(Debug, Error)]
pub enum SavedViewErr {
    #[error("saved view service failed")]
    Domain(#[from] DomainError),
    #[error("An unknown error has occurred")]
    DbErr(#[from] sqlx::Error),
}

impl IntoResponse for SavedViewErr {
    fn into_response(self) -> Response {
        match &self {
            SavedViewErr::Domain(error) => {
                let status = match error {
                    DomainError::NotFound => StatusCode::NOT_FOUND,
                    DomainError::NotOwner => StatusCode::UNAUTHORIZED,
                    DomainError::Conflict => StatusCode::CONFLICT,
                    DomainError::Invalid | DomainError::NotMember => StatusCode::BAD_REQUEST,
                    DomainError::Internal(err) => {
                        tracing::error!(error=?err);
                        StatusCode::INTERNAL_SERVER_ERROR
                    }
                };
                (
                    status,
                    Json(ErrorResponse {
                        message: error.to_string().into(),
                    }),
                )
                    .into_response()
            }
            SavedViewErr::DbErr(error) => {
                tracing::error!(error=?error);
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(ErrorResponse {
                        message: self.to_string().into(),
                    }),
                )
                    .into_response()
            }
        }
    }
}

#[derive(Serialize, Deserialize, Debug, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ViewsResponse {
    views: Vec<View>,
    excluded_default_views: Vec<ExcludedDefaultView>,
}

#[derive(Serialize, Deserialize, Debug, ToSchema)]
pub struct CreateViewRequest {
    name: String,
    config: serde_json::Value,
}

#[derive(Serialize, Deserialize, Debug, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ExcludeDefaultViewRequest {
    default_view_id: String,
}

#[utoipa::path(
        tag = "saved_views",
        get,
        path = "/saved_views",
        responses(
            (status = 200, body=ViewsResponse),
            (status = 401, body=ErrorResponse),
            (status = 500, body=ErrorResponse),
        )
    )]
#[tracing::instrument(skip_all, err)]
async fn get_views_handler(
    State(ctx): State<ApiContext>,
    user: MacroAuthorizationExtractor<AuthorizationService, UserOrInternal>,
) -> Result<(StatusCode, Json<ViewsResponse>), SavedViewErr> {
    let pg_view_storage = PgViewStorage::new(ctx.db.clone());

    let views = service(ctx.db.clone())
        .legacy_list(user.authorization.user.macro_user_id.as_ref())
        .await?;
    let excluded_default_views = pg_view_storage
        .get_excluded_default_views_for_user(user.authorization.user.macro_user_id.as_ref())
        .await?;

    Ok((
        StatusCode::OK,
        Json(ViewsResponse {
            views,
            excluded_default_views,
        }),
    ))
}

#[utoipa::path(
    tag = "saved_views",
    post,
    path = "/saved_views",
    responses(
        (status = 200, body=View),
        (status = 401, body=ErrorResponse),
        (status = 500, body=ErrorResponse),
    )
)]
async fn create_view_handler(
    ctx: State<ApiContext>,
    user: MacroAuthorizationExtractor<AuthorizationService, UserOrInternal>,
    Json(create_view_request): Json<CreateViewRequest>,
) -> Result<(StatusCode, Json<View>), SavedViewErr> {
    let new_view = service(ctx.db.clone())
        .legacy_create(
            user.authorization.user.macro_user_id.as_ref(),
            create_view_request.name,
            create_view_request.config,
        )
        .await?;

    Ok((StatusCode::CREATED, Json(new_view)))
}

#[derive(Deserialize)]
struct SavedViewParams {
    pub saved_view_id: Uuid,
}

#[utoipa::path(
    tag = "saved_views",
    delete,
    path = "/saved_views/{saved_view_id}",
    params(
        ("saved_view_id" = String, Path, description = "The id of the saved view to delete")
    ),
    responses(
        (status = 200),
        (status = 401, body=ErrorResponse),
        (status = 500, body=ErrorResponse),
    )
)]
#[tracing::instrument(skip_all, fields(view_id = %id), err)]
async fn delete_view_handler(
    State(ctx): State<ApiContext>,
    user: MacroAuthorizationExtractor<AuthorizationService, UserOrInternal>,
    Path(SavedViewParams { saved_view_id: id }): Path<SavedViewParams>,
) -> Result<StatusCode, SavedViewErr> {
    service(ctx.db.clone())
        .legacy_delete(user.authorization.user.macro_user_id.as_ref(), id)
        .await?;

    Ok(StatusCode::OK)
}

#[utoipa::path(
    tag = "saved_views",
    patch,
    path = "/saved_views/{saved_view_id}",
    params(
        ("saved_view_id" = String, Path, description = "The id of the saved view to patch")
    ),
    responses(
        (status = 200),
        (status = 401, body=ErrorResponse),
        (status = 500, body=ErrorResponse),
    )
)]
#[tracing::instrument(skip_all, fields(view_id = %id), err)]
async fn patch_view_handler(
    State(ctx): State<ApiContext>,
    user: MacroAuthorizationExtractor<AuthorizationService, UserOrInternal>,
    Path(SavedViewParams { saved_view_id: id }): Path<SavedViewParams>,
    Json(patch): Json<ViewPatch>,
) -> Result<StatusCode, SavedViewErr> {
    service(ctx.db.clone())
        .legacy_patch(
            user.authorization.user.macro_user_id.as_ref(),
            id,
            patch.name.as_deref(),
            patch.config.as_ref(),
        )
        .await?;

    Ok(StatusCode::OK)
}

#[utoipa::path(
    tag = "saved_views",
    post,
    path = "/saved_views/exclude_default",
    responses(
        (status = 200),
        (status = 401, body=ErrorResponse),
        (status = 500, body=ErrorResponse),
    )
)]
#[tracing::instrument(skip_all, err)]
pub async fn exclude_default_view_handler(
    State(ctx): State<ApiContext>,
    user: MacroAuthorizationExtractor<AuthorizationService, UserOrInternal>,
    Json(ExcludeDefaultViewRequest {
        default_view_id: id,
    }): Json<ExcludeDefaultViewRequest>,
) -> Result<StatusCode, SavedViewErr> {
    let pg_view_storage = PgViewStorage::new(ctx.db.clone());

    pg_view_storage
        .create_excluded_default_view(ExcludedDefaultView::new(
            user.authorization.user.macro_user_id.to_string(),
            id.to_string(),
        ))
        .await?;

    Ok(StatusCode::OK)
}
