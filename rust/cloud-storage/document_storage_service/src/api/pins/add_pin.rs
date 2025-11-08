use crate::{api::context::ApiContext, model::request::pins::AddPinRequest};
use axum::{
    Extension,
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
};
use macro_middleware::cloud_storage::ensure_access::pin::PinAccessLevelExtractor;
use model::response::{
    GenericErrorResponse, GenericResponse, GenericSuccessResponse, SuccessResponse,
};
use model::user::UserContext;
use models_permissions::share_permission::access_level::ViewAccessLevel;
use serde::Deserialize;

#[derive(Deserialize)]
pub struct Params {
    pub pinned_item_id: String,
}

/// Pins the item for the user
#[utoipa::path(
        post,
        path = "/pins/:pinned_item_id",
        params(
            ("pinned_item_id" = String, Path, description = "ID of the pinned item")
        ),
        request_body = AddPinRequest,
        responses(
            (status = 200, body=SuccessResponse),
            (status = 401, body=GenericErrorResponse),
            (status = 404, body=GenericErrorResponse),
            (status = 500, body=GenericErrorResponse),
        )
    )]
#[tracing::instrument(skip(ctx, user_context, pin_type, inner), fields(user_id=?user_context.user_id))]
#[axum::debug_handler(state = ApiContext)]
pub async fn add_pin_handler(
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
    Path(Params { pinned_item_id }): Path<Params>,
    PinAccessLevelExtractor {
        pin_type, inner, ..
    }: PinAccessLevelExtractor<ViewAccessLevel, AddPinRequest>,
) -> impl IntoResponse {
    match macro_db_client::pins::upsert_pin(
        ctx.db.clone(),
        user_context.user_id.as_str(),
        pinned_item_id.as_str(),
        pin_type.pin_type.as_str(),
        inner.pin_index,
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
