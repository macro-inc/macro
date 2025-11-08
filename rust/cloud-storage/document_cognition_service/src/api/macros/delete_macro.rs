use crate::api::context::ApiContext;
use axum::{
    Extension,
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
};
use macro_db_client::dcs::delete_macro::delete_macro;
use macro_middleware::cloud_storage::ensure_access::macros::MacrosAccessLevelExtractor;
use model::user::UserContext;
use models_permissions::share_permission::access_level::EditAccessLevel;
use sqlx::PgPool;

#[derive(serde::Deserialize)]
pub struct Params {
    pub macro_prompt_id: String,
}

/// Deletes a particular macro by its id
#[utoipa::path(
        delete,
        path = "/macros/{macro_prompt_id}",
        responses(
            (status = 200),
            (status = 401, body=String),
            (status = 404, body=String),
            (status = 500, body=String),
        ),
        params( ("macro_prompt_id" = String, Path, description = "id of the macro"))
    )]
#[tracing::instrument(skip(db, user_context), fields(user_id=?user_context.user_id))]
#[axum::debug_handler(state = ApiContext)]
pub async fn delete_macro_handler(
    _access: MacrosAccessLevelExtractor<EditAccessLevel>,
    State(db): State<PgPool>,
    user_context: Extension<UserContext>,
    Path(Params { macro_prompt_id }): Path<Params>,
) -> impl IntoResponse {
    if let Err(e) = delete_macro(&db, &macro_prompt_id).await {
        tracing::error!(
            error = %e,

            user_id = ?user_context.user_id,
            macro_prompt_id = %macro_prompt_id,
            "Failed to delete macro"
        );
        return Err((StatusCode::INTERNAL_SERVER_ERROR, "unable to delete macro").into_response());
    }

    Ok(StatusCode::OK)
}
