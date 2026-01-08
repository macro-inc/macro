use crate::{api::context::ApiContext, model::request::chats::PatchChatRequestV2};
use anyhow::{Context, Result};
use axum::{
    Extension, Json,
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use macro_middleware::cloud_storage::ensure_access::{
    chat::ChatAccessLevelExtractor, project::ProjectBodyAccessLevelExtractor,
};
use macro_share_permissions::user_item_access::update_user_item_access;
use model::{chat::ChatBasic, response::ErrorResponse, user::UserContext};
use models_permissions::share_permission::access_level::{
    AccessLevel, EditAccessLevel, OwnerAccessLevel,
};

#[derive(serde::Deserialize)]
pub struct Params {
    pub chat_id: String,
}

#[tracing::instrument(skip(user_context, state), fields(user_id=?user_context.user_id))]
pub async fn patch_chat_handler(
    ChatAccessLevelExtractor { access_level, .. }: ChatAccessLevelExtractor<OwnerAccessLevel>,
    State(state): State<ApiContext>,
    user_context: Extension<UserContext>,
    chat_context: Extension<ChatBasic>,
    Path(Params { chat_id }): Path<Params>,
    project: ProjectBodyAccessLevelExtractor<EditAccessLevel, PatchChatRequestV2>,
) -> Result<Response, Response> {
    let req = project.into_inner();
    if chat_context.deleted_at.is_some() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                message: "cannot modify deleted chat",
            }),
        )
            .into_response());
    }

    patch_chat_v2(
        &state,
        user_context,
        chat_context,
        access_level,
        chat_id,
        req,
    )
    .await
    .map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                message: "unable to patch chat",
            }),
        )
            .into_response()
    })?;

    Ok((StatusCode::OK).into_response())
}

#[tracing::instrument(skip(ctx, user_context, chat_context, req), fields(user_id = %user_context.user_id, chat_id = %chat_id))]
async fn patch_chat_v2(
    ctx: &ApiContext,
    user_context: Extension<UserContext>,
    chat_context: Extension<ChatBasic>,
    users_access_level: AccessLevel,
    chat_id: String,
    req: PatchChatRequestV2,
) -> Result<(), (StatusCode, String)> {
    if req.project_id.is_some() && users_access_level != AccessLevel::Owner {
        return Err((
            StatusCode::UNAUTHORIZED,
            "you do not have valid permissions to move this item".to_string(),
        ));
    }

    if req.share_permission.is_some() && users_access_level != AccessLevel::Owner {
        return Err((
            StatusCode::UNAUTHORIZED,
            "you do not have valid permission to modify share permissions".to_string(),
        ));
    }

    let share_permission: Option<
        models_permissions::share_permission::UpdateSharePermissionRequestV2,
    > = req.share_permission;

    patch_chat_transaction(
        ctx,
        &user_context,
        &chat_id,
        req.name.as_deref(),
        req.model.as_deref(),
        req.project_id.as_deref(),
        share_permission.as_ref(),
    )
    .await
    .map_err(|_e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "unable to patch chat".to_string(),
        )
    })?;

    macro_project_utils::update_project_modified(
        &ctx.db,
        &ctx.macro_notify_client,
        macro_project_utils::ProjectModifiedArgs {
            project_id: req.project_id.clone(),
            old_project_id: chat_context.project_id.clone(),
            user_id: user_context.user_id.clone(),
        },
    )
    .await;

    if req.name.is_some() {
        match macro_uuid::string_to_uuid(&chat_id) {
            Ok(chat_id) => {
                let _ = ctx
                    .sqs_client
                    .send_message_to_search_event_queue(
                        sqs_client::search::SearchQueueMessage::UpdateEntityName(
                            sqs_client::search::name::EntityName {
                                entity_id: chat_id,
                                entity_type: models_opensearch::SearchEntityType::Chats,
                            },
                        ),
                    )
                    .await
                    .inspect_err(|e| {
                        tracing::error!(error=?e, "SEARCH_QUEUE unable to enqueue message");
                    });
            }
            Err(err) => {
                tracing::error!(error=?err, "failed to convert chat_id to uuid");
            }
        }
    }

    Ok(())
}

#[tracing::instrument(err, skip(ctx, user_context, share_permission), fields(user_id = %user_context.user_id))]
async fn patch_chat_transaction(
    ctx: &ApiContext,
    user_context: &UserContext,
    chat_id: &str,
    name: Option<&str>,
    model: Option<&str>,
    project_id: Option<&str>,
    share_permission: Option<&models_permissions::share_permission::UpdateSharePermissionRequestV2>,
) -> anyhow::Result<()> {
    let mut transaction = ctx
        .db
        .begin()
        .await
        .context("failed to begin transaction")?;

    // Update chat metadata
    macro_db_client::chat::patch::patch_chat(
        &mut transaction,
        chat_id,
        name,
        model,
        None,
        share_permission,
        project_id,
    )
    .await
    .context("failed to patch chat")?;

    // Update user access if share permissions are provided
    if let Some(share_permission) = share_permission {
        update_user_item_access(
            &mut transaction,
            &ctx.comms_service_client,
            &user_context.user_id,
            chat_id,
            "chat",
            share_permission,
        )
        .await
        .context("failed to update user item access")?;
    }

    transaction
        .commit()
        .await
        .context("failed to commit transaction")?;

    Ok(())
}
