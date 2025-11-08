use crate::{api::context::ApiContext, model::request::macros::CreateMacroRequest};
use axum::{
    Json,
    extract::{self, Extension, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use model::{response::StringIDResponse, user::UserContext};
use sqlx::PgPool;

#[utoipa::path(
        post,
        path = "/macros",
        responses(
            (status = 201, body=StringIDResponse),
            (status = 401, body=String),
            (status = 404, body=String),
            (status = 500, body=String),
        )
    )]
#[tracing::instrument(skip(db, user_context), fields(user_id=?user_context.user_id))]
#[axum::debug_handler(state = ApiContext)]
pub(in crate::api) async fn create_macro_handler(
    State(db): State<PgPool>,
    user_context: Extension<UserContext>,
    extract::Json(req): extract::Json<CreateMacroRequest>,
) -> Result<Response, Response> {
    let string_id_response = create_macro_v2(&db, user_context, req)
        .await
        .map_err(|(status_code, message)| (status_code, message).into_response())?;

    Ok((StatusCode::OK, Json(string_id_response)).into_response())
}

#[tracing::instrument(skip(db, user_context, req), fields(user_id=user_context.user_id))]
async fn create_macro_v2(
    db: &PgPool,
    user_context: Extension<UserContext>,
    req: CreateMacroRequest,
) -> Result<StringIDResponse, (StatusCode, String)> {
    let share_permission: models_permissions::share_permission::SharePermissionV2 =
        models_permissions::share_permission::SharePermissionV2::default();

    let macro_item = macro_db_client::macros::create::create_macro(
        db,
        user_context.user_id.as_str(),
        req.title.as_str(),
        req.prompt.as_str(),
        req.icon.as_str(),
        req.color.as_str(),
        req.required_docs,
        &share_permission,
    )
    .await
    .map_err(|err| {
        tracing::error!(error=%err,  "failed to create macro in database");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "unable to create macro".to_string(),
        )
    })?;

    Ok(StringIDResponse { id: macro_item })
}
