use anyhow::{Context, anyhow};
use models_email::db;
use models_email::email::service::label;
use sqlx::PgPool;
use sqlx::types::Uuid;
use std::collections::{HashMap, HashSet};

/// retrieves a message label if it exists
#[tracing::instrument(skip(pool), level = "info")]
pub async fn fetch_message_label(
    pool: &PgPool,
    message_id: Uuid,
    provider_label_id: &str,
    link_id: Uuid,
) -> anyhow::Result<Option<label::MessageLabel>> {
    if provider_label_id.is_empty() {
        return Err(anyhow!("Provider label ID cannot be empty"));
    }

    let record = sqlx::query_as!(
        db::label::MessageLabel,
        r#"
        SELECT ml.message_id, ml.label_id
        FROM email_message_labels ml
        JOIN email_labels l ON ml.label_id = l.id
        WHERE ml.message_id = $1
        AND l.provider_label_id = $2
        AND l.link_id = $3
        "#,
        message_id,
        provider_label_id,
        link_id
    )
        .fetch_optional(pool)
        .await
        .with_context(|| {
            format!(
                "Failed to fetch message_label for message_id {} with provider_label_id {} and link_id {}",
                message_id, provider_label_id, link_id
            )
        })?;

    Ok(record.map(Into::into))
}

#[tracing::instrument(skip(pool))]
pub async fn fetch_message_labels(
    pool: &PgPool,
    message_db_id: Uuid,
) -> anyhow::Result<Vec<db::label::Label>> {
    sqlx::query_as!(
        db::label::Label,
        r#"
        SELECT 
            l.id, 
            l.link_id, 
            l.provider_label_id, 
            l.name, 
            l.created_at,
            l.message_list_visibility as "message_list_visibility: _",
            l.label_list_visibility as "label_list_visibility: _",
            l.type as "type_: _"
        FROM email_message_labels ml
        JOIN email_labels l ON ml.label_id = l.id
        WHERE ml.message_id = $1
        ORDER BY l.name
        "#,
        message_db_id
    )
    .fetch_all(pool)
    .await
    .context("Failed to fetch labels")
}

#[tracing::instrument(skip(executor), level = "info")]
pub async fn fetch_message_labels_in_bulk<'e, E>(
    executor: E,
    message_ids: &[Uuid],
) -> anyhow::Result<HashMap<Uuid, Vec<db::label::Label>>>
where
    E: sqlx::Executor<'e, Database = sqlx::Postgres>,
{
    if message_ids.is_empty() {
        return Ok(HashMap::new());
    }

    struct BulkLabelQueryResult {
        message_id: Uuid,
        id: Uuid,
        link_id: Uuid,
        provider_label_id: String,
        name: String,
        created_at: chrono::DateTime<chrono::Utc>,
        message_list_visibility: db::label::MessageListVisibility,
        label_list_visibility: db::label::LabelListVisibility,
        type_: db::label::LabelType,
    }

    let results = sqlx::query_as!(
        BulkLabelQueryResult,
        r#"
        SELECT
            ml.message_id,
            l.id,
            l.link_id,
            l.provider_label_id,
            l.name,
            l.created_at,
            l.message_list_visibility as "message_list_visibility: _",
            l.label_list_visibility as "label_list_visibility: _",
            l.type as "type_: _"
        FROM email_message_labels ml
        JOIN email_labels l ON ml.label_id = l.id
        WHERE
            ml.message_id = ANY($1)
        ORDER BY ml.message_id
        "#,
        message_ids
    )
    .fetch_all(executor)
    .await
    .context("Failed to fetch message labels in bulk")?;

    let mut labels_map = HashMap::new();
    for row in results {
        // Create the final db::label::Label struct from the query result row.
        let label = db::label::Label {
            id: row.id,
            link_id: row.link_id,
            provider_label_id: row.provider_label_id,
            name: row.name,
            created_at: row.created_at,
            message_list_visibility: row.message_list_visibility,
            label_list_visibility: row.label_list_visibility,
            type_: row.type_,
        };

        labels_map
            .entry(row.message_id)
            .or_insert_with(Vec::new)
            .push(label);
    }

    Ok(labels_map)
}

#[tracing::instrument(skip(pool), level = "debug")]
pub async fn find_missing_provider_labels(
    pool: &PgPool,
    link_id: Uuid,
    provider_label_ids: HashSet<String>,
) -> anyhow::Result<Vec<String>> {
    if provider_label_ids.is_empty() {
        return Ok(Vec::new());
    }

    // Convert HashSet to Vec for the SQL query
    let provider_label_ids_vec: Vec<String> = provider_label_ids.into_iter().collect();

    // Query the database for existing labels
    let existing_labels = sqlx::query!(
        r#"
        SELECT provider_label_id
        FROM email_labels
        WHERE link_id = $1 AND provider_label_id = ANY($2)
        "#,
        link_id,
        &provider_label_ids_vec
    )
    .fetch_all(pool)
    .await
    .with_context(|| {
        format!(
            "Failed to check for existing labels. link_id: {}, provider_label_ids: {:?}",
            link_id, provider_label_ids_vec
        )
    })?;

    // Create a set of existing provider label IDs for efficient lookup
    let existing_provider_label_ids: std::collections::HashSet<String> = existing_labels
        .into_iter()
        .map(|record| record.provider_label_id)
        .collect();

    // Filter out the labels that already exist
    let missing_labels: Vec<String> = provider_label_ids_vec
        .into_iter()
        .filter(|id| !existing_provider_label_ids.contains(id))
        .collect();

    Ok(missing_labels)
}

#[tracing::instrument(skip(pool), level = "info")]
pub async fn fetch_labels_by_link_id(
    pool: &PgPool,
    link_id: Uuid,
) -> anyhow::Result<Vec<label::Label>> {
    let db_labels = sqlx::query_as!(
        db::label::Label,
        r#"
        SELECT 
            id, 
            link_id, 
            provider_label_id, 
            name, 
            created_at,
            message_list_visibility as "message_list_visibility: _",
            label_list_visibility as "label_list_visibility: _",
            type as "type_: _"
        FROM email_labels
        WHERE link_id = $1
        ORDER BY name
        "#,
        link_id
    )
    .fetch_all(pool)
    .await
    .with_context(|| format!("Failed to fetch labels for link_id {}", link_id))?;

    // Convert db::label::Label to service::label::Label
    let service_labels: Vec<label::Label> = db_labels.into_iter().map(Into::into).collect();

    Ok(service_labels)
}

#[tracing::instrument(skip(pool), level = "info")]
pub async fn fetch_label_by_id(
    pool: &PgPool,
    label_id: Uuid,
    link_id: Uuid,
) -> anyhow::Result<Option<label::Label>> {
    let db_label = sqlx::query_as!(
        db::label::Label,
        r#"
        SELECT 
            id, 
            link_id, 
            provider_label_id, 
            name, 
            created_at,
            message_list_visibility as "message_list_visibility: _",
            label_list_visibility as "label_list_visibility: _",
            type as "type_: _"
        FROM email_labels
        WHERE id = $1 AND link_id = $2
        "#,
        label_id,
        link_id
    )
    .fetch_optional(pool)
    .await
    .with_context(|| {
        format!(
            "Failed to fetch label with id {} and link_id {}",
            label_id, link_id
        )
    })?;

    // Convert db::label::Label to service::label::Label if found
    let service_label = db_label.map(Into::into);

    Ok(service_label)
}
