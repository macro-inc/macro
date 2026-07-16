use crate::api::context::{ApiContext, AuthorizationService};
use axum::extract::State;
use axum::{extract::Path, http::StatusCode, response::IntoResponse};
use macro_authorization::MacroAuthorizationExtractor;
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
#[tracing::instrument(skip(ctx, user), fields(user_id=?user.macro_user_id))]
pub async fn delete_history_handler(
    State(ctx): State<ApiContext>,
    user: MacroAuthorizationExtractor<AuthorizationService>,
    Path(Params { item_type, item_id }): Path<Params>,
) -> impl IntoResponse {
    if let Err(e) = macro_db_client::history::delete_user_history(
        &ctx.db,
        user.macro_user_id.as_ref(),
        item_id.as_str(),
        item_type.as_str(),
    )
    .await
    {
        tracing::error!(error=?e, user_id=?user.macro_user_id, "unable to delete history");
        return GenericResponse::builder()
            .message("unable to delete history")
            .is_error(true)
            .send(StatusCode::INTERNAL_SERVER_ERROR);
    }

    GenericResponse::builder()
        .data(&GenericSuccessResponse { success: true })
        .send(StatusCode::OK)
}
