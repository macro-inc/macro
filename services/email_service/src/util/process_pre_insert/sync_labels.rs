use crate::pubsub::cache::TtlCache;
use anyhow::Context;
use gmail_client::GmailClient;
use models_email::email::service::label::Label;
use sqlx::PgPool;
use std::collections::HashMap;
use uuid::Uuid;

/// Loads the complete label ID map from the worker cache, refreshing it once when a requested
/// provider label is absent. Message persistence retains a database fallback for labels that are
/// still absent after the refresh.
pub async fn resolve_label_ids(
    db: &PgPool,
    cache: &TtlCache<Uuid, HashMap<String, Uuid>>,
    link_id: Uuid,
    provider_label_ids: &[String],
) -> anyhow::Result<HashMap<String, Uuid>> {
    if provider_label_ids.is_empty() {
        return Ok(HashMap::new());
    }

    let mut label_ids = load_label_ids(db, cache, link_id).await?;
    if provider_label_ids
        .iter()
        .any(|provider_label_id| !label_ids.contains_key(provider_label_id))
    {
        cache.invalidate(&link_id);
        label_ids = load_label_ids(db, cache, link_id).await?;
    }

    Ok(label_ids)
}

async fn load_label_ids(
    db: &PgPool,
    cache: &TtlCache<Uuid, HashMap<String, Uuid>>,
    link_id: Uuid,
) -> anyhow::Result<HashMap<String, Uuid>> {
    cache
        .get_or_load(link_id, || async {
            email_db_client::labels::get::fetch_label_id_map(db, link_id).await
        })
        .await
}

// syncs our db labels with gmail - adds new labels, updates changed labels, deletes removed labels
#[tracing::instrument(skip(db, gmail_client, access_token, label_id_cache))]
pub async fn sync_labels(
    db: &PgPool,
    gmail_client: &GmailClient,
    access_token: &str,
    link_id: Uuid,
    label_id_cache: &TtlCache<Uuid, HashMap<String, Uuid>>,
) -> anyhow::Result<()> {
    // Step 1: Fetch all labels from both sources
    let db_labels = email_db_client::labels::get::fetch_labels_by_link_id(db, link_id)
        .await
        .context("Failed to fetch labels from database")?;

    let gmail_labels = gmail_client
        .fetch_user_labels(access_token, link_id)
        .await
        .context("Failed to fetch labels from Gmail API")?;

    // Create maps for easier comparison
    let db_label_map: HashMap<String, Label> = db_labels
        .into_iter()
        .map(|label| (label.provider_label_id.clone(), label))
        .collect();

    let gmail_label_map: HashMap<String, Label> = gmail_labels
        .into_iter()
        .map(|label| (label.provider_label_id.clone(), label))
        .collect();

    // Step 2: Identify labels to delete (in DB but not in Gmail)
    let labels_to_delete: Vec<String> = db_label_map
        .keys()
        .filter(|provider_id| !gmail_label_map.contains_key(*provider_id))
        .cloned()
        .collect();

    let mut labels_to_upsert = Vec::new();
    let mut insert_count = 0;
    let mut update_count = 0;

    // Step 3: Identify labels to insert or update
    for gmail_label in gmail_label_map.values() {
        // if the label exists in both the db and gmail
        if let Some(db_label) = db_label_map.get(&gmail_label.provider_label_id) {
            // if any of the label fields are different in gmail, update it in the db
            let needs_update = gmail_label.name != db_label.name
                || gmail_label.message_list_visibility != db_label.message_list_visibility
                || gmail_label.label_list_visibility != db_label.label_list_visibility
                || gmail_label.type_ != db_label.type_;

            if needs_update {
                let mut updated_label = gmail_label.clone();
                updated_label.id = db_label.id;
                labels_to_upsert.push(updated_label);
                update_count += 1;
            }
        // if the label exists in gmail but not in our db, insert it into the db
        } else {
            let mut new_label = gmail_label.clone();
            new_label.id = Some(macro_uuid::generate_uuid_v7());
            labels_to_upsert.push(new_label);
            insert_count += 1;
        }
    }

    // Step 4: Perform deletions if needed
    let deleted_count = if !labels_to_delete.is_empty() {
        let result = email_db_client::labels::delete::delete_labels_by_provider_ids(
            db,
            link_id,
            labels_to_delete.clone(),
        )
        .await
        .context(format!(
            "Failed to delete labels by provider_ids: {:?}",
            labels_to_delete
        ))?;

        let deleted_count = result as usize;
        if deleted_count > 0 {
            label_id_cache.invalidate(&link_id);
        }
        deleted_count
    } else {
        0
    };

    // Step 5: Perform insert/update operations
    if !labels_to_upsert.is_empty() {
        email_db_client::labels::insert::insert_or_update_labels(db, labels_to_upsert)
            .await
            .context("Failed to insert/update labels from Gmail")?;
        label_id_cache.invalidate(&link_id);
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
