//! Queries for resolving a call to its channel ID and share permission ID.

#[cfg(not(test))]
use cached::proc_macro::cached;

use sqlx::PgPool;
use uuid::Uuid;

/// Row returned by call channel queries.
#[derive(Clone, sqlx::FromRow)]
pub struct CallChannelRow {
    /// The channel the call belongs to.
    pub channel_id: Uuid,
    /// The share permission ID for this call.
    pub share_permission_id: String,
}

/// Look up a call's channel and share permission by call ID.
///
/// Checks both active calls and archived call records.
#[tracing::instrument(err, skip(pool))]
#[allow(clippy::disallowed_methods, reason = "legacy code. fix later")]
pub async fn get_call_channel(
    pool: &PgPool,
    call_id: &Uuid,
) -> Result<Option<CallChannelRow>, sqlx::Error> {
    sqlx::query_as::<_, CallChannelRow>(
        r#"
        SELECT channel_id, share_permission_id
        FROM calls
        WHERE id = $1
        UNION ALL
        SELECT channel_id, share_permission_id
        FROM call_records
        WHERE id = $1
        LIMIT 1
        "#,
    )
    .bind(call_id)
    .fetch_optional(pool)
    .await
}

/// Look up a call's channel and share permission by channel ID.
///
/// Checks both active calls and archived call records.
/// Active calls are checked first.
#[tracing::instrument(err, skip(pool))]
#[cfg_attr(
    not(test),
    cached(
        time = 10,
        result = true,
        key = "String",
        convert = r#"{format!("{}", channel_id)}"#
    )
)]
pub async fn get_call_channel_by_channel_id(
    pool: &PgPool,
    channel_id: &Uuid,
) -> Result<Option<CallChannelRow>, sqlx::Error> {
    sqlx::query_as!(
        CallChannelRow,
        r#"
        SELECT channel_id AS "channel_id!", share_permission_id AS "share_permission_id!"
        FROM calls
        WHERE channel_id = $1
        UNION ALL
        SELECT channel_id, share_permission_id
        FROM call_records
        WHERE channel_id = $1
        ORDER BY 1
        LIMIT 1
        "#,
        channel_id
    )
    .fetch_optional(pool)
    .await
}
