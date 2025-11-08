use ai::types::ChatMessageContent;
use anyhow::Error;
use chrono::{DateTime, Utc};
use model::chat::{ChatHistory, ConversationRecord, MessageWithAttachmentSummary, Summary};
use model::insight_context::document::DocumentSummary;
use sqlx::{Executor, FromRow, Postgres};
use std::collections::HashMap;

// Struct to represent the query result row
#[derive(FromRow)]
struct ChatQueryRecord {
    message_id: String,
    content: serde_json::Value,
    date: DateTime<Utc>,
    conversation_title: String,
    attachment_id: Option<String>,
    ds_summary: Option<String>,
    ds_version_id: Option<String>,
    ds_created_at: Option<DateTime<Utc>>,
    ds_document_id: Option<String>,
    ds_id: Option<String>,
    chat_id: String,
}

fn process_chat_records(records: Vec<ChatQueryRecord>) -> Result<ChatHistory, Error> {
    // map message id to summaries
    let mut attachments: HashMap<String, Vec<_>> = HashMap::new();

    for record in records.iter() {
        if let Some(ref attachment_id) = record.attachment_id {
            let summary = if record.ds_id.is_some() {
                if record.ds_document_id.is_none()
                    || record.ds_summary.is_none()
                    || record.ds_version_id.is_none()
                {
                    panic!("unexpected null");
                }

                Summary::Summary(DocumentSummary {
                    created_at: record.ds_created_at,
                    document_id: record.ds_document_id.clone().expect("document id"),
                    summary: record.ds_summary.clone().expect("summary"),
                    id: record.ds_id.clone(),
                    version_id: record.ds_version_id.clone().expect("version_id"),
                })
            } else {
                Summary::NoSummary {
                    document_id: attachment_id.clone(),
                }
            };
            attachments
                .entry(record.message_id.clone())
                .or_default()
                .push(summary);
        }
    }

    // map chat id to messages
    let mut message_map: HashMap<String, Vec<MessageWithAttachmentSummary>> = HashMap::new();
    // map chat id to title
    let mut title_map: HashMap<String, String> = HashMap::new();

    records
        .into_iter()
        // dedup records by message_id
        .map(|record| (record.message_id.clone(), record))
        .collect::<HashMap<_, _>>()
        .values()
        // iterating over messages
        .for_each(|record| {
            // let date = DateTime::from_naive_utc_and_offset(record.date, Utc);
            let attachment_list = attachments
                .get(&record.message_id)
                .map(|c| c.to_owned())
                .unwrap_or_default();
            let content = serde_json::from_value::<ChatMessageContent>(record.content.clone());
            if content.is_err() {
                return;
            }
            let content = content.unwrap();
            let text = content.message_text_with_tools();
            let message = MessageWithAttachmentSummary {
                attachment_summaries: attachment_list,
                content: text,
                date: record.date,
            };
            message_map
                .entry(record.chat_id.clone())
                .or_default()
                .push(message);
            title_map.insert(record.chat_id.clone(), record.conversation_title.clone());
        });

    let mut conversations = message_map
        .into_iter()
        .map(|(chat_id, mut messages)| {
            messages.sort_by(|a, b| a.date.cmp(&b.date));
            let title = title_map.get(&chat_id).unwrap_or(&"".to_string()).clone();
            ConversationRecord {
                chat_id,
                title,
                messages,
            }
        })
        .collect::<Vec<_>>();

    // Sort conversations by chat_id to ensure consistent ordering
    conversations.sort_by(|a, b| a.chat_id.cmp(&b.chat_id));
    Ok(ChatHistory {
        conversation: conversations,
    })
}

#[tracing::instrument(skip(db))]
pub async fn get_chat_history_for_messages<'e, E>(
    db: E,
    messages: &[String],
) -> Result<ChatHistory, Error>
where
    E: Executor<'e, Database = Postgres>,
{
    let records = sqlx::query_as!(
        ChatQueryRecord,
        r#"
        SELECT
            m."id" as message_id,
            m."content",
            m."createdAt" as "date!: DateTime<Utc>",
            c."name" as conversation_title,
            a."attachmentId" as "attachment_id?",
            d."summary" as "ds_summary?",
            d."version_id" as "ds_version_id?",
            d."createdAt" as "ds_created_at?: DateTime<Utc>",
            d."document_id" as "ds_document_id?",
            d."id" as "ds_id?",
            m."chatId" as "chat_id"
        FROM "ChatMessage" m
        LEFT JOIN "Chat" c
            ON c."id" = m."chatId"
        LEFT JOIN "ChatAttachment" a
            ON m.id = a."messageId"
        LEFT JOIN LATERAL (
            SELECT DISTINCT ON (ds."document_id")
                ds.*
            FROM "DocumentSummary" ds
            WHERE ds."document_id" = a."attachmentId"
            ORDER BY ds."document_id", ds."createdAt" DESC
        ) d ON true
        WHERE
            m."id" = ANY($1)
        ORDER BY m."createdAt" DESC;
        "#,
        &messages
    )
    .fetch_all(db)
    .await?;

    process_chat_records(records)
}

#[tracing::instrument(skip(db))]
pub async fn get_chat_history<'e, E>(db: E, chat_id: &str) -> Result<ChatHistory, Error>
where
    E: Executor<'e, Database = Postgres>,
{
    let records = sqlx::query_as!(
        ChatQueryRecord,
        r#"
        SELECT
            m."id" as message_id,
            m."content",
            m."createdAt" as "date!: DateTime<Utc>",
            c."name" as conversation_title,
            a."attachmentId" as "attachment_id?",
            d."summary" as "ds_summary?",
            d."version_id" as "ds_version_id?",
            d."createdAt" as "ds_created_at?: DateTime<Utc>",
            d."document_id" as "ds_document_id?",
            d."id" as "ds_id?",
            m."chatId" as "chat_id"
        FROM "ChatMessage" m
        LEFT JOIN "Chat" c
            ON c."id" = m."chatId"
        LEFT JOIN "ChatAttachment" a
            ON m.id = a."messageId"
        LEFT JOIN LATERAL (
            SELECT DISTINCT ON (ds."document_id")
                ds.*
            FROM "DocumentSummary" ds
            WHERE ds."document_id" = a."attachmentId"
            ORDER BY ds."document_id", ds."createdAt" DESC
        ) d ON true
        WHERE
            m."chatId" = $1
        ORDER BY m."createdAt" DESC;
        "#,
        chat_id
    )
    .fetch_all(db)
    .await?;

    process_chat_records(records)
}

#[cfg(test)]
mod test {
    use super::*;
    use sqlx::{Pool, Postgres};
    use std::collections::HashMap;

    const USER_ID: &str = "test-userid";
    #[sqlx::test(fixtures(path = "../../../fixtures", scripts("chat_with_attachment_summaries")))]
    async fn test_get_a(db: Pool<Postgres>) {
        let history = get_chat_history_for_messages(&db, &["c0m0".to_string()])
            .await
            .expect("messages");

        assert!(!history.conversation.is_empty());
        assert_eq!(history.conversation.len(), 1);
        assert_eq!(
            history.conversation.first().expect("first").messages.len(),
            1
        );

        let message = history
            .conversation
            .first()
            .expect("first")
            .messages
            .first()
            .expect("first_message");
        assert_eq!(message.content.as_str(), "m0-content");

        let summaries = message
            .clone()
            .attachment_summaries
            .into_iter()
            .filter_map(|sum| match sum {
                Summary::Summary(s) => Some(s),
                _ => None,
            })
            .collect::<Vec<_>>();

        assert_eq!(summaries.len(), 1);

        let i0 = summaries.first().expect("summary").clone();

        assert_eq!(i0.document_id, "document-id-0".to_string());
    }

    #[sqlx::test(fixtures(path = "../../../fixtures", scripts("chat_with_attachment_summaries")))]
    async fn test_get_b(db: Pool<Postgres>) {
        let history = get_chat_history_for_messages(
            &db,
            &["c0m0", "c0m1", "c0m2"]
                .into_iter()
                .map(&str::to_string)
                .collect::<Vec<_>>(),
        )
        .await
        .expect("messages");
        assert_eq!(history.conversation.len(), 1);
        assert_eq!(
            history.conversation.first().expect("first").messages.len(),
            3
        );

        let history = get_chat_history_for_messages(
            &db,
            &["c0m0", "c0m1", "c0m2", "c1m0", "c1m1"]
                .into_iter()
                .map(&str::to_string)
                .collect::<Vec<_>>(),
        )
        .await
        .expect("messages");
        assert_eq!(history.conversation.len(), 2);
        assert_eq!(history.conversation[0].messages.len(), 3);
        assert_eq!(history.conversation[1].messages.len(), 2);

        let history = get_chat_history_for_messages(
            &db,
            &["c0m0", "c0m1", "c0m2", "c0m0", "c0m0", "c0m0"]
                .into_iter()
                .map(&str::to_string)
                .collect::<Vec<_>>(),
        )
        .await
        .expect("messages");
        assert_eq!(history.conversation.len(), 1);
        assert_eq!(
            history.conversation.first().expect("first").messages.len(),
            3
        );
    }

    #[sqlx::test(fixtures(path = "../../../fixtures", scripts("chat_with_attachment_summaries")))]
    async fn test_get_c(db: Pool<Postgres>) {
        let history = get_chat_history_for_messages(
            &db,
            &["c0m0", "c0m1", "c0m2", "c1m0", "c1m1"]
                .into_iter()
                .map(&str::to_string)
                .collect::<Vec<_>>(),
        )
        .await
        .expect("messages");
        assert_eq!(history.conversation.len(), 2);
        assert_eq!(history.conversation[0].messages.len(), 3);
        assert_eq!(history.conversation[1].messages.len(), 2);

        let all_insights = history
            .conversation
            .into_iter()
            .flat_map(|c| {
                c.messages
                    .into_iter()
                    .flat_map(|m| m.attachment_summaries.into_iter())
            })
            .collect::<Vec<_>>();
        let mut messages_without_insight = 0;
        for i in &all_insights {
            if let Summary::NoSummary { document_id } = i {
                messages_without_insight += 1;
                assert!(
                    document_id.as_str() == "document-id-img"
                        || document_id.as_str() == "document-id-2"
                )
            }
        }
        assert_eq!(messages_without_insight, 2);
        let deduped = all_insights
            .into_iter()
            .filter_map(|i| match i {
                Summary::NoSummary { .. } => None,
                Summary::Summary(a) => Some((a.document_id.clone(), a)),
            })
            .collect::<HashMap<_, _>>();
        assert_eq!(deduped.len(), 2);
    }

    #[sqlx::test(fixtures(path = "../../../fixtures", scripts("chat_with_attachment_summaries")))]
    async fn test_stable_order_and_chronology(db: Pool<Postgres>) {
        const USER_ID: &str = "test-userid";

        // Every message-id in the fixture in one shot.
        let all_ids: Vec<String> = ["c0m0", "c0m1", "c0m2", "c1m0", "c1m1"]
            .iter()
            .map(|s| s.to_string())
            .collect();

        // A single “canonical” run whose order we’ll treat as ground truth.
        let baseline = get_chat_history_for_messages(&db, &all_ids)
            .await
            .expect("baseline history");

        // Extract (conversation title, Vec<DateTime>) from the baseline.
        let baseline_timeline: Vec<(String, Vec<DateTime<Utc>>)> = baseline
            .conversation
            .iter()
            .map(|conv| {
                let dates = conv.messages.iter().map(|m| m.date).collect::<Vec<_>>();
                (conv.title.clone(), dates)
            })
            .collect();

        // Run the query many times to flush out any nondeterminism.
        for _ in 0..100 {
            let history = get_chat_history_for_messages(&db, &all_ids)
                .await
                .expect("history");

            // 1️⃣ conversation order must match baseline
            assert_eq!(
                history.conversation.len(),
                baseline_timeline.len(),
                "conversation count changed"
            );

            for (idx, conv) in history.conversation.iter().enumerate() {
                let (ref expected_title, ref expected_dates) = baseline_timeline[idx];

                assert_eq!(
                    &conv.title, expected_title,
                    "conversation order changed at index {idx}"
                );

                // 2️⃣ message dates must match baseline *and* be ascending
                let dates = conv.messages.iter().map(|m| m.date).collect::<Vec<_>>();
                assert_eq!(
                    &dates, expected_dates,
                    "message order changed in conversation `{}`",
                    conv.title
                );

                let mut sorted = dates.clone();
                sorted.sort();

                assert!(
                    sorted.first().expect("first") < sorted.last().expect("last"),
                    "latest last"
                );
                assert_eq!(
                    dates, sorted,
                    "messages in `{}` not sorted earliest → latest",
                    conv.title
                );
            }
        }
    }
}
