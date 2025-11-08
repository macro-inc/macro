use crate::model::SimpleMention;
use anyhow::Result;
use sqlx::{Executor, Postgres};
use uuid::Uuid;

#[derive(Debug)]
pub struct CreateMessageMentionOptions {
    pub message_id: Uuid,
    pub mentions: Vec<SimpleMention>,
}

/// Creates message mentions for a given message
/// returns the mentioned users
/// a user is mentioned if the entity_type is "user" and the entity_id is a user_id that is
/// included in the channel_participants table associated with the message's channel_id
#[tracing::instrument(skip(executor))]
pub async fn create_message_mentions<'e, E>(
    executor: E,
    options: CreateMessageMentionOptions,
) -> Result<Vec<String>>
where
    E: Executor<'e, Database = Postgres>,
{
    if options.mentions.is_empty() {
        return Ok(vec![]);
    }

    let entity_types: Vec<String> = options
        .mentions
        .iter()
        .map(|m| m.entity_type.clone())
        .collect();
    let entity_ids: Vec<String> = options
        .mentions
        .iter()
        .map(|m| m.entity_id.clone())
        .collect();

    let mentioned_users = sqlx::query_scalar!(
        r#"
        WITH message_channel AS (
            SELECT channel_id FROM comms_messages WHERE id = $1
        ),
        mentions_to_insert AS (
            SELECT t.entity_type, t.entity_id
            FROM UNNEST($2::text[], $3::text[]) AS t(entity_type, entity_id)
        ),
        inserted_mentions AS (
            INSERT INTO comms_entity_mentions (id, source_entity_type, source_entity_id, entity_type, entity_id, user_id)
            SELECT gen_random_uuid(), 'message', $1::text, m.entity_type, m.entity_id, NULL
            FROM mentions_to_insert m
            WHERE NOT EXISTS (
                SELECT 1 FROM comms_entity_mentions em 
                WHERE em.source_entity_type = 'message' 
                  AND em.source_entity_id = $1::text
                  AND em.entity_type = m.entity_type 
                  AND em.entity_id = m.entity_id
            )
        )
        SELECT DISTINCT cp.user_id
        FROM mentions_to_insert m
        CROSS JOIN message_channel mc
        JOIN comms_channel_participants cp ON m.entity_id = cp.user_id
        WHERE m.entity_type = 'user'
        AND cp.channel_id = mc.channel_id
        AND cp.left_at IS NULL
        "#,
        options.message_id,
        &entity_types as &[String],
        &entity_ids as &[String],
    )
    .fetch_all(executor)
    .await?;

    Ok(mentioned_users)
}

#[cfg(test)]
mod tests {
    use crate::{messages::create_message_mentions, model::SimpleMention};
    use macro_db_migrator::MACRO_DB_MIGRATIONS;
    use sqlx::PgPool;
    use std::str::FromStr;
    use uuid::Uuid;

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "./../../fixtures", scripts("mentions"))
    )]
    async fn test_insert_message_mentions(pool: PgPool) -> anyhow::Result<()> {
        const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS; // Dummy reference for IDE
        let message_id = Uuid::from_str("11111111-1111-1111-1111-111111111111").unwrap();
        let mentions = vec![
            SimpleMention {
                entity_id: "user1".to_string(),
                entity_type: "user".to_string(),
            },
            SimpleMention {
                entity_id: "user2".to_string(),
                entity_type: "user".to_string(),
            },
            SimpleMention {
                entity_id: "document-one".to_string(),
                entity_type: "document".to_string(),
            },
        ];

        let expected_notified = vec!["user1".to_string(), "user2".to_string()];
        let mut user_mentions = create_message_mentions::create_message_mentions(
            &pool,
            create_message_mentions::CreateMessageMentionOptions {
                message_id,
                mentions: mentions.clone(),
            },
        )
        .await?;
        user_mentions.sort();
        assert_eq!(user_mentions, expected_notified);
        // expect all mentions to be in the entity_mentions table
        let mentions_in_table = sqlx::query!(
            r#"
            SELECT m.entity_id, m.entity_type
            FROM comms_entity_mentions m
            WHERE m.source_entity_type = 'message' AND m.source_entity_id = $1
            "#,
            message_id.to_string()
        )
        .map(|row| SimpleMention {
            entity_id: row.entity_id,
            entity_type: row.entity_type,
        })
        .fetch_all(&pool)
        .await?;

        let mut sorted_mentions_in_table = mentions_in_table;
        sorted_mentions_in_table.sort_by(|a, b| {
            a.entity_type
                .cmp(&b.entity_type)
                .then(a.entity_id.cmp(&b.entity_id))
        });

        let mut sorted_expected_mentions = mentions.clone();
        sorted_expected_mentions.sort_by(|a, b| {
            a.entity_type
                .cmp(&b.entity_type)
                .then(a.entity_id.cmp(&b.entity_id))
        });

        assert_eq!(sorted_mentions_in_table, sorted_expected_mentions);
        Ok(())
    }
}
