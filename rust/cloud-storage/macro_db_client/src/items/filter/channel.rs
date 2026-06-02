//! This module contains db queries to filter out items by channel ids

/// Legacy org-channel filters no longer match any channels.
#[tracing::instrument(skip_all, err)]
pub async fn filter_channels_by_org_id(
    _db: &sqlx::PgPool,
    _channel_ids: &[uuid::Uuid],
    _org_id: i64,
) -> anyhow::Result<Vec<uuid::Uuid>> {
    Ok(Vec::new())
}
