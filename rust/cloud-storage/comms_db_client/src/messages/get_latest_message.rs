use anyhow::Result;
use model::comms::{ChannelMessage, LatestMessage};
use sqlx::{Pool, Postgres};
use std::collections::HashMap;
use uuid::Uuid;

pub type ChannelLatestMessages = HashMap<Uuid, LatestMessage>;

#[tracing::instrument(err)]
pub async fn get_latest_channel_messages_batch(
    pool: &Pool<Postgres>,
    channel_ids: &[Uuid],
) -> Result<ChannelLatestMessages> {
    if channel_ids.is_empty() {
        return Ok(HashMap::new());
    }

    let rows = sqlx::query!(
        r#"
        WITH input_ids AS (
            SELECT UNNEST($1::uuid[]) AS channel_id
        )
        SELECT
            i.channel_id                                          AS "channel_id!",
            l.message_id                                           AS "l_message_id?: uuid::Uuid",
            l.thread_id                                            AS "l_thread_id?: uuid::Uuid",
            l.sender_id                                            AS "l_sender_id?: String",
            l.content                                              AS "l_content?: String",
            l.created_at                                           AS "l_created_at?: chrono::DateTime<chrono::Utc>",
            l.updated_at                                           AS "l_updated_at?: chrono::DateTime<chrono::Utc>",
            l.deleted_at                                           AS "l_deleted_at?: chrono::DateTime<chrono::Utc>",
            l.mentions                                             AS "l_mentions?: Vec<String>",
            n.message_id                                           AS "n_message_id?: uuid::Uuid",
            n.thread_id                                            AS "n_thread_id?: uuid::Uuid",
            n.sender_id                                            AS "n_sender_id?: String",
            n.content                                              AS "n_content?: String",
            n.created_at                                           AS "n_created_at?: chrono::DateTime<chrono::Utc>",
            n.updated_at                                           AS "n_updated_at?: chrono::DateTime<chrono::Utc>",
            n.deleted_at                                           AS "n_deleted_at?: chrono::DateTime<chrono::Utc>",
            n.mentions                                             AS "n_mentions?: Vec<String>"
        FROM input_ids i
        LEFT JOIN LATERAL (
            SELECT
                m.id AS message_id,
                m.thread_id,
                m.sender_id,
                m.content,
                m.created_at,
                m.updated_at,
                m.deleted_at::timestamptz AS deleted_at,
                COALESCE(
                    ARRAY(
                        SELECT entity_type || ':' || entity_id
                        FROM comms_entity_mentions em
                        WHERE em.source_entity_type = 'message'
                          AND em.source_entity_id = m.id::text
                    ),
                    '{}'::text[]
                ) AS mentions
            FROM comms_messages m
            WHERE m.channel_id = i.channel_id
              AND m.deleted_at IS NULL
            ORDER BY m.created_at DESC
            LIMIT 1
        ) l ON TRUE
        LEFT JOIN LATERAL (
            SELECT
                m.id AS message_id,
                m.thread_id,
                m.sender_id,
                m.content,
                m.created_at,
                m.updated_at,
                m.deleted_at::timestamptz AS deleted_at,
                COALESCE(
                    ARRAY(
                        SELECT entity_type || ':' || entity_id
                        FROM comms_entity_mentions em
                        WHERE em.source_entity_type = 'message'
                          AND em.source_entity_id = m.id::text
                    ),
                    '{}'::text[]
                ) AS mentions
            FROM comms_messages m
            WHERE m.channel_id = i.channel_id
              AND m.deleted_at IS NULL
              AND m.thread_id IS NULL
            ORDER BY m.created_at DESC
            LIMIT 1
        ) n ON TRUE
        "#,
        channel_ids
    )
    .fetch_all(pool)
    .await?;

    let mut result: ChannelLatestMessages = HashMap::with_capacity(rows.len());

    let build_message = |message_id: Option<Uuid>,
                         thread_id: Option<Uuid>,
                         sender_id: Option<String>,
                         content: Option<String>,
                         created_at: Option<chrono::DateTime<chrono::Utc>>,
                         updated_at: Option<chrono::DateTime<chrono::Utc>>,
                         deleted_at: Option<chrono::DateTime<chrono::Utc>>,
                         mentions: Option<Vec<String>>| {
        match (message_id, sender_id, content, created_at, updated_at) {
            (
                Some(message_id),
                Some(sender_id),
                Some(content),
                Some(created_at),
                Some(updated_at),
            ) => Some(ChannelMessage {
                message_id,
                thread_id,
                sender_id,
                content,
                created_at,
                updated_at,
                deleted_at,
                mentions: mentions.unwrap_or_default(),
            }),
            (None, _, _, _, _) => None,
            _ => {
                tracing::warn!("incomplete latest message row; skipping");
                None
            }
        }
    };

    for row in rows {
        let latest_message = build_message(
            row.l_message_id,
            row.l_thread_id,
            row.l_sender_id,
            row.l_content,
            row.l_created_at,
            row.l_updated_at,
            row.l_deleted_at,
            row.l_mentions,
        );

        let latest_non_thread_message = build_message(
            row.n_message_id,
            row.n_thread_id,
            row.n_sender_id,
            row.n_content,
            row.n_created_at,
            row.n_updated_at,
            row.n_deleted_at,
            row.n_mentions,
        );

        result.insert(
            row.channel_id,
            LatestMessage {
                latest_message,
                latest_non_thread_message,
            },
        );
    }

    Ok(result)
}

pub async fn get_latest_channel_message(
    pool: &Pool<Postgres>,
    channel_id: Uuid,
) -> Result<LatestMessage> {
    let res = get_latest_channel_messages_batch(pool, &[channel_id]).await?;
    Ok(res.get(&channel_id).cloned().unwrap_or(LatestMessage {
        latest_message: None,
        latest_non_thread_message: None,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use macro_db_migrator::MACRO_DB_MIGRATIONS;

    fn uuid(s: &str) -> Uuid {
        Uuid::parse_str(s).unwrap()
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("latest_messages"))
    )]
    async fn test_get_latest_channel_messages_batch(
        pool: sqlx::Pool<sqlx::Postgres>,
    ) -> Result<()> {
        const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS; // Dummy reference for IDE
        let ids = vec![
            uuid("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"),
            uuid("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"),
            uuid("cccccccc-cccc-cccc-cccc-cccccccccccc"),
            uuid("dddddddd-dddd-dddd-dddd-dddddddddddd"),
        ];

        let res = get_latest_channel_messages_batch(&pool, &ids).await?;

        // aaaaaaaa
        let a = res.get(&ids[0]).expect("channel a should exist");
        assert_eq!(
            a.latest_non_thread_message
                .as_ref()
                .map(|m| m.message_id.to_string())
                .as_deref(),
            Some("aaaaaa2a-0000-0000-0000-000000000002")
        );

        // bbbbbbbb
        let b = res.get(&ids[1]).expect("channel b should exist");
        assert_eq!(
            b.latest_message
                .as_ref()
                .map(|m| m.message_id.to_string())
                .as_deref(),
            Some("bbbbbb2b-0000-0000-0000-000000000003")
        );
        assert!(b.latest_non_thread_message.is_none());

        // cccccccc
        let c = res.get(&ids[2]).expect("channel c should exist");
        assert_eq!(
            c.latest_message
                .as_ref()
                .map(|m| m.message_id.to_string())
                .as_deref(),
            Some("cccccc2c-0000-0000-0000-000000000002")
        );
        assert_eq!(
            c.latest_non_thread_message
                .as_ref()
                .map(|m| m.message_id.to_string())
                .as_deref(),
            Some("cccccc2c-0000-0000-0000-000000000002")
        );

        // dddddddd
        let d = res.get(&ids[3]).expect("channel d should exist");
        assert_eq!(
            d.latest_message
                .as_ref()
                .map(|m| m.message_id.to_string())
                .as_deref(),
            Some("dddddd1d-0000-0000-0000-000000000001")
        );
        assert_eq!(
            d.latest_non_thread_message
                .as_ref()
                .map(|m| m.message_id.to_string())
                .as_deref(),
            Some("dddddd1d-0000-0000-0000-000000000001")
        );

        Ok(())
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("latest_messages"))
    )]
    async fn test_get_latest_channel_message(pool: sqlx::Pool<sqlx::Postgres>) -> Result<()> {
        let a =
            get_latest_channel_message(&pool, uuid("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")).await?;

        assert_eq!(
            a.latest_message
                .as_ref()
                .map(|m| m.message_id.to_string())
                .as_deref(),
            Some("aaaaaa2a-0000-0000-0000-000000000004")
        );
        assert_eq!(
            a.latest_non_thread_message
                .as_ref()
                .map(|m| m.message_id.to_string())
                .as_deref(),
            Some("aaaaaa2a-0000-0000-0000-000000000002")
        );

        let b =
            get_latest_channel_message(&pool, uuid("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")).await?;
        assert_eq!(
            b.latest_message
                .as_ref()
                .map(|m| m.message_id.to_string())
                .as_deref(),
            Some("bbbbbb2b-0000-0000-0000-000000000003")
        );
        assert!(b.latest_non_thread_message.is_none());

        let c =
            get_latest_channel_message(&pool, uuid("cccccccc-cccc-cccc-cccc-cccccccccccc")).await?;
        assert_eq!(
            c.latest_message
                .as_ref()
                .map(|m| m.message_id.to_string())
                .as_deref(),
            Some("cccccc2c-0000-0000-0000-000000000002")
        );
        assert_eq!(
            c.latest_non_thread_message
                .as_ref()
                .map(|m| m.message_id.to_string())
                .as_deref(),
            Some("cccccc2c-0000-0000-0000-000000000002")
        );

        let d =
            get_latest_channel_message(&pool, uuid("dddddddd-dddd-dddd-dddd-dddddddddddd")).await?;
        assert_eq!(
            d.latest_message
                .as_ref()
                .map(|m| m.message_id.to_string())
                .as_deref(),
            Some("dddddd1d-0000-0000-0000-000000000001")
        );
        assert_eq!(
            d.latest_non_thread_message
                .as_ref()
                .map(|m| m.message_id.to_string())
                .as_deref(),
            Some("dddddd1d-0000-0000-0000-000000000001")
        );

        Ok(())
    }
}
