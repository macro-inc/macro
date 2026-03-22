use super::filters::*;
use crate::domain::models::{PreviewView, PreviewViewStandardLabel};
use crate::outbound::email_pg_repo::db_types::*;
use chrono::{DateTime, Utc};
use filter_ast::Expr;
use item_filters::ast::email::EmailLiteral;
use models_pagination::{Query, SimpleSortMethod};
use sqlx::{PgPool, Postgres, QueryBuilder, Row};
use std::sync::Arc;
use uuid::Uuid;

struct QueryParams {
    link_id: Uuid,
    sort_method_str: String,
    query_limit: i64,
    cursor_timestamp: Option<DateTime<Utc>>,
    cursor_id_str: Option<String>,
    is_important: bool,
}

/// Builds a dynamic email thread query with filters applied.
/// All user-controlled values are parameterized via `push_bind`.
fn build_query(
    view: &PreviewView,
    email_filter: &Expr<EmailLiteral>,
    params: QueryParams,
) -> QueryBuilder<'static, Postgres> {
    let sort_ts_field = get_sort_timestamp_field(view);
    let view_thread_filter = build_view_thread_filter(view);
    let view_message_filter = build_view_message_filter(view);

    let mut builder = sqlx::QueryBuilder::new(
        r#"
        SELECT
            t.id,
            t.provider_id,
            t.inbox_visible,
            t.is_read,
            t.effective_ts AS sort_ts,
            t.created_at,
            t.updated_at,
            t.viewed_at,
            t.project_id,
            lmp.subject AS name,
            lmp.snippet,
            lmp.is_draft,
            CASE
                WHEN "#,
    );

    builder.push_bind(params.is_important);

    builder.push(
        r#" THEN TRUE
                ELSE (
                    SELECT EXISTS (
                        SELECT 1
                        FROM email_messages m_imp
                        JOIN email_message_labels ml ON m_imp.id = ml.message_id
                        JOIN email_labels l ON ml.label_id = l.id
                        WHERE m_imp.thread_id = t.id
                          AND l.name = 'IMPORTANT'
                          AND l.link_id = t.link_id
                    )
                )
            END AS is_important,
            c.email_address AS sender_email,
            c.name AS sender_name,
            c.sfs_photo_url as sender_photo_url
        FROM (
            -- Step 1: Efficiently find and sort candidate threads
            SELECT
                t.id,
                t.provider_id,
                t.link_id,
                t.inbox_visible,
                t.is_read,
                t.project_id,
        "#,
    );

    // Add the appropriate timestamp fields based on view
    builder.push(format!(
        r#"
                {} AS created_at,
                {} AS updated_at,
                uh.updated_at AS viewed_at,
                CASE "#,
        sort_ts_field, sort_ts_field
    ));

    builder.push_bind(params.sort_method_str.clone());

    builder.push(format!(
        r#"
                    WHEN 'viewed_at' THEN COALESCE(uh."updated_at", '1970-01-01 00:00:00+00')
                    WHEN 'viewed_updated' THEN COALESCE(uh.updated_at, {})
                    ELSE {}
                END AS effective_ts
            FROM email_threads t
            LEFT JOIN email_user_history uh ON uh.thread_id = t.id AND uh.link_id = t.link_id
            WHERE
                t.link_id = "#,
        sort_ts_field, sort_ts_field
    ));

    builder.push_bind(params.link_id);

    // Add view-specific thread filters
    if !view_thread_filter.is_empty() {
        view_thread_filter.push_into(&mut builder);
    }

    if has_thread_literals(email_filter) {
        build_thread_email_filter(email_filter).push_into(&mut builder);
    }

    builder.push(
        r#"
              -- Cursor logic
              AND (("#,
    );

    builder.push_bind(params.cursor_timestamp);

    builder.push(
        r#"::timestamptz IS NULL) OR (
                  CASE "#,
    );

    builder.push_bind(params.sort_method_str);

    builder.push(format!(
        r#"
                      WHEN 'viewed_at' THEN COALESCE(uh."updated_at", '1970-01-01 00:00:00+00')
                      WHEN 'viewed_updated' THEN COALESCE(uh.updated_at, {})
                      ELSE {}
                  END, t.id
              ) < ("#,
        sort_ts_field, sort_ts_field
    ));

    builder.push_bind(params.cursor_timestamp);

    builder.push("::timestamptz, ");

    builder.push_bind(params.cursor_id_str);

    builder.push(
        "::uuid))\n            ORDER BY effective_ts DESC, t.updated_at DESC\n            LIMIT ",
    );

    builder.push_bind(params.query_limit);

    builder.push(
        r#"
        ) AS t
        -- Step 2: For each thread, find its latest message matching the filter
        CROSS JOIN LATERAL (
            SELECT
                   m.subject,
                   m.snippet,
                   m.from_contact_id,
                   m.is_draft
            FROM email_messages m
            WHERE m.thread_id = t.id
              AND NOT EXISTS (
                SELECT 1 FROM email_message_labels ml JOIN email_labels l ON ml.label_id = l.id
                WHERE ml.message_id = m.id AND l.name = 'TRASH' AND l.link_id = t.link_id
              )
        "#,
    );

    // Add view-specific message filters
    if !view_message_filter.is_empty() {
        view_message_filter.push_into(&mut builder);
    }

    if has_message_literals(email_filter) {
        build_message_email_filter(email_filter).push_into(&mut builder);
    }

    builder.push(
        r#"
            ORDER BY COALESCE(m.internal_date_ts, m.created_at) DESC
            LIMIT 1
        ) AS lmp
        -- Step 3: Join to get the sender's details
        LEFT JOIN email_contacts c ON lmp.from_contact_id = c.id
        ORDER BY t.effective_ts DESC, t.updated_at DESC
        "#,
    );

    builder
}

/// Fetches a paginated list of thread previews with dynamic filtering based on EmailLiteral AST.
/// This function provides a flexible alternative to the hardcoded view-specific queries,
/// combining view-specific filters (Inbox, Sent, Drafts, etc.) with custom email filters
/// (sender, recipient, cc, bcc).
///
/// # Arguments
/// * `pool` - Database connection pool
/// * `query` - Preview cursor query containing view, link_id, limit, cursor, and filter AST
///
/// # Returns
/// A vector of ThreadPreviewCursorDbRow matching the view and filter criteria
///
/// # Example
/// ```ignore
/// // Get drafts from a specific sender
/// let query = PreviewCursorQuery {
///     view: PreviewView::StandardLabel(PreviewViewStandardLabel::Drafts),
///     link_id,
///     limit: 50,
///     query: Query::new(Expr::Literal(EmailLiteral::Sender(
///         Email::Complete(EmailStr::parse_from_str("john@example.com").unwrap().into_owned())
///     ))),
/// };
/// let results = dynamic_email_thread_cursor(&pool, &query).await?;
/// ```
#[tracing::instrument(skip(pool), err)]
pub(crate) async fn dynamic_email_thread_cursor(
    pool: &PgPool,
    link_id: &Uuid,
    limit: u32,
    view: &PreviewView,
    query: Query<Uuid, SimpleSortMethod, Arc<Expr<EmailLiteral>>>,
) -> Result<Vec<ThreadPreviewCursorDbRow>, sqlx::Error> {
    let query_limit = limit as i64;
    let sort_method_str = query.sort_method().to_string();
    let (cursor_id, cursor_timestamp) = query.vals();
    let cursor_id_str = cursor_id.as_ref().map(|u| u.to_string());

    // Extract email filter from query
    let email_filter = query.filter();

    let is_important = matches!(
        view,
        PreviewView::StandardLabel(PreviewViewStandardLabel::Important)
    );

    build_query(
        view,
        email_filter,
        QueryParams {
            link_id: *link_id,
            sort_method_str,
            query_limit,
            cursor_timestamp: cursor_timestamp.copied(),
            cursor_id_str,
            is_important,
        },
    )
    .build()
    .try_map(|row| {
        Ok(ThreadPreviewCursorDbRow {
            id: row.try_get("id")?,
            provider_id: row.try_get("provider_id")?,
            inbox_visible: row.try_get("inbox_visible")?,
            is_read: row.try_get("is_read")?,
            is_draft: row.try_get("is_draft")?,
            is_important: row.try_get("is_important")?,
            sort_ts: row.try_get("sort_ts")?,
            name: row.try_get("name")?,
            snippet: row.try_get("snippet")?,
            sender_email: row.try_get("sender_email")?,
            sender_name: row.try_get("sender_name")?,
            sender_photo_url: row.try_get("sender_photo_url")?,
            viewed_at: row.try_get("viewed_at")?,
            created_at: row.try_get("created_at")?,
            updated_at: row.try_get("updated_at")?,
            project_id: row.try_get("project_id")?,
        })
    })
    .fetch_all(pool)
    .await
}
