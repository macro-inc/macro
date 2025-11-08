use crate::context::{self};
use anyhow::Context;
use aws_lambda_events::eventbridge::EventBridgeEvent;
use lambda_runtime::tracing::Instrument;
use lambda_runtime::{
    Error, LambdaEvent,
    tracing::{self},
};
use sqs_client::search::{
    SearchQueueMessage, chat::RemoveChatMessage, document::DocumentId, project,
};

#[tracing::instrument(skip(ctx, _event))]
pub async fn handler(
    ctx: context::Context,
    _event: LambdaEvent<EventBridgeEvent>,
) -> Result<(), Error> {
    let chat_handle = tokio::spawn({
        let ctx = ctx.clone();
        async move { handle_chats(&ctx).await }
    });

    let document_handle = tokio::spawn({
        let ctx = ctx.clone();
        async move { handle_documents(&ctx).await }
    });

    let project_handle = tokio::spawn({
        let ctx = ctx.clone();
        async move { handle_projects(&ctx).await }
    });

    // Use tokio::try_join! macro
    let (chat_result, document_result, project_result) =
        tokio::try_join!(chat_handle, document_handle, project_handle)?;

    // Propagate any errors from the tasks
    project_result.context("error handling projects")?;
    chat_result.context("error handling chats")?;
    document_result.context("error handling documents")?;

    Ok(())
}

#[tracing::instrument(skip(ctx))]
async fn handle_projects(ctx: &context::Context) -> anyhow::Result<()> {
    let date = chrono::Utc::now().naive_utc() - chrono::Duration::days(30);

    let projects_to_delete = macro_db_client::projects::get_projects_to_delete(&ctx.db, &date)
        .await
        .context("unable to get projects to delete")?;

    if projects_to_delete.is_empty() {
        tracing::info!("no projects to delete");
        return Ok(());
    }

    tracing::debug!(projects_to_delete=?projects_to_delete, "projects to delete");

    // We can actually perform the project deletion here as we will automatically be queuing all
    // the items in the project for deletion as well
    macro_db_client::projects::delete::delete_projects_bulk(&ctx.db, &projects_to_delete)
        .await
        .context("unable to delete projects")?;

    // delete projects from search
    tokio::spawn({
        let sqs_client = ctx.sqs_client.clone();
        let project_ids = projects_to_delete.clone();
        async move {
            tracing::trace!("sending message to search extractor queue");
            let _ = sqs_client
                .send_message_to_search_event_queue(SearchQueueMessage::BulkRemoveProjectMessage(
                    project::BulkRemoveProjectMessage { project_ids },
                ))
                .await
                .inspect_err(|e| {
                    tracing::error!(error=?e, "SEARCH_QUEUE unable to enqueue message");
                });
        }
        .in_current_span()
    });

    Ok(())
}

#[tracing::instrument(skip(ctx))]
async fn handle_chats(ctx: &context::Context) -> anyhow::Result<()> {
    let date = chrono::Utc::now().naive_utc() - chrono::Duration::days(30);

    let chats_to_delete = macro_db_client::chat::get_chats_to_delete(&ctx.db, &date)
        .await
        .context("unable to get chats to delete")?;

    if chats_to_delete.is_empty() {
        tracing::info!("no chats to delete");
        return Ok(());
    }

    tracing::debug!(chats_to_delete=?chats_to_delete, "chats to delete");

    ctx.sqs_client
        .bulk_send_message_to_search_event_queue(
            chats_to_delete
                .iter()
                .map(|id| {
                    SearchQueueMessage::RemoveChatMessage(RemoveChatMessage {
                        chat_id: id.to_string(),
                        message_id: None,
                    })
                })
                .collect(),
        )
        .await
        .context("unable to enqueue chat delete for search")?;

    ctx.sqs_client
        .bulk_enqueue_chat_delete(chats_to_delete)
        .await
        .context("unable to enqueue chat delete")?;

    Ok(())
}

#[tracing::instrument(skip(ctx))]
async fn handle_documents(ctx: &context::Context) -> anyhow::Result<()> {
    let date = chrono::Utc::now().naive_utc() - chrono::Duration::days(30);

    let documents_to_delete =
        macro_db_client::document::get_all_documents::get_documents_to_delete(&ctx.db, &date)
            .await
            .context("unable to get documents to delete")?;

    if documents_to_delete.is_empty() {
        tracing::info!("no documents to delete");
        return Ok(());
    }

    tracing::debug!(documents_to_delete=?documents_to_delete, "documents to delete");

    ctx.sqs_client
        .bulk_send_message_to_search_event_queue(
            documents_to_delete
                .iter()
                .map(|id| {
                    SearchQueueMessage::RemoveDocument(DocumentId {
                        document_id: id.to_string(),
                    })
                })
                .collect(),
        )
        .await
        .context("unable to enqueue chat delete for search")?;

    ctx.sqs_client
        .bulk_enqueue_document_delete(documents_to_delete)
        .await
        .context("unable to enqueue document delete")?;

    Ok(())
}
