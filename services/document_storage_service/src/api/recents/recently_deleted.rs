use crate::api::context::AuthorizationService;
use axum::extract::State;
use axum::{http::StatusCode, response::IntoResponse};
use macro_authorization::{MacroAuthorizationExtractor, UserOrInternal};
use model::item::Item;
use model::response::{GenericErrorResponse, GenericResponse, TypedSuccessResponse};
use sqlx::PgPool;
use utoipa::ToSchema;

#[derive(serde::Serialize, serde::Deserialize, Eq, PartialEq, Debug, ToSchema)]
pub struct RecentlyDeletedResponseData {
    /// The items returned from the call
    pub items: Vec<Item>,
}

pub type RecentlyDeletedResponse = TypedSuccessResponse<RecentlyDeletedResponseData>;

/// Gets the users recently deleted items.
#[utoipa::path(
    tag="recents",
    operation_id="recently_deleted",
    get,
    path = "/recents/deleted",
    responses(
        (status = 200, body=RecentlyDeletedResponse),
        (status = 400, body=GenericErrorResponse),
        (status = 401, body=GenericErrorResponse),
        (status = 500, body=GenericErrorResponse),
    )
)]
#[tracing::instrument(skip(db, user), fields(user_id=?user.authorization.user.macro_user_id))]
pub async fn handler(
    State(db): State<PgPool>,
    user: MacroAuthorizationExtractor<AuthorizationService, UserOrInternal>,
) -> impl IntoResponse {
    tracing::info!("recently_deleted");

    let items = match macro_db_client::recents::deleted::get_recently_deleted(
        &db,
        user.authorization.user.macro_user_id.as_ref(),
    )
    .await
    {
        Ok(result) => result,
        Err(e) => {
            tracing::error!(error=?e, "error getting recently deleted items");
            return GenericResponse::builder()
                .message("error getting recently deleted items")
                .is_error(true)
                .send(StatusCode::INTERNAL_SERVER_ERROR);
        }
    };

    let data = RecentlyDeletedResponseData { items };

    GenericResponse::builder().data(&data).send(StatusCode::OK)
}
