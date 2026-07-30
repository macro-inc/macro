#[cfg(test)]
mod test;

use crate::context::{self};
use anyhow::Context;
use aws_lambda_events::eventbridge::EventBridgeEvent;
use chat::domain::events::{ChatMacroEvent, ChatPermanentlyDeletedMetadata};
use futures::future::join_all;
use lambda_runtime::{
    Error, LambdaEvent,
    tracing::{self},
};
use macro_db_client::projects::ProjectToDelete;
use macro_event_broker::MacroEventBroker;
use macro_user_id::user_id::MacroUserIdStr;
use projects::domain::events::{ProjectMacroEvent, ProjectPermanentlyDeletedMetadata};
use sqs_client::search::{SearchQueueMessage, document::DocumentId};

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

#[tracing::instrument(skip(event_broker, projects_to_delete), err)]
async fn publish_project_purge_events<B: MacroEventBroker>(
    event_broker: &B,
    projects_to_delete: &[ProjectToDelete],
) -> anyhow::Result<()> {
    let events = projects_to_delete
        .iter()
        .map(|project| {
            let project_id = project.project_id.clone();
            let owner: MacroUserIdStr<'static> = MacroUserIdStr::try_from(project.user_id.clone())
                .with_context(|| format!("invalid owner for project {}", project.project_id))?;

            Ok(ProjectMacroEvent::permanently_deleted(
                project_id.clone(),
                ProjectPermanentlyDeletedMetadata {
                    project_id: project_id.clone(),
                    owner,
                    actor_user_id: None,
                    parent_project_id: None,
                    purged_project_ids: vec![project_id],
                    purged_document_ids: Vec::new(),
                    purged_chat_ids: Vec::new(),
                },
            ))
        })
        .collect::<anyhow::Result<Vec<_>>>()?;

    let publications = events
        .iter()
        .map(|event| event_broker.send_event(event))
        .collect::<Vec<_>>();
    let publication_results = join_all(publications.into_iter().map(|publication| async move {
        let handle = publication.context("failed to enqueue project purge event")?;
        handle
            .await
            .context("project purge event publication task failed")?
            .context("failed to publish project purge event")
    }))
    .await;

    for result in publication_results {
        result?;
    }

    Ok(())
}

#[tracing::instrument(skip(event_broker, chat_ids), err)]
async fn publish_chat_purge_events<B: MacroEventBroker>(
    event_broker: &B,
    chat_ids: &[String],
) -> anyhow::Result<()> {
    let events = chat_ids
        .iter()
        .map(|chat_id| {
            ChatMacroEvent::permanently_deleted(ChatPermanentlyDeletedMetadata {
                chat_id: chat_id.clone(),
                actor_user_id: None,
                project_id: None,
            })
        })
        .collect::<Vec<_>>();

    let publications = events
        .iter()
        .map(|event| event_broker.send_event(event))
        .collect::<Vec<_>>();
    let publication_results = join_all(publications.into_iter().map(|publication| async move {
        let handle = publication.context("failed to enqueue chat purge event")?;
        handle
            .await
            .context("chat purge event publication task failed")?
            .context("failed to publish chat purge event")
    }))
    .await;

    for result in publication_results {
        result?;
    }

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

    publish_project_purge_events(&ctx.macro_event_broker, &projects_to_delete)
        .await
        .context("unable to publish project purge events")?;

    let project_ids = projects_to_delete
        .into_iter()
        .map(|project| project.project_id)
        .collect::<Vec<String>>();

    // We can actually perform the project deletion here as we will automatically be queuing all
    // the items in the project for deletion as well
    macro_db_client::projects::delete::delete_projects_bulk(&ctx.db, &project_ids)
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

    publish_chat_purge_events(&ctx.macro_event_broker, &chats_to_delete)
        .await
        .context("unable to publish chat purge events")?;

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
