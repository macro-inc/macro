use crate::api::context::ApiContext;
use crate::model::response::history::GetUserHistoryResponse;
use axum::extract::State;
use axum::{Extension, http::StatusCode, response::IntoResponse};
use macro_authorization::SharedMacroAuthorizationExtractor;
use model::response::{GenericErrorResponse, GenericResponse};
use model::version::ApiVersionEnum;

/// Gets the users history
#[utoipa::path(
        get,
        path = "/history",
        responses(
            (status = 200, body=GetUserHistoryResponse),
            (status = 401, body=GenericErrorResponse),
            (status = 500, body=GenericErrorResponse),
        )
    )]
#[tracing::instrument(skip(ctx, authorization), fields(user_id=?authorization.user_context.user_id))]
pub async fn get_history_handler(
    State(ctx): State<ApiContext>,
    api_version: Extension<ApiVersionEnum>,
    authorization: SharedMacroAuthorizationExtractor,
) -> impl IntoResponse {
    tracing::info!("get_history_handler");

    let user_context = &authorization.user_context;
    let history =
        match macro_db_client::history::get_user_history(&ctx.db, &user_context.user_id).await {
            Ok(history) => history,
            Err(e) => {
                tracing::error!(error=?e, user_id=?user_context.user_id, "unable to get history");
                return GenericResponse::builder()
                    .message("unable to get history")
                    .is_error(true)
                    .send(StatusCode::INTERNAL_SERVER_ERROR);
            }
        };

    GenericResponse::builder()
        .data(&history)
        .send(StatusCode::OK)
}
