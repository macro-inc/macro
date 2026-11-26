//! ViewedUpdated uses the saved view time when present, even when the thread
//! has a newer message. Merge viewed and never-viewed sources instead of
//! sorting the whole mailbox by that cross-table expression.

use chrono::{DateTime, Utc};

use super::*;

/// Like the owned reader, grow candidate windows only up to 16,000 rows.
/// Rejected history/thread rows and complete timestamp tie groups can cost
/// more; the request deadline bounds the read, not this emitted-row cap.
const MAX_WINDOW: i64 = 16_000;
const EFFECTIVE_TS: &str = "COALESCE(uh.updated_at, t.latest_non_spam_message_ts, t.updated_at)";

#[derive(Clone, Copy, Debug, PartialEq, Eq, sqlx::FromRow)]
pub(super) struct Below {
    effective_ts: DateTime<Utc>,
    id: Uuid,
}

/// One history PK probe per candidate/copy. Keep it out of non-viewed SQL.
pub(super) fn push_history(builder: &mut QueryBuilder<'static, Postgres>) {
    builder.push(
        r#"
                LEFT JOIN LATERAL (
                    SELECT updated_at FROM email_user_history
                    WHERE link_id = t.link_id AND thread_id = t.id OFFSET 0
                ) AS uh ON TRUE"#,
    );
}

impl TeamRead<'_> {
    pub(super) fn viewed_updated(&self) -> bool {
        self.params.sort_method_str == "viewed_updated"
    }

    pub(super) fn effective_timestamp<'a>(&self, base: &'a str) -> &'a str {
        if self.viewed_updated() {
            EFFECTIVE_TS
        } else {
            base
        }
    }

    /// Keep filling below each complete raw window. Copy priority is checked
    /// without these boundaries, so a conversation has one representative
    /// across every round and page in this snapshot.
    pub(super) async fn read_viewed(
        &self,
        connection: &mut PgConnection,
        deadline: Instant,
    ) -> Result<Vec<ThreadPreviewCursorDbRow>, PreviewReadError> {
        let mut rows = Vec::new();
        let mut below = None;
        let mut window = self
            .params
            .query_limit
            .saturating_mul(self.tuning.window_per_row)
            .clamp(1, MAX_WINDOW);
        let mut rounds = 0_i64;
        let span = tracing::Span::current();
        let result = async {
            while (rows.len() as i64) < self.params.query_limit {
                if Instant::now() >= deadline {
                    return Err(PreviewReadError::ReadDeadlineExceeded);
                }
                rounds += 1;
                let stream = Stream::ViewedUpdated { window, below };
                let remaining = self.params.query_limit - rows.len() as i64;
                let found = self
                    .page_with_limit(connection, deadline, stream, remaining)
                    .await?;
                rows.extend(found);
                if rows.len() as i64 >= self.params.query_limit {
                    break;
                }
                #[cfg(test)]
                let deadline = if test::expire_viewed_after_window(rows.len()) {
                    Instant::now()
                } else {
                    deadline
                };
                let Some(end) = self
                    .viewed_window_end(connection, deadline, stream, window)
                    .await?
                else {
                    break;
                };
                below = Some(end);
                window = window.saturating_mul(2).min(MAX_WINDOW);
            }
            Ok(rows)
        }
        .await;
        span.record("rounds", rounds);
        result
    }

    /// The identical raw source proves exhaustion only when it has fewer
    /// than `window` rows. A full final window may take one empty next round.
    async fn viewed_window_end(
        &self,
        connection: &mut PgConnection,
        deadline: Instant,
        stream: Stream,
        window: i64,
    ) -> Result<Option<Below>, PreviewReadError> {
        if Instant::now() >= deadline {
            return Err(PreviewReadError::ReadDeadlineExceeded);
        }
        limit_statement_time(connection, deadline).await?;
        let mut builder = QueryBuilder::new("SELECT effective_ts, id FROM (");
        self.push_stream(&mut builder, stream, get_sort_timestamp_field(self.view));
        builder.push(") AS candidates ORDER BY effective_ts DESC, id DESC OFFSET ");
        builder.push_bind(window.saturating_sub(1));
        builder.push(" LIMIT 1");
        Ok(builder
            .build_query_as()
            .persistent(false)
            .fetch_optional(connection)
            .await?)
    }

    pub(super) fn push_viewed_stream(
        &self,
        builder: &mut QueryBuilder<'static, Postgres>,
        window: i64,
        below: Option<Below>,
    ) {
        let base_ts = get_sort_timestamp_field(self.view);
        builder.push("SELECT * FROM (");
        for (index, inbox) in self.inboxes.iter().enumerate() {
            if index > 0 {
                builder.push(" UNION ALL ");
            }
            // History's index orders only by timestamp. Fetch the whole
            // last tie before sorting by ID and taking the per-inbox window.
            // Source filters precede the cap: a short arm means exhaustion.
            builder.push("(SELECT * FROM (");
            self.push_stream_columns_with_sort(builder, base_ts, "uh.updated_at");
            builder.push(
                r#"
                FROM email_user_history uh
                CROSS JOIN LATERAL (
                    SELECT * FROM email_threads
                    WHERE id = uh.thread_id OFFSET 0
                ) AS t WHERE t.link_id = "#,
            );
            builder.push_bind(*inbox);
            builder.push(" AND uh.link_id = ");
            builder.push_bind(*inbox);
            // A scalar bound hides first-page infinity from the planner,
            // keeping the link/view-time index useful under stale statistics.
            builder.push(" AND uh.updated_at <= (SELECT COALESCE(");
            builder.push_bind(
                below
                    .map(|end| end.effective_ts)
                    .or(self.params.cursor_timestamp),
            );
            builder.push("::timestamptz, 'infinity'::timestamptz))");
            self.push_viewed_filters(builder, "uh.updated_at", below);
            builder.push(" ORDER BY uh.updated_at DESC FETCH FIRST ");
            builder.push_bind(window);
            builder.push(" ROWS WITH TIES) AS viewed ORDER BY effective_ts DESC, id DESC LIMIT ");
            builder.push_bind(window);
            builder.push(") UNION ALL (");

            self.push_stream_columns_with_sort(builder, base_ts, base_ts);
            builder.push(" FROM email_threads t WHERE t.link_id = ");
            builder.push_bind(*inbox);
            builder.push(
                r#" AND NOT EXISTS (
                    SELECT 1 FROM email_user_history uh
                    WHERE uh.link_id = t.link_id AND uh.thread_id = t.id OFFSET 0
                )"#,
            );
            self.push_viewed_filters(builder, base_ts, below);
            builder.push(format!(" ORDER BY {base_ts} DESC, t.id DESC LIMIT "));
            builder.push_bind(window);
            builder.push(")");
        }
        builder.push(") AS viewed_and_unseen ORDER BY effective_ts DESC, id DESC LIMIT ");
        builder.push_bind(window);
    }

    fn push_viewed_filters(
        &self,
        builder: &mut QueryBuilder<'static, Postgres>,
        timestamp: &str,
        below: Option<Below>,
    ) {
        self.push_stream_filters(builder, timestamp);
        if let Some(below) = below {
            builder.push(format!(" AND ({timestamp}, t.id) < ("));
            builder.push_bind(below.effective_ts);
            builder.push("::timestamptz, ");
            builder.push_bind(below.id);
            builder.push("::uuid)");
        }
    }
}
