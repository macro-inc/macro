use crate::model::chats::ChatsResponse;
use axum::extract::State;
use axum::{Extension, Json, http::StatusCode, response::IntoResponse};
use macro_db_client::dcs::get_chats::get_chats;
use model::user::UserContext;
use sqlx::PgPool;

/// Gets all the chats for a user
#[utoipa::path(
        get,
        path = "/chats",
        responses(
            (status = 200, body=ChatsResponse),
            (status = 401, body=String),
            (status = 404, body=String),
            (status = 500, body=String),
        )
    )]
#[tracing::instrument(skip(db, user_context), fields(user_id=?user_context.user_id))]
pub async fn get_chats_handler(
    State(db): State<PgPool>,
    user_context: Extension<UserContext>,
) -> impl IntoResponse {
    let chats = match get_chats(&db, &user_context.user_id).await {
        Ok(chats) => chats,
        Err(err) => {
            tracing::error!(error=%err, user_id=%user_context.user_id, "unable to get chats");
            return (StatusCode::INTERNAL_SERVER_ERROR, "unable to get chats").into_response();
        }
    };

    (StatusCode::OK, Json(&chats)).into_response()
}
