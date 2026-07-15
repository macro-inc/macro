use crate::api::context::{ApiContext, AuthorizationService};
use axum::{
    extract::{self, State},
    http::StatusCode,
    response::IntoResponse,
};
use macro_authorization::MacroAuthorizationExtractor;
use model::{
    pin::request::ReorderPinRequest,
    response::{GenericErrorResponse, GenericResponse, GenericSuccessResponse, SuccessResponse},
};

/// Saves the updated order of the pins for the user
#[utoipa::path(
        patch,
        path = "/pins",
        responses(
            (status = 200, body=SuccessResponse),
            (status = 401, body=GenericErrorResponse),
            (status = 404, body=GenericErrorResponse),
            (status = 500, body=GenericErrorResponse),
        )
    )]
#[tracing::instrument(skip(ctx, user, req), fields(user_id=?user.macro_user_id))]
pub async fn reorder_pins_handler(
    State(ctx): State<ApiContext>,
    user: MacroAuthorizationExtractor<AuthorizationService>,
    extract::Json(req): extract::Json<Vec<ReorderPinRequest>>,
) -> impl IntoResponse {
    match macro_db_client::pins::reorder_pins(ctx.db.clone(), user.macro_user_id.as_ref(), req)
        .await
    {
        Ok(_) => (),
        Err(err) => {
            tracing::error!(error=?err, user_id=?user.macro_user_id, "failed to reorder pins");
            return GenericResponse::builder()
                .message("failed to reorder pins")
                .is_error(true)
                .send(StatusCode::INTERNAL_SERVER_ERROR);
        }
    };

    let response_data = GenericSuccessResponse { success: true };
    GenericResponse::builder()
        .data(&response_data)
        .send(StatusCode::OK)
}
