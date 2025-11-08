use crate::{api::context::ApiContext, model::request::pins::PinRequest};
use axum::{
    Extension,
    extract::{Json, Path, State},
    http::StatusCode,
    response::IntoResponse,
};
use model::response::{
    GenericErrorResponse, GenericResponse, GenericSuccessResponse, SuccessResponse,
};
use model::user::UserContext;
use serde::Deserialize;

#[derive(Deserialize)]
pub struct Params {
    pub pinned_item_id: String,
}

/// Deletes the pin for the user
#[utoipa::path(
        delete,
        path = "/pins/:pinned_item_id",
        params(
            ("pinned_item_id" = String, Path, description = "ID of the pinned item")
        ),
        responses(
            (status = 200, body=SuccessResponse),
            (status = 401, body=GenericErrorResponse),
            (status = 404, body=GenericErrorResponse),
            (status = 500, body=GenericErrorResponse),
        )
    )]
#[tracing::instrument(skip(ctx, user_context), fields(user_id=?user_context.user_id))]
pub async fn remove_pin_handler(
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
    Path(Params { pinned_item_id }): Path<Params>,
    Json(req): Json<PinRequest>,
) -> impl IntoResponse {
    match macro_db_client::pins::remove_pin(
        ctx.db.clone(),
        user_context.user_id.as_str(),
        pinned_item_id.as_str(),
        req.pin_type.as_str(),
    )
    .await
    {
        Ok(_) => (),
        Err(err) => {
            tracing::error!(error=?err, user_id=?user_context.user_id, "failed to add pin");
            return GenericResponse::builder()
                .message("failed to add pin")
                .is_error(true)
                .send(StatusCode::INTERNAL_SERVER_ERROR);
        }
    };

    let response_data = GenericSuccessResponse { success: true };
    GenericResponse::builder()
        .data(&response_data)
        .send(StatusCode::OK)
}
