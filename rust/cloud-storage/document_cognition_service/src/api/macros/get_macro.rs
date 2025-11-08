use crate::{api::context::ApiContext, model::response::macros::GetMacroResponse};
use axum::{
    Extension, Json,
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
};
use macro_db_client::dcs::get_macro::get_macro;
use macro_middleware::cloud_storage::ensure_access::macros::MacrosAccessLevelExtractor;
use model::user::UserContext;
use models_permissions::share_permission::access_level::ViewAccessLevel;
use sqlx::PgPool;

#[derive(serde::Deserialize)]
pub struct Params {
    pub macro_prompt_id: String,
}

/// Gets a particular macro by its id
#[utoipa::path(
        get,
        path = "/macros/{macro_prompt_id}",
        responses(
            (status = 200, body=GetMacroResponse),
            (status = 401, body=String),
            (status = 404, body=String),
            (status = 500, body=String),
        ),
        params( ("macro_prompt_id" = String, Path, description = "id of the macro"))
)]
#[tracing::instrument(skip(db, user_context), fields(user_id=?user_context.user_id))]
#[axum::debug_handler(state = ApiContext)]
pub async fn get_macro_handler(
    MacrosAccessLevelExtractor { access_level, .. }: MacrosAccessLevelExtractor<ViewAccessLevel>,
    State(db): State<PgPool>,
    user_context: Extension<UserContext>,
    Path(Params { macro_prompt_id }): Path<Params>,
) -> impl IntoResponse {
    let macro_item = match get_macro(&db, &macro_prompt_id).await {
        Ok(macro_item) => macro_item,
        Err(sqlx::Error::RowNotFound) => {
            tracing::error!(
                macro_prompt_id = %macro_prompt_id,
                user_id = %user_context.user_id,
                "macro not found"
            );
            return Err((StatusCode::NOT_FOUND, "macro not found"));
        }
        Err(err) => {
            tracing::error!(
                error = %err,
                macro_prompt_id = %macro_prompt_id,
                user_id = %user_context.user_id,
                "failed to get macro from database"
            );
            return Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                "unable to get macro permissions",
            ));
        }
    };

    let get_macro_response = GetMacroResponse {
        macro_item,
        user_access_level: access_level,
    };

    Ok((StatusCode::OK, Json(get_macro_response)))
}
