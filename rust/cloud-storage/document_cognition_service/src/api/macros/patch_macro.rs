use crate::{api::context::ApiContext, model::request::macros::PatchMacroRequest};
use axum::{
    extract::{self, Extension, Path, State},
    http::StatusCode,
    response::IntoResponse,
};
use macro_db_client::dcs::patch_macro::patch_macro;
use macro_middleware::cloud_storage::ensure_access::macros::MacrosAccessLevelExtractor;
use model::user::UserContext;
use models_permissions::share_permission::access_level::EditAccessLevel;
use sqlx::PgPool;

#[derive(serde::Deserialize)]
pub struct Params {
    pub macro_prompt_id: String,
}

#[utoipa::path(
        patch,
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
pub(in crate::api) async fn patch_macro_handler(
    _access: MacrosAccessLevelExtractor<EditAccessLevel>,
    State(db): State<PgPool>,
    user_context: Extension<UserContext>,
    Path(Params { macro_prompt_id }): Path<Params>,
    extract::Json(req): extract::Json<PatchMacroRequest>,
) -> impl IntoResponse {
    if let Err(e) = patch_macro(
        &db,
        &macro_prompt_id,
        req.title.as_deref(),
        req.prompt.as_deref(),
        req.icon.as_deref(),
        req.color.as_deref(),
        req.required_docs.as_ref(),
    )
    .await
    {
        tracing::error!(error = %e,  macro_prompt_id = %macro_prompt_id, user_id = %user_context.user_id, "Failed to patch macro");
        return Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            "unable to patch macro".to_string(),
        ));
    }
    Ok(StatusCode::OK)
}
