use crate::{
    api::context::{ApiContext, AuthorizationService, EntityAccessService},
    model::request::pins::AddPinRequest,
};
use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
};

use entity_access::inbound::axum_extractors::PinAccessLevelExtractor;
use macro_authorization::{MacroAuthorizationExtractor, UserOrInternal};
use model::response::{
    GenericErrorResponse, GenericResponse, GenericSuccessResponse, SuccessResponse,
};
use models_permissions::share_permission::access_level::ViewAccessLevel;
use serde::Deserialize;

#[derive(Deserialize)]
pub struct Params {
    pub pinned_item_id: String,
}

/// Pins the item for the user
#[utoipa::path(
        post,
        path = "/pins/{pinned_item_id}",
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
#[tracing::instrument(skip(ctx, user, pin_type, inner), fields(user_id=?user.authorization.user.macro_user_id))]
#[axum::debug_handler(state = ApiContext)]
pub async fn add_pin_handler(
    State(ctx): State<ApiContext>,
    user: MacroAuthorizationExtractor<AuthorizationService, UserOrInternal>,
    Path(Params { pinned_item_id }): Path<Params>,
    PinAccessLevelExtractor {
        pin_type, inner, ..
    }: PinAccessLevelExtractor<
        ViewAccessLevel,
        EntityAccessService,
        AddPinRequest,
        AuthorizationService,
    >,
) -> impl IntoResponse {
    match macro_db_client::pins::upsert_pin(
        ctx.db.clone(),
        user.authorization.user.macro_user_id.as_ref(),
        pinned_item_id.as_str(),
        pin_type.pin_type.as_str(),
        inner.pin_index,
    )
    .await
    {
        Ok(_) => (),
        Err(err) => {
            tracing::error!(error=?err, user_id=?user.authorization.user.macro_user_id, "failed to add pin");
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
