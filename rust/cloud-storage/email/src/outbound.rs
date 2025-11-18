use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use sqlx::{
    PgPool,
    types::chrono::{DateTime, Utc},
};
use uuid::Uuid;

use crate::domain::{
    models::{
        Attachment, AttachmentMacro, Contact, PreviewCursorQuery, PreviewView,
        PreviewViewStandardLabel, ThreadPreviewCursor,
    },
    ports::EmailRepo,
};

#[derive(Clone)]
pub struct EmailPgRepo {
    pool: PgPool,
}

impl EmailPgRepo {
    pub fn new(pool: PgPool) -> Self {
        EmailPgRepo { pool }
    }
}

impl EmailRepo for EmailPgRepo {
    type Err = sqlx::Error;

    async fn previews_for_view_cursor(
        &self,
        query: PreviewCursorQuery,
        user_id: MacroUserIdStr<'static>,
    ) -> Result<Vec<ThreadPreviewCursor>, Self::Err> {
        Ok(match query.view {
            PreviewView::StandardLabel(ref label) => match label {
                PreviewViewStandardLabel::Inbox => {
                    self.new_inbox_preview_cursor(&query, user_id.copied())
                        .await?
                }
                PreviewViewStandardLabel::Sent => {
                    self.sent_preview_cursor(&query, user_id.copied()).await?
                }
                PreviewViewStandardLabel::Drafts => {
                    self.drafts_preview_cursor(&query, user_id.copied()).await?
                }
                PreviewViewStandardLabel::Starred => {
                    self.starred_preview_cursor(&query, user_id.copied())
                        .await?
                }
                PreviewViewStandardLabel::All => {
                    self.all_mail_preview_cursor(&query, user_id.copied())
                        .await?
                }
                PreviewViewStandardLabel::Important => {
                    self.important_preview_cursor(&query, user_id.copied())
                        .await?
                }
                PreviewViewStandardLabel::Other => {
                    self.other_inbox_preview_cursor(&query, user_id.copied())
                        .await?
                }
            },
            PreviewView::UserLabel(ref label_name) => {
                self.user_label_preview_cursor(&query, label_name, user_id.copied())
                    .await?
            }
        }
        .into_iter()
        .map(|row| row.with_user_id(user_id.clone()))
        .collect())
    }

    async fn attachments_by_thread_ids(
        &self,
        thread_ids: &[Uuid],
    ) -> Result<Vec<Attachment>, Self::Err> {
        // Query all attachments for messages in the provided threads
        // Include thread_id in the result set
        Ok(sqlx::query_as!(
            AttachmentDbRow,
            r#"
            SELECT 
                a.id,
                a.message_id,
                a.provider_attachment_id,
                a.filename,
                a.mime_type,
                a.size_bytes,
                a.content_id,
                a.created_at,
                m.thread_id
            FROM 
                email_attachments a
            JOIN
                email_messages m ON a.message_id = m.id
            WHERE 
                m.thread_id = ANY($1)
            ORDER BY 
                a.created_at ASC
            "#,
            thread_ids
        )
        .fetch_all(&self.pool)
        .await?
        .into_iter()
        .map(AttachmentDbRow::into_model)
        .collect())
    }

    async fn macro_attachments_by_thread_ids(
        &self,
        thread_ids: &[Uuid],
    ) -> Result<Vec<AttachmentMacro>, Self::Err> {
        // Query all attachments for email_messages in the provided threads
        // Include thread_id in the result set
        Ok(sqlx::query_as!(
            AttachmentMacroDbRow,
            r#"
        SELECT
            a.id,
            a.message_id,
            a.item_id as "item_id!",
            a.item_type as "item_type!",
            a.created_at,
            m.thread_id
        FROM
            email_attachments_macro a
        JOIN
            email_messages m ON a.message_id = m.id
        WHERE
            m.thread_id = ANY($1)
        ORDER BY
            a.created_at ASC
        "#,
            thread_ids
        )
        .fetch_all(&self.pool)
        .await?
        .into_iter()
        .map(AttachmentMacroDbRow::into_model)
        .collect())
    }

    async fn contacts_by_thread_ids(&self, thread_ids: &[Uuid]) -> Result<Vec<Contact>, Self::Err> {
        // Define a struct to hold the joined results
        #[derive(Debug)]
        struct ThreadContactResult {
            thread_id: Uuid,
            id: Uuid,
            link_id: Uuid,
            email_address: Option<String>,
            name: Option<String>,
            sfs_photo_url: Option<String>,
        }

        impl ThreadContactResult {
            fn into_model(self) -> Contact {
                let ThreadContactResult {
                    thread_id,
                    id,
                    link_id,
                    email_address,
                    name,
                    sfs_photo_url,
                } = self;
                Contact {
                    id,
                    link_id,
                    thread_id,
                    name,
                    email_address,
                    sfs_photo_url,
                }
            }
        }

        Ok(sqlx::query_as!(
            ThreadContactResult,
            r#"
            SELECT
                m.thread_id,
                c.id, c.link_id, c.email_address, c.name, c.sfs_photo_url
            FROM email_messages m
            JOIN email_contacts c ON m.from_contact_id = c.id
            WHERE m.thread_id = ANY($1) AND m.from_contact_id IS NOT NULL
            ORDER BY m.created_at ASC
            "#,
            thread_ids
        )
        .fetch_all(&self.pool)
        .await?
        .into_iter()
        .map(ThreadContactResult::into_model)
        .collect())
    }
}

struct AttachmentMacroDbRow {
    id: Uuid,
    message_id: Uuid,
    item_id: Uuid,
    item_type: String,
    #[expect(
        dead_code,
        reason = "We need this field to use query_as with the current query, but we never read it"
    )]
    created_at: DateTime<Utc>,
    thread_id: Uuid,
}

impl AttachmentMacroDbRow {
    fn into_model(self) -> AttachmentMacro {
        let AttachmentMacroDbRow {
            id,
            message_id,
            item_id,
            item_type,
            created_at: _,
            thread_id,
        } = self;
        AttachmentMacro {
            thread_id,
            db_id: id,
            message_id,
            item_id,
            item_type,
        }
    }
}

struct AttachmentDbRow {
    id: Uuid,
    message_id: Uuid,
    // a different value is returned by the gmail API for this each time you fetch a message -
    // don't make the mistake of using it to uniquely identify an attachment
    provider_attachment_id: Option<String>,
    filename: Option<String>,
    mime_type: Option<String>,
    size_bytes: Option<i64>,
    content_id: Option<String>,
    created_at: DateTime<Utc>,
    thread_id: Uuid,
}

impl AttachmentDbRow {
    fn into_model(self) -> Attachment {
        let AttachmentDbRow {
            id,
            message_id,
            provider_attachment_id,
            filename,
            mime_type,
            size_bytes,
            content_id,
            created_at,
            thread_id,
        } = self;

        Attachment {
            id,
            thread_id,
            message_id,
            provider_attachment_id,
            filename,
            mime_type,
            size_bytes,
            content_id,
            created_at,
        }
    }
}

/// thread summary returned in preview cursor endpoint
#[derive(Debug, Clone)]
struct ThreadPreviewCursorDbRow {
    id: Uuid,
    provider_id: Option<String>,
    inbox_visible: bool,
    is_read: bool,
    is_draft: bool,
    is_important: bool,
    sort_ts: DateTime<Utc>,
    name: Option<String>,
    snippet: Option<String>,
    sender_email: Option<String>,
    sender_name: Option<String>,
    sender_photo_url: Option<String>,
    viewed_at: Option<DateTime<Utc>>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

impl ThreadPreviewCursorDbRow {
    fn with_user_id(self, owner_id: MacroUserIdStr<'_>) -> ThreadPreviewCursor {
        let ThreadPreviewCursorDbRow {
            id,
            provider_id,
            inbox_visible,
            is_read,
            is_draft,
            is_important,
            sort_ts,
            name,
            snippet,
            sender_email,
            sender_name,
            sender_photo_url,
            viewed_at,
            created_at,
            updated_at,
        } = self;

        ThreadPreviewCursor {
            id,
            provider_id,
            owner_id: owner_id.into_owned(),
            inbox_visible,
            is_read,
            is_draft,
            is_important,
            name,
            snippet,
            sender_email,
            sender_name,
            sender_photo_url,
            sort_ts,
            created_at,
            updated_at,
            viewed_at,
        }
    }
}

impl EmailPgRepo {
    /// Fetches a paginated list of thread previews for a given link_id.
    /// Each thread preview includes details from the latest message (inbound or outbound)
    /// that is NOT in the 'TRASH' label.
    /// The sorting and filtering behavior is determined by the `sort_method` parameter.
    #[tracing::instrument(skip(self), level = "info", err)]
    async fn new_inbox_preview_cursor(
        &self,
        query: &PreviewCursorQuery,
        user_id: MacroUserIdStr<'_>,
    ) -> Result<Vec<ThreadPreviewCursorDbRow>, sqlx::Error> {
        let query_limit = query.limit as i64;
        let sort_method_str = query.query.sort_method().to_string();
        let (cursor_id, cursor_timestamp) = query.query.vals();

        sqlx::query_as!(
        ThreadPreviewCursorDbRow,
        r#"
        SELECT
            t.id,
            t.provider_id,
            TRUE AS "inbox_visible!",
            t.is_read,
            t.effective_ts AS "sort_ts!",
            t.created_at AS "created_at!",
            t.updated_at AS "updated_at!",
            t.viewed_at AS "viewed_at?",
            lmp.subject AS "name?",
            lmp.snippet AS "snippet?",
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
            ) AS "is_important!",
            c.email_address AS "sender_email?",
            c.name AS "sender_name?",
            c.sfs_photo_url as "sender_photo_url?"
        FROM (
            -- Step 1: Efficiently find and sort ONLY the top N+1 candidate threads.
            -- This subquery is fast as it only touches `threads` and `user_history`.
            SELECT
                t.id,
                t.provider_id,
                t.link_id,
                t.is_read,
                t.latest_inbound_message_ts AS created_at,
                t.latest_inbound_message_ts AS updated_at,
                uh.updated_at AS viewed_at,
                CASE $5 -- sort_method_str
                    WHEN 'viewed_at' THEN COALESCE(uh."updated_at", '1970-01-01 00:00:00+00')
                    WHEN 'viewed_updated' THEN COALESCE(uh.updated_at, t.latest_inbound_message_ts)
                    ELSE t.latest_inbound_message_ts
                END AS effective_ts
            FROM email_threads t
            LEFT JOIN email_user_history uh ON uh.thread_id = t.id AND uh.link_id = t.link_id
            WHERE
                t.link_id = $1
              AND t.inbox_visible = TRUE
              AND t.latest_inbound_message_ts IS NOT NULL
              
              -- The cursor logic is moved inside this subquery for maximum efficiency.
              AND (($3::timestamptz IS NULL) OR (
                  -- This CASE must exactly match the one that defines `effective_ts`
                  CASE $5 -- sort_method_str
                      WHEN 'viewed_at' THEN COALESCE(uh."updated_at", '1970-01-01 00:00:00+00')
                      WHEN 'viewed_updated' THEN COALESCE(uh.updated_at, t.latest_inbound_message_ts)
                      ELSE t.latest_inbound_message_ts
                  END, t.id
              ) < ($3::timestamptz, $4::uuid))
            ORDER BY effective_ts DESC, t.updated_at DESC -- fall back to updated_at if effective_ts is the same
            LIMIT $2
        ) AS t
        -- Step 2: For EACH of the limited threads from above, find its latest non-trashed message.
        CROSS JOIN LATERAL (
            SELECT
                   m.subject,
                   m.snippet,
                   m.from_contact_id,
                   m.is_draft
            FROM email_messages m
            WHERE m.thread_id = t.id
              AND m.is_draft = FALSE
              AND NOT EXISTS (
                SELECT 1 FROM email_message_labels ml JOIN email_labels l ON ml.label_id = l.id
                WHERE ml.message_id = m.id AND l.name = 'TRASH' AND l.link_id = t.link_id
            )
            ORDER BY m.internal_date_ts DESC
            LIMIT 1
        ) AS lmp
        -- Step 3: Join to get the sender's details for the final result set.
        LEFT JOIN email_contacts c ON lmp.from_contact_id = c.id
        -- Final ordering is preserved because the input `t` is already sorted.
        ORDER BY t.effective_ts DESC, t.updated_at DESC -- fall back to updated_at if effective_ts is the same
        "#,
        query.link_id,            // $1
        query_limit,              // $2
        cursor_timestamp,   // $3
        cursor_id,          // $4
        sort_method_str,          // $5
    ).fetch_all(&self.pool).await
    }

    /// Fetches a paginated list of thread previews for the "Sent" view.
    /// This view includes all threads (archived or not) sorted by the timestamp
    /// of the latest sent message. The preview details (subject, snippet) are
    /// taken from the most recent sent message in the thread that is not in the trash.
    #[tracing::instrument(skip(self), level = "info")]
    async fn sent_preview_cursor(
        &self,
        query: &PreviewCursorQuery,
        user_id: MacroUserIdStr<'_>,
    ) -> Result<Vec<ThreadPreviewCursorDbRow>, sqlx::Error> {
        let query_limit = query.limit as i64;
        let sort_method_str = query.query.sort_method().to_string();
        let (cursor_id, cursor_timestamp) = query.query.vals();

        sqlx::query_as!(
        ThreadPreviewCursorDbRow,
        r#"
        SELECT
            t.id,
            t.provider_id,
            t.inbox_visible,
            t.is_read,
            t.effective_ts AS "sort_ts!",
            t.created_at AS "created_at!",
            t.updated_at AS "updated_at!",
            t.viewed_at AS "viewed_at?",
            lmp.subject AS "name?",
            lmp.snippet AS "snippet?",
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
            ) AS "is_important!",
            c.email_address AS "sender_email?",
            c.name AS "sender_name?",
            c.sfs_photo_url as "sender_photo_url?"
        FROM (
            -- Step 1: Efficiently find and sort ONLY the top N+1 candidate threads.
            -- This subquery only touches `threads` and `user_history`.
            SELECT
                t.id,
                t.provider_id,
                t.link_id,
                t.inbox_visible,
                t.is_read,
                t.latest_outbound_message_ts AS created_at,
                t.latest_outbound_message_ts AS updated_at,
                uh.updated_at AS viewed_at,
                CASE $5 -- sort_method_str
                    WHEN 'viewed_at' THEN COALESCE(uh."updated_at", '1970-01-01 00:00:00+00')
                    WHEN 'viewed_updated' THEN COALESCE(uh.updated_at, t.latest_outbound_message_ts)
                    ELSE t.latest_outbound_message_ts
                END AS effective_ts
            FROM email_threads t
            LEFT JOIN email_user_history uh ON uh.thread_id = t.id AND uh.link_id = t.link_id
            WHERE
                t.link_id = $1
              AND t.latest_outbound_message_ts IS NOT NULL
              
              -- Cursor logic moved inside for maximum efficiency
              AND (($3::timestamptz IS NULL) OR (
                  -- This CASE must exactly match the one that defines `effective_ts`
                  CASE $5 -- sort_method_str
                      WHEN 'viewed_at' THEN COALESCE(uh."updated_at", '1970-01-01 00:00:00+00')
                      WHEN 'viewed_updated' THEN COALESCE(uh.updated_at, t.latest_outbound_message_ts)
                      ELSE t.latest_outbound_message_ts
                  END, t.id
              ) < ($3::timestamptz, $4::uuid))
            ORDER BY effective_ts DESC, t.updated_at DESC
            LIMIT $2
        ) AS t
        -- Step 2: For EACH of the limited threads from above, find its latest SENT, non-trashed message.
        CROSS JOIN LATERAL (
            SELECT
                   m.subject,
                   m.snippet,
                   m.from_contact_id,
                   m.is_draft
            FROM email_messages m
            WHERE m.thread_id = t.id
              AND m.is_sent = TRUE -- This condition is specific to the "Sent" view
              AND NOT EXISTS (
                SELECT 1 FROM email_message_labels ml JOIN email_labels l ON ml.label_id = l.id
                WHERE ml.message_id = m.id AND l.name = 'TRASH' AND l.link_id = t.link_id
            )
            ORDER BY m.internal_date_ts DESC
            LIMIT 1
        ) AS lmp
        -- Step 3: Join to get the sender's details for the final result set.
        LEFT JOIN email_contacts c ON lmp.from_contact_id = c.id
        -- Final ordering is preserved because the input `t` is already sorted.
        ORDER BY t.effective_ts DESC, t.updated_at DESC
        "#,
        query.link_id,            // $1
        query_limit,              // $2
        cursor_timestamp,   // $3
        cursor_id,          // $4
        sort_method_str,          // $5
    )
        .fetch_all(&self.pool)
        .await
    }

    /// Fetches a paginated list of thread previews for the "Drafts" view.
    /// This view includes all threads that contain at least one draft message, sorted by the
    /// timestamp of the most recent draft within each thread.
    #[tracing::instrument(skip(self), level = "info", err)]
    async fn drafts_preview_cursor(
        &self,
        query: &PreviewCursorQuery,
        user_id: MacroUserIdStr<'_>,
    ) -> Result<Vec<ThreadPreviewCursorDbRow>, sqlx::Error> {
        let query_limit = query.limit as i64;
        let sort_method_str = query.query.sort_method().to_string();
        let (cursor_id, cursor_timestamp) = query.query.vals();

        sqlx::query_as!(
        ThreadPreviewCursorDbRow,
        r#"
        SELECT
            t.id,
            t.provider_id,
            t.inbox_visible,
            t.is_read,
            t.effective_ts AS "sort_ts!",
            t.created_at AS "created_at!",
            t.updated_at AS "updated_at!",
            t.viewed_at AS "viewed_at?",
            lmp.subject AS "name?",
            lmp.snippet AS "snippet?",
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
            ) AS "is_important!",
            c.email_address AS "sender_email?",
            c.name AS "sender_name?",
            c.sfs_photo_url as "sender_photo_url?"
        FROM (
            -- Step 1: Find the latest draft timestamp for each thread, calculate the
            -- effective sort key, then sort and limit the results. This is the core optimization.
            SELECT
                t.id,
                t.provider_id,
                t.link_id,
                t.inbox_visible,
                t.is_read,
                ldpt.latest_draft_ts AS created_at,
                ldpt.latest_draft_ts AS updated_at,
                uh.updated_at AS viewed_at,
                CASE $5 -- sort_method_str
                    WHEN 'viewed_at' THEN COALESCE(uh."updated_at", '1970-01-01 00:00:00+00')
                    WHEN 'viewed_updated' THEN COALESCE(uh.updated_at, ldpt.latest_draft_ts)
                    ELSE ldpt.latest_draft_ts
                END AS effective_ts
            FROM (
                -- This sub-subquery efficiently finds the latest draft timestamp for every thread.
                SELECT thread_id, MAX(updated_at) as latest_draft_ts
                FROM email_messages
                -- we only display macro drafts, not drafts created in gmail
                WHERE link_id = $1 AND is_draft = TRUE AND internal_date_ts IS NULL
                GROUP BY thread_id
            ) ldpt
            JOIN email_threads t ON ldpt.thread_id = t.id
            LEFT JOIN email_user_history uh ON uh.thread_id = t.id AND uh.link_id = t.link_id
            WHERE
                (($3::timestamptz IS NULL) OR (
                    CASE $5 -- sort_method_str
                        WHEN 'viewed_at' THEN COALESCE(uh."updated_at", '1970-01-01 00:00:00+00')
                        WHEN 'viewed_updated' THEN COALESCE(uh.updated_at, ldpt.latest_draft_ts)
                        ELSE ldpt.latest_draft_ts
                    END, t.id
                ) < ($3::timestamptz, $4::uuid))
            ORDER BY effective_ts DESC, t.updated_at DESC
            LIMIT $2
        ) AS t
        -- Step 2: For EACH of the limited threads from above, find the full details of its latest draft.
        CROSS JOIN LATERAL (
            SELECT
                   m.subject,
                   m.snippet,
                   m.from_contact_id,
                   m.is_draft
            FROM email_messages m
            WHERE m.thread_id = t.id
              AND m.is_draft = TRUE
              -- we only display macro drafts, not drafts created in gmail
              AND m.internal_date_ts IS NULL
            ORDER BY m.updated_at DESC
            LIMIT 1
        ) AS lmp
        -- Step 3: Join to get the sender's details.
        LEFT JOIN email_contacts c ON lmp.from_contact_id = c.id
        ORDER BY t.effective_ts DESC, t.updated_at DESC
        "#,
        query.link_id,            // $1
        query_limit,              // $2
        cursor_timestamp,   // $3
        cursor_id,          // $4
        sort_method_str,          // $5
    )
        .fetch_all(&self.pool)
        .await
    }

    /// Fetches a paginated list of thread previews for the "Starred" view.
    /// This view includes all threads that contain at least one starred message, sorted by the
    /// timestamp of the most recent starred message within each thread. The preview content is
    /// taken from the most-recent starred message.
    #[tracing::instrument(skip(self), level = "info")]
    async fn starred_preview_cursor(
        &self,
        query: &PreviewCursorQuery,
        user_id: MacroUserIdStr<'_>,
    ) -> Result<Vec<ThreadPreviewCursorDbRow>, sqlx::Error> {
        let query_limit = query.limit as i64;
        let sort_method_str = query.query.sort_method().to_string();
        let (cursor_id, cursor_timestamp) = query.query.vals();

        sqlx::query_as!(
        ThreadPreviewCursorDbRow,
        r#"
        SELECT
            t.id,
            t.provider_id,
            t.inbox_visible,
            t.is_read,
            t.effective_ts AS "sort_ts!",
            t.created_at AS "created_at!",
            t.updated_at AS "updated_at!",
            t.viewed_at AS "viewed_at?",
            lmp.subject AS "name?",
            lmp.snippet AS "snippet?",
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
            ) AS "is_important!",
            c.email_address AS "sender_email?",
            c.name AS "sender_name?",
            c.sfs_photo_url as "sender_photo_url?"
        FROM (
            -- Step 1: Find the latest starred timestamp for each thread, calculate the
            -- effective sort key, then sort and limit the results.
            SELECT
                t.id,
                t.provider_id,
                t.link_id,
                t.inbox_visible,
                t.is_read,
                lspt.latest_starred_ts AS created_at,
                lspt.latest_starred_ts AS updated_at,
                uh.updated_at AS viewed_at,
                CASE $5 -- sort_method_str
                    WHEN 'viewed_at' THEN COALESCE(uh."updated_at", '1970-01-01 00:00:00+00')
                    WHEN 'viewed_updated' THEN COALESCE(uh.updated_at, lspt.latest_starred_ts)
                    ELSE lspt.latest_starred_ts
                END AS effective_ts
            FROM (
                -- This sub-subquery efficiently finds the latest starred timestamp for every thread.
                SELECT thread_id, MAX(internal_date_ts) as latest_starred_ts
                FROM email_messages
                WHERE link_id = $1 AND is_starred = TRUE
                GROUP BY thread_id
            ) lspt
            JOIN email_threads t ON lspt.thread_id = t.id
            LEFT JOIN email_user_history uh ON uh.thread_id = t.id AND uh.link_id = t.link_id
            WHERE
                (($3::timestamptz IS NULL) OR (
                    CASE $5 -- sort_method_str
                        WHEN 'viewed_at' THEN COALESCE(uh."updated_at", '1970-01-01 00:00:00+00')
                        WHEN 'viewed_updated' THEN COALESCE(uh.updated_at, lspt.latest_starred_ts)
                        ELSE lspt.latest_starred_ts
                    END, t.id
                ) < ($3::timestamptz, $4::uuid))
            ORDER BY effective_ts DESC, t.updated_at DESC
            LIMIT $2
        ) AS t
        -- Step 2: For EACH of the limited threads from above, find the full details of its latest starred message.
        CROSS JOIN LATERAL (
            SELECT
                   m.subject,
                   m.snippet,
                   m.from_contact_id,
                   m.is_draft
            FROM email_messages m
            WHERE m.thread_id = t.id
              AND m.is_starred = TRUE
              AND m.is_draft = FALSE
            ORDER BY m.internal_date_ts DESC
            LIMIT 1
        ) AS lmp
        -- Step 3: Join to get the sender's details.
        LEFT JOIN email_contacts c ON lmp.from_contact_id = c.id
        ORDER BY t.effective_ts DESC, t.updated_at DESC
        "#,
        query.link_id,            // $1
        query_limit,              // $2
        cursor_timestamp,   // $3
        cursor_id,          // $4
        sort_method_str,          // $5
    )
        .fetch_all(&self.pool)
        .await
    }

    /// Fetches a paginated list of thread previews for the "All Mail" view using a
    /// denormalized timestamp.
    /// This view includes all threads that have at least one non-spam message, sorted by the
    /// `latest_non_spam_message_ts` column on the `threads` table. The preview shows
    /// details from the latest non-spam message
    #[tracing::instrument(skip(self), level = "info")]
    async fn all_mail_preview_cursor(
        &self,
        query: &PreviewCursorQuery,
        user_id: MacroUserIdStr<'_>,
    ) -> Result<Vec<ThreadPreviewCursorDbRow>, sqlx::Error> {
        let query_limit = query.limit as i64;
        let sort_method_str = query.query.sort_method().to_string();
        let (cursor_id, cursor_timestamp) = query.query.vals();

        sqlx::query_as!(
        ThreadPreviewCursorDbRow,
        r#"
        SELECT
            t.id,
            t.provider_id,
            t.inbox_visible,
            t.is_read,
            t.effective_ts AS "sort_ts!",
            t.created_at AS "created_at!",
            t.updated_at AS "updated_at!",
            t.viewed_at AS "viewed_at?",
            lmp.subject AS "name?",
            lmp.snippet AS "snippet?",
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
            ) AS "is_important!",
            c.email_address AS "sender_email?",
            c.name AS "sender_name?",
            c.sfs_photo_url as "sender_photo_url?"
        FROM (
            -- Step 1: Efficiently find, sort, and limit the top N+1 threads.
            -- This subquery only touches `threads` and `user_history`, making it very fast.
            SELECT
                t.id,
                t.provider_id,
                t.link_id,
                t.inbox_visible,
                t.is_read,
                t.latest_non_spam_message_ts AS created_at,
                t.latest_non_spam_message_ts AS updated_at,
                uh.updated_at AS viewed_at,
                CASE $5 -- sort_method_str
                    WHEN 'viewed_at' THEN COALESCE(uh."updated_at", '1970-01-01 00:00:00+00')
                    WHEN 'viewed_updated' THEN COALESCE(uh.updated_at, t.latest_non_spam_message_ts)
                    ELSE t.latest_non_spam_message_ts
                END AS effective_ts
            FROM email_threads t
            LEFT JOIN email_user_history uh ON uh.thread_id = t.id AND uh.link_id = t.link_id
            WHERE
                t.link_id = $1
              AND t.latest_non_spam_message_ts IS NOT NULL
              
              -- Cursor logic is moved inside for maximum efficiency
              AND (($3::timestamptz IS NULL) OR (
                  -- This CASE must exactly match the one that defines `effective_ts`
                  CASE $5 -- sort_method_str
                      WHEN 'viewed_at' THEN COALESCE(uh."updated_at", '1970-01-01 00:00:00+00')
                      WHEN 'viewed_updated' THEN COALESCE(uh.updated_at, t.latest_non_spam_message_ts)
                      ELSE t.latest_non_spam_message_ts
                  END, t.id
              ) < ($3::timestamptz, $4::uuid))
            ORDER BY effective_ts DESC, t.updated_at DESC
            LIMIT $2
        ) AS t
        -- Step 2: For EACH of the limited threads from above, find its latest non-SPAM/TRASH message.
        CROSS JOIN LATERAL (
            SELECT
                m.subject,
                m.snippet,
                m.is_draft,
                m.from_contact_id
            FROM email_messages m
            WHERE m.thread_id = t.id
              AND m.is_draft = FALSE
            AND NOT EXISTS (
                SELECT 1
                FROM email_message_labels ml
                JOIN email_labels l ON ml.label_id = l.id
                WHERE ml.message_id = m.id
                  AND l.link_id = t.link_id
                  AND l.name IN ('SPAM', 'TRASH')
            )
            ORDER BY m.internal_date_ts DESC
            LIMIT 1
        ) AS lmp
        -- Step 3: Join to get the sender's details for the final result set.
        LEFT JOIN email_contacts c ON lmp.from_contact_id = c.id
        ORDER BY t.effective_ts DESC, t.updated_at DESC
        "#,
        query.link_id,            // $1
        query_limit,              // $2
        cursor_timestamp,   // $3
        cursor_id,          // $4
        sort_method_str,          // $5
    )
        .fetch_all(&self.pool)
        .await
    }

    /// Fetches a paginated list of thread previews for the "Important" view.
    /// Includes threads that:
    /// 1. Have messages with both 'IMPORTANT' and 'INBOX' labels, or
    /// 2. Contain draft messages
    /// The threads are sorted by timestamp, with preview details taken from the latest qualifying message.
    #[tracing::instrument(skip(self), level = "info")]
    async fn important_preview_cursor(
        &self,
        query: &PreviewCursorQuery,
        user_id: MacroUserIdStr<'_>,
    ) -> Result<Vec<ThreadPreviewCursorDbRow>, sqlx::Error> {
        let query_limit = query.limit as i64;
        let sort_method_str = query.query.sort_method().to_string();
        let (cursor_id, cursor_timestamp) = query.query.vals();

        sqlx::query_as!(
        ThreadPreviewCursorDbRow,
        r#"
        WITH ApplicableLabelIDs AS (
            SELECT id
            FROM email_labels
            WHERE link_id = $1
              AND (name = 'INBOX')
        ),
        QualifyingMessages AS (
            SELECT m.thread_id,
                   m.internal_date_ts,
                   m.is_draft,
                   m.subject,
                   m.snippet,
                   m.from_contact_id
            FROM email_messages m
            WHERE m.link_id = $1
              AND EXISTS (
                  SELECT 1
                  FROM email_message_labels ml
                  JOIN email_labels l ON ml.label_id = l.id
                  WHERE ml.message_id = m.id
                    AND l.name = 'IMPORTANT'
              )
              AND EXISTS (
                  SELECT 1
                  FROM email_message_labels ml
                  JOIN ApplicableLabelIDs ali ON ml.label_id = ali.id
                  WHERE ml.message_id = m.id
              )

            UNION ALL

            SELECT m.thread_id,
                   m.internal_date_ts,
                   m.is_draft,
                   m.subject,
                   m.snippet,
                   m.from_contact_id
            FROM email_messages m
            WHERE m.link_id = $1
              AND m.is_draft = TRUE
        ),
        AllImportantThreads AS (
            -- From all qualifying messages, get the single most recent one per thread.
            SELECT DISTINCT ON (thread_id)
                   thread_id,
                   internal_date_ts,
                   is_draft,
                   subject,
                   snippet,
                   from_contact_id
            FROM QualifyingMessages
            ORDER BY thread_id, internal_date_ts DESC
        ),
        ImportantWithSortKey AS (
            -- Join with user_history to calculate the final effective sort key.
            SELECT
                ait.thread_id,
                ait.internal_date_ts,
                ait.is_draft,
                ait.subject,
                ait.snippet,
                ait.from_contact_id,
                ait.internal_date_ts as created_at,
                ait.internal_date_ts as updated_at,
                uh.updated_at as viewed_at,
                -- This CASE statement dynamically selects the correct timestamp for sorting.
                -- For 'updated_at' and 'created_at', we use the important message timestamp
                -- For 'viewed_at', we use the history timestamp.
                -- For 'viewed_updated', we use the history timestamp if it exists, otherwise the important message timestamp.
                CASE $5 -- sort_method_str
                    WHEN 'viewed_at' THEN COALESCE(uh."updated_at", '1970-01-01 00:00:00+00')
                    WHEN 'viewed_updated' THEN COALESCE(uh.updated_at, ait.internal_date_ts)
                    ELSE ait.internal_date_ts
                END AS effective_ts
            FROM AllImportantThreads ait
            -- This has to be a left join to support all sort methods.
            LEFT JOIN email_user_history uh ON uh.thread_id = ait.thread_id AND uh.link_id = $1
            -- user_history updated_at (aka last time opened) has to exist when viewed_at sort method is selected.
            WHERE ait.is_draft = FALSE 
        )
        SELECT
               isk.thread_id as "id!",
               t.provider_id,
               t.inbox_visible,
               t.is_read,
               isk.effective_ts as "sort_ts!",
               isk.created_at as "created_at!",
               isk.updated_at as "updated_at!",
               isk.viewed_at as "viewed_at?",
               isk.is_draft as "is_draft!",
               -- It's the important view - all threads here are important
               true as "is_important!",
               isk.subject as "name?",
               isk.snippet as "snippet?",
               c.email_address AS "sender_email?",
               c.name AS "sender_name?",
               c.sfs_photo_url as "sender_photo_url?"
        FROM ImportantWithSortKey isk
        JOIN email_threads t ON isk.thread_id = t.id
        LEFT JOIN email_contacts c ON isk.from_contact_id = c.id
        WHERE
            ($3::timestamptz IS NULL) OR (isk.effective_ts, isk.thread_id) < ($3::timestamptz, $4::uuid)
        ORDER BY isk.effective_ts DESC, isk.thread_id DESC
        LIMIT $2
        "#,
        query.link_id,            // $1
        query_limit,              // $2
        cursor_timestamp,   // $3
        cursor_id,          // $4
        sort_method_str,          // $5
    )
        .fetch_all(&self.pool)
        .await
    }

    /// Fetches a paginated list of thread previews for the "Other" inbox view.
    /// This view includes threads that have a category label (Promotions, Social, etc.)
    /// and are not explicitly spam, trash, or drafts.
    #[tracing::instrument(skip(self), level = "info")]
    async fn other_inbox_preview_cursor(
        &self,
        query: &PreviewCursorQuery,
        user_id: MacroUserIdStr<'_>,
    ) -> Result<Vec<ThreadPreviewCursorDbRow>, sqlx::Error> {
        let query_limit = query.limit as i64;
        let sort_method_str = query.query.sort_method().to_string();
        let (cursor_id, cursor_timestamp) = query.query.vals();

        sqlx::query_as!(
        ThreadPreviewCursorDbRow,
        r#"
        SELECT
            t.id,
            t.provider_id,
            t.inbox_visible,
            t.is_read,
            t.effective_ts AS "sort_ts!",
            t.created_at AS "created_at!",
            t.updated_at AS "updated_at!",
            t.viewed_at AS "viewed_at?",
            lmp.subject AS "name?",
            lmp.snippet AS "snippet?",
            lmp.is_draft,
            -- A thread in "Other" can still be "Important", so we must perform the check.
            (
                SELECT EXISTS (
                    SELECT 1
                    FROM email_messages m_imp
                    JOIN email_message_labels ml ON m_imp.id = ml.message_id
                    JOIN email_labels l ON ml.label_id = l.id
                    WHERE m_imp.thread_id = t.id
                      AND l.link_id = t.link_id
                      AND l.name = 'IMPORTANT'
                )
            ) AS "is_important!",
            c.email_address AS "sender_email?",
            c.name AS "sender_name?",
            c.sfs_photo_url as "sender_photo_url?"
        FROM (
            -- Step 1: Efficiently find, sort, and limit the top N+1 threads that qualify for the "Other" inbox.
            SELECT
                t.id,
                t.provider_id,
                t.link_id,
                t.inbox_visible,
                t.is_read,
                t.latest_non_spam_message_ts AS created_at,
                t.latest_non_spam_message_ts AS updated_at,
                uh.updated_at AS viewed_at,
                CASE $5 -- sort_method_str
                    WHEN 'viewed_at' THEN COALESCE(uh."updated_at", '1970-01-01 00:00:00+00')
                    WHEN 'viewed_updated' THEN COALESCE(uh.updated_at, t.latest_non_spam_message_ts)
                    ELSE t.latest_non_spam_message_ts
                END AS effective_ts
            FROM email_threads t
            LEFT JOIN email_user_history uh ON uh.thread_id = t.id AND uh.link_id = t.link_id
            WHERE
                t.link_id = $1
              AND t.latest_non_spam_message_ts IS NOT NULL
              -- Inclusion Criteria: Must have a category label.
              AND EXISTS (
                  SELECT 1 FROM email_messages m JOIN email_message_labels ml ON m.id = ml.message_id JOIN email_labels l ON ml.label_id = l.id
                  WHERE m.thread_id = t.id AND l.link_id = t.link_id AND l.name IN ('CATEGORY_PROMOTIONS', 'CATEGORY_SOCIAL', 'CATEGORY_FORUMS')
              )
              -- ****** CORRECTED EXCLUSION CRITERIA ******
              -- This now matches the logic of your original query, which did NOT filter out 'INBOX' or 'IMPORTANT'.
              AND NOT EXISTS (
                  SELECT 1 FROM email_messages m JOIN email_message_labels ml ON m.id = ml.message_id JOIN email_labels l ON ml.label_id = l.id
                  WHERE m.thread_id = t.id AND l.link_id = t.link_id AND l.name IN ('SPAM', 'TRASH', 'DRAFT')
              )
              
              AND (($3::timestamptz IS NULL) OR (
                  CASE $5 -- sort_method_str
                      WHEN 'viewed_at' THEN COALESCE(uh."updated_at", '1970-01-01 00:00:00+00')
                      WHEN 'viewed_updated' THEN COALESCE(uh.updated_at, t.latest_non_spam_message_ts)
                      ELSE t.latest_non_spam_message_ts
                  END, t.id
              ) < ($3::timestamptz, $4::uuid))
            ORDER BY effective_ts DESC, t.updated_at DESC
            LIMIT $2
        ) AS t
        -- Step 2: For EACH of the limited threads from above, find its latest non-spam/trash message for the preview.
        CROSS JOIN LATERAL (
            SELECT
                m.subject,
                m.snippet,
                m.is_draft,
                m.from_contact_id
            FROM email_messages m
            WHERE m.thread_id = t.id
              AND m.is_draft = FALSE
            AND NOT EXISTS (
                SELECT 1 FROM email_message_labels ml JOIN email_labels l ON ml.label_id = l.id
                WHERE ml.message_id = m.id AND l.link_id = t.link_id AND l.name IN ('SPAM', 'TRASH')
            )
            ORDER BY m.internal_date_ts DESC
            LIMIT 1
        ) AS lmp
        -- Step 3: Join to get the sender's details.
        LEFT JOIN email_contacts c ON lmp.from_contact_id = c.id
        ORDER BY t.effective_ts DESC, t.updated_at DESC
        "#,
        query.link_id,            // $1
        query_limit,              // $2
        cursor_timestamp,   // $3
        cursor_id,          // $4
        sort_method_str,          // $5
    )
        .fetch_all(&self.pool)
        .await
    }

    /// Fetches a paginated list of thread previews for a user label.
    /// This view includes threads that have at least one message with the given label.
    /// Threads are sorted by the timestamp of the most recent message that has the label.
    /// The preview content is taken from that same most-recent labeled message.
    #[tracing::instrument(skip(self), level = "info")]
    async fn user_label_preview_cursor(
        &self,
        query: &PreviewCursorQuery,
        label_name: &str,
        user_id: MacroUserIdStr<'_>,
    ) -> Result<Vec<ThreadPreviewCursorDbRow>, sqlx::Error> {
        let query_limit = query.limit as i64;
        let sort_method_str = query.query.sort_method().to_string();
        let (cursor_id, cursor_timestamp) = query.query.vals();

        sqlx::query_as!(
        ThreadPreviewCursorDbRow,
        r#"
        SELECT
            t.id,
            t.provider_id,
            t.inbox_visible,
            t.is_read,
            t.effective_ts AS "sort_ts!",
            t.created_at AS "created_at!",
            t.updated_at AS "updated_at!",
            t.viewed_at AS "viewed_at?",
            lmp.subject AS "name?",
            lmp.snippet AS "snippet?",
            lmp.is_draft,
            (
                SELECT EXISTS (
                    SELECT 1
                    FROM email_messages m_imp
                    JOIN email_message_labels ml ON m_imp.id = ml.message_id
                    JOIN email_labels l ON ml.label_id = l.id
                    WHERE m_imp.thread_id = t.id
                      AND l.link_id = t.link_id
                      AND l.name = 'IMPORTANT'
                )
            ) AS "is_important!",
            c.email_address AS "sender_email?",
            c.name AS "sender_name?",
            c.sfs_photo_url as "sender_photo_url?"
        FROM (
            -- Step 1: Find the latest labeled message timestamp for each thread,
            -- calculate the effective sort key, then sort and limit the results.
            SELECT
                t.id,
                t.provider_id,
                t.link_id,
                t.inbox_visible,
                t.is_read,
                llpt.latest_labeled_ts AS created_at,
                llpt.latest_labeled_ts AS updated_at,
                uh.updated_at AS viewed_at,
                CASE $6 -- sort_method_str
                    WHEN 'viewed_at' THEN COALESCE(uh."updated_at", '1970-01-01 00:00:00+00')
                    WHEN 'viewed_updated' THEN COALESCE(uh.updated_at, llpt.latest_labeled_ts)
                    ELSE llpt.latest_labeled_ts
                END AS effective_ts
            FROM (
                -- This sub-subquery efficiently finds the latest timestamp for every thread
                -- that has at least one message with the specified label.
                SELECT
                    m.thread_id,
                    MAX(m.internal_date_ts) as latest_labeled_ts
                FROM email_messages m
                JOIN email_message_labels ml ON m.id = ml.message_id
                JOIN email_labels l ON ml.label_id = l.id
                WHERE m.link_id = $1 AND l.name = $5
                GROUP BY m.thread_id
            ) llpt
            JOIN email_threads t ON llpt.thread_id = t.id
            LEFT JOIN email_user_history uh ON uh.thread_id = t.id AND uh.link_id = $1
            WHERE
                (($3::timestamptz IS NULL) OR (
                    CASE $6 -- sort_method_str
                        WHEN 'viewed_at' THEN COALESCE(uh."updated_at", '1970-01-01 00:00:00+00')
                        WHEN 'viewed_updated' THEN COALESCE(uh.updated_at, llpt.latest_labeled_ts)
                        ELSE llpt.latest_labeled_ts
                    END, t.id
                ) < ($3::timestamptz, $4::uuid))
            ORDER BY effective_ts DESC, t.updated_at DESC
            LIMIT $2
        ) AS t
        -- Step 2: For EACH of the limited threads from above, find the full details of its latest message with that specific label.
        CROSS JOIN LATERAL (
            SELECT
                   m.subject,
                   m.snippet,
                   m.from_contact_id,
                   m.is_draft
            FROM email_messages m
            JOIN email_message_labels ml ON m.id = ml.message_id
            JOIN email_labels l ON ml.label_id = l.id
            WHERE m.thread_id = t.id AND m.is_draft = FALSE AND l.link_id = t.link_id AND l.name = $5
            ORDER BY m.internal_date_ts DESC
            LIMIT 1
        ) AS lmp
        -- Step 3: Join to get the sender's details.
        LEFT JOIN email_contacts c ON lmp.from_contact_id = c.id
        ORDER BY t.effective_ts DESC, t.updated_at DESC
        "#,
        query.link_id,            // $1
        query_limit,              // $2
        cursor_timestamp,   // $3
        cursor_id,          // $4
        label_name,               // $5
        sort_method_str,          // $6
    )
        .fetch_all(&self.pool)
        .await
    }
}
