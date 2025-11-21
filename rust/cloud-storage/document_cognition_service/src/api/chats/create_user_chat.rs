use crate::{
    api::context::ApiContext,
    core::{
        constants::{
            DEFAULT_CHANNEL_TOKENS, DEFAULT_CHAT_NAME, DEFAULT_EMAIL_TOKENS, DEFAULT_IMAGE_TOKENS,
        },
        model::FALLBACK_MODEL,
    },
    model::request::chats::CreateChatRequest,
    service::attachment::document::get_document_token_count,
};
use anyhow::Context;
use axum::{
    Json,
    extract::{Extension, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use macro_db_client::dcs::create_chat;
use macro_middleware::cloud_storage::ensure_access::{
    get_users_access_level_v2, project::ProjectBodyAccessLevelExtractor,
};
use model::chat::NewChatAttachment;
use model::{chat::AttachmentType, response::StringIDResponse, user::UserContext};
use models_permissions::share_permission::access_level::EditAccessLevel;
use sqs_client::search::SearchQueueMessage;
use tracing::Instrument;

#[utoipa::path(
        post,
        path = "/chats",
        responses(
            (status = 201, body=StringIDResponse),
            (status = 401, body=String),
            (status = 404, body=String),
            (status = 500, body=String),
        )
    )]
#[tracing::instrument(skip(state, user_context), fields(user_id=?user_context.user_id))]
pub(in crate::api) async fn create_chat_handler(
    State(state): State<ApiContext>,
    user_context: Extension<UserContext>,
    project: ProjectBodyAccessLevelExtractor<EditAccessLevel, CreateChatRequest>,
) -> Result<Response, Response> {
    let req = project.into_inner();

    for attachment in req.attachments.as_ref().unwrap_or(&vec![]) {
        if attachment.attachment_type == AttachmentType::Document {
            get_users_access_level_v2(
                &state.db,
                &state.comms_service_client,
                &user_context.user_id,
                &attachment.attachment_id,
                "document",
            )
            .await
            .map_err(|err| {
                tracing::error!(
                    error = ?err,
                    user_id = %user_context.user_id,
                    attachment_id = %attachment.attachment_id,
                    "failed to verify document access"
                );
                (
                    StatusCode::UNAUTHORIZED,
                    "No access to document".to_string(),
                )
                    .into_response()
            })?
            .ok_or_else(|| {
                tracing::error!(
                    user_id = %user_context.user_id,
                    attachment_id = %attachment.attachment_id,
                    "user has no access to document"
                );
                (
                    StatusCode::UNAUTHORIZED,
                    "No access to document".to_string(),
                )
                    .into_response()
            })?;
        }
    }

    let string_id_response = create_user_chat_v2(&state, user_context, req)
        .await
        .map_err(|(status_code, err)| (status_code, err).into_response())?;

    Ok((StatusCode::OK, Json(string_id_response)).into_response())
}

#[tracing::instrument(
    skip(ctx, user_context, req),
    fields(
        user_id = %user_context.user_id,
        project_id = ?req.project_id,
        model = ?req.model,
        attachment_count = req.attachments.as_ref().map(|a| a.len()).unwrap_or(0),
    )
)]
pub async fn create_user_chat_v2(
    ctx: &ApiContext,
    user_context: Extension<UserContext>,
    req: CreateChatRequest,
) -> Result<StringIDResponse, (StatusCode, String)> {
    let chat_name = req.name.unwrap_or(DEFAULT_CHAT_NAME.to_string());
    let share_permission = macro_share_permissions::share_permission::create_new_share_permission();

    let attachment_token_count =
        futures::future::try_join_all(req.attachments.as_ref().into_iter().flatten().map(
            |attachment| {
                let ctx = ctx.clone();
                async move {
                    match &attachment.attachment_type {
                        AttachmentType::Document => {
                            get_document_token_count(&ctx, &attachment.attachment_id)
                                .await
                                .context("failed to get document token count")
                        }
                        AttachmentType::Image => Ok(DEFAULT_IMAGE_TOKENS),
                        AttachmentType::Channel => Ok(DEFAULT_CHANNEL_TOKENS),
                        AttachmentType::Email => Ok(DEFAULT_EMAIL_TOKENS),
                    }
                }
            },
        ))
        .await
        .map_err(|err| {
            tracing::error!(error = %err, "failed to calculate attachment token count");
            (
                StatusCode::BAD_REQUEST,
                "unsupported attachment type".to_string(),
            )
        })?
        .iter()
        .sum();

    let chat = create_chat::create_chat_v2(
        &ctx.db,
        &user_context.user_id,
        &chat_name,
        req.model.unwrap_or(FALLBACK_MODEL),
        req.project_id.as_deref(),
        &share_permission,
        req.attachments
            .unwrap_or_default()
            .into_iter()
            .map(|attachment| NewChatAttachment {
                attachment_id: attachment.attachment_id,
                attachment_type: attachment.attachment_type,
                // this is only known after creating the row in the db so it mutated in the inner function. Yes this type should be refactored,
                chat_id: "cope".into(),
            })
            .collect(),
        attachment_token_count,
        req.is_persistent.unwrap_or(false),
    )
    .await
    .map_err(|err| {
        tracing::error!(error = %err, "failed to create chat in database");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "unable to create chat".to_string(),
        )
    })?;

    macro_project_utils::update_project_modified(
        &ctx.db,
        &ctx.macro_notify_client,
        macro_project_utils::ProjectModifiedArgs {
            project_id: req.project_id.clone(),
            old_project_id: None,
            user_id: user_context.user_id.clone(),
        },
    )
    .await;

    tokio::spawn({
        let sqs_client = ctx.sqs_client.clone();
        let chat_id = chat.clone();
        async move {
            tracing::trace!("sending message to search extractor queue");
            let chat_id = match macro_uuid::string_to_uuid(&chat_id) {
                Ok(chat_id) => chat_id,
                Err(err) => {
                    tracing::error!(error=?err, "failed to convert chat_id to uuid");
                    return;
                }
            };

            let _ = sqs_client
                .send_message_to_search_event_queue(SearchQueueMessage::UpdateEntityName(
                    sqs_client::search::name::UpdateEntityName {
                        entity_id: chat_id,
                        entity_type: models_opensearch::SearchEntityType::Chats,
                    },
                ))
                .await
                .inspect_err(|e| {
                    tracing::error!(error=?e, "SEARCH_QUEUE unable to enqueue message");
                });
        }
        .in_current_span()
    });

    Ok(StringIDResponse { id: chat })
}
