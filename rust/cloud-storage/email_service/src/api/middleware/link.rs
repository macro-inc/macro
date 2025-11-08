use axum::{
    Extension, Json,
    extract::{Request, State},
    http::StatusCode,
    middleware::Next,
    response::{IntoResponse, Response},
};
use model::response::ErrorResponse;
use model::user::UserContext;
use models_email::email::service::link::UserProvider;
use tracing::instrument;

use crate::api::context::ApiContext;
#[instrument(skip_all, fields(macro_id = %user_context.user_id, fusion_user_id = %user_context.fusion_user_id))]
pub(in crate::api) async fn attach_link_context(
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
    mut req: Request,
    next: Next,
) -> Result<Response, Response> {
    let link = email_db_client::links::get::fetch_link_by_fusionauth_and_macro_id(
        &ctx.db,
        &user_context.fusion_user_id,
        &user_context.user_id,
        UserProvider::Gmail,
    )
    .await
    .map_err(|e| {
        tracing::error!(error=?e, "unable to fetch link");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                message: "unable to fetch link",
            }),
        )
            .into_response()
    })?;

    let link = link.ok_or_else(|| {
        (
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                message: "No email link found for user",
            }),
        )
            .into_response()
    })?;

    let service_link = link;
    req.extensions_mut().insert(service_link);
    Ok(next.run(req).await)
}
