// biohazard
use ai::types::ChatMessageContent;
use ai::types::Role;
use anyhow::{Error, Result};
use model::chat::{
    AttachmentMetadata, AttachmentType, Chat, ChatAttachment, ChatAttachmentWithName,
    ChatMessageWithAttachments,
};
use model::document::FileType;
use sqlx::{Executor, Pool, Postgres};
use std::collections::HashMap;

// TODO: @synoet this is a temp solution FIX
#[derive(serde::Serialize, serde::Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct RawAttachment {
    attachment_id: String,
    attachment_type: String,
    document_name: Option<String>,
    document_type: Option<FileType>,
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
              ca."attachmentId" as "attachment_id",
              ca."attachmentType" as "attachment_type: AttachmentType",
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

pub async fn get_messages<'e, T>(
    db: T,
    chat_id: &str,
    attachments: &[ChatAttachmentWithName],
) -> Result<Vec<ChatMessageWithAttachments>>
where
    T: Executor<'e, Database = Postgres>,
{
    let message_result = sqlx::query!(
        r#"
        WITH attachment_info AS (
            SELECT
                ca.id,
                ca."attachmentType",
                ca."attachmentId",
                ca."messageId",
                CASE
                    WHEN ca."attachmentType" = 'document' THEN d.name
                    WHEN ca."attachmentType" = 'chat' THEN c.name
                    WHEN ca."attachmentType" = 'project' THEN p.name
                    WHEN ca."attachmentType" = 'image' THEN d.name
                    ELSE NULL
                END AS document_name,
                CASE
                    WHEN ca."attachmentType" = 'document' THEN d."fileType"
                    WHEN ca."attachmentType" = 'image' THEN d."fileType"
                    ELSE NULL
                END as document_type
            FROM
                "ChatAttachment" ca
            LEFT JOIN
            "Document" d ON (
                (ca."attachmentType" = 'document' AND ca."attachmentId" = d.id)
                OR
                (ca."attachmentType" = 'image' AND ca."attachmentId" = d.id)
            )
            LEFT JOIN
                "Chat" c ON ca."attachmentType" = 'chat' AND ca."attachmentId" = c.id
            LEFT JOIN
                "Project" p ON ca."attachmentType" = 'project' AND ca."attachmentId" = p.id
        )
        SELECT
            cm.id AS "id!",
            cm.content,
            cm.role,
            cm.model,
            COALESCE(
                (
                    SELECT json_agg(
                        json_build_object(
                            'id', attachment_info."attachmentId",
                            'attachmentType', attachment_info."attachmentType",
                            'attachmentId', attachment_info."attachmentId",
                            'documentName', attachment_info.document_name,
                            'documentType', attachment_info.document_type
                        )
                    )
                    FROM attachment_info
                    WHERE attachment_info."messageId" = cm.id
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
    // FIXME: @synoet this is messy
    let messages: Vec<ChatMessageWithAttachments> = message_result
        .into_iter()
        .map(|record| {
            let attachments = match record.attachments {
                Some(raw_attachments) => {
                    let attachments = serde_json::from_value(raw_attachments)
                        .unwrap_or_else(|e| {
                            tracing::error!(error=?e, "Error parsing attachments");
                            Vec::new()
                        })
                        .into_iter()
                        .filter_map(|raw: RawAttachment| match raw.attachment_type.as_str() {
                            "document" => Some(ChatAttachmentWithName {
                                id: raw.attachment_id.clone(),
                                attachment_id: raw.attachment_id,
                                attachment_type: AttachmentType::Document,
                                metadata: raw.document_name.zip(raw.document_type).map(
                                    |(name, type_)| AttachmentMetadata::Document {
                                        document_type: type_,
                                        document_name: name,
                                    },
                                ),
                            }),
                            "image" => Some(ChatAttachmentWithName {
                                id: raw.attachment_id.clone(),
                                attachment_id: raw.attachment_id,
                                attachment_type: AttachmentType::Image,
                                metadata: raw.document_name.zip(raw.document_type).map(
                                    |(name, type_)| AttachmentMetadata::Image {
                                        image_extension: type_,
                                        image_name: name,
                                    },
                                ),
                            }),
                            "channel" => {
                                // Reuse metadata from earlier attachments vector
                                let metadata = attachments
                                    .iter()
                                    .find(|a| {
                                        a.attachment_id == raw.attachment_id
                                            && a.attachment_type == AttachmentType::Channel
                                    })
                                    .and_then(|a| a.metadata.clone());
                                Some(ChatAttachmentWithName {
                                    id: raw.attachment_id.clone(),
                                    attachment_id: raw.attachment_id,
                                    attachment_type: AttachmentType::Channel,
                                    metadata,
                                })
                            }
                            _ => None,
                        })
                        .collect();

                    Some(attachments)
                }
                None => None,
            };

            tracing::debug!("get chat\n{:?}", record.content.as_str());
            let content =
                serde_json::from_value::<ChatMessageContent>(record.content).expect("content");
            let role = Role::try_from(record.role.as_str()).unwrap_or(Role::User);
            // serde_json::from_str::<Role>(&record.role).expect("role");

            ChatMessageWithAttachments {
                id: record.id,
                content,
                role,
                attachments: attachments.unwrap_or_default(),
                model: record.model,
            }
        })
        .collect();
    Ok(messages)
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
