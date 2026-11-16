//! Durable backfill publication with a row lock held through each queue send.
use macro_user_id::user_id::MacroUserIdStr;
use models_email::service::backfill::{
    BackfillOperation, BackfillPubsubMessage, FinalizeBackfillPayload, JobScopedPayload,
    PopulateCrmForUserPayload,
};
use models_email::service::thread::ListThreadsPayload;
use tracing::Instrument;
use uuid::Uuid;

const BATCH_SIZE: usize = 50;
/// One pending initialization publication.
#[derive(Clone)]
pub struct EmailInitOutboxRow {
    /// Stored outbox fact.
    pub id: Uuid,
    /// Stored outbox fact.
    pub backfill_job_id: Uuid,
    /// Stored outbox fact.
    pub email_link_id: Uuid,
    /// Stored outbox fact.
    pub priority_pass: bool,
    /// Stored outbox fact.
    pub refresh_existing: bool,
}

/// One pending completion publication.
#[derive(Clone)]
pub struct EmailCompletionOutboxRow {
    /// Stored outbox fact.
    pub id: Uuid,
    /// Stored outbox fact.
    pub backfill_job_id: Uuid,
    /// Stored outbox fact.
    pub email_link_id: Option<Uuid>,
}

/// Commit the transaction after publication and marking succeed.
pub trait OutboxTransaction: Send {
    /// Preserve the original commit or implicit rollback on drop.
    fn commit(self) -> impl Future<Output = anyhow::Result<()>> + Send;
}
/// Locked initialization requests.
pub trait InitOutboxTransaction: OutboxTransaction {
    /// Lock the next eligible row, or report no row.
    fn next(&mut self) -> impl Future<Output = anyhow::Result<Option<EmailInitOutboxRow>>> + Send;
    /// Mark the row as published inside this transaction.
    fn published(&mut self, id: Uuid) -> impl Future<Output = anyhow::Result<()>> + Send;
}
/// Locked completion requests.
pub trait CompletionOutboxTransaction: OutboxTransaction {
    /// Lock the next eligible row, including its canonical link.
    fn next(
        &mut self,
    ) -> impl Future<Output = anyhow::Result<Option<EmailCompletionOutboxRow>>> + Send;
    /// Mark the row as published, optionally retiring a deleted link's effects.
    fn published(
        &mut self,
        id: Uuid,
        retire: bool,
    ) -> impl Future<Output = anyhow::Result<()>> + Send;
}
/// One persisted consent publication.
#[derive(Clone)]
pub struct CrmOutboxRow {
    /// Team whose consent changed.
    pub team_id: Uuid,
    /// Owner whose mailbox was consented.
    pub user_id: String,
    /// Persisted parent trace metadata.
    pub traceparent: Option<String>,
}
/// Locked CRM requests and the associated consent check.
pub trait CrmOutboxTransaction: OutboxTransaction {
    /// Lock the next request.
    fn next(&mut self) -> impl Future<Output = anyhow::Result<Option<CrmOutboxRow>>> + Send;
    /// Read whether this request still has a consented primary mailbox.
    fn enabled(&mut self, row: &CrmOutboxRow) -> impl Future<Output = anyhow::Result<bool>> + Send;
    /// Delete a successfully handled request.
    fn delete(&mut self, row: &CrmOutboxRow) -> impl Future<Output = anyhow::Result<()>> + Send;
}
/// Open the existing transaction for each outbox family.
pub trait BackfillOutboxRepository: Send + Sync {
    /// Initialization transaction.
    type Init: InitOutboxTransaction;
    /// Completion transaction.
    type Completion: CompletionOutboxTransaction;
    /// CRM consent transaction.
    type Crm: CrmOutboxTransaction;
    /// Begin an initialization transaction.
    fn init(&self) -> impl Future<Output = anyhow::Result<Self::Init>> + Send;
    /// Begin a completion transaction.
    fn completion(&self) -> impl Future<Output = anyhow::Result<Self::Completion>> + Send;
    /// Begin a CRM transaction.
    fn crm(&self) -> impl Future<Output = anyhow::Result<Self::Crm>> + Send;
}
/// Publish the domain operation and propagate persisted trace metadata.
pub trait BackfillOutboxPublisher: Send + Sync {
    /// Send an operation with the existing queue attributes.
    fn publish(
        &self,
        message: BackfillPubsubMessage,
    ) -> impl Future<Output = anyhow::Result<()>> + Send;
    /// Restore the persisted parent onto the publication span.
    fn adopt(&self, span: &tracing::Span, traceparent: Option<&str>);
}
/// Publish pending completion requests.
#[tracing::instrument(skip(db, sqs), err)]
pub async fn drain_email_completion<R: BackfillOutboxRepository, Q: BackfillOutboxPublisher>(
    db: &R,
    sqs: &Q,
) -> anyhow::Result<usize> {
    let mut published = 0;
    for _ in 0..BATCH_SIZE {
        let mut tx = db.completion().await?;
        let row = tx.next().await?;

        let Some(row) = row else {
            tx.commit().await?;
            break;
        };
        let Some(message) = to_email_completion_message(&row) else {
            tx.published(row.id, true).await?;
            tx.commit().await?;
            published += 1;
            continue;
        };
        sqs.publish(message).await?;
        tx.published(row.id, false).await?;
        tx.commit().await?;
        published += 1;
    }
    Ok(published)
}

fn to_email_completion_message(row: &EmailCompletionOutboxRow) -> Option<BackfillPubsubMessage> {
    Some(BackfillPubsubMessage {
        backfill_operation: BackfillOperation::FinalizeBackfill(JobScopedPayload {
            link_id: row.email_link_id?,
            job_id: row.backfill_job_id,
            payload: FinalizeBackfillPayload {},
        }),
    })
}

/// Publish pending initialization requests.
#[tracing::instrument(skip(db, sqs), err)]
pub async fn drain_email_init<R: BackfillOutboxRepository, Q: BackfillOutboxPublisher>(
    db: &R,
    sqs: &Q,
) -> anyhow::Result<usize> {
    let mut published = 0;
    for _ in 0..BATCH_SIZE {
        let mut tx = db.init().await?;
        let row = tx.next().await?;

        let Some(row) = row else {
            tx.commit().await?;
            break;
        };
        let message = BackfillPubsubMessage {
            backfill_operation: BackfillOperation::ListThreads(JobScopedPayload {
                link_id: row.email_link_id,
                job_id: row.backfill_job_id,
                payload: ListThreadsPayload {
                    next_page_token: None,
                    priority_pass: row.priority_pass,
                    refresh_existing: row.refresh_existing,
                },
            }),
        };
        sqs.publish(message).await?;
        tx.published(row.id).await?;
        tx.commit().await?;
        published += 1;
    }
    Ok(published)
}

/// Publish consented CRM requests and retire withdrawn ones.
pub async fn drain_crm<R: BackfillOutboxRepository, Q: BackfillOutboxPublisher>(
    db: &R,
    sqs: &Q,
) -> anyhow::Result<()> {
    for _ in 0..BATCH_SIZE {
        let mut tx = db.crm().await?;
        let Some(row) = tx.next().await? else {
            break;
        };
        let publish_span =
            tracing::info_span!("crm.email_backfill.publish", team_id = %row.team_id);
        sqs.adopt(&publish_span, row.traceparent.as_deref());
        async {
            let enabled = tx.enabled(&row).await?;
            if enabled {
                sqs.publish(BackfillPubsubMessage {
                    backfill_operation: BackfillOperation::PopulateCrmForUser(
                        PopulateCrmForUserPayload {
                            macro_id: MacroUserIdStr::try_from(row.user_id.clone())?,
                        },
                    ),
                })
                .await?;
            }
            tx.delete(&row).await?;
            tx.commit().await?;
            anyhow::Ok(())
        }
        .instrument(publish_span)
        .await?;
    }
    Ok(())
}

#[cfg(test)]
mod test;
