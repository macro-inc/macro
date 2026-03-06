use crate::domain::models::{
    LabelListVisibility, LabelType, LinkLabel, MessageListVisibility, SimpleMessage,
};
use crate::outbound::email_pg_repo::db_types::{
    LabelListVisibilityDbRow, LabelTypeDbRow, MessageListVisibilityDbRow,
};
use chrono::{DateTime, Utc};
use sqlx::PgPool;
use uuid::Uuid;

/// DB row for a label looked up by ID.
struct LinkLabelDbRow {
    id: Uuid,
    link_id: Uuid,
    provider_label_id: String,
    name: String,
    created_at: DateTime<Utc>,
    message_list_visibility: MessageListVisibilityDbRow,
    label_list_visibility: LabelListVisibilityDbRow,
    type_: LabelTypeDbRow,
}

impl From<LinkLabelDbRow> for LinkLabel {
    fn from(row: LinkLabelDbRow) -> Self {
        Self {
            id: row.id,
            link_id: row.link_id,
            provider_label_id: row.provider_label_id,
            name: row.name,
            created_at: row.created_at,
            message_list_visibility: match row.message_list_visibility {
                MessageListVisibilityDbRow::Show => MessageListVisibility::Show,
                MessageListVisibilityDbRow::Hide => MessageListVisibility::Hide,
            },
            label_list_visibility: match row.label_list_visibility {
                LabelListVisibilityDbRow::LabelShow => LabelListVisibility::LabelShow,
                LabelListVisibilityDbRow::LabelShowIfUnread => {
                    LabelListVisibility::LabelShowIfUnread
                }
                LabelListVisibilityDbRow::LabelHide => LabelListVisibility::LabelHide,
            },
            type_: match row.type_ {
                LabelTypeDbRow::System => LabelType::System,
                LabelTypeDbRow::User => LabelType::User,
            },
        }
    }
}

/// DB row for a simplified message in thread label operations.
struct SimpleMessageDbRow {
    id: Uuid,
    provider_id: Option<String>,
    thread_id: Uuid,
    provider_thread_id: Option<String>,
    replying_to_id: Option<Uuid>,
    global_id: Option<String>,
    link_id: Uuid,
    subject: Option<String>,
    snippet: Option<String>,
    from_contact_id: Option<Uuid>,
    provider_history_id: Option<String>,
    internal_date_ts: Option<DateTime<Utc>>,
    sent_at: Option<DateTime<Utc>>,
    size_estimate: Option<i64>,
    is_read: bool,
    is_starred: bool,
    is_sent: bool,
    is_draft: bool,
    has_attachments: bool,
    headers_jsonb: Option<serde_json::Value>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

impl From<SimpleMessageDbRow> for SimpleMessage {
    fn from(row: SimpleMessageDbRow) -> Self {
        Self {
            db_id: row.id,
            provider_id: row.provider_id,
            thread_db_id: row.thread_id,
            provider_thread_id: row.provider_thread_id,
            replying_to_id: row.replying_to_id,
            global_id: row.global_id,
            link_id: row.link_id,
            subject: row.subject,
            snippet: row.snippet,
            from_contact_id: row.from_contact_id,
            provider_history_id: row.provider_history_id,
            internal_date_ts: row.internal_date_ts,
            sent_at: row.sent_at,
            size_estimate: row.size_estimate,
            is_read: row.is_read,
            is_starred: row.is_starred,
            is_sent: row.is_sent,
            is_draft: row.is_draft,
            has_attachments: row.has_attachments,
            headers_json: row.headers_jsonb,
            created_at: row.created_at,
            updated_at: row.updated_at,
        }
    }
}

#[tracing::instrument(skip(pool), err)]
pub(crate) async fn list_labels_by_link_id(
    pool: &PgPool,
    link_id: Uuid,
) -> Result<Vec<LinkLabel>, sqlx::Error> {
    let rows: Vec<LinkLabelDbRow> = sqlx::query_as!(
        LinkLabelDbRow,
        r#"
        SELECT
            id,
            link_id,
            provider_label_id,
            name,
            created_at,
            message_list_visibility as "message_list_visibility: _",
            label_list_visibility as "label_list_visibility: _",
            type as "type_: _"
        FROM email_labels
        WHERE link_id = $1
        ORDER BY name
        "#,
        link_id
    )
    .fetch_all(pool)
    .await?;

    Ok(rows.into_iter().map(Into::into).collect())
}

#[tracing::instrument(skip(pool), err)]
pub(crate) async fn get_label_by_id(
    pool: &PgPool,
    label_id: Uuid,
    link_id: Uuid,
) -> Result<Option<LinkLabel>, sqlx::Error> {
    let row: Option<LinkLabelDbRow> = sqlx::query_as!(
        LinkLabelDbRow,
        r#"
        SELECT
            id,
            link_id,
            provider_label_id,
            name,
            created_at,
            message_list_visibility as "message_list_visibility: _",
            label_list_visibility as "label_list_visibility: _",
            type as "type_: _"
        FROM email_labels
        WHERE id = $1 AND link_id = $2
        "#,
        label_id,
        link_id
    )
    .fetch_optional(pool)
    .await?;

    Ok(row.map(Into::into))
}

#[tracing::instrument(skip(pool), err)]
pub(crate) async fn get_thread_label_messages(
    pool: &PgPool,
    thread_id: Uuid,
    link_id: Uuid,
) -> Result<Vec<SimpleMessage>, sqlx::Error> {
    let rows: Vec<SimpleMessageDbRow> = sqlx::query_as!(
        SimpleMessageDbRow,
        r#"
        SELECT
            m.id,
            m.provider_id,
            m.thread_id,
            m.provider_thread_id,
            m.replying_to_id,
            m.global_id,
            m.link_id,
            m.subject,
            m.snippet,
            m.from_contact_id,
            m.provider_history_id,
            m.internal_date_ts,
            m.sent_at,
            m.size_estimate,
            m.is_read,
            m.is_starred,
            m.is_sent,
            m.is_draft,
            m.has_attachments,
            m.headers_jsonb,
            m.created_at,
            m.updated_at
        FROM email_messages m
        WHERE m.thread_id = $1 AND m.link_id = $2
        ORDER BY m.internal_date_ts DESC NULLS LAST
        "#,
        thread_id,
        link_id
    )
    .fetch_all(pool)
    .await?;

    Ok(rows.into_iter().map(Into::into).collect())
}

#[tracing::instrument(skip(pool), err)]
pub(crate) async fn insert_message_labels_batch(
    pool: &PgPool,
    message_ids: &[Uuid],
    provider_label_id: &str,
    link_id: Uuid,
) -> Result<(), sqlx::Error> {
    if message_ids.is_empty() {
        return Ok(());
    }

    sqlx::query!(
        r#"
        INSERT INTO email_message_labels (message_id, label_id)
        SELECT
            unnested_message_id,
            l.id
        FROM
            UNNEST($1::uuid[]) AS t(unnested_message_id)
        CROSS JOIN
            email_labels l
        WHERE
            l.link_id = $2 AND l.provider_label_id = $3
        ON CONFLICT (message_id, label_id) DO NOTHING
        "#,
        message_ids,
        link_id,
        provider_label_id
    )
    .execute(pool)
    .await?;

    Ok(())
}

#[tracing::instrument(skip(pool), err)]
pub(crate) async fn delete_message_labels_batch(
    pool: &PgPool,
    message_ids: &[Uuid],
    provider_label_id: &str,
    link_id: Uuid,
) -> Result<(), sqlx::Error> {
    if message_ids.is_empty() {
        return Ok(());
    }

    sqlx::query!(
        r#"
        DELETE FROM email_message_labels
        WHERE
            message_id = ANY($1)
            AND label_id = (
                SELECT id FROM email_labels
                WHERE link_id = $2 AND provider_label_id = $3
            )
        "#,
        message_ids,
        link_id,
        provider_label_id
    )
    .execute(pool)
    .await?;

    Ok(())
}

#[tracing::instrument(skip(pool), err)]
pub(crate) async fn update_message_read_status_batch(
    pool: &PgPool,
    message_ids: &[Uuid],
    link_id: Uuid,
    is_read: bool,
) -> Result<(), sqlx::Error> {
    if message_ids.is_empty() {
        return Ok(());
    }

    sqlx::query!(
        r#"
        UPDATE email_messages m
        SET
            is_read = $1,
            updated_at = NOW()
        WHERE
            m.id = ANY($2)
            AND m.link_id = $3
        "#,
        is_read,
        message_ids,
        link_id
    )
    .execute(pool)
    .await?;

    Ok(())
}

#[tracing::instrument(skip(pool), err)]
pub(crate) async fn update_message_starred_status_batch(
    pool: &PgPool,
    message_ids: &[Uuid],
    link_id: Uuid,
    is_starred: bool,
) -> Result<(), sqlx::Error> {
    if message_ids.is_empty() {
        return Ok(());
    }

    sqlx::query!(
        r#"
        UPDATE email_messages m
        SET
            is_starred = $1,
            updated_at = NOW()
        WHERE
            m.id = ANY($2)
            AND m.link_id = $3
        "#,
        is_starred,
        message_ids,
        link_id
    )
    .execute(pool)
    .await?;

    Ok(())
}
