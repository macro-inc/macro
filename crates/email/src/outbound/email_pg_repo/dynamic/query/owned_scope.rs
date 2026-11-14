//! An All Mail page of the caller's own inboxes filtered to one OR-tree of
//! addresses: the Sales Email view and a CRM record's emails under Me (a
//! company's domains and its contacts' addresses), or a search on senders
//! and recipients. Newest first.
//!
//! The general builder lists every thread of the inboxes that has a message
//! from or to the addresses, probing each such message's mailbox facts,
//! before its LIMIT, so a CRM that covers most of a mailbox read the whole
//! mailbox for each page. [`OwnedRead`] reads the same page in page order
//! and stops when it is full:
//!
//! - A *stream* lists threads in `(effective_ts, id)` order with only the
//!   conditions an index serves: the inbox, the filter's thread-level terms
//!   and the cursor. The *superset* stream sorts the threads the address
//!   indexes list (`matching_threads`, without mailbox facts), which is cheap
//!   when the addresses are rare in the mail. The *inbox* stream merges each
//!   inbox's newest threads from `idx_email_threads_non_spam_link_ts_id`, up
//!   to a window of `limit × window_per_row` threads (at most
//!   [`MAX_WINDOW`]), which is cheap when they are common.
//! - Each streamed thread then gets the general builder's preview pick, its
//!   latest message the view and the filter accept, in order, until the page
//!   fills; a thread with none drops out. The pick is the general builder's
//!   message match, so the page holds its threads, order and previews.
//!
//! A probe counts the superset up to `superset_limit` to choose the stream.
//! The inbox stream's page is final when it filled the page, or when its
//! window held every thread left in the inboxes (a list's last page);
//! otherwise the superset stream reads it.
//!
//! The general builder lists a thread only when it matches through the queried
//! inboxes' own contacts (`matching_threads`), while its preview pick matches a
//! domain or partial address on any inbox's contact. A message lists only its
//! own inbox's contacts (`parse_and_upsert_message_contacts`), but no
//! constraint keeps it so: a picked message with another inbox's contact
//! lists its thread in either stream only if `matching_threads`' condition
//! holds for it ([`ContactScope`]).

use filter_ast::Expr;
use item_filters::SharedEmailFilter;
use item_filters::ast::email::EmailLiteral;
use sqlx::{PgConnection, Postgres, QueryBuilder};
use tracing::field::Empty;
use uuid::Uuid;

use super::super::SqlFragment;
use super::super::filters::{
    AddressSuperset, ContactScope, build_address_superset, build_contact_scope,
    build_thread_conjunct_filter, get_sort_timestamp_field, top_level_owners,
};
use super::{
    QueryParams, map_row, push_page_head, push_page_tail, push_preview_message_select_with,
    uses_subject_subscans, uses_view_history,
};
use crate::domain::models::{PreviewView, PreviewViewStandardLabel};
use crate::outbound::email_pg_repo::db_types::ThreadPreviewCursorDbRow;

/// Where [`OwnedRead`] switches streams.
#[derive(Clone, Copy, Debug)]
pub(crate) struct OwnedReadTuning {
    /// The most superset rows the superset stream reads first. Past it the
    /// inbox stream reads first.
    pub(crate) superset_limit: i64,
    /// The inbox stream's window, in threads per page row.
    pub(crate) window_per_row: i64,
}

impl OwnedReadTuning {
    /// Chosen on a production-size mailbox: the superset stream reads all its
    /// rows before the first thread, and at 5,000 rows that stays well under
    /// the inbox stream's cost for addresses that rare. Past it the
    /// addresses usually fill a page within 100 threads per row of the
    /// inboxes.
    pub(crate) const DEFAULT: Self = Self {
        superset_limit: 5_000,
        window_per_row: 100,
    };
}

/// The most threads the inbox stream reads for one page: a Sales Email page
/// of 100 at 100 per row. Past it the superset stream finishes the page, so
/// a larger limit (Soup allows 500) doesn't stretch a window that the
/// addresses fill slowly.
const MAX_WINDOW: i64 = 10_000;

/// The inbox stream's window for a page of `query_limit` rows: `window_per_row`
/// threads per row, at most [`MAX_WINDOW`].
pub(crate) fn inbox_window(query_limit: i64, window_per_row: i64) -> i64 {
    query_limit.saturating_mul(window_per_row).min(MAX_WINDOW)
}

/// The stream a page reads its threads from, in page order.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Stream {
    /// The threads the address indexes list, sorted.
    Superset,
    /// Each inbox's newest threads, merged, up to a window.
    Inboxes,
}

/// The streams that read an owned page, in the order they ran.
#[derive(Clone, Copy, Debug, PartialEq, Eq, strum::IntoStaticStr)]
#[strum(serialize_all = "snake_case")]
pub(crate) enum OwnedStreams {
    /// No inbox or no address can match, so no statement ran.
    Empty,
    /// The superset was small enough to read first.
    Superset,
    /// The inbox stream filled the page.
    Inboxes,
    /// The inbox stream came up short of a page, but its window held every
    /// thread left in the inboxes, so the page is final.
    InboxesToEnd,
    /// The inbox stream came up short of a page, so the superset read it.
    InboxesThenSuperset,
}

/// An owned All Mail page for one OR-tree of addresses. See the module docs.
pub(super) struct OwnedRead<'a> {
    view: &'a PreviewView,
    email_filter: &'a Expr<EmailLiteral>,
    params: QueryParams,
    tuning: OwnedReadTuning,
    /// The caller's inboxes the filter's top-level `Owner` terms allow. The
    /// superset and the contact scope are on all the request's inboxes, as the
    /// general builder's `matching_threads` is.
    inboxes: Vec<Uuid>,
    superset: AddressSuperset,
    /// How a picked thread stays on the inboxes' own contacts, when the tree
    /// has domains or partial addresses.
    contact_scope: Option<ContactScope>,
    /// The filter's top-level thread-level terms on `t`, which the streams
    /// apply as they read.
    thread_terms: SqlFragment,
}

impl<'a> OwnedRead<'a> {
    /// A read for an owned All Mail request whose filter has one positive
    /// OR-tree of addresses among its top-level terms; other requests get
    /// their params back.
    pub(super) fn new(
        view: &'a PreviewView,
        email_filter: &'a Expr<EmailLiteral>,
        params: QueryParams,
        tuning: OwnedReadTuning,
    ) -> Result<Self, Box<QueryParams>> {
        // A top-level subject term has its own ordered subscan in the
        // general builder.
        let covered = matches!(
            view,
            PreviewView::StandardLabel(PreviewViewStandardLabel::All)
        ) && params.team_id.is_none()
            && !uses_view_history(email_filter, &params.sort_method_str)
            && matches!(params.shared, SharedEmailFilter::Exclude)
            && params.project_scope.is_none()
            && !uses_subject_subscans(view, email_filter);
        if !covered {
            return Err(Box::new(params));
        }
        let owners = top_level_owners(email_filter);
        let inboxes: Vec<Uuid> = params
            .link_ids
            .iter()
            .copied()
            .filter(|inbox| owners.iter().all(|owner| owner == inbox))
            .collect();
        let Some(superset) =
            build_address_superset(email_filter, &params.resolved, &params.link_ids)
        else {
            return Err(Box::new(params));
        };
        let contact_scope = build_contact_scope(email_filter, &params.resolved, &params.link_ids);
        Ok(Self {
            view,
            email_filter,
            thread_terms: build_thread_conjunct_filter(
                email_filter,
                get_sort_timestamp_field(view),
            ),
            params,
            tuning,
            inboxes,
            superset,
            contact_scope,
        })
    }

    /// Reads the page.
    #[tracing::instrument(
        name = "email.owned_address_read",
        skip_all,
        fields(
            inboxes = self.inboxes.len(),
            superset_rows = Empty,
            streams = Empty,
            rows = Empty,
        ),
        err
    )]
    pub(super) async fn fetch(
        self,
        connection: &mut PgConnection,
    ) -> Result<(OwnedStreams, Vec<ThreadPreviewCursorDbRow>), sqlx::Error> {
        let span = tracing::Span::current();
        let (streams, rows) = if self.inboxes.is_empty() || self.superset.branches.is_empty() {
            (OwnedStreams::Empty, Vec::new())
        } else {
            let superset_rows: i64 = self
                .probe()
                .build_query_scalar()
                .persistent(false)
                .fetch_one(&mut *connection)
                .await?;
            span.record("superset_rows", superset_rows);
            self.read(connection, superset_rows).await?
        };
        span.record("streams", <&str>::from(streams));
        span.record("rows", rows.len());
        Ok((streams, rows))
    }

    /// The page and the streams that read it.
    async fn read(
        &self,
        connection: &mut PgConnection,
        superset_rows: i64,
    ) -> Result<(OwnedStreams, Vec<ThreadPreviewCursorDbRow>), sqlx::Error> {
        if superset_rows <= self.tuning.superset_limit {
            let rows = self.page(connection, Stream::Superset).await?;
            return Ok((OwnedStreams::Superset, rows));
        }
        let rows = self.page(connection, Stream::Inboxes).await?;
        if rows.len() as i64 >= self.params.query_limit {
            return Ok((OwnedStreams::Inboxes, rows));
        }
        // The superset costs a dense list's whole address set, so a short
        // page skips it when the window read every thread there is.
        let window_threads: i64 = self
            .window_count()
            .build_query_scalar()
            .persistent(false)
            .fetch_one(&mut *connection)
            .await?;
        if window_threads < self.window() {
            return Ok((OwnedStreams::InboxesToEnd, rows));
        }
        let rows = self.page(connection, Stream::Superset).await?;
        Ok((OwnedStreams::InboxesThenSuperset, rows))
    }

    /// The inbox stream's window for this page ([`inbox_window`]).
    fn window(&self) -> i64 {
        inbox_window(self.params.query_limit, self.tuning.window_per_row)
    }

    /// Counts the threads in the inbox stream's window, stopping at the
    /// window: fewer means the stream read every thread left in the inboxes.
    /// Each inbox's walk is the stream's, so the count reads its index.
    fn window_count(&self) -> QueryBuilder<'static, Postgres> {
        let sort_ts_field = get_sort_timestamp_field(self.view);
        let window = self.window();
        let mut builder = QueryBuilder::new("SELECT count(*) FROM (SELECT 1 FROM (");
        for (index, inbox) in self.inboxes.iter().enumerate() {
            if index > 0 {
                builder.push("\n            UNION ALL");
            }
            builder.push("\n            (SELECT 1 FROM email_threads t WHERE t.link_id = ");
            builder.push_bind(*inbox);
            self.push_stream_filters(&mut builder, sort_ts_field);
            builder.push(format!(" ORDER BY {sort_ts_field} DESC, t.id DESC LIMIT "));
            builder.push_bind(window);
            builder.push(")");
        }
        builder.push("\n        ) AS inbox_threads LIMIT ");
        builder.push_bind(window);
        builder.push(") AS window_threads");
        builder
    }

    async fn page(
        &self,
        connection: &mut PgConnection,
        stream: Stream,
    ) -> Result<Vec<ThreadPreviewCursorDbRow>, sqlx::Error> {
        let mut builder = self.build_page(stream);
        builder
            .build()
            .persistent(false)
            .try_map(map_row)
            .fetch_all(&mut *connection)
            .await
    }

    /// Counts the superset's rows (a thread once per message that lists
    /// it), stopping one past `superset_limit`.
    fn probe(&self) -> QueryBuilder<'static, Postgres> {
        let mut builder = QueryBuilder::new("");
        self.push_contact_ctes(&mut builder, "WITH ");
        builder.push("\n        SELECT count(*) FROM (SELECT 1 FROM (\n            ");
        self.push_branches(&mut builder, "UNION ALL");
        builder.push("\n        ) AS superset LIMIT ");
        builder.push_bind(self.tuning.superset_limit.saturating_add(1));
        builder.push(") AS capped");
        builder
    }

    /// The hoisted contact CTEs the branches read, the first after `lead`.
    fn push_contact_ctes(&self, builder: &mut QueryBuilder<'static, Postgres>, lead: &str) {
        let mut separator = lead;
        for (name, body) in self.superset.contact_ctes.iter().cloned() {
            builder.push(format!("{separator}{name} AS MATERIALIZED (\n            "));
            body.push_into(builder, &self.params.user_id);
            builder.push("\n        )");
            separator = ",\n        ";
        }
    }

    fn push_branches(&self, builder: &mut QueryBuilder<'static, Postgres>, operator: &str) {
        for (index, branch) in self.superset.branches.iter().cloned().enumerate() {
            if index > 0 {
                builder.push(format!("\n            {operator}\n            "));
            }
            branch.push_into(builder, &self.params.user_id);
        }
    }

    fn build_page(&self, stream: Stream) -> QueryBuilder<'static, Postgres> {
        let sort_ts_field = get_sort_timestamp_field(self.view);
        let mut builder = QueryBuilder::new("");
        if stream == Stream::Superset {
            self.push_contact_ctes(&mut builder, "\n        WITH ");
            let separator = if self.superset.contact_ctes.is_empty() {
                "\n        WITH "
            } else {
                ",\n        "
            };
            builder.push(format!(
                "{separator}matching_threads AS MATERIALIZED (\n            "
            ));
            self.push_branches(&mut builder, "UNION");
            builder.push("\n        )");
        }
        push_page_head(&mut builder, &self.params, true);
        // The preview pick runs per streamed thread, in order: a LIMITed
        // LATERAL can't become a join over the whole stream, and the ORDER
        // BY, already the stream's, keeps the planner from sorting. It
        // projects the preview as the general builder's candidates do, which
        // the page tail reads when it doesn't pick again.
        builder.push(
            r#"
            SELECT t.*, lmp.subject, lmp.snippet, lmp.from_contact_id, lmp.from_name, lmp.is_draft
            FROM ("#,
        );
        self.push_stream(&mut builder, stream, sort_ts_field);
        builder.push(
            r#"
            ) AS t
            CROSS JOIN LATERAL ("#,
        );
        let contact_scope = self.contact_scope.clone();
        push_preview_message_select_with(
            &mut builder,
            self.view,
            self.email_filter,
            &self.params,
            contact_scope
                .as_ref()
                .map(|scope| (scope.own_contacts.clone(), "own_contacts")),
        );
        builder.push(
            r#"
            ) AS lmp"#,
        );
        if let Some(ContactScope { member, .. }) = contact_scope {
            // On the inboxes' own contacts the pick is a match through them,
            // so `member` runs only for a message that lists another inbox's.
            builder.push(
                r#"
            WHERE lmp.own_contacts OR "#,
            );
            member.push_into(&mut builder, &self.params.user_id);
        }
        builder.push(
            r#"
            ORDER BY t.effective_ts DESC, t.id DESC
            LIMIT "#,
        );
        builder.push_bind(self.params.query_limit);
        push_page_tail(
            &mut builder,
            self.view,
            self.email_filter,
            &self.params,
            true,
        );
        builder
    }

    fn push_stream(
        &self,
        builder: &mut QueryBuilder<'static, Postgres>,
        stream: Stream,
        sort_ts_field: &str,
    ) {
        match stream {
            Stream::Superset => {
                self.push_stream_select(builder, sort_ts_field);
                builder.push("t.link_id = ANY(");
                builder.push_bind(self.inboxes.clone());
                builder.push(") AND t.id IN (SELECT thread_id FROM matching_threads)");
                self.push_stream_filters(builder, sort_ts_field);
                builder.push(
                    r#"
                    ORDER BY effective_ts DESC, id DESC
                    OFFSET 0"#,
                );
            }
            Stream::Inboxes => {
                // One ordered, limited index walk per inbox: `link_id =
                // ANY(…)` can't return index order, so it would read and sort
                // every thread of every inbox.
                let window = self.window();
                builder.push("\n                    SELECT * FROM (");
                for (index, inbox) in self.inboxes.iter().enumerate() {
                    if index > 0 {
                        builder.push("\n                        UNION ALL");
                    }
                    builder.push("\n                        (");
                    self.push_stream_select(builder, sort_ts_field);
                    builder.push("t.link_id = ");
                    builder.push_bind(*inbox);
                    self.push_stream_filters(builder, sort_ts_field);
                    builder.push(" ORDER BY effective_ts DESC, id DESC LIMIT ");
                    builder.push_bind(window);
                    builder.push(")");
                }
                builder.push(
                    r#"
                    ) AS inbox_threads
                    ORDER BY effective_ts DESC, id DESC
                    LIMIT "#,
                );
                builder.push_bind(window);
            }
        }
    }

    /// A stream's columns, up to its `WHERE`. All Mail's `created_at` and
    /// `updated_at` are its sort date, as in the general builder.
    fn push_stream_select(&self, builder: &mut QueryBuilder<'static, Postgres>, ts: &str) {
        builder.push(format!(
            r#"
                    SELECT t.id, t.provider_id, t.link_id, t.inbox_visible, t.is_read,
                           t.is_signal, t.project_id,
                           {ts} AS created_at, {ts} AS updated_at, {ts} AS effective_ts
                    FROM email_threads t
                    WHERE "#
        ));
    }

    /// The thread-level terms and, after the first page, the cursor: both
    /// index conditions of the stream's walk.
    fn push_stream_filters(&self, builder: &mut QueryBuilder<'static, Postgres>, ts: &str) {
        self.thread_terms
            .clone()
            .push_into(builder, &self.params.user_id);
        if let Some(cursor_timestamp) = self.params.cursor_timestamp {
            builder.push(format!(" AND ({ts}, t.id) < ("));
            builder.push_bind(cursor_timestamp);
            builder.push("::timestamptz, ");
            builder.push_bind(self.params.cursor_id_str.clone());
            builder.push("::uuid)");
        }
    }
}
