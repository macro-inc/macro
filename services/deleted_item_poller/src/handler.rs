#[cfg(test)]
mod test;

use std::time::{Duration, SystemTime};

use crate::context::{self};
use anyhow::Context;
use aws_lambda_events::eventbridge::EventBridgeEvent;
use chat::domain::events::{ChatMacroEvent, ChatPermanentlyDeletedMetadata};
use documents::domain::events::{DocumentMacroEvent, DocumentPurgedMetadata};
use futures::{StreamExt, future::join_all};
use lambda_runtime::{
    Error, LambdaEvent,
    tracing::{self},
};
use macro_db_client::document::get_all_documents::{ExpiredDocument, get_documents_to_delete};
use macro_db_client::projects::ProjectToDelete;
use macro_event_broker::MacroEventBroker;
use model_owner::Owner;
use projects::domain::events::{ProjectMacroEvent, ProjectPermanentlyDeletedMetadata};

/// How many expired documents one run purges, and in what steps.
#[derive(Clone, Copy, Debug)]
struct DocumentPurgeLimits {
    /// The most documents one run hands to the delete queue.
    run_cap: usize,
    /// Documents read, published and enqueued together.
    page_size: usize,
}

/// A backlog of expired documents drains over several runs, at most
/// `run_cap` every four hours. A document stays in trash until the storage
/// service's delete worker removes it, so a run that queued more than that
/// worker clears before the next run would see those documents again and
/// queue them twice.
const DOCUMENT_PURGE_LIMITS: DocumentPurgeLimits = DocumentPurgeLimits {
    run_cap: 50_000,
    page_size: 1_000,
};

/// The most messages SQS accepts in one `SendMessageBatch`.
const SQS_MAX_BATCH_SIZE: usize = 10;

/// Document delete batches in flight at once.
const CONCURRENT_DOCUMENT_DELETE_BATCHES: usize = 8;

/// A run starts no new page this close to the Lambda deadline, so it ends
/// between pages instead of being cut off inside one.
const DEADLINE_MARGIN: Duration = Duration::from_secs(30);

/// The storage service's document delete queue.
trait DocumentDeleteQueue: Sync {
    /// Enqueue one SQS batch of document deletes.
    fn enqueue(&self, document_ids: Vec<String>)
    -> impl Future<Output = anyhow::Result<()>> + Send;
}

impl DocumentDeleteQueue for sqs_client::SQS {
    async fn enqueue(&self, document_ids: Vec<String>) -> anyhow::Result<()> {
        self.bulk_enqueue_document_delete(document_ids).await
    }
}

/// What one run did with expired documents.
#[derive(Debug, Default)]
struct DocumentPurgeRun {
    selected: usize,
    pages: usize,
    events_published: usize,
    events_failed: usize,
    delete_batches_sent: usize,
    delete_batches_failed: usize,
    enqueued: usize,
    /// The run stopped at its cap with expired documents left over.
    cap_reached: bool,
    /// The run stopped early because the Lambda deadline was near.
    deadline_reached: bool,
    /// When the oldest document this run left in trash was trashed.
    oldest_remaining: Option<chrono::NaiveDateTime>,
    first_failure: Option<anyhow::Error>,
}

impl DocumentPurgeRun {
    fn record(&self, span: &tracing::Span) {
        span.record("document.selected_count", self.selected as i64);
        span.record("page.count", self.pages as i64);
        span.record("event.published_count", self.events_published as i64);
        span.record("event.failed_count", self.events_failed as i64);
        span.record("delete_batch.sent_count", self.delete_batches_sent as i64);
        span.record(
            "delete_batch.failed_count",
            self.delete_batches_failed as i64,
        );
        span.record("document.enqueued_count", self.enqueued as i64);
        span.record("run.cap_reached", self.cap_reached);
        span.record("run.deadline_reached", self.deadline_reached);

        if let Some(oldest_remaining) = self.oldest_remaining {
            span.record(
                "backlog.oldest_deleted_at",
                tracing::field::display(oldest_remaining),
            );
        }
    }

    fn fail(&mut self, error: anyhow::Error) {
        self.first_failure.get_or_insert(error);
    }
}

#[tracing::instrument(skip(ctx, event), err)]
pub async fn handler(
    ctx: context::Context,
    event: LambdaEvent<EventBridgeEvent>,
) -> Result<(), Error> {
    let deadline = event.context.deadline();

    // Each kind runs to the end even when another fails: cancelling a
    // document run mid-page would waste the page it was on.
    let (chats, documents, projects) = tokio::join!(
        handle_chats(&ctx),
        handle_documents(&ctx, deadline),
        handle_projects(&ctx)
    );
    chats?;
    documents?;
    projects?;

    Ok(())
}

/// Publish a purge event for each document and wait for every delivery.
/// Returns the documents whose event was delivered.
#[tracing::instrument(skip_all, fields(document.count = document_ids.len() as i64))]
async fn publish_document_purge_events<B: MacroEventBroker>(
    event_broker: &B,
    document_ids: Vec<String>,
    run: &mut DocumentPurgeRun,
) -> Vec<String> {
    let publications = join_all(document_ids.into_iter().map(|document_id| async move {
        let event = DocumentMacroEvent::purged(
            document_id.clone(),
            DocumentPurgedMetadata {
                document_id: document_id.clone(),
            },
        );
        let delivery = async {
            let handle = event_broker
                .send_event(&event)
                .context("failed to enqueue document purge event")?;
            handle
                .await
                .context("document purge event publication task failed")?
                .context("failed to publish document purge event")
        };
        (document_id, delivery.await)
    }))
    .await;

    let mut delivered = Vec::with_capacity(publications.len());
    for (document_id, delivery) in publications {
        match delivery {
            Ok(()) => delivered.push(document_id),
            Err(error) => {
                run.events_failed += 1;
                run.fail(error);
            }
        }
    }
    run.events_published += delivered.len();

    delivered
}

/// Enqueue documents for storage deletion in SQS batches, a few at a time.
/// Every batch is tried, so one failed batch does not strand the ones after it.
async fn enqueue_document_deletes<Q: DocumentDeleteQueue>(
    delete_queue: &Q,
    document_ids: Vec<String>,
    run: &mut DocumentPurgeRun,
) {
    let batches = document_ids
        .chunks(SQS_MAX_BATCH_SIZE)
        .map(<[_]>::to_vec)
        .collect::<Vec<_>>();
    let mut sends = futures::stream::iter(batches)
        .map(|batch| async move {
            let size = batch.len();
            (size, delete_queue.enqueue(batch).await)
        })
        .buffer_unordered(CONCURRENT_DOCUMENT_DELETE_BATCHES);

    while let Some((size, sent)) = sends.next().await {
        match sent {
            Ok(()) => {
                run.delete_batches_sent += 1;
                run.enqueued += size;
            }
            Err(error) => {
                run.delete_batches_failed += 1;
                run.fail(error.context("unable to enqueue a document delete batch"));
            }
        }
    }
}

/// Purge the oldest expired documents, a page at a time, up to the run's cap
/// or until the Lambda deadline is near.
///
/// A document's purge event is delivered before it is queued for storage
/// deletion, and a document whose event failed is not queued. Whatever fails
/// stays in trash, so the next run finds it and tries again: a repeated purge
/// event only removes the document from search again, which is harmless.
async fn purge_expired_document_pages<B: MacroEventBroker, Q: DocumentDeleteQueue>(
    db: &sqlx::PgPool,
    event_broker: &B,
    delete_queue: &Q,
    cutoff: chrono::NaiveDateTime,
    limits: DocumentPurgeLimits,
    deadline: SystemTime,
    run: &mut DocumentPurgeRun,
) -> anyhow::Result<()> {
    let mut after: Option<ExpiredDocument> = None;

    while run.selected < limits.run_cap {
        if SystemTime::now() + DEADLINE_MARGIN >= deadline {
            run.deadline_reached = true;
            break;
        }

        let page_size = limits.page_size.min(limits.run_cap - run.selected);
        let page = get_documents_to_delete(db, &cutoff, after.as_ref(), page_size as i64).await?;
        let is_last_page = page.len() < page_size;

        run.pages += 1;
        run.selected += page.len();
        after = page.last().cloned();

        let document_ids = page.into_iter().map(|document| document.id).collect();
        let delivered = publish_document_purge_events(event_broker, document_ids, run).await;
        enqueue_document_deletes(delete_queue, delivered, run).await;

        if is_last_page {
            return Ok(());
        }
    }

    run.oldest_remaining = get_documents_to_delete(db, &cutoff, after.as_ref(), 1)
        .await?
        .first()
        .map(|document| document.deleted_at);
    run.cap_reached = !run.deadline_reached && run.oldest_remaining.is_some();

    Ok(())
}

#[tracing::instrument(
    name = "deleted_item_poller.purge_documents",
    skip_all,
    fields(
        document.selected_count = tracing::field::Empty,
        page.count = tracing::field::Empty,
        event.published_count = tracing::field::Empty,
        event.failed_count = tracing::field::Empty,
        delete_batch.sent_count = tracing::field::Empty,
        delete_batch.failed_count = tracing::field::Empty,
        document.enqueued_count = tracing::field::Empty,
        run.cap_reached = tracing::field::Empty,
        run.deadline_reached = tracing::field::Empty,
        backlog.oldest_deleted_at = tracing::field::Empty,
    ),
    err
)]
async fn purge_expired_documents<B: MacroEventBroker, Q: DocumentDeleteQueue>(
    db: &sqlx::PgPool,
    event_broker: &B,
    delete_queue: &Q,
    cutoff: chrono::NaiveDateTime,
    limits: DocumentPurgeLimits,
    deadline: SystemTime,
) -> anyhow::Result<DocumentPurgeRun> {
    let mut run = DocumentPurgeRun::default();
    let pages = purge_expired_document_pages(
        db,
        event_broker,
        delete_queue,
        cutoff,
        limits,
        deadline,
        &mut run,
    )
    .await;

    run.record(&tracing::Span::current());
    tracing::info!("expired document purge run finished");

    pages.context("unable to read expired documents")?;
    if let Some(failure) = run.first_failure.take() {
        return Err(failure.context(format!(
            "{} document purge events and {} document delete batches failed",
            run.events_failed, run.delete_batches_failed
        )));
    }

    Ok(run)
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
            let owner = Owner::from_principal_str(&project.user_id)
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

async fn handle_documents(ctx: &context::Context, deadline: SystemTime) -> anyhow::Result<()> {
    let cutoff = chrono::Utc::now().naive_utc() - chrono::Duration::days(30);

    purge_expired_documents(
        &ctx.db,
        &ctx.macro_event_broker,
        ctx.sqs_client.as_ref(),
        cutoff,
        DOCUMENT_PURGE_LIMITS,
        deadline,
    )
    .await?;

    Ok(())
}
