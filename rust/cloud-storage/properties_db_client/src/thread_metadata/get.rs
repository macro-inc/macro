//! Get thread metadata from macrodb.

use crate::error::PropertiesDatabaseError;
use models_properties::service::thread_metadata::ThreadMetadata;
use sqlx::{Pool, Postgres};
use uuid::Uuid;

type Result<T> = std::result::Result<T, PropertiesDatabaseError>;

/// Get thread metadata by thread ID from macrodb
#[tracing::instrument(skip(db), err)]
pub async fn get_thread_metadata(
    db: &Pool<Postgres>,
    thread_id: Uuid,
) -> Result<Option<ThreadMetadata>> {
    sqlx::query_as!(
        ThreadMetadata,
        r#"
        SELECT
            t.id,
            t.latest_inbound_message_ts as last_received,
            t.latest_outbound_message_ts as last_sent,
            first_msg.internal_date_ts as thread_started,
            first_msg.subject,
            (SELECT COUNT(*)::bigint FROM email_messages WHERE thread_id = t.id) as "message_count!"
        FROM
            email_threads t
        -- LATERAL join to get subject and timestamp from the first message
        LEFT JOIN LATERAL (
            SELECT internal_date_ts, subject
            FROM email_messages
            WHERE thread_id = t.id
            ORDER BY internal_date_ts ASC NULLS LAST
            LIMIT 1
        ) first_msg ON true
        WHERE
            t.id = $1
        "#,
        thread_id
    )
    .fetch_optional(db)
    .await
    .map_err(PropertiesDatabaseError::Query)
}
