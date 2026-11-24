use super::super::telemetry::span_int;
use super::{ConnectionSourceError, InboxSyncCatalog};
use anyhow::Context;
use macro_user_id::user_id::MacroUserIdStr;
use models_email::email::service::label::Label;
use std::collections::HashMap;
use tracing::field;
use uuid::Uuid;

/// Reconcile the provider catalog with the stored catalog, preserving existing label identities.
/// Search indexes a message's label names, so renaming a label also reindexes the threads
/// carrying it. Those reindexes are queued before the new name is stored: if queueing fails, the
/// rename is still found by the next sync.
#[tracing::instrument(
    skip(db, queue, owner, provider_labels),
    fields(
        labels.renamed = field::Empty,
        labels.reindexed_threads = field::Empty,
    ),
    err
)]
pub async fn sync_labels<R: LabelCatalogRepository, Q: ThreadReindexQueue>(
    db: &R,
    queue: &Q,
    link_id: Uuid,
    owner: &MacroUserIdStr<'static>,
    provider_labels: &[Label],
) -> anyhow::Result<()> {
    // Step 1: Fetch the persisted labels
    let db_labels = db
        .stored_catalog(link_id)
        .await
        .map_err(ConnectionSourceError::into_original)
        .context("Failed to fetch labels from database")?;

    // Create maps for easier comparison
    let db_label_map: HashMap<String, Label> = db_labels
        .into_iter()
        .map(|label| (label.provider_label_id.clone(), label))
        .collect();

    let provider_label_map: HashMap<&str, &Label> = provider_labels
        .iter()
        .map(|label| (label.provider_label_id.as_str(), label))
        .collect();

    // Step 2: Identify labels to delete (in DB but not in Gmail)
    let labels_to_delete: Vec<String> = db_label_map
        .keys()
        .filter(|provider_id| !provider_label_map.contains_key(provider_id.as_str()))
        .cloned()
        .collect();

    let mut labels_to_upsert = Vec::new();
    let mut renamed_labels = Vec::new();
    let mut insert_count = 0;
    let mut update_count = 0;

    // Step 3: Identify labels to insert or update
    for provider_label in provider_label_map.values() {
        // if the label exists in both the db and gmail
        if let Some(db_label) = db_label_map.get(&provider_label.provider_label_id) {
            // if any of the label fields are different in the provider, update it in the db
            let needs_update = provider_label.name != db_label.name
                || provider_label.message_list_visibility != db_label.message_list_visibility
                || provider_label.label_list_visibility != db_label.label_list_visibility
                || provider_label.type_ != db_label.type_;

            if provider_label.name != db_label.name {
                renamed_labels.push(provider_label.provider_label_id.clone());
            }

            if needs_update {
                let mut updated_label = (*provider_label).clone();
                updated_label.id = db_label.id;
                labels_to_upsert.push(updated_label);
                update_count += 1;
            }
        // if the label exists in the provider but not in our db, insert it into the db
        } else {
            let mut new_label = (*provider_label).clone();
            new_label.id = Some(macro_uuid::generate_uuid_v7());
            labels_to_upsert.push(new_label);
            insert_count += 1;
        }
    }

    // Step 4: Queue the reindex of the threads carrying a renamed label. A
    // failure keeps the old names stored, so the next sync finds the renames
    // again; it must not stop the mailbox's sync.
    if !renamed_labels.is_empty()
        && let Err(error) =
            queue_renamed_label_reindex(db, queue, link_id, owner, &renamed_labels).await
    {
        tracing::error!(
            error = ?error,
            %link_id,
            renamed = renamed_labels.len(),
            "Failed to queue the reindex of threads carrying renamed labels"
        );
        labels_to_upsert.retain(|label| !renamed_labels.contains(&label.provider_label_id));
    }

    // Step 5: Perform deletions if needed
    let deleted_count = if !labels_to_delete.is_empty() {
        let result = db
            .delete_stored_catalog(link_id, labels_to_delete.clone())
            .await
            .map_err(ConnectionSourceError::into_original)
            .context(format!(
                "Failed to delete labels by provider_ids: {:?}",
                labels_to_delete
            ))?;

        result as usize
    } else {
        0
    };

    // Step 6: Perform insert/update operations
    if !labels_to_upsert.is_empty() {
        db.upsert_stored_catalog(labels_to_upsert)
            .await
            .map_err(ConnectionSourceError::into_original)
            .context("Failed to insert/update labels from Gmail")?;
    }

    if insert_count > 0 || update_count > 0 || deleted_count > 0 {
        tracing::debug!(
            link_id = %link_id,
            added = insert_count,
            updated = update_count,
            deleted = deleted_count,
            "Label synchronization complete"
        );
    }

    Ok(())
}

async fn queue_renamed_label_reindex<R: LabelCatalogRepository, Q: ThreadReindexQueue>(
    db: &R,
    queue: &Q,
    link_id: Uuid,
    owner: &MacroUserIdStr<'static>,
    renamed_labels: &[String],
) -> anyhow::Result<()> {
    let span = tracing::Span::current();
    span.record("labels.renamed", span_int(renamed_labels.len()));

    let threads = db
        .labelled_threads(link_id, renamed_labels)
        .await
        .map_err(ConnectionSourceError::into_original)
        .context("Failed to fetch the threads carrying renamed labels")?;
    span.record("labels.reindexed_threads", span_int(threads.len()));

    if threads.is_empty() {
        return Ok(());
    }

    queue
        .enqueue_thread_reindex(owner, threads)
        .await
        .map_err(ConnectionSourceError::into_original)
        .context("Failed to queue the threads")
}

/// Catalog facts and writes shared by live sync and backfill initialization.
pub trait LabelCatalogRepository: Send + Sync {
    /// Original persistence error.
    type CatalogError: ConnectionSourceError;
    /// Read the complete stored catalog.
    fn stored_catalog(
        &self,
        link: Uuid,
    ) -> impl Future<Output = Result<Vec<Label>, Self::CatalogError>> + Send;
    /// Delete the missing provider label identities.
    fn delete_stored_catalog(
        &self,
        link: Uuid,
        labels: Vec<String>,
    ) -> impl Future<Output = Result<u64, Self::CatalogError>> + Send;
    /// Insert and update the reconciled labels.
    fn upsert_stored_catalog(
        &self,
        labels: Vec<Label>,
    ) -> impl Future<Output = Result<(), Self::CatalogError>> + Send;
    /// The threads with a message carrying any of these provider labels.
    fn labelled_threads(
        &self,
        link: Uuid,
        labels: &[String],
    ) -> impl Future<Output = Result<Vec<Uuid>, Self::CatalogError>> + Send;
}

/// Bulk search reindexing, kept off the queue that carries live mail's events.
pub trait ThreadReindexQueue: Send + Sync + 'static {
    /// Original queue failure.
    type ReindexError: ConnectionSourceError;
    /// Queue the threads to be reread and reindexed. They are reread no sooner
    /// than a minute later, after the caller's own change is stored.
    fn enqueue_thread_reindex(
        &self,
        owner: &MacroUserIdStr<'static>,
        threads: Vec<Uuid>,
    ) -> impl Future<Output = Result<(), Self::ReindexError>> + Send;
}
impl<R: InboxSyncCatalog> LabelCatalogRepository for R {
    type CatalogError = R::Err;
    async fn stored_catalog(&self, link: Uuid) -> Result<Vec<Label>, Self::CatalogError> {
        self.catalog(link).await
    }
    async fn delete_stored_catalog(
        &self,
        link: Uuid,
        labels: Vec<String>,
    ) -> Result<u64, Self::CatalogError> {
        self.delete_catalog(link, labels).await
    }
    async fn upsert_stored_catalog(&self, labels: Vec<Label>) -> Result<(), Self::CatalogError> {
        self.upsert_catalog(labels).await
    }
    async fn labelled_threads(
        &self,
        link: Uuid,
        labels: &[String],
    ) -> Result<Vec<Uuid>, Self::CatalogError> {
        InboxSyncCatalog::labelled_threads(self, link, labels).await
    }
}
