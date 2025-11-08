use crate::{
    api::context::ApiContext, core::model::FALLBACK_MODEL, model::request::chats::CopyChatRequest,
    service::get_chat::get_chat,
};
use macro_db_client::dcs::copy_messages::copy_messages;
use macro_db_client::dcs::create_chat::create_chat_v2;

use axum::{
    Extension, Json,
    extract::{self, Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use macro_middleware::cloud_storage::ensure_access::chat::ChatAccessLevelExtractor;
use model::{response::StringIDResponse, user::UserContext};
use models_permissions::share_permission::access_level::ViewAccessLevel;

#[derive(serde::Deserialize)]
pub struct Params {
    pub chat_id: String,
}

#[utoipa::path(
        post,
        path = "/chats/{chat_id}/copy",
        responses(
            (status = 201, body=StringIDResponse),
            (status = 401, body=String),
            (status = 404, body=String),
            (status = 500, body=String),
        ),
        params(
            ("chat_id" = String, Path, description = "Chat id")
        )
    )]
pub async fn copy_chat_handler(
    _access: ChatAccessLevelExtractor<ViewAccessLevel>,
    State(state): State<ApiContext>,
    user_context: Extension<UserContext>,
    Path(Params { chat_id }): Path<Params>,
    extract::Json(req): extract::Json<CopyChatRequest>,
) -> Result<Response, Response> {
    let string_id_response = copy_chat_v2(&state, user_context, chat_id, req)
        .await
        .map_err(|(status_code, err)| (status_code, err).into_response())?;

    Ok((StatusCode::OK, Json(string_id_response)).into_response())
}

#[tracing::instrument(skip(state, user_context, req), fields(user_id=?user_context.user_id, chat_id))]
pub async fn copy_chat_v2(
    state: &ApiContext,
    user_context: Extension<UserContext>,
    chat_id: String,
    req: CopyChatRequest,
) -> Result<StringIDResponse, (StatusCode, String)> {
    // 1. create share permission
    let share_permission = models_permissions::share_permission::SharePermissionV2::default();
    // 2. create new chat
    let old_chat = get_chat(state, &chat_id, &user_context.user_id)
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "failed to get chat");
            (
                StatusCode::NOT_FOUND,
                "could not find chat to copy".to_string(),
            )
        })?;

    let project_id = if let Some(project_id) = old_chat.project_id {
        // Depending on if you are the project owner, we should copy the project id
        let project = macro_db_client::projects::get_project::get_basic_project::get_basic_project(
            &state.db,
            &project_id,
        )
        .await
        .map_err(|e| {
            tracing::error!(error=?e, project_id, "failed to get project");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "unable to get project".to_string(),
            )
        })?;

        if !project.user_id.eq(&user_context.user_id) {
            None
        } else {
            Some(project.id)
        }
    } else {
        None
    };

    let model = old_chat.model.unwrap_or(FALLBACK_MODEL);
    let chat_id = create_chat_v2(
        &state.db,
        user_context.user_id.as_str(),
        req.name.as_str(),
        model,
        project_id.as_deref(),
        &share_permission,
        vec![],
        0,
        false, // copied chats are not persistent
    )
    .await
    .map_err(|e| {
        tracing::error!(error=?e, "failed to create chat");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "unable to copy chat".to_string(),
        )
    })?;
    // 3. rename and copy messages
    let new_id = copy_messages(state.db.clone(), old_chat.id.as_str(), chat_id.as_str())
        .await
        .map_err(|e| {
            tracing::error!(error=?e, old_chat_id=?old_chat.id, new_chat_id=?chat_id, "failed to copy messages");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "unable to copy chat".to_string(),
            )
        })?;
    Ok(StringIDResponse { id: new_id })
}
