// biohazard
use agent::types::ChatMessageContent;
use agent::types::Role;
use anyhow::{Error, Result};
use model::chat::{AttachmentType, Chat, ChatAttachment, ChatMessageWithAttachments};
use model_entity::{Entity, EntityType};
use sqlx::{Executor, Pool, Postgres};
use std::collections::HashMap;

#[derive(serde::Deserialize, Debug)]
struct RawAttachment {
    entity_type: String,
    entity_id: String,
}

#[tracing::instrument(skip(db))]
pub async fn get_chat_name(db: &Pool<Postgres>, chat_id: &str) -> anyhow::Result<String> {
    let chat = sqlx::query!(
        r#"
        SELECT name
        FROM "Chat"
        WHERE id = $1
        "#,
        chat_id
    )
    .map(|r| r.name)
    .fetch_one(db)
    .await?;

    Ok(chat)
}

pub async fn get_chat_db<'e, T>(db: T, chat_id: &str) -> Result<Chat>
where
    T: Executor<'e, Database = Postgres>,
{
    sqlx::query_as!(
        Chat,
        r#"
          SELECT
              c.id,
              c.name,
              c.model,
              c."userId" as "user_id",
              c."createdAt"::timestamptz as "created_at",
              c."updatedAt"::timestamptz as "updated_at",
              c."deletedAt"::timestamptz as "deleted_at",
              c."projectId" as "project_id",
              c."tokenCount" as "token_count",
              c."isPersistent" as "is_persistent"
          FROM "Chat" c WHERE c.id = $1
          "#,
        chat_id,
    )
    .fetch_one(db)
    .await
    .map_err(Error::from)
}

pub async fn raw_attachments<'e, T>(db: T, chat_id: &str) -> Result<Vec<ChatAttachment>>
where
    T: Executor<'e, Database = Postgres>,
{
    sqlx::query_as!(
        ChatAttachment,
        r#"
          SELECT
              ca.id,
              ca."chatId" as "chat_id",
              ca."entity_id"::TEXT as "attachment_id!",
              ca."entity_type" as "attachment_type: AttachmentType",
              ca."messageId" as "message_id"
          FROM
              "ChatAttachment" ca
          WHERE ca."chatId" = $1
          ORDER BY ca.id ASC
    "#,
        chat_id,
    )
    .fetch_all(db)
    .await
    .map_err(Error::from)
}

pub async fn get_messages<'e, T>(db: T, chat_id: &str) -> Result<Vec<ChatMessageWithAttachments>>
where
    T: Executor<'e, Database = Postgres>,
{
    let message_result = sqlx::query!(
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
    .fetch_all(db)
    .await?;

    let messages: Vec<ChatMessageWithAttachments> = message_result
        .into_iter()
        .map(|record| {
            let attachments: Vec<Entity<'static>> = record
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

// and still we cope
#[derive(Debug, Clone)]
pub struct Citation {
    pub url: String,
    pub title: String,
    pub description: Option<String>,
    pub image_url: Option<String>,
    pub favicon_url: Option<String>,
}

pub async fn get_web_citations<'e, T>(db: T, chat_id: &str) -> Result<Vec<(String, Vec<Citation>)>>
where
    T: Executor<'e, Database = Postgres>,
{
    let citation_records = sqlx::query!(
        r#"
        SELECT
            "messageId" as "message_id",
            "url",
            "title",
            "description",
            "favicon_url",
            "image_url"
        FROM "WebAnnotations" wa
        INNER JOIN "ChatMessage" cm ON cm.id = wa."messageId"
        WHERE cm."chatId" = $1
    "#,
        chat_id
    )
    .fetch_all(db)
    .await?;

    let mut citations: HashMap<String, Vec<Citation>> = HashMap::new();
    citation_records.into_iter().for_each(|record| {
        let link = Citation {
            url: record.url,
            title: record.title,
            description: record.description,
            favicon_url: record.favicon_url,
            image_url: record.image_url,
        };
        if let Some(id) = record.message_id {
            citations
                .entry(id)
                .and_modify(|links: &mut Vec<Citation>| links.push(link.clone())) // cringe rust. this shouldn't move
                .or_insert_with(|| vec![link]);
        }
    });
    Ok(citations.into_iter().collect())
}
