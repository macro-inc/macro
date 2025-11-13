//! This module contains db queries to filter out items by channel ids

/// Given a list of channel ids and an org id, this will
/// return all organization channel ids for the provided org id.
#[tracing::instrument(skip(db), err)]
pub async fn filter_channels_by_org_id(
    db: &sqlx::PgPool,
    channel_ids: &[uuid::Uuid],
    org_id: i64,
) -> anyhow::Result<Vec<uuid::Uuid>> {
    let channel_ids = sqlx::query!(
        r#"
        SELECT
            c.id
        FROM
            comms_channels c
        WHERE
            c.id = ANY($1)
            AND c.channel_type = 'organization'
            AND c.org_id = $2
        "#,
        channel_ids,
        org_id,
    )
    .map(|row| row.id)
    .fetch_all(db)
    .await?;

    Ok(channel_ids)
}
