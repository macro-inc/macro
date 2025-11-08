use crate::{api::context::ApiContext, model::request::documents::edit::EditDocumentRequestV2};
use anyhow::Context;
use axum::{
    http::StatusCode,
    response::{IntoResponse, Json, Response},
};
use macro_share_permissions::user_item_access::update_user_item_access;
use model::{
    document::{DocumentBasic, FileType},
    response::{ErrorResponse, GenericSuccessResponse, SuccessResponse},
    user::UserContext,
};
use models_permissions::share_permission::UpdateSharePermissionRequestV2;
use models_permissions::share_permission::access_level::AccessLevel;
use sqs_client::search::{SearchQueueMessage, document::DocumentId};
use tracing::Instrument;

pub async fn edit_document(
    ctx: &ApiContext,
    document_context: DocumentBasic,
    users_access_level: AccessLevel,
    req: EditDocumentRequestV2,
    user_context: &UserContext,
) -> Result<Response, Response> {
    let share_permission: Option<UpdateSharePermissionRequestV2> = req.share_permission.clone();
    // Overrides the document name cleaned document name (removing file extension)
    // if it was accidentally included
    let document_name = req.document_name.map(FileType::clean_document_name);

    if req.project_id.is_some() && users_access_level != AccessLevel::Owner {
        return Err((
            StatusCode::UNAUTHORIZED,
            Json(ErrorResponse {
                message: "you do not have valid permissions to move this item",
            }),
        )
            .into_response());
    }

    if req.share_permission.is_some() && users_access_level != AccessLevel::Owner {
        return Err((
            StatusCode::UNAUTHORIZED,
            Json(ErrorResponse {
                message: "you do not have valid permission to modify share permissions",
            }),
        )
            .into_response());
    }

    if let Err(err) = edit_document_transaction(
        ctx,
        user_context,
        &document_context,
        document_name.clone(),
        req.project_id.clone(),
        share_permission.as_ref(),
    )
    .await
    {
        tracing::error!(error=?err, "Failed to edit document");
        return Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                message: "unable to edit document",
            }),
        )
            .into_response());
    }

    // update project modified if necessary
    macro_project_utils::update_project_modified(
        &ctx.db,
        &ctx.macro_notify_client,
        macro_project_utils::ProjectModifiedArgs {
            project_id: req.project_id,
            old_project_id: document_context.project_id,
            user_id: user_context.user_id.clone(),
        },
    )
    .await;

    // If an important attribute is updated we will need to send a message to the search extractor
    if document_name.is_some() {
        tokio::spawn({
            let sqs_client = ctx.sqs_client.clone();
            let document_id = document_context.document_id.clone();
            async move {
                tracing::trace!("sending message to search extractor queue");
                let _ = sqs_client
                    .send_message_to_search_event_queue(SearchQueueMessage::UpdateDocumentMetadata(
                        DocumentId { document_id },
                    ))
                    .await
                    .inspect_err(|e| {
                        tracing::error!(error=?e, "SEARCH_QUEUE unable to enqueue message");
                    });
            }
            .in_current_span()
        });
    }

    Ok((
        StatusCode::OK,
        Json(SuccessResponse {
            error: false,
            data: GenericSuccessResponse::default(),
        }),
    )
        .into_response())
}

#[tracing::instrument(skip(ctx, user_context, document_context))]
async fn edit_document_transaction(
    ctx: &ApiContext,
    user_context: &UserContext,
    document_context: &DocumentBasic,
    document_name: Option<String>,
    project_id: Option<String>,
    share_permission: Option<&UpdateSharePermissionRequestV2>,
) -> anyhow::Result<()> {
    let mut transaction = ctx
        .db
        .begin()
        .await
        .context("failed to begin transaction")?;

    // Update document metadata
    macro_db_client::document::v2::edit::edit_document(
        &mut transaction,
        &document_context.document_id,
        document_name.as_deref(),
        project_id.as_deref(),
        share_permission,
    )
    .await
    .context("failed to edit document")?;

    // Update user item access if share permissions are changing
    if let Some(share_permission) = share_permission {
        update_user_item_access(
            &mut transaction,
            &ctx.comms_service_client,
            &user_context.user_id,
            &document_context.document_id,
            "document",
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
