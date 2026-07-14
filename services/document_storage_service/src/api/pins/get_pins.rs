use crate::model::response::pin::GetPinsResponse;
use crate::{api::context::ApiContext, model::response::pin::UserPinsResponse};
use axum::extract::State;
use axum::{Extension, http::StatusCode, response::IntoResponse};
use model::response::{GenericErrorResponse, GenericResponse};
use model::user::UserContext;

/// Gets the users pinned items
#[utoipa::path(
        get,
        path = "/pins",
        responses(
            (status = 200, body=GetPinsResponse),
            (status = 401, body=GenericErrorResponse),
            (status = 500, body=GenericErrorResponse),
        )
    )]
#[tracing::instrument(skip(ctx, user_context), fields(user_id=?user_context.user_id))]
pub async fn get_pins_handler(
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
) -> impl IntoResponse {
    let pins = match macro_db_client::pins::get_pins(ctx.db.clone(), user_context.user_id.as_str())
        .await
    {
        Ok(pins) => pins,
        Err(err) => {
            tracing::error!(error=?err, user_id=?user_context.user_id, "failed to get users pinned items");
            return GenericResponse::builder()
                .message("failed to get pins")
                .is_error(true)
                .send(StatusCode::INTERNAL_SERVER_ERROR);
        }
    };

    let response_data = UserPinsResponse { recent: pins };

    GenericResponse::builder()
        .data(&response_data)
        .send(StatusCode::OK)
}
