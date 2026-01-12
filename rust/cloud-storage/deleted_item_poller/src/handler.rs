use crate::context::{self};
use anyhow::Context;
use aws_lambda_events::eventbridge::EventBridgeEvent;
use lambda_runtime::{
    Error, LambdaEvent,
    tracing::{self},
};
use sqs_client::search::{SearchQueueMessage, chat::RemoveChatMessage, document::DocumentId};

#[tracing::instrument(skip(ctx, _event), err)]
pub async fn handler(
    ctx: context::Context,
    _event: LambdaEvent<EventBridgeEvent>,
) -> Result<(), Error> {
    let _ = tokio::try_join!(
        handle_chats(&ctx),
        handle_documents(&ctx),
        handle_projects(&ctx)
    )?;

    Ok(())
}

#[tracing::instrument(skip(ctx), err)]
async fn handle_projects(ctx: &context::Context) -> anyhow::Result<()> {
    let date = chrono::Utc::now().naive_utc() - chrono::Duration::days(30);

    let projects_to_delete =
        macro_db_client::projects::get_projects_to_delete(&ctx.db, &date).await?;

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

    Ok(())
}

#[tracing::instrument(skip(ctx), err)]
async fn handle_chats(ctx: &context::Context) -> anyhow::Result<()> {
    let date = chrono::Utc::now().naive_utc() - chrono::Duration::days(30);

    let chats_to_delete = macro_db_client::chat::get_chats_to_delete(&ctx.db, &date).await?;

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
        .await?;

    ctx.sqs_client
        .bulk_enqueue_chat_delete(chats_to_delete)
        .await?;

    Ok(())
}

#[tracing::instrument(skip(ctx), err)]
async fn handle_documents(ctx: &context::Context) -> anyhow::Result<()> {
    let date = chrono::Utc::now().naive_utc() - chrono::Duration::days(30);

    let documents_to_delete =
        macro_db_client::document::get_all_documents::get_documents_to_delete(&ctx.db, &date)
            .await?;

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
        .await?;

    ctx.sqs_client
        .bulk_enqueue_document_delete(documents_to_delete)
        .await?;

    Ok(())
}
