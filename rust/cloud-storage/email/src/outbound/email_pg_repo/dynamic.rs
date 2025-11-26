//! This module exposes a dynamic query builder for email threads which can build specific
//! email queries that filter content based on input AST (EmailLiteral).

use super::db_types::*;
use crate::domain::models::PreviewCursorQuery;
use filter_ast::Expr;
use item_filters::ast::email::{Email, EmailLiteral};
use macro_user_id::user_id::MacroUserIdStr;
use recursion::CollapsibleExt;
use sqlx::{PgPool, Postgres, QueryBuilder, Row};

/// Builds SQL WHERE conditions for email filters based on the AST.
/// Returns a string to be appended to the WHERE clause.
fn build_email_filter(ast: Option<&Expr<EmailLiteral>>) -> String {
    let Some(expr) = ast else {
        return String::new();
    };

    let formatting = expr.collapse_frames(|frame| match frame {
        filter_ast::ExprFrame::And(a, b) => format!("({a} AND {b})"),
        filter_ast::ExprFrame::Or(a, b) => format!("({a} OR {b})"),
        filter_ast::ExprFrame::Not(a) => format!("(NOT {a})"),

        filter_ast::ExprFrame::Literal(EmailLiteral::Sender(email)) => match email {
            Email::Complete(e) => format!(
                r#"EXISTS (
                    SELECT 1 FROM email_contacts c
                    WHERE c.id = m.from_contact_id
                    AND LOWER(c.email_address) = LOWER('{}')
                )"#,
                e.0.as_ref()
            ),
            Email::Partial(s) => format!(
                r#"EXISTS (
                    SELECT 1 FROM email_contacts c
                    WHERE c.id = m.from_contact_id
                    AND c.email_address ILIKE '%{}%'
                )"#,
                escape_like_pattern(&s)
            ),
        },

        filter_ast::ExprFrame::Literal(EmailLiteral::Recipient(email)) => match email {
            Email::Complete(e) => format!(
                r#"EXISTS (
                    SELECT 1 FROM email_message_recipients mr
                    JOIN email_contacts c ON mr.contact_id = c.id
                    WHERE mr.message_id = m.id
                    AND mr.recipient_type = 'TO'
                    AND LOWER(c.email_address) = LOWER('{}')
                )"#,
                e.0.as_ref()
            ),
            Email::Partial(s) => format!(
                r#"EXISTS (
                    SELECT 1 FROM email_message_recipients mr
                    JOIN email_contacts c ON mr.contact_id = c.id
                    WHERE mr.message_id = m.id
                    AND mr.recipient_type = 'TO'
                    AND c.email_address ILIKE '%{}%'
                )"#,
                escape_like_pattern(&s)
            ),
        },

        filter_ast::ExprFrame::Literal(EmailLiteral::Cc(email)) => match email {
            Email::Complete(e) => format!(
                r#"EXISTS (
                    SELECT 1 FROM email_message_recipients mr
                    JOIN email_contacts c ON mr.contact_id = c.id
                    WHERE mr.message_id = m.id
                    AND mr.recipient_type = 'CC'
                    AND LOWER(c.email_address) = LOWER('{}')
                )"#,
                e.0.as_ref()
            ),
            Email::Partial(s) => format!(
                r#"EXISTS (
                    SELECT 1 FROM email_message_recipients mr
                    JOIN email_contacts c ON mr.contact_id = c.id
                    WHERE mr.message_id = m.id
                    AND mr.recipient_type = 'CC'
                    AND c.email_address ILIKE '%{}%'
                )"#,
                escape_like_pattern(&s)
            ),
        },

        filter_ast::ExprFrame::Literal(EmailLiteral::Bcc(email)) => match email {
            Email::Complete(e) => format!(
                r#"EXISTS (
                    SELECT 1 FROM email_message_recipients mr
                    JOIN email_contacts c ON mr.contact_id = c.id
                    WHERE mr.message_id = m.id
                    AND mr.recipient_type = 'BCC'
                    AND LOWER(c.email_address) = LOWER('{}')
                )"#,
                e.0.as_ref()
            ),
            Email::Partial(s) => format!(
                r#"EXISTS (
                    SELECT 1 FROM email_message_recipients mr
                    JOIN email_contacts c ON mr.contact_id = c.id
                    WHERE mr.message_id = m.id
                    AND mr.recipient_type = 'BCC'
                    AND c.email_address ILIKE '%{}%'
                )"#,
                escape_like_pattern(&s)
            ),
        },
    });

    if formatting.is_empty() {
        String::new()
    } else {
        format!(" AND {}", formatting)
    }
}

/// Escapes special characters in LIKE patterns to prevent SQL injection
fn escape_like_pattern(s: &str) -> String {
    s.replace('\\', r"\\")
        .replace('%', r"\%")
        .replace('_', r"\_")
}

/// Builds a dynamic email thread query with filters applied
fn build_query(email_filter: Option<&Expr<EmailLiteral>>) -> QueryBuilder<'_, Postgres> {
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
            lmp.subject AS name,
            lmp.snippet,
            lmp.is_draft,
            (
                SELECT EXISTS (
                    SELECT 1
                    FROM email_messages m_imp
                    JOIN email_message_labels ml ON m_imp.id = ml.message_id
                    JOIN email_labels l ON ml.label_id = l.id
                    WHERE m_imp.thread_id = t.id
                      AND l.name = 'IMPORTANT'
                      AND l.link_id = t.link_id
                )
            ) AS is_important,
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
                t.latest_non_spam_message_ts AS created_at,
                t.latest_non_spam_message_ts AS updated_at,
                uh.updated_at AS viewed_at,
                CASE $2 -- sort_method_str
                    WHEN 'viewed_at' THEN COALESCE(uh."updated_at", '1970-01-01 00:00:00+00')
                    WHEN 'viewed_updated' THEN COALESCE(uh.updated_at, t.latest_non_spam_message_ts)
                    ELSE t.latest_non_spam_message_ts
                END AS effective_ts
            FROM email_threads t
            LEFT JOIN email_user_history uh ON uh.thread_id = t.id AND uh.link_id = t.link_id
            WHERE
                t.link_id = $1
              AND t.latest_non_spam_message_ts IS NOT NULL

              -- Cursor logic
              AND (($4::timestamptz IS NULL) OR (
                  CASE $2 -- sort_method_str
                      WHEN 'viewed_at' THEN COALESCE(uh."updated_at", '1970-01-01 00:00:00+00')
                      WHEN 'viewed_updated' THEN COALESCE(uh.updated_at, t.latest_non_spam_message_ts)
                      ELSE t.latest_non_spam_message_ts
                  END, t.id
              ) < ($4::timestamptz, $5::uuid))
            ORDER BY effective_ts DESC, t.updated_at DESC
            LIMIT $3
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

    // Add dynamic email filters
    let filter_sql = build_email_filter(email_filter);
    if !filter_sql.is_empty() {
        builder.push(filter_sql);
    }

    builder.push(
        r#"
            ORDER BY m.internal_date_ts DESC
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
/// This function provides a flexible alternative to the hardcoded view-specific queries.
///
/// # Arguments
/// * `pool` - Database connection pool
/// * `query` - Preview cursor query containing link_id, limit, cursor, and filter AST
/// * `user_id` - The user making the request
///
/// # Returns
/// A vector of ThreadPreviewCursorDbRow matching the filter criteria
#[tracing::instrument(skip(pool), err)]
pub(crate) async fn dynamic_email_thread_cursor(
    pool: &PgPool,
    query: &PreviewCursorQuery,
    _user_id: MacroUserIdStr<'_>,
) -> Result<Vec<ThreadPreviewCursorDbRow>, sqlx::Error> {
    let query_limit = query.limit as i64;
    let sort_method_str = query.query.sort_method().to_string();
    let (cursor_id, cursor_timestamp) = query.query.vals();
    let cursor_id_str = cursor_id.as_ref().map(|u| u.to_string());

    // Extract email filter from query if present
    let email_filter = query.query.filter();

    build_query(email_filter.as_ref())
        .build()
        .bind(query.link_id) // $1
        .bind(sort_method_str) // $2
        .bind(query_limit) // $3
        .bind(cursor_timestamp) // $4
        .bind(cursor_id_str) // $5
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
            })
        })
        .fetch_all(pool)
        .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use item_filters::ast::email::{Email, EmailLiteral};
    use macro_user_id::cowlike::CowLike;
    use macro_user_id::email::EmailStr;

    #[test]
    fn test_build_email_filter_sender_complete() {
        let email = Email::Complete(EmailStr::parse_from_str("test@example.com").unwrap().into_owned());
        let expr = Expr::Literal(EmailLiteral::Sender(email));
        let result = build_email_filter(Some(&expr));

        assert!(result.contains("m.from_contact_id"));
        assert!(result.contains("LOWER(c.email_address) = LOWER('test@example.com')"));
    }

    #[test]
    fn test_build_email_filter_sender_partial() {
        let email = Email::Partial("example".to_string());
        let expr = Expr::Literal(EmailLiteral::Sender(email));
        let result = build_email_filter(Some(&expr));

        assert!(result.contains("m.from_contact_id"));
        assert!(result.contains("c.email_address ILIKE '%example%'"));
    }

    #[test]
    fn test_build_email_filter_recipient() {
        let email = Email::Complete(EmailStr::parse_from_str("recipient@example.com").unwrap().into_owned());
        let expr = Expr::Literal(EmailLiteral::Recipient(email));
        let result = build_email_filter(Some(&expr));

        assert!(result.contains("email_message_recipients"));
        assert!(result.contains("recipient_type = 'TO'"));
        assert!(result.contains("LOWER(c.email_address) = LOWER('recipient@example.com')"));
    }

    #[test]
    fn test_build_email_filter_cc() {
        let email = Email::Complete(EmailStr::parse_from_str("cc@example.com").unwrap().into_owned());
        let expr = Expr::Literal(EmailLiteral::Cc(email));
        let result = build_email_filter(Some(&expr));

        assert!(result.contains("recipient_type = 'CC'"));
    }

    #[test]
    fn test_build_email_filter_bcc() {
        let email = Email::Complete(EmailStr::parse_from_str("bcc@example.com").unwrap().into_owned());
        let expr = Expr::Literal(EmailLiteral::Bcc(email));
        let result = build_email_filter(Some(&expr));

        assert!(result.contains("recipient_type = 'BCC'"));
    }

    #[test]
    fn test_build_email_filter_and() {
        let email1 = Email::Complete(EmailStr::parse_from_str("sender@example.com").unwrap().into_owned());
        let email2 = Email::Complete(EmailStr::parse_from_str("recipient@example.com").unwrap().into_owned());
        let expr = Expr::and(
            Expr::Literal(EmailLiteral::Sender(email1)),
            Expr::Literal(EmailLiteral::Recipient(email2)),
        );
        let result = build_email_filter(Some(&expr));

        assert!(result.contains("AND"));
        assert!(result.contains("sender@example.com"));
        assert!(result.contains("recipient@example.com"));
    }

    #[test]
    fn test_build_email_filter_or() {
        let email1 = Email::Complete(EmailStr::parse_from_str("sender1@example.com").unwrap().into_owned());
        let email2 = Email::Complete(EmailStr::parse_from_str("sender2@example.com").unwrap().into_owned());
        let expr = Expr::or(
            Expr::Literal(EmailLiteral::Sender(email1)),
            Expr::Literal(EmailLiteral::Sender(email2)),
        );
        let result = build_email_filter(Some(&expr));

        assert!(result.contains("OR"));
        assert!(result.contains("sender1@example.com"));
        assert!(result.contains("sender2@example.com"));
    }

    #[test]
    fn test_build_email_filter_not() {
        let email = Email::Complete(EmailStr::parse_from_str("blocked@example.com").unwrap().into_owned());
        let expr = Expr::is_not(Expr::Literal(EmailLiteral::Sender(email)));
        let result = build_email_filter(Some(&expr));

        assert!(result.contains("NOT"));
        assert!(result.contains("blocked@example.com"));
    }

    #[test]
    fn test_escape_like_pattern() {
        assert_eq!(escape_like_pattern("test"), "test");
        assert_eq!(escape_like_pattern("test%"), r"test\%");
        assert_eq!(escape_like_pattern("test_"), r"test\_");
        assert_eq!(escape_like_pattern(r"test\"), r"test\\");
        assert_eq!(escape_like_pattern(r"test\%_"), r"test\\\%\_");
    }

    #[test]
    fn test_build_email_filter_none() {
        let result = build_email_filter(None);
        assert_eq!(result, "");
    }
}
