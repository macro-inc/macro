use crate::{api::context::ApiContext, model::response::macros::GetMacroPermissionsResponseV2};

use axum::{
    Extension, Json,
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use macro_middleware::cloud_storage::ensure_access::macros::MacrosAccessLevelExtractor;
use model::user::UserContext;
use models_permissions::share_permission::access_level::EditAccessLevel;
use sqlx::PgPool;

#[derive(serde::Deserialize)]
pub struct Params {
    pub macro_prompt_id: String,
}

/// Gets the current macro share permissions
#[utoipa::path(
        get,
        path = "/macros/{macro_prompt_id}/permissions",
        responses(
            (status = 200, body=GetMacroPermissionsResponseV2),
            (status = 404, body=String),
            (status = 500, body=String),
        ),
        params( ("macro_prompt_id" = String, Path, description = "id of the macro"))
    )]
#[tracing::instrument(skip(db, _user_context), fields(user_id=?_user_context.user_id))]
#[axum::debug_handler(state = ApiContext)]
pub async fn get_macro_permissions_handler(
    _access: MacrosAccessLevelExtractor<EditAccessLevel>,
    State(db): State<PgPool>,
    _user_context: Extension<UserContext>,
    Path(Params { macro_prompt_id }): Path<Params>,
) -> impl IntoResponse {
    get_macro_permissions_v2(&db, &macro_prompt_id).await
}

#[tracing::instrument(skip(db))]
async fn get_macro_permissions_v2(
    db: &PgPool,
    macro_prompt_id: &str,
) -> Result<Response, Response> {
    let macro_permissions =
        macro_db_client::share_permission::get::get_macro_share_permission(db, macro_prompt_id)
            .await
            .map_err(|e| {
                tracing::error!(error=?e, macro_prompt_id, "Failed to get macro permissions");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "unable to get macro permissions",
                )
                    .into_response()
            })?;

    let res = GetMacroPermissionsResponseV2 {
        permissions: macro_permissions,
    };

    Ok((StatusCode::OK, Json(res)).into_response())
}
