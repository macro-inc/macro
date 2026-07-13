use crate::model::response::attachments::GetChatsForAttachmentResponse;
use anyhow::Result;
use axum::{
    Extension, Json,
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use macro_db_client::dcs::get_chats_for_attachment::{
    get_latest_single_attachment_chat, get_multi_attachment_chat,
};
use model::user::UserContext;
use sqlx::PgPool;

#[derive(serde::Deserialize)]
pub struct Params {
    pub attachment_id: String,
}

#[utoipa::path(
        get,
        path = "/attachments/{attachment_id}/chats",
        responses(
            (status = 200, body=GetChatsForAttachmentResponse),
            (status = 401, body=String),
            (status = 404, body=String),
            (status = 500, body=String),
        ),
        params( ("attachment_id" = String, Path, description = "id of the attachment"))
    )]
#[tracing::instrument(skip(db, user_context), fields(user_id=?user_context.user_id))]
pub async fn get_chats_for_attachment_handler(
    State(db): State<PgPool>,
    user_context: Extension<UserContext>,
    Path(Params { attachment_id }): Path<Params>,
) -> Result<Response, Response> {
    let mut transaction = db.begin().await.map_err(|e| {
        tracing::error!(error=?e, user_id=%user_context.user_id, attachment_id=%attachment_id, "failed to begin transaction");
        StatusCode::INTERNAL_SERVER_ERROR.into_response()
    })?;

    let recent = get_latest_single_attachment_chat(
        &mut transaction,
        &attachment_id,
        user_context.user_id.as_str(),
    )
    .await
    .map_err(|e| {
        tracing::error!(error=?e, user_id=%user_context.user_id, attachment_id=%attachment_id, "failed to get latest single attachment chat");
        StatusCode::INTERNAL_SERVER_ERROR.into_response()
    })?;

    let multi = get_multi_attachment_chat(
        &mut transaction,
        &attachment_id,
        user_context.user_id.as_str(),
    )
    .await
    .map_err(|e| {
        tracing::error!(error=?e, user_id=%user_context.user_id, attachment_id=%attachment_id, "failed to get multi attachment chat");
        StatusCode::INTERNAL_SERVER_ERROR.into_response()
    })?;

    let res = GetChatsForAttachmentResponse {
        recent_chat: recent,
        all_chats: multi,
    };

    Ok((StatusCode::OK, Json::<GetChatsForAttachmentResponse>(res)).into_response())
}
