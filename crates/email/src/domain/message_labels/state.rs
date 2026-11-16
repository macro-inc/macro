//! Label-state decisions over statement-sized persistence capabilities.

#[cfg(feature = "mailbox")]
use models_email::service::label::Label;
use std::collections::HashMap;
use uuid::Uuid;

#[cfg(test)]
mod test;

/// Position of one pending write among the writes for a message's labels.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LabelWriteTurn {
    /// This write can reach Gmail now.
    Send,
    /// A newer unconfirmed write must finish first.
    Wait,
    /// A newer confirmed write already owns the state.
    Superseded,
}

/// Facts for one requested message/label pair, selected by persistence.
#[derive(Debug)]
pub struct LabelWriteFacts {
    /// Message whose pending write was inspected.
    pub message_id: Uuid,
    /// Whether the requested write has a row.
    pub claimed: bool,
    /// Whether any later row exists.
    pub has_newer: bool,
    /// Whether a later row still awaits delivery.
    pub waits: bool,
}

/// State selected atomically when removing a pending write.
#[derive(Debug)]
pub struct LabelRestore {
    /// Message whose label can be restored.
    pub message_id: Uuid,
    /// Provider label to restore.
    pub provider_label_id: String,
    /// Selected fallback state.
    pub label_present: bool,
}

/// Statement-sized operations on a caller-owned transaction or read connection.
pub trait PendingLabelQueries: Send {
    /// Original persistence failure, preserved for the transaction caller.
    type Err: std::fmt::Display + std::fmt::Debug + Send + Sync;
    /// Read pending-write facts without interpreting them.
    fn facts(
        &mut self,
        messages: &[Uuid],
        labels: &[String],
        write: Uuid,
    ) -> impl Future<Output = Result<Vec<LabelWriteFacts>, Self::Err>> + Send;
}

/// Restoration statements on the caller's existing transaction.
pub trait PendingLabelRestore: Send {
    /// Original persistence failure, preserved for the transaction caller.
    type Err: std::fmt::Display + std::fmt::Debug + Send + Sync;
    /// Remove this write and return the fallback states selected atomically.
    fn remove(
        &mut self,
        messages: &[Uuid],
        write: Uuid,
    ) -> impl Future<Output = Result<Vec<LabelRestore>, Self::Err>> + Send;
    /// Insert the supplied parallel message/label pairs.
    fn restore_present(
        &mut self,
        link: Uuid,
        messages: &[Uuid],
        labels: &[String],
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;
    /// Delete the supplied parallel message/label pairs.
    fn restore_absent(
        &mut self,
        link: Uuid,
        messages: &[Uuid],
        labels: &[String],
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;
    /// Refresh flags from the restored label relations.
    fn refresh_flags(
        &mut self,
        messages: &[Uuid],
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;
}

/// Atomic pending-write insertion on the caller's connection or pool.
pub trait PendingLabelMark: Send {
    /// Original persistence failure.
    type Err: std::fmt::Display + std::fmt::Debug + Send + Sync;
    /// Insert the pending-write rows using the storage-owned before-state and expiry.
    fn mark(
        &mut self,
        link: Uuid,
        messages: &[Uuid],
        label: &str,
        present: bool,
        write: Uuid,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;
}

/// Atomic confirmation on a caller-owned transaction.
pub trait PendingLabelConfirm: Send {
    /// Original persistence failure.
    type Err: std::fmt::Display + std::fmt::Debug + Send + Sync;
    /// Apply the atomic confirmation transition.
    fn confirm(
        &mut self,
        messages: &[Uuid],
        write: Uuid,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;
}

/// Record a nonempty pending-write batch.
#[tracing::instrument(
    target = "email_db_client::labels::pending_writes",
    skip(executor, message_ids),
    err
)]
pub async fn mark_pending_label_writes<Q: PendingLabelMark>(
    executor: &mut Q,
    link_id: Uuid,
    message_ids: &[Uuid],
    provider_label_id: &str,
    label_present: bool,
    write_id: Uuid,
) -> Result<(), Q::Err> {
    if message_ids.is_empty() {
        return Ok(());
    }
    executor
        .mark(
            link_id,
            message_ids,
            provider_label_id,
            label_present,
            write_id,
        )
        .await
}

/// Confirm a nonempty pending-write batch within its existing transaction.
#[tracing::instrument(
    target = "email_db_client::labels::pending_writes",
    skip(tx, message_ids),
    err
)]
pub async fn confirm_pending_label_writes<Q: PendingLabelConfirm>(
    tx: &mut Q,
    message_ids: &[Uuid],
    write_id: Uuid,
) -> Result<(), Q::Err> {
    if message_ids.is_empty() {
        return Ok(());
    }
    tx.confirm(message_ids, write_id).await
}

/// Interpret each label's facts, then combine turns for each message.
#[tracing::instrument(
    target = "email_db_client::labels::pending_writes",
    skip(executor, message_ids),
    err
)]
pub async fn label_write_turns<Q: PendingLabelQueries>(
    executor: &mut Q,
    message_ids: &[Uuid],
    provider_label_ids: &[String],
    write_id: Uuid,
) -> Result<HashMap<Uuid, LabelWriteTurn>, Q::Err> {
    let rows = executor
        .facts(message_ids, provider_label_ids, write_id)
        .await?;
    let mut turns = HashMap::new();
    for row in rows {
        let turn = if !row.claimed {
            LabelWriteTurn::Superseded
        } else if row.waits {
            LabelWriteTurn::Wait
        } else if row.has_newer {
            LabelWriteTurn::Superseded
        } else {
            LabelWriteTurn::Send
        };
        turns
            .entry(row.message_id)
            .and_modify(|current: &mut LabelWriteTurn| {
                *current = match (*current, turn) {
                    (LabelWriteTurn::Wait, _) | (_, LabelWriteTurn::Wait) => LabelWriteTurn::Wait,
                    (LabelWriteTurn::Send, LabelWriteTurn::Send) => LabelWriteTurn::Send,
                    _ => LabelWriteTurn::Superseded,
                }
            })
            .or_insert(turn);
    }
    Ok(turns)
}

/// Restore abandoned writes within the caller's existing transaction and locks.
#[tracing::instrument(
    target = "email_db_client::labels::pending_writes",
    skip(tx, message_ids),
    err
)]
pub async fn abandon_pending_label_writes<Q: PendingLabelRestore>(
    tx: &mut Q,
    link_id: Uuid,
    message_ids: &[Uuid],
    write_id: Uuid,
) -> Result<Vec<Uuid>, Q::Err> {
    if message_ids.is_empty() {
        return Ok(Vec::new());
    }
    let restored = tx.remove(message_ids, write_id).await?;
    if restored.is_empty() {
        return Ok(Vec::new());
    }
    let (present, absent): (Vec<_>, Vec<_>) = restored.iter().partition(|r| r.label_present);
    let present_ids: Vec<Uuid> = present.iter().map(|r| r.message_id).collect();
    let present_labels: Vec<String> = present
        .iter()
        .map(|r| r.provider_label_id.clone())
        .collect();
    let absent_ids: Vec<Uuid> = absent.iter().map(|r| r.message_id).collect();
    let absent_labels: Vec<String> = absent.iter().map(|r| r.provider_label_id.clone()).collect();
    tx.restore_present(link_id, &present_ids, &present_labels)
        .await?;
    tx.restore_absent(link_id, &absent_ids, &absent_labels)
        .await?;
    let mut restored_ids: Vec<Uuid> = restored.iter().map(|r| r.message_id).collect();
    restored_ids.sort_unstable();
    restored_ids.dedup();
    tx.refresh_flags(&restored_ids).await?;
    Ok(restored_ids)
}

/// Statement-sized message label and flag updates.
pub trait MessageLabelQueries: Send {
    /// Insert label relations and return their affected count.
    fn insert(
        &mut self,
        messages: &[Uuid],
        label: &str,
        link: Uuid,
    ) -> impl Future<Output = anyhow::Result<usize>> + Send;
    /// Delete label relations and return their affected count.
    fn delete(
        &mut self,
        messages: &[Uuid],
        label: &str,
        link: Uuid,
    ) -> impl Future<Output = anyhow::Result<usize>> + Send;
    /// Delete the supplied labels from one message.
    fn delete_labels(
        &mut self,
        message: Uuid,
        labels: &[String],
        link: Uuid,
    ) -> impl Future<Output = anyhow::Result<()>> + Send;
    /// Update one message's read flag, returning its id when found.
    fn read(
        &mut self,
        message: Uuid,
        link: Uuid,
        read: bool,
    ) -> impl Future<Output = anyhow::Result<Option<Uuid>>> + Send;
    /// Update read flags and return their affected count.
    fn read_batch(
        &mut self,
        messages: Vec<Uuid>,
        link: Uuid,
        read: bool,
    ) -> impl Future<Output = anyhow::Result<usize>> + Send;
    /// Update starred flags and return their affected count.
    fn starred_batch(
        &mut self,
        messages: Vec<Uuid>,
        link: Uuid,
        starred: bool,
    ) -> impl Future<Output = anyhow::Result<usize>> + Send;
}

/// Validate and insert one label across a batch.
#[tracing::instrument(target = "email_db_client::labels::insert", skip(executor), err)]
pub async fn insert_message_labels_batch<Q: MessageLabelQueries>(
    executor: &mut Q,
    message_ids: &Vec<Uuid>,
    provider_label_id: &str,
    link_id: Uuid,
) -> anyhow::Result<usize> {
    if message_ids.is_empty() {
        return Ok(0);
    }
    if provider_label_id.is_empty() {
        anyhow::bail!("Provider label ID cannot be empty");
    }
    executor
        .insert(message_ids, provider_label_id, link_id)
        .await
}

/// Validate and remove one label across a batch.
#[tracing::instrument(target = "email_db_client::labels::delete", skip(executor), err)]
pub async fn delete_message_labels_batch<Q: MessageLabelQueries>(
    executor: &mut Q,
    message_ids: &Vec<Uuid>,
    provider_label_id: &str,
    link_id: Uuid,
) -> anyhow::Result<usize> {
    if message_ids.is_empty() {
        return Ok(0);
    }
    if provider_label_id.is_empty() {
        anyhow::bail!("Provider label ID cannot be empty");
    }
    executor
        .delete(message_ids, provider_label_id, link_id)
        .await
}

/// Skip an empty label deletion before requesting its statement.
#[tracing::instrument(target = "email_db_client::labels::delete", skip(tx), err)]
pub async fn delete_db_message_labels<Q: MessageLabelQueries>(
    tx: &mut Q,
    message_id: Uuid,
    provider_label_ids: &[String],
    link_id: Uuid,
) -> anyhow::Result<()> {
    if provider_label_ids.is_empty() {
        return Ok(());
    }
    tx.delete_labels(message_id, provider_label_ids, link_id)
        .await
}

/// Update one message's read state and diagnose a missing or foreign message.
#[tracing::instrument(target = "email_db_client::messages::update", skip(tx), err)]
pub async fn update_message_read_status<Q: MessageLabelQueries>(
    tx: &mut Q,
    message_id: Uuid,
    link_id: Uuid,
    is_read: bool,
) -> anyhow::Result<Option<Uuid>> {
    let result = tx.read(message_id, link_id, is_read).await?;
    if result.is_none() {
        tracing::warn!(target: "email_db_client::messages::update", message_id = %message_id, link_id = %link_id,
            "No message was updated - message may not exist or doesn't belong to the inbox");
    }
    Ok(result)
}

/// Update a read batch and interpret the number of matching messages.
#[tracing::instrument(target = "email_db_client::messages::update", skip(executor), err)]
pub async fn update_message_read_status_batch<Q: MessageLabelQueries>(
    executor: &mut Q,
    message_ids: Vec<Uuid>,
    link_id: Uuid,
    is_read: bool,
) -> anyhow::Result<usize> {
    if message_ids.is_empty() {
        return Ok(0);
    }
    let requested_count = message_ids.len();
    let updated_count = executor.read_batch(message_ids, link_id, is_read).await?;
    if updated_count == 0 {
        anyhow::bail!(
            "no messages updated for link {link_id}: none of the {} requested ids belong to it",
            requested_count
        );
    }
    if updated_count < requested_count {
        tracing::warn!(target: "email_db_client::messages::update", requested_count = requested_count, updated_count = updated_count, link_id = %link_id,
            "Some messages were not updated - they may not exist or don't belong to the inbox");
    }
    Ok(updated_count)
}

/// Update a starred batch; unlike read batches a zero count only warns.
#[tracing::instrument(target = "email_db_client::messages::update", skip(executor), err)]
pub async fn update_message_starred_status_batch<Q: MessageLabelQueries>(
    executor: &mut Q,
    message_ids: Vec<Uuid>,
    link_id: Uuid,
    is_starred: bool,
) -> anyhow::Result<usize> {
    if message_ids.is_empty() {
        return Ok(0);
    }
    let requested_count = message_ids.len();
    let updated_count = executor
        .starred_batch(message_ids, link_id, is_starred)
        .await?;
    if updated_count < requested_count {
        tracing::warn!(target: "email_db_client::messages::update", requested_count = requested_count, updated_count = updated_count, link_id = %link_id,
            "Some messages were not updated - they may not exist or don't belong to the inbox");
    }
    Ok(updated_count)
}

/// Statement-sized catalog operations; deletion deliberately is not transactional.
#[cfg(feature = "mailbox")]
pub trait LabelCatalogQueries: Send {
    /// Upsert catalog entries that already have generated ids.
    fn upsert(&mut self, labels: Vec<Label>) -> impl Future<Output = anyhow::Result<()>> + Send;
    /// Remove relations referencing these provider labels.
    fn delete_relations(
        &mut self,
        link: Uuid,
        labels: Vec<String>,
    ) -> impl Future<Output = anyhow::Result<u64>> + Send;
    /// Remove these provider labels from the catalog.
    fn delete_labels(
        &mut self,
        link: Uuid,
        labels: Vec<String>,
    ) -> impl Future<Output = anyhow::Result<u64>> + Send;
}

/// Assign missing ids before catalog upsert.
#[cfg(feature = "mailbox")]
#[tracing::instrument(target = "email_db_client::labels::insert", skip(pool, service_labels), fields(label_count = service_labels.len()), err)]
pub async fn insert_or_update_labels<Q: LabelCatalogQueries>(
    pool: &mut Q,
    mut service_labels: Vec<Label>,
) -> anyhow::Result<()> {
    if service_labels.is_empty() {
        return Ok(());
    }
    for label in &mut service_labels {
        if label.id.is_none() {
            label.id = Some(macro_uuid::generate_uuid_v7());
        }
    }
    pool.upsert(service_labels).await
}

/// Remove references before catalog entries, preserving the original failure boundary.
#[cfg(feature = "mailbox")]
#[tracing::instrument(target = "email_db_client::labels::delete", skip(pool), err)]
pub async fn delete_labels_by_provider_ids<Q: LabelCatalogQueries>(
    pool: &mut Q,
    link_id: Uuid,
    provider_label_ids: Vec<String>,
) -> anyhow::Result<u64> {
    if provider_label_ids.is_empty() {
        return Ok(0);
    }
    let deleted_message_labels_count = pool
        .delete_relations(link_id, provider_label_ids.clone())
        .await?;
    tracing::debug!(target: "email_db_client::labels::delete", link_id = %link_id, provider_label_count = provider_label_ids.len(),
        deleted_message_labels_count = deleted_message_labels_count,
        "Deleted message_labels entries that referenced the labels");
    pool.delete_labels(link_id, provider_label_ids).await
}
