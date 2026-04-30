//! Fetch all messages for a chat with their attachments.

use ai::types::{ChatMessageContent, Role};
use model::chat::ChatMessageWithAttachments;
use model_entity::{Entity, EntityType};
use sqlx::PgPool;

#[derive(serde::Deserialize, Debug)]
struct RawAttachment {
    entity_type: String,
    entity_id: String,
}

/// Fetch all messages for a chat, with inline attachment metadata from DB joins.
#[tracing::instrument(err, skip(pool))]
pub(crate) async fn get_messages(
    pool: &PgPool,
    chat_id: &str,
) -> anyhow::Result<Vec<ChatMessageWithAttachments>> {
    let records = sqlx::query!(
        r#"
        SELECT
            cm.id AS "id!",
            cm.content,
            cm.role,
            cm.model,
            COALESCE(
                (
                    SELECT json_agg(
                        json_build_object(
                            'entity_type', ca."entity_type",
                            'entity_id', ca."entity_id"::TEXT
                        )
                    )
                    FROM "ChatAttachment" ca
                    WHERE ca."messageId" = cm.id
                ),
                '[]'::json
            ) AS attachments
        FROM
            "ChatMessage" cm
        WHERE
            cm."chatId" = $1
        ORDER BY
            cm."createdAt" ASC
        "#,
        chat_id
    )
    .fetch_all(pool)
    .await?;

    let messages = records
        .into_iter()
        .map(|record| {
            let attachments = record
                .attachments
                .and_then(|raw_json| {
                    serde_json::from_value::<Vec<RawAttachment>>(raw_json)
                        .inspect_err(|e| tracing::error!(error=?e, "Error parsing attachments"))
                        .ok()
                })
                .map(|raws| raws.into_iter().filter_map(parse_raw_attachment).collect())
                .unwrap_or_default();

            let content =
                serde_json::from_value::<ChatMessageContent>(record.content).expect("content");
            let role = Role::try_from(record.role.as_str()).unwrap_or(Role::User);

            ChatMessageWithAttachments {
                id: record.id,
                content,
                role,
                attachments,
            }
        })
        .collect();

    Ok(messages)
}

fn parse_raw_attachment(raw: RawAttachment) -> Option<Entity<'static>> {
    let entity_type: EntityType = raw.entity_type.parse().ok()?;
    Some(entity_type.with_entity_string(raw.entity_id))
}
