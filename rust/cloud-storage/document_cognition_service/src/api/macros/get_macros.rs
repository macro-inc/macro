use crate::api::context::ApiContext;
use macro_db_client::dcs::get_macros::get_macros;

use axum::{Extension, Json, extract::State, http::StatusCode, response::IntoResponse};
use model::{macros::MacrosResponse, user::UserContext};
use sqlx::PgPool;

/// Gets all the macros for a user.
#[utoipa::path(
        get,
        path = "/macros",
        responses(
            (status = 200, body=MacrosResponse),
            (status = 401, body=String),
            (status = 404, body=String),
            (status = 500, body=String),
        )
    )]
#[tracing::instrument(skip(db, user_context), fields(user_id=?user_context.user_id))]
#[axum::debug_handler(state = ApiContext)]
pub async fn get_macros_handler(
    State(db): State<PgPool>,
    user_context: Extension<UserContext>,
) -> impl IntoResponse {
    let macros = match get_macros(&db, &user_context.user_id).await {
        Ok(macros) => macros,
        Err(err) => {
            tracing::error!(error=?err, user_id=%user_context.user_id, "unable to get macros");
            return (StatusCode::INTERNAL_SERVER_ERROR, "unable to get macros").into_response();
        }
    };

    let macros_response = MacrosResponse { macros };

    (StatusCode::OK, Json(&macros_response)).into_response()
}
