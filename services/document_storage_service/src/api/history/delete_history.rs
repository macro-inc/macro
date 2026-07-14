use crate::api::context::ApiContext;
use axum::extract::{Path, State};
use axum::{http::StatusCode, response::IntoResponse};
use macro_authorization::SharedMacroAuthorizationExtractor;
use model::response::{
    GenericErrorResponse, GenericResponse, GenericSuccessResponse, SuccessResponse,
};

#[derive(serde::Deserialize)]
pub struct Params {
    pub item_type: String,
    pub item_id: String,
}

/// Deletes an item from the user's history
#[utoipa::path(
        delete,
        path = "/history/{item_type}/{item_id}",
        params(
            ("item_type" = String, Path, description = "Type of the item"),
            ("item_id" = String, Path, description = "ID of the item")
        ),
        responses(
            (status = 200, body=SuccessResponse),
            (status = 401, body=GenericErrorResponse),
            (status = 500, body=GenericErrorResponse),
        )
    )]
#[tracing::instrument(skip(ctx, authorization), fields(user_id=?authorization.user_context.user_id))]
pub async fn delete_history_handler(
    State(ctx): State<ApiContext>,
    authorization: SharedMacroAuthorizationExtractor,
    Path(Params { item_type, item_id }): Path<Params>,
) -> impl IntoResponse {
    let user_context = &authorization.user_context;
    if let Err(e) = macro_db_client::history::delete_user_history(
        &ctx.db,
        &user_context.user_id,
        item_id.as_str(),
        item_type.as_str(),
    )
    .await
    {
        tracing::error!(error=?e, user_id=?user_context.user_id, "unable to delete history");
        return GenericResponse::builder()
            .message("unable to delete history")
            .is_error(true)
            .send(StatusCode::INTERNAL_SERVER_ERROR);
    }

    GenericResponse::builder()
        .data(&GenericSuccessResponse { success: true })
        .send(StatusCode::OK)
}
