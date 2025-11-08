use anyhow::{Context, anyhow};
use models_email::email::{db, service};
use sqlx::types::Uuid;
use sqlx::{Executor, PgPool, Postgres};

#[tracing::instrument(skip(pool), level = "info")]
pub async fn insert_message_label(
    pool: &PgPool,
    message_id: Uuid,
    provider_label_id: &str,
    link_id: Uuid,
) -> anyhow::Result<()> {
    if provider_label_id.is_empty() {
        return Err(anyhow!("Provider label ID cannot be empty"));
    }

    let result = sqlx::query!(
        r#"
        WITH label_lookup AS (
            SELECT id FROM email_labels
            WHERE link_id = $2 AND provider_label_id = $3
        )
        INSERT INTO email_message_labels (message_id, label_id)
        SELECT $1, id FROM label_lookup
        ON CONFLICT (message_id, label_id) DO NOTHING
        RETURNING (SELECT COUNT(*) FROM label_lookup) AS label_found
        "#,
        message_id,
        link_id,
        provider_label_id
    )
        .fetch_optional(pool)
        .await
        .with_context(|| {
            format!(
                "Failed to add message_label for message_id {} with provider_label_id {} and link_id {}",
                message_id, provider_label_id, link_id
            )
        })?;

    // Check if the label was found
    match result {
        Some(record) if record.label_found.unwrap_or(0) > 0 => Ok(()),
        // the label we were trying to insert a relation for doesn't exist. this shouldn't happen
        _ => {
            tracing::warn!(
                message_id = %message_id,
                provider_label_id = %provider_label_id,
                link_id = %link_id,
                "No message label found to create relation for"
            );
            Err(anyhow!(
                "No label found for link_id {} with provider_label_id {}",
                link_id,
                provider_label_id
            ))
        }
    }
}

/// Inserts a label for multiple messages at once
#[tracing::instrument(skip(executor), level = "info")]
pub async fn insert_message_labels_batch<'e, E>(
    executor: E,
    message_ids: &Vec<Uuid>,
    provider_label_id: &str,
    link_id: Uuid,
) -> anyhow::Result<usize>
where
    E: Executor<'e, Database = Postgres>,
{
    if message_ids.is_empty() {
        return Ok(0);
    }

    if provider_label_id.is_empty() {
        return Err(anyhow!("Provider label ID cannot be empty"));
    }

    let result = sqlx::query!(
        r#"
        INSERT INTO email_message_labels (message_id, label_id)
        SELECT
            unnested_message_id,
            l.id
        FROM
            UNNEST($1::uuid[]) AS t(unnested_message_id)
        CROSS JOIN
            email_labels l
        WHERE
            l.link_id = $2 AND l.provider_label_id = $3
        ON CONFLICT (message_id, label_id) DO NOTHING
        "#,
        message_ids,
        link_id,
        provider_label_id
    )
        .execute(executor)
        .await
        .with_context(|| {
            format!(
                "Failed to insert message_labels for {} messages with provider_label_id {} and link_id {}",
                message_ids.len(), provider_label_id, link_id
            )
        })?;

    let rows_affected = result.rows_affected() as usize;

    Ok(rows_affected)
}

/// Inserts or updates labels for a user.
/// Labels are shared across messages, so this should be done separately from inserting message_labels
/// to avoid deadlock issues.
#[tracing::instrument(skip(pool, service_labels), fields(label_count = service_labels.len()))]
pub async fn insert_or_update_labels(
    pool: &PgPool,
    mut service_labels: Vec<service::label::Label>,
) -> anyhow::Result<()> {
    if service_labels.is_empty() {
        return Ok(());
    }

    // need to generate before conversion
    for service_label in service_labels.iter_mut() {
        if service_label.id.is_none() {
            service_label.id = Some(macro_uuid::generate_uuid_v7());
        }
    }

    let db_labels: Vec<db::label::Label> = service_labels.into_iter().map(Into::into).collect();

    // Extract data for batch insert
    let label_db_ids: Vec<Uuid> = db_labels.iter().map(|label| label.id).collect();
    let link_ids: Vec<Uuid> = db_labels.iter().map(|label| label.link_id).collect();
    let provider_label_ids: Vec<String> = db_labels
        .iter()
        .map(|label| label.provider_label_id.clone())
        .collect();
    let names: Vec<String> = db_labels.iter().map(|label| label.name.clone()).collect();

    // Extract enum values
    let message_list_visibilities: Vec<db::label::MessageListVisibility> = db_labels
        .iter()
        .map(|label| label.message_list_visibility)
        .collect();

    let label_list_visibilities: Vec<db::label::LabelListVisibility> = db_labels
        .iter()
        .map(|label| label.label_list_visibility)
        .collect();

    let types: Vec<db::label::LabelType> = db_labels.iter().map(|label| label.type_).collect();

    // Insert/update labels with all fields
    sqlx::query!(
        r#"
        WITH input_rows (
            id,
            link_id,
            provider_label_id,
            name,
            message_list_visibility,
            label_list_visibility,
            type
        ) AS (
           SELECT * FROM unnest(
               $1::uuid[],
               $2::uuid[],
               $3::text[],
               $4::text[],
               $5::email_message_list_visibility_enum[],
               $6::email_label_list_visibility_enum[],
               $7::email_label_type_enum[]
           )
        )
        INSERT INTO email_labels (
            id,
            link_id,
            provider_label_id,
            name,
            message_list_visibility,
            label_list_visibility,
            type
        )
        SELECT
            id,
            link_id,
            provider_label_id,
            name,
            message_list_visibility,
            label_list_visibility,
            type
        FROM input_rows
        ON CONFLICT (link_id, provider_label_id) DO UPDATE
        SET
            name = EXCLUDED.name,
            message_list_visibility = EXCLUDED.message_list_visibility,
            label_list_visibility = EXCLUDED.label_list_visibility,
            type = EXCLUDED.type
        "#,
        &label_db_ids,
        &link_ids,
        &provider_label_ids,
        &names,
        &message_list_visibilities as _,
        &label_list_visibilities as _,
        &types as _
    )
    .execute(pool)
    .await
    .with_context(|| "Failed during batch insert/update of labels".to_string())?;

    Ok(())
}

#[tracing::instrument(skip(pool, service_label))]
pub async fn insert_label(
    pool: &PgPool,
    mut service_label: service::label::Label,
) -> anyhow::Result<service::label::Label> {
    if service_label.id.is_none() {
        service_label.id = Some(macro_uuid::generate_uuid_v7());
    }

    // Convert to DB model
    let db_label: db::label::Label = service_label.clone().into();

    // Insert the label into the database
    let inserted_label = sqlx::query_as!(
        db::label::Label,
        r#"
        INSERT INTO email_labels (
            id,
            link_id,
            provider_label_id,
            name,
            message_list_visibility,
            label_list_visibility,
            type
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (link_id, provider_label_id) DO UPDATE
        SET
            name = EXCLUDED.name,
            message_list_visibility = EXCLUDED.message_list_visibility,
            label_list_visibility = EXCLUDED.label_list_visibility,
            type = EXCLUDED.type
        RETURNING 
            id,
            link_id,
            provider_label_id,
            name,
            created_at,
            message_list_visibility as "message_list_visibility: _",
            label_list_visibility as "label_list_visibility: _",
            type as "type_: _"
        "#,
        db_label.id,
        db_label.link_id,
        db_label.provider_label_id,
        db_label.name,
        db_label.message_list_visibility as _,
        db_label.label_list_visibility as _,
        db_label.type_ as _
    )
    .fetch_one(pool)
    .await
    .with_context(|| {
        format!(
            "Failed to insert label with provider_label_id {} for link_id {}",
            db_label.provider_label_id, db_label.link_id
        )
    })?;

    let populated_service_label: service::label::Label = inserted_label.into();

    Ok(populated_service_label)
}

/// inserts the labels of an email into the database in a batch
pub async fn insert_message_labels(
    tx: &mut sqlx::PgConnection,
    link_id: Uuid,
    message_id: Uuid,
    provider_label_ids: &[String],
    delete_old: bool,
) -> anyhow::Result<()> {
    if provider_label_ids.is_empty() {
        return Ok(());
    }

    // get back label ids to use in junction table insert
    #[derive(Debug)]
    struct LabelId {
        id: Uuid,
    }

    let label_mappings: Vec<LabelId> = sqlx::query_as!(
        LabelId,
        r#"
        SELECT id
        FROM email_labels
        WHERE link_id = $1 AND provider_label_id = ANY($2)
        "#,
        link_id,
        &provider_label_ids
    )
    .fetch_all(&mut *tx)
    .await
    .context(format!(
        "Failed to select label IDs after upsert. link_id: {}, provider_label_ids: {:?}",
        link_id, provider_label_ids
    ))?;

    if label_mappings.len() != provider_label_ids.len() {
        return Err(anyhow!(
            "Could not find all expected labels in database after upsert. link_id: {}, provider_label_ids: {:?}",
            link_id,
            provider_label_ids
        ));
    }

    // insert into junction table
    let message_ids_repeated: Vec<Uuid> =
        std::iter::repeat_n(message_id, label_mappings.len()).collect();
    let label_db_ids: Vec<Uuid> = label_mappings.iter().map(|m| m.id).collect();

    // deleting records that don't match the ones to insert first in case we are doing an
    // upsert and some of the old ones got removed
    if delete_old {
        sqlx::query!(
        r#"
        DELETE FROM email_message_labels
        WHERE message_id = $1
        AND label_id NOT IN (
            SELECT UNNEST($2::uuid[])
        )
        "#,
        message_id,
        &label_db_ids
    )
            .execute(&mut *tx)
            .await
            .context(format!(
                "Failed to delete message labels for message_id {} where label_id not in label_db_ids {:?}",
                message_id, label_db_ids
            ))?;
    }

    sqlx::query(
        r#"
        INSERT INTO email_message_labels (message_id, label_id)
        SELECT * FROM unnest($1::uuid[], $2::uuid[])
        ON CONFLICT (message_id, label_id) DO NOTHING
        "#,
    )
    .bind(&message_ids_repeated)
    .bind(&label_db_ids)
    .execute(&mut *tx)
    .await
    .context(format!(
        "Failed to batch insert message label links. message_id: {}, label_ids: {:?}",
        message_id, label_db_ids
    ))?;

    Ok(())
}
