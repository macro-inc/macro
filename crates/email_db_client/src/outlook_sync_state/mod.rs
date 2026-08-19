use chrono::{DateTime, Utc};
use sqlx::{PgPool, types::Uuid};

#[cfg(test)]
mod test;

/// Persisted Microsoft Graph subscription and delta synchronization state.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OutlookSyncState {
    /// Email link that owns this state.
    pub link_id: Uuid,
    /// Graph subscription identifier, when a subscription is active.
    pub subscription_id: Option<String>,
    /// Time at which Graph expires the active subscription.
    pub subscription_expires_at: Option<DateTime<Utc>>,
    /// Opaque Graph delta cursor.
    pub delta_cursor: Option<String>,
    /// Time at which the state was first created.
    pub created_at: DateTime<Utc>,
    /// Time at which the state was last updated.
    pub updated_at: DateTime<Utc>,
}

/// Fetches Outlook synchronization state for an email link.
#[tracing::instrument(skip(pool), err)]
pub async fn get_outlook_sync_state(
    pool: &PgPool,
    link_id: Uuid,
) -> anyhow::Result<Option<OutlookSyncState>> {
    let state = sqlx::query_as!(
        OutlookSyncState,
        r#"
        SELECT
            link_id,
            subscription_id,
            subscription_expires_at,
            delta_cursor,
            created_at,
            updated_at
        FROM email_outlook_sync_state
        WHERE link_id = $1
        "#,
        link_id
    )
    .fetch_optional(pool)
    .await?;

    Ok(state)
}

/// Inserts Outlook synchronization state or replaces the current provider values.
#[tracing::instrument(skip(pool, delta_cursor), err)]
pub async fn upsert_outlook_sync_state(
    pool: &PgPool,
    link_id: Uuid,
    subscription_id: Option<&str>,
    subscription_expires_at: Option<DateTime<Utc>>,
    delta_cursor: Option<&str>,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"
        INSERT INTO email_outlook_sync_state (
            link_id,
            subscription_id,
            subscription_expires_at,
            delta_cursor
        )
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (link_id)
        DO UPDATE SET
            subscription_id = EXCLUDED.subscription_id,
            subscription_expires_at = EXCLUDED.subscription_expires_at,
            delta_cursor = EXCLUDED.delta_cursor,
            updated_at = NOW()
        "#,
        link_id,
        subscription_id,
        subscription_expires_at,
        delta_cursor
    )
    .execute(pool)
    .await?;

    Ok(())
}

/// Updates the opaque delta cursor for an Outlook email link.
#[tracing::instrument(skip(pool, delta_cursor), err)]
pub async fn update_outlook_delta_cursor(
    pool: &PgPool,
    link_id: Uuid,
    delta_cursor: Option<&str>,
) -> anyhow::Result<bool> {
    let result = sqlx::query!(
        r#"
        UPDATE email_outlook_sync_state
        SET delta_cursor = $2,
            updated_at = NOW()
        WHERE link_id = $1
        "#,
        link_id,
        delta_cursor
    )
    .execute(pool)
    .await?;

    Ok(result.rows_affected() > 0)
}

/// Updates Graph subscription metadata for an Outlook email link.
#[tracing::instrument(skip(pool), err)]
pub async fn update_outlook_subscription(
    pool: &PgPool,
    link_id: Uuid,
    subscription_id: Option<&str>,
    subscription_expires_at: Option<DateTime<Utc>>,
) -> anyhow::Result<bool> {
    let result = sqlx::query!(
        r#"
        UPDATE email_outlook_sync_state
        SET subscription_id = $2,
            subscription_expires_at = $3,
            updated_at = NOW()
        WHERE link_id = $1
        "#,
        link_id,
        subscription_id,
        subscription_expires_at
    )
    .execute(pool)
    .await?;

    Ok(result.rows_affected() > 0)
}

/// Fetches Outlook synchronization state by Graph subscription identifier.
#[tracing::instrument(skip(pool), err)]
pub async fn get_outlook_sync_state_by_subscription_id(
    pool: &PgPool,
    subscription_id: &str,
) -> anyhow::Result<Option<OutlookSyncState>> {
    let state = sqlx::query_as!(
        OutlookSyncState,
        r#"
        SELECT
            link_id,
            subscription_id,
            subscription_expires_at,
            delta_cursor,
            created_at,
            updated_at
        FROM email_outlook_sync_state
        WHERE subscription_id = $1
        "#,
        subscription_id
    )
    .fetch_optional(pool)
    .await?;

    Ok(state)
}

/// Fetches active Outlook subscriptions expiring no later than the supplied time.
#[tracing::instrument(skip(pool), err)]
pub async fn get_outlook_sync_states_expiring_before(
    pool: &PgPool,
    expires_before: DateTime<Utc>,
    limit: i64,
) -> anyhow::Result<Vec<OutlookSyncState>> {
    anyhow::ensure!(limit > 0, "limit must be positive");

    let states = sqlx::query_as!(
        OutlookSyncState,
        r#"
        SELECT
            link_id,
            subscription_id,
            subscription_expires_at,
            delta_cursor,
            created_at,
            updated_at
        FROM email_outlook_sync_state
        WHERE subscription_id IS NOT NULL
          AND subscription_expires_at <= $1
        ORDER BY subscription_expires_at, link_id
        LIMIT $2
        "#,
        expires_before,
        limit
    )
    .fetch_all(pool)
    .await?;

    Ok(states)
}

/// Deletes Outlook synchronization state for an email link.
#[tracing::instrument(skip(pool), err)]
pub async fn delete_outlook_sync_state(pool: &PgPool, link_id: Uuid) -> anyhow::Result<bool> {
    let result = sqlx::query!(
        r#"
        DELETE FROM email_outlook_sync_state
        WHERE link_id = $1
        "#,
        link_id
    )
    .execute(pool)
    .await?;

    Ok(result.rows_affected() > 0)
}
