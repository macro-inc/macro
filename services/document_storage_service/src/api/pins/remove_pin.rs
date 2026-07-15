use crate::{
    api::context::{ApiContext, AuthorizationService},
    model::request::pins::PinRequest,
};
use axum::{
    extract::{Json, Path, State},
    http::StatusCode,
    response::IntoResponse,
};
use macro_authorization::MacroAuthorizationExtractor;
use model::response::{
    GenericErrorResponse, GenericResponse, GenericSuccessResponse, SuccessResponse,
};
use serde::Deserialize;

#[derive(Deserialize)]
pub struct Params {
    pub pinned_item_id: String,
}

/// Deletes the pin for the user
#[utoipa::path(
        delete,
        path = "/pins/{pinned_item_id}",
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
#[tracing::instrument(skip(ctx, user), fields(user_id=?user.macro_user_id))]
pub async fn remove_pin_handler(
    State(ctx): State<ApiContext>,
    user: MacroAuthorizationExtractor<AuthorizationService>,
    Path(Params { pinned_item_id }): Path<Params>,
    Json(req): Json<PinRequest>,
) -> impl IntoResponse {
    match macro_db_client::pins::remove_pin(
        ctx.db.clone(),
        user.macro_user_id.as_ref(),
        pinned_item_id.as_str(),
        req.pin_type.as_str(),
    )
    .await
    {
        Ok(_) => (),
        Err(err) => {
            tracing::error!(error=?err, user_id=?user.macro_user_id, "failed to add pin");
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
