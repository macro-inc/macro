//! Coalesced, at-least-once publication of channel changes made by imports.

use chrono::{DateTime, Utc};
use sqlx::{PgPool, Postgres, Transaction};
use uuid::Uuid;

use super::internal;
use crate::domain::ports::PortResult;

/// One channel and the exact queued write being delivered.
#[derive(Clone, Copy, Debug)]
pub struct ChannelUpdate {
    /// Canonical channel to hydrate for its current members.
    pub channel_id: Uuid,
    /// Identifies the committed write this publication may acknowledge.
    pub revision: Uuid,
}

/// Queue the channel in the same transaction as its membership or activity change.
pub async fn enqueue(tx: &mut Transaction<'_, Postgres>, channel_id: Uuid) -> PortResult<()> {
    sqlx::query!(
        "INSERT INTO slack_import_channel_updates (channel_id, revision, next_attempt_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (channel_id) DO UPDATE
         SET revision = EXCLUDED.revision,
             next_attempt_at = LEAST(slack_import_channel_updates.next_attempt_at, NOW() + INTERVAL '2 seconds')",
        channel_id,
        Uuid::now_v7(),
    )
    .execute(&mut **tx)
    .await
    .map_err(internal)?;
    Ok(())
}

/// Lease a bounded page without holding row locks during publication.
pub async fn claim(pool: &PgPool, now: DateTime<Utc>) -> PortResult<Vec<ChannelUpdate>> {
    sqlx::query_as!(
        ChannelUpdate,
        "WITH due AS (
            SELECT channel_id
            FROM slack_import_channel_updates
            WHERE next_attempt_at <= $1
            ORDER BY next_attempt_at, channel_id
            LIMIT 16
            FOR UPDATE SKIP LOCKED
         )
         UPDATE slack_import_channel_updates queued
         SET next_attempt_at = $1 + INTERVAL '1 minute'
         FROM due
         WHERE queued.channel_id = due.channel_id
         RETURNING queued.channel_id, queued.revision",
        now,
    )
    .fetch_all(pool)
    .await
    .map_err(internal)
}

/// Drop an acknowledged write while preserving any newer write for the channel.
pub async fn acknowledge(pool: &PgPool, update: ChannelUpdate) -> PortResult<()> {
    sqlx::query!(
        "DELETE FROM slack_import_channel_updates WHERE channel_id = $1 AND revision = $2",
        update.channel_id,
        update.revision,
    )
    .execute(pool)
    .await
    .map_err(internal)?;
    Ok(())
}
