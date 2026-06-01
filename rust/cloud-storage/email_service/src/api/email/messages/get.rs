use crate::api::ApiContext;
use anyhow::Context;
use axum::{
    Extension,
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Json, Response},
};
use model::{response::ErrorResponse, user::UserContext};
use sqlx::types::Uuid;
use std::collections::HashSet;
use strum_macros::AsRefStr;
use thiserror::Error;

/// The set of link ids the caller owns — every message read unions across these.
async fn owned_link_ids(
    ctx: &ApiContext,
    fusionauth_user_id: &str,
) -> anyhow::Result<HashSet<Uuid>> {
    Ok(
        email_db_client::links::get::fetch_links_by_fusionauth_user_id(&ctx.db, fusionauth_user_id)
            .await?
            .into_iter()
            .map(|link| link.id)
            .collect(),
    )
}

#[derive(Debug, Error, AsRefStr)]
pub enum GetMessageError {
    #[error("Message not found")]
    MessageNotFound,

    #[error("Unauthorized")]
    Unauthorized,

    #[error("Database query error")]
    QueryError(#[from] anyhow::Error),
}

impl IntoResponse for GetMessageError {
    fn into_response(self) -> Response {
        let status_code = match &self {
            GetMessageError::MessageNotFound => StatusCode::NOT_FOUND,
            GetMessageError::Unauthorized => StatusCode::UNAUTHORIZED,
            GetMessageError::QueryError(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };

        if status_code.is_server_error() {
            tracing::error!(
                nested_error = ?self,
                error_type = "GetMessageError",
                variant = self.as_ref(),
                "Internal server error");
        }

        (status_code, self.to_string()).into_response()
    }
}

#[derive(serde::Serialize, serde::Deserialize, Debug)]
pub struct PathParams {
    pub id: Uuid,
}

// TODO: deduplicate with internal api
#[utoipa::path(
    get,
    tag = "Messages",
    path = "/email/messages/{id}",
    operation_id = "get_message",
    params(
        ("id" = Uuid, Path, description = "Message ID."),
    ),
    responses(
            (status = 200, body=models_email::service::message::ParsedMessage),
            (status = 400, body=ErrorResponse),
            (status = 401, body=ErrorResponse),
            (status = 404, body=ErrorResponse),
            (status = 500, body=ErrorResponse),
    )
)]
#[tracing::instrument(skip(ctx, user_context), fields(user_id=user_context.user_id, fusionauth_user_id=user_context.fusion_user_id))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
    Path(PathParams { id }): Path<PathParams>,
) -> Result<Response, GetMessageError> {
    let message = email_db_client::messages::get_parsed::get_parsed_message_by_id(&ctx.db, &id)
        .await
        .context("Failed to get message by id")?;

    let Some(message) = message else {
        return Err(GetMessageError::MessageNotFound);
    };

    let link_ids = owned_link_ids(&ctx, &user_context.fusion_user_id).await?;
    if link_ids.contains(&message.link_id) {
        Ok(Json(message).into_response())
    } else {
        Err(GetMessageError::Unauthorized)
    }
}

// TODO: deduplicate with internal api
#[utoipa::path(
    post,
    tag = "Messages",
    path = "/email/messages/batch",
    operation_id = "get_messages_batch",
    responses(
            (status = 200, body=Vec<models_email::service::message::ParsedMessage>),
            (status = 400, body=ErrorResponse),
            (status = 401, body=ErrorResponse),
            (status = 404, body=ErrorResponse),
            (status = 500, body=ErrorResponse),
    )
)]
#[tracing::instrument(skip(ctx, user_context), fields(user_id=user_context.user_id, fusionauth_user_id=user_context.fusion_user_id))]
pub async fn batch_handler(
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
    Json(ids): Json<Vec<Uuid>>,
) -> Result<Response, GetMessageError> {
    let messages =
        email_db_client::messages::get_parsed::get_parsed_messages_by_id_batch(&ctx.db, &ids)
            .await
            .context("Failed to get messages by ids")?;

    if messages.is_empty() {
        tracing::trace!("no messages found");
        return Err(GetMessageError::MessageNotFound);
    }

    let link_ids = owned_link_ids(&ctx, &user_context.fusion_user_id).await?;
    let accessible_messages = messages
        .into_iter()
        .filter(|msg| link_ids.contains(&msg.link_id))
        .collect::<Vec<_>>();

    if accessible_messages.is_empty() {
        return Err(GetMessageError::Unauthorized);
    }

    if accessible_messages.len() == ids.len() {
        Ok(Json(accessible_messages).into_response())
    } else {
        let missing_ids: Vec<Uuid> = ids
            .iter()
            .filter(|id| !accessible_messages.iter().any(|m| m.db_id == **id))
            .cloned()
            .collect();

        tracing::warn!(
            missing_ids = ?missing_ids,
            "some ids not found in database or not authorized for access"
        );

        Ok(Json(accessible_messages).into_response())
    }
}
