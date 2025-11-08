use axum::extract::{FromRef, FromRequestParts, Path, State};
use axum::http::StatusCode;
use axum::http::request::Parts;
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, patch, post};
use axum::{Extension, Router, routing::get};
use axum::{Json, async_trait};
use model::response::ErrorResponse;
use model::user::UserContext;
use saved_views::{ExcludedDefaultViewStorage, PgViewStorage, ViewStorage};

pub use saved_views::{ExcludedDefaultView, View, ViewPatch};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use thiserror::Error;
use tokio::try_join;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::api::ApiContext;

pub fn router() -> Router<ApiContext> {
    Router::new()
        .route("/", get(get_views_handler))
        .route("/", post(create_view_handler))
        .route("/:saved_view_id", delete(delete_view_handler))
        .route("/:saved_view_id", patch(patch_view_handler))
        .route("/exclude_default", post(exclude_default_view_handler))
}

#[derive(Debug, Error)]
pub enum SavedViewErr {
    #[error("An unknown error has occurred")]
    DbErr(#[from] sqlx::Error),
    #[error("You are not authorized to access this")]
    Unauthorized,
    #[error("saved view not found")]
    NotFound,
    #[error("bad request {0}")]
    BadRequest(&'static str),
}

impl IntoResponse for SavedViewErr {
    fn into_response(self) -> Response {
        match &self {
            SavedViewErr::DbErr(error) => {
                tracing::error!(error=?error);
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(ErrorResponse {
                        message: &self.to_string(),
                    }),
                )
                    .into_response()
            }
            SavedViewErr::Unauthorized => (
                StatusCode::UNAUTHORIZED,
                Json(ErrorResponse {
                    message: &self.to_string(),
                }),
            )
                .into_response(),
            SavedViewErr::NotFound => (
                StatusCode::NOT_FOUND,
                Json(ErrorResponse {
                    message: &self.to_string(),
                }),
            )
                .into_response(),
            SavedViewErr::BadRequest(message) => {
                (StatusCode::BAD_REQUEST, Json(ErrorResponse { message })).into_response()
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

async fn authorize_view_access(
    storage: &impl ViewStorage<Err = sqlx::Error>,
    view_id: Uuid,
    user_id: &str,
) -> Result<(), SavedViewErr> {
    let view = storage.get_view(view_id).await.map_err(|e| match e {
        sqlx::Error::RowNotFound => SavedViewErr::NotFound,
        e => SavedViewErr::DbErr(e),
    })?;

    if view.user_id != user_id {
        return Err(SavedViewErr::Unauthorized);
    }
    Ok(())
}

#[derive(Debug)]
struct SavedViewOwner(pub UserContext);

#[async_trait]
impl<S> FromRequestParts<S> for SavedViewOwner
where
    S: Send + Sync,
    PgPool: FromRef<S>,
{
    type Rejection = SavedViewErr;

    //HACK: to be replaced once @seanaye's extractor pr is merged
    //until then, we are left with using these extension extractors
    #[tracing::instrument(skip(parts, state), err)]
    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let db = PgPool::from_ref(state);

        let user_context = Extension::<UserContext>::from_request_parts(parts, state)
            .await
            .map(|Extension(ctx)| ctx)
            .map_err(|_| SavedViewErr::BadRequest("Missing user context"))?;

        let saved_view_id = Path::<SavedViewParams>::from_request_parts(parts, state)
            .await
            .map_err(|_| SavedViewErr::BadRequest("Missing saved view id"))?
            .saved_view_id;

        authorize_view_access(
            &PgViewStorage::new(db),
            saved_view_id,
            &user_context.user_id,
        )
        .await?;

        Ok(SavedViewOwner(user_context))
    }
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
#[tracing::instrument(skip(ctx, user_context), fields(user_id=?user_context.user_id), err)]
async fn get_views_handler(
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
) -> Result<(StatusCode, Json<ViewsResponse>), SavedViewErr> {
    let pg_view_storage = PgViewStorage::new(ctx.db.clone());

    let (views, excluded_default_views) = try_join!(
        async {
            pg_view_storage
                .get_views_for_user(&user_context.user_id)
                .await
        },
        async {
            pg_view_storage
                .get_excluded_default_views_for_user(&user_context.user_id)
                .await
        }
    )?;

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
    user_context: Extension<UserContext>,
    Json(create_view_request): Json<CreateViewRequest>,
) -> Result<(StatusCode, Json<View>), SavedViewErr> {
    let pg_view_storage = PgViewStorage::new(ctx.db.clone());

    let new_view = View::new(
        user_context.user_id.clone(),
        create_view_request.name,
        create_view_request.config,
    );

    pg_view_storage.create_view(&new_view).await?;

    Ok((StatusCode::CREATED, Json(new_view)))
}

#[derive(Deserialize)]
struct SavedViewParams {
    pub saved_view_id: Uuid,
}

#[utoipa::path(
    tag = "saved_views",
    delete,
    path = "/saved_views",
    params(
        ("saved_view_id" = String, Path, description = "The id of the saved view to delete")
    ),
    responses(
        (status = 200),
        (status = 401, body=ErrorResponse),
        (status = 500, body=ErrorResponse),
    )
)]
#[tracing::instrument(skip(ctx), fields(user_id=?user_context.user_id), err)]
async fn delete_view_handler(
    State(ctx): State<ApiContext>,
    SavedViewOwner(user_context): SavedViewOwner,
    Path(SavedViewParams { saved_view_id: id }): Path<SavedViewParams>,
) -> Result<StatusCode, SavedViewErr> {
    let pg_view_storage = PgViewStorage::new(ctx.db.clone());

    pg_view_storage.delete_view(id).await?;

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
#[tracing::instrument(skip(ctx), fields(user_id=?user_context.user_id), err)]
async fn patch_view_handler(
    State(ctx): State<ApiContext>,
    SavedViewOwner(user_context): SavedViewOwner,
    Path(SavedViewParams { saved_view_id: id }): Path<SavedViewParams>,
    Json(patch): Json<ViewPatch>,
) -> Result<StatusCode, SavedViewErr> {
    let pg_view_storage = PgViewStorage::new(ctx.db.clone());

    pg_view_storage.patch_view(id, patch).await?;

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
#[tracing::instrument(skip(ctx), fields(user_id=?user_context.user_id), err)]
pub async fn exclude_default_view_handler(
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
    Json(ExcludeDefaultViewRequest {
        default_view_id: id,
    }): Json<ExcludeDefaultViewRequest>,
) -> Result<StatusCode, SavedViewErr> {
    let pg_view_storage = PgViewStorage::new(ctx.db.clone());

    pg_view_storage
        .create_excluded_default_view(ExcludedDefaultView::new(
            user_context.user_id.clone(),
            id.to_string(),
        ))
        .await?;

    Ok(StatusCode::OK)
}
