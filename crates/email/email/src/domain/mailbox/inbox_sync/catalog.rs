use super::{ConnectionSourceError, InboxSyncCatalog};
use anyhow::Context;
use models_email::email::service::label::Label;
use std::collections::HashMap;
use uuid::Uuid;

/// Reconcile the provider catalog with the stored catalog, preserving existing label identities.
#[tracing::instrument(skip(db, provider_labels), err)]
pub async fn sync_labels<R: LabelCatalogRepository>(
    db: &R,
    link_id: Uuid,
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

    // Step 4: Perform deletions if needed
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

    // Step 5: Perform insert/update operations
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
}
