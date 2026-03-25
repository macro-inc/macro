//! Fetch all messages for a chat with their attachments.

use ai::types::{ChatMessageContent, Role};
use model::chat::{
    AttachmentMetadata, AttachmentType, ChatAttachmentWithName, ChatMessageWithAttachments,
};
use sqlx::PgPool;

#[derive(serde::Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct RawAttachment {
    attachment_id: String,
    attachment_type: String,
    document_name: Option<String>,
    document_type: Option<model::document::FileType>,
}

/// Fetch all messages for a chat, with inline attachment metadata from DB joins.
#[tracing::instrument(err, skip(pool))]
pub(crate) async fn get_messages(
    pool: &PgPool,
    chat_id: &str,
) -> anyhow::Result<Vec<ChatMessageWithAttachments>> {
    let records = sqlx::query!(
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
                model: record.model,
            }
        })
        .collect();

    Ok(messages)
}

fn parse_raw_attachment(raw: RawAttachment) -> Option<ChatAttachmentWithName> {
    match raw.attachment_type.as_str() {
        "document" => Some(ChatAttachmentWithName {
            id: raw.attachment_id.clone(),
            attachment_id: raw.attachment_id,
            attachment_type: AttachmentType::Document,
            metadata: raw.document_name.zip(raw.document_type).map(|(name, ft)| {
                AttachmentMetadata::Document {
                    document_type: ft,
                    document_name: name,
                }
            }),
        }),
        "image" => Some(ChatAttachmentWithName {
            id: raw.attachment_id.clone(),
            attachment_id: raw.attachment_id,
            attachment_type: AttachmentType::Image,
            metadata: raw.document_name.zip(raw.document_type).map(|(name, ft)| {
                AttachmentMetadata::Image {
                    image_extension: ft,
                    image_name: name,
                }
            }),
        }),
        "project" => Some(ChatAttachmentWithName {
            id: raw.attachment_id.clone(),
            attachment_id: raw.attachment_id,
            attachment_type: AttachmentType::Project,
            metadata: raw
                .document_name
                .map(|name| AttachmentMetadata::Project { project_name: name }),
        }),
        "channel" => Some(ChatAttachmentWithName {
            id: raw.attachment_id.clone(),
            attachment_id: raw.attachment_id,
            attachment_type: AttachmentType::Channel,
            metadata: None,
        }),
        "email" => Some(ChatAttachmentWithName {
            id: raw.attachment_id.clone(),
            attachment_id: raw.attachment_id,
            attachment_type: AttachmentType::Email,
            metadata: None,
        }),
        _ => None,
    }
}
