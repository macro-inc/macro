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
//!   when the addresses are rare in the mail. The initial sparse superset
//!   fetches each distinct match by primary key, so its estimate cannot
//!   turn those IDs into a filter over the whole mailbox. The *inbox* stream
//!   merges each inbox's newest threads from `idx_email_threads_non_spam_link_ts_id`,
//!   up to a window of threads, which is cheap when they are common.
//! - Each streamed thread then gets the general builder's preview pick, its
//!   latest message the view and the filter accept, in order, until the page
//!   fills; a thread with none drops out. The pick is the general builder's
//!   message match, so the page holds its threads, order and previews.
//!
//! A probe counts the superset up to `superset_limit` to choose the stream.
//! Past it, the inbox stream reads a first window of `limit ×
//! window_per_row` threads (at most [`MAX_WINDOW`]). The page is final when
//! that window filled it, or held every thread left in the inboxes (a list's
//! last page). Otherwise the page goes on below the last walked thread in
//! rounds, each with a window [`GROWTH`] times the last, up to
//! [`MAX_ROUND_WINDOW`]:
//!
//! - When the last window found rows fast enough that, at its rate, the
//!   round's window would fill the page, the inbox stream walks it. The rate
//!   is the last window's, not the page's: a page that found most of its
//!   rows early would otherwise keep walking far below the last of them.
//! - Otherwise, and always after a window that found none, a probe first
//!   counts the superset up to the round's cap
//!   ([`OwnedReadTuning::round_cap`]), which follows the walk the page still
//!   needs at that rate and the walk so far. When the superset fits, the
//!   superset stream finishes the page below the last walked thread; when it
//!   doesn't, the inbox stream walks the round's window. A round probes only
//!   with a cap [`GROWTH`] times the last one the superset outgrew, or once
//!   at [`MAX_SUPERSET_CAP`] ([`OwnedReadTuning::probes_again`]).
//!
//! A walked thread whose messages miss the addresses costs the pick a read of
//! each of them, so on a cold cache a window of addresses gone quiet costs
//! several times their superset. The windows and emitted probe rows are
//! capped ([`MAX_ROUND_WINDOW`] threads, [`MAX_SUPERSET_CAP`] superset rows),
//! and their sizes grow geometrically. These caps do not bound recipients
//! rejected by a role filter or messages inspected by a thread's preview
//! pick. The request as a whole has no bound: a superset past
//! [`MAX_SUPERSET_CAP`] rows leaves only the walk, which goes on to the
//! page's last row or the end of the inboxes, about what reading that
//! superset would cost. A page never comes up short to save rounds, so it
//! keeps the general builder's rows. All the page's statements read one
//! snapshot, and each lists only threads below the previous one's, so their
//! rows concatenate in page order.
//!
//! The address tree must be the filter's only top-level term with a message
//! literal. Another one (a subject, or an address under `NOT`) can drop most
//! of the inbox window in the pick, so the window comes up short and the
//! read pays for rounds the general builder doesn't, which reads those
//! requests.
//!
//! The general builder lists a thread only when it matches through the queried
//! inboxes' own contacts (`matching_threads`), while its preview pick matches a
//! domain or partial address on any inbox's contact. A message lists only its
//! own inbox's contacts (`parse_and_upsert_message_contacts`), but no
//! constraint keeps it so: a picked message with another inbox's contact
//! lists its thread in either stream only if `matching_threads`' condition
//! holds for it ([`ContactScope`]).

use chrono::{DateTime, Utc};
use filter_ast::Expr;
use item_filters::SharedEmailFilter;
use item_filters::ast::email::EmailLiteral;
use sqlx::{PgConnection, Postgres, QueryBuilder};
use tracing::field::Empty;
use uuid::Uuid;

#[cfg(test)]
mod stream_plan;

use super::super::SqlFragment;
use super::super::filters::{
    AddressSuperset, ContactScope, build_address_superset, build_contact_scope,
    build_thread_conjunct_filter, get_sort_timestamp_field, only_address_message_terms,
    top_level_owners,
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
    /// The inbox stream's first window, in threads per page row.
    pub(crate) window_per_row: i64,
    /// A round's cap, in superset rows per thread the walk would still read
    /// to fill the page at the rate it found rows.
    pub(crate) superset_per_need: i64,
    /// The most a round's cap reaches, in superset rows per thread walked so
    /// far.
    pub(crate) superset_per_walked: i64,
    /// The most threads a round's window reads: [`MAX_ROUND_WINDOW`].
    pub(crate) max_round_window: i64,
    /// The most superset rows a round's probe counts: [`MAX_SUPERSET_CAP`].
    pub(crate) max_superset_cap: i64,
}

impl OwnedReadTuning {
    /// Chosen on a production-size mailbox: the superset stream reads all its
    /// rows before the first thread, and at 5,000 rows that stays well under
    /// the inbox stream's cost for addresses that rare. Past it the
    /// addresses that fill pages fill one within 10 threads per row of the
    /// inboxes. On a cold cache a walked thread costs about 1.4 ms, a
    /// superset row 0.15–0.5 ms and a probed row 0.05 ms, so the superset is
    /// the cheaper read while it has up to about 3 rows per thread the walk
    /// still needs. At 50 rows per thread walked, a cold probe the superset
    /// outgrows costs about twice the walk before it.
    pub(crate) const DEFAULT: Self = Self {
        superset_limit: 5_000,
        window_per_row: 10,
        superset_per_need: 3,
        superset_per_walked: 50,
        max_round_window: MAX_ROUND_WINDOW,
        max_superset_cap: MAX_SUPERSET_CAP,
    };

    /// The most superset rows a round reads the superset for, after the walk
    /// read `walked` threads, the last `last_window` of which held
    /// `last_found` rows, and the page needs `left` more:
    /// `superset_per_need` per thread the walk would still read at that
    /// window's rate, at most `superset_per_walked` per thread walked and
    /// `max_superset_cap`. A window that found no rows gives no rate, so
    /// only the walk so far bounds the cap.
    pub(crate) fn round_cap(
        &self,
        walked: i64,
        last_window: i64,
        last_found: i64,
        left: i64,
    ) -> i64 {
        let most = walked
            .saturating_mul(self.superset_per_walked)
            .min(self.max_superset_cap);
        if last_found <= 0 {
            return most;
        }
        let need = left.saturating_mul(last_window) / last_found;
        need.saturating_mul(self.superset_per_need).min(most)
    }

    /// Whether a round probes the superset at `cap` after a probe at `over`
    /// came up short: only with a cap [`GROWTH`] times `over`, since a
    /// smaller one would recount most of what that probe counted, or once at
    /// `max_superset_cap`, which no cap grows past. Without that last probe,
    /// once a probe over a quarter of it came up short, a superset under it
    /// would never be read and the walk would go on to the end of the
    /// inboxes.
    pub(crate) fn probes_again(&self, cap: i64, over: i64) -> bool {
        cap >= over.max(1).saturating_mul(GROWTH) || (cap == self.max_superset_cap && cap > over)
    }
}

/// The most threads the inbox stream's first window reads: a Sales Email
/// page of 100 at 10 per row. Past it the rounds finish the page, so a
/// larger limit (Soup allows 500) doesn't stretch a window that the
/// addresses fill slowly.
const MAX_WINDOW: i64 = 1_000;

/// The most threads a round's window reads. Past it the rounds keep this
/// window, so no one statement walks more.
const MAX_ROUND_WINDOW: i64 = 16_000;

/// The most superset rows a round's probe counts, and so the superset stream
/// reads below the walk. Past it the rounds only walk.
const MAX_SUPERSET_CAP: i64 = 800_000;

/// How much each round's window grows over the last, and the least each
/// probe's cap grows over the last cap the superset outgrew.
const GROWTH: i64 = 4;

/// The inbox stream's first window for a page of `query_limit` rows:
/// `window_per_row` threads per row, at least one and at most
/// [`MAX_WINDOW`].
pub(crate) fn inbox_window(query_limit: i64, window_per_row: i64) -> i64 {
    query_limit
        .saturating_mul(window_per_row)
        .clamp(1, MAX_WINDOW)
}

/// The stream a statement reads its threads from, in page order.
#[derive(Clone, Copy, Debug)]
enum Stream {
    /// The threads the address indexes list, sorted.
    Superset,
    /// A superset the initial capped probe found small enough for indexed lookups.
    SparseSuperset,
    /// Each inbox's newest threads, merged, up to `window` threads.
    Inboxes { window: i64 },
}

/// A thread's place in the streams' order. A round lists only the threads
/// after it, the older ones.
#[derive(Clone, Copy, Debug)]
struct Below {
    effective_ts: DateTime<Utc>,
    id: Uuid,
}

/// The streams that read an owned page, in the order they ran.
#[derive(Clone, Copy, Debug, PartialEq, Eq, strum::IntoStaticStr)]
#[strum(serialize_all = "snake_case")]
pub(crate) enum OwnedStreams {
    /// No inbox or no address can match, so no statement ran.
    Empty,
    /// The superset was small enough to read first.
    Superset,
    /// The inbox stream's first window filled the page.
    Inboxes,
    /// The inbox stream's first window came up short of a page, but held
    /// every thread left in the inboxes, so the page is final.
    InboxesToEnd,
    /// The first window came up short, and the rounds' windows below it
    /// filled the page or reached the end of the inboxes.
    InboxesThenInboxes,
    /// The windows came up short, and the superset, within a round's cap,
    /// finished the page below them.
    InboxesThenSuperset,
}

/// How [`OwnedRead`] took a page.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct OwnedReadStats {
    pub(crate) streams: OwnedStreams,
    /// The rounds below the first window.
    pub(crate) rounds: u32,
    /// The superset counts that ran, the first one's included.
    pub(crate) probes: u32,
    /// The last count's cap, when one ran.
    pub(crate) probe_cap: Option<i64>,
    /// The threads the inbox stream's windows reached. The last window
    /// stops early when it fills the page.
    pub(crate) walked: i64,
}

impl OwnedReadStats {
    /// The streams that read the page, set when the read returns it.
    fn with(self, streams: OwnedStreams) -> Self {
        Self { streams, ..self }
    }
}

/// A page and how [`OwnedRead`] took it.
type Taken = (OwnedReadStats, Vec<ThreadPreviewCursorDbRow>);

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
        // general builder. Any other message term beside the addresses can
        // drop most of the inbox window in the preview pick, which the probe
        // can't foresee: the read would walk the window and then read the
        // superset, slower than the general builder's one statement.
        let covered = matches!(
            view,
            PreviewView::StandardLabel(PreviewViewStandardLabel::All)
        ) && params.team_id.is_none()
            && !uses_view_history(email_filter, &params.sort_method_str)
            && matches!(params.shared, SharedEmailFilter::Exclude)
            && params.project_scope.is_none()
            && !uses_subject_subscans(view, email_filter)
            && only_address_message_terms(email_filter);
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
        let Some(superset) = build_address_superset(
            email_filter,
            &params.resolved,
            &params.link_ids,
            tuning.superset_limit,
        ) else {
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
            rounds = Empty,
            probes = Empty,
            probe_cap = Empty,
            walked = Empty,
            rows = Empty,
        ),
        err
    )]
    pub(super) async fn fetch(self, connection: &mut PgConnection) -> Result<Taken, sqlx::Error> {
        let span = tracing::Span::current();
        let (stats, rows) = if self.inboxes.is_empty() || self.superset.branches.is_empty() {
            let stats = OwnedReadStats {
                streams: OwnedStreams::Empty,
                rounds: 0,
                probes: 0,
                probe_cap: None,
                walked: 0,
            };
            (stats, Vec::new())
        } else {
            let superset_rows = self
                .superset_rows(connection, self.tuning.superset_limit, true)
                .await?;
            span.record("superset_rows", superset_rows);
            self.read(connection, superset_rows).await?
        };
        span.record("streams", <&str>::from(stats.streams));
        span.record("rounds", stats.rounds);
        span.record("probes", stats.probes);
        if let Some(cap) = stats.probe_cap {
            span.record("probe_cap", cap);
        }
        span.record("walked", stats.walked);
        span.record("rows", rows.len());
        Ok((stats, rows))
    }

    /// The page and how it was read, after the first probe counted
    /// `superset_rows`.
    async fn read(
        &self,
        connection: &mut PgConnection,
        superset_rows: i64,
    ) -> Result<Taken, sqlx::Error> {
        let limit = self.params.query_limit;
        let mut stats = OwnedReadStats {
            streams: OwnedStreams::Superset,
            rounds: 0,
            probes: 1,
            probe_cap: Some(self.tuning.superset_limit),
            walked: 0,
        };
        if superset_rows <= self.tuning.superset_limit {
            let rows = self
                .page(connection, Stream::SparseSuperset, None, limit)
                .await?;
            return Ok((stats, rows));
        }
        let mut window = inbox_window(limit, self.tuning.window_per_row);
        let mut rows = self
            .page(connection, Stream::Inboxes { window }, None, limit)
            .await?;
        stats.walked = window;
        if rows.len() as i64 >= limit {
            return Ok((stats.with(OwnedStreams::Inboxes), rows));
        }
        // A short page is final when the window read every thread there is.
        let Some(mut below) = self.window_end(connection, None, window).await? else {
            return Ok((stats.with(OwnedStreams::InboxesToEnd), rows));
        };
        // The rows the last window found, all of whose threads it read.
        let mut last_found = rows.len() as i64;
        // The superset holds more rows than this.
        let mut over = self.tuning.superset_limit;
        loop {
            stats.rounds += 1;
            let last_window = window;
            window = window
                .saturating_mul(GROWTH)
                .min(self.tuning.max_round_window);
            let left = limit - rows.len() as i64;
            // At the last window's rate, the page needs `left × last_window
            // / last_found` more threads; a window that found none never
            // fills it.
            if left.saturating_mul(last_window) > last_found.saturating_mul(window) {
                let cap = self
                    .tuning
                    .round_cap(stats.walked, last_window, last_found, left);
                if self.tuning.probes_again(cap, over) {
                    stats.probes += 1;
                    stats.probe_cap = Some(cap);
                    if self.superset_rows(connection, cap, false).await? <= cap {
                        rows.extend(
                            self.page(connection, Stream::Superset, Some(below), left)
                                .await?,
                        );
                        return Ok((stats.with(OwnedStreams::InboxesThenSuperset), rows));
                    }
                    over = cap;
                }
            }
            let found = self
                .page(connection, Stream::Inboxes { window }, Some(below), left)
                .await?;
            stats.walked = stats.walked.saturating_add(window);
            last_found = found.len() as i64;
            rows.extend(found);
            if rows.len() as i64 >= limit {
                return Ok((stats.with(OwnedStreams::InboxesThenInboxes), rows));
            }
            let Some(end) = self.window_end(connection, Some(below), window).await? else {
                return Ok((stats.with(OwnedStreams::InboxesThenInboxes), rows));
            };
            below = end;
        }
    }

    /// The last thread of the inbox stream's `window` threads below `below`
    /// (or the cursor), or `None` when the inboxes hold fewer: then the
    /// stream read every thread left. Each inbox's walk is the stream's, so
    /// this reads the index entries the stream just read.
    async fn window_end(
        &self,
        connection: &mut PgConnection,
        below: Option<Below>,
        window: i64,
    ) -> Result<Option<Below>, sqlx::Error> {
        let sort_ts_field = get_sort_timestamp_field(self.view);
        let mut builder = QueryBuilder::new("SELECT effective_ts, id FROM (");
        for (index, inbox) in self.inboxes.iter().enumerate() {
            if index > 0 {
                builder.push("\n            UNION ALL");
            }
            builder.push(format!(
                "\n            (SELECT {sort_ts_field} AS effective_ts, t.id \
                 FROM email_threads t WHERE t.link_id = "
            ));
            builder.push_bind(*inbox);
            self.push_stream_filters(&mut builder, sort_ts_field, below);
            builder.push(format!(" ORDER BY {sort_ts_field} DESC, t.id DESC LIMIT "));
            builder.push_bind(window);
            builder.push(")");
        }
        builder.push("\n        ) AS inbox_threads ORDER BY effective_ts DESC, id DESC OFFSET ");
        builder.push_bind(window.saturating_sub(1).max(0));
        builder.push(" LIMIT 1");
        let end: Option<(DateTime<Utc>, Uuid)> = builder
            .build_query_as()
            .persistent(false)
            .fetch_optional(&mut *connection)
            .await?;
        Ok(end.map(|(effective_ts, id)| Below { effective_ts, id }))
    }

    async fn page(
        &self,
        connection: &mut PgConnection,
        stream: Stream,
        below: Option<Below>,
        limit: i64,
    ) -> Result<Vec<ThreadPreviewCursorDbRow>, sqlx::Error> {
        let mut builder = self.build_page(stream, below, limit);
        builder
            .build()
            .persistent(false)
            .try_map(map_row)
            .fetch_all(&mut *connection)
            .await
    }

    /// Counts the superset's rows (a thread once per message that lists
    /// it), stopping one past `cap`.
    async fn superset_rows(
        &self,
        connection: &mut PgConnection,
        cap: i64,
        indexed: bool,
    ) -> Result<i64, sqlx::Error> {
        self.probe(cap, indexed)
            .build_query_scalar()
            .persistent(false)
            .fetch_one(&mut *connection)
            .await
    }

    fn probe(&self, cap: i64, indexed: bool) -> QueryBuilder<'static, Postgres> {
        let mut builder = QueryBuilder::new("");
        self.push_contact_ctes(&mut builder, "WITH ");
        builder.push("\n        SELECT count(*) FROM (SELECT 1 FROM (\n            ");
        let branches = if indexed {
            &self.superset.indexed_branches
        } else {
            &self.superset.branches
        };
        self.push_branches(&mut builder, branches, "UNION ALL");
        builder.push("\n        ) AS superset LIMIT ");
        builder.push_bind(cap.saturating_add(1).max(0));
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

    fn push_branches(
        &self,
        builder: &mut QueryBuilder<'static, Postgres>,
        branches: &[SqlFragment],
        operator: &str,
    ) {
        for (index, branch) in branches.iter().cloned().enumerate() {
            if index > 0 {
                builder.push(format!("\n            {operator}\n            "));
            }
            branch.push_into(builder, &self.params.user_id);
        }
    }

    /// A statement reading `limit` rows of `stream` below `below` (or the
    /// cursor).
    fn build_page(
        &self,
        stream: Stream,
        below: Option<Below>,
        limit: i64,
    ) -> QueryBuilder<'static, Postgres> {
        let sort_ts_field = get_sort_timestamp_field(self.view);
        let mut builder = QueryBuilder::new("");
        if matches!(stream, Stream::Superset | Stream::SparseSuperset) {
            self.push_contact_ctes(&mut builder, "\n        WITH ");
            let separator = if self.superset.contact_ctes.is_empty() {
                "\n        WITH "
            } else {
                ",\n        "
            };
            builder.push(format!(
                "{separator}matching_threads AS MATERIALIZED (\n            "
            ));
            let branches = if matches!(stream, Stream::SparseSuperset) {
                &self.superset.indexed_branches
            } else {
                &self.superset.branches
            };
            self.push_branches(&mut builder, branches, "UNION");
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
        self.push_stream(&mut builder, stream, below, sort_ts_field);
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
        builder.push_bind(limit);
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
        below: Option<Below>,
        sort_ts_field: &str,
    ) {
        match stream {
            Stream::Superset | Stream::SparseSuperset => {
                if matches!(stream, Stream::SparseSuperset) {
                    self.push_stream_columns(builder, sort_ts_field);
                    // A recipient lookup can change the CTE's estimate enough
                    // to scan the mailbox. Fetch the proven-small ID set first;
                    // DISTINCT keeps one thread when several messages match.
                    builder.push(
                        r#"
                    FROM (SELECT DISTINCT thread_id FROM matching_threads) matched
                    CROSS JOIN LATERAL (
                        SELECT * FROM email_threads WHERE id = matched.thread_id OFFSET 0
                    ) AS t
                    WHERE "#,
                    );
                } else {
                    self.push_stream_select(builder, sort_ts_field);
                }
                builder.push("t.link_id = ANY(");
                builder.push_bind(self.inboxes.clone());
                builder.push(")");
                if matches!(stream, Stream::Superset) {
                    builder.push(" AND t.id IN (SELECT thread_id FROM matching_threads)");
                }
                self.push_stream_filters(builder, sort_ts_field, below);
                builder.push(
                    r#"
                    ORDER BY effective_ts DESC, id DESC
                    OFFSET 0"#,
                );
            }
            Stream::Inboxes { window } => {
                // One ordered, limited index walk per inbox: `link_id =
                // ANY(…)` can't return index order, so it would read and sort
                // every thread of every inbox.
                builder.push("\n                    SELECT * FROM (");
                for (index, inbox) in self.inboxes.iter().enumerate() {
                    if index > 0 {
                        builder.push("\n                        UNION ALL");
                    }
                    builder.push("\n                        (");
                    self.push_stream_select(builder, sort_ts_field);
                    builder.push("t.link_id = ");
                    builder.push_bind(*inbox);
                    self.push_stream_filters(builder, sort_ts_field, below);
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
        self.push_stream_columns(builder, ts);
        builder.push(
            r#"
                    FROM email_threads t
                    WHERE "#,
        );
    }

    /// Shared projection for mailbox walks and matched-thread fetches.
    fn push_stream_columns(&self, builder: &mut QueryBuilder<'static, Postgres>, ts: &str) {
        builder.push(format!(
            r#"
                    SELECT t.id, t.provider_id, t.link_id, t.inbox_visible, t.is_read,
                           t.is_signal, t.project_id,
                           {ts} AS created_at, {ts} AS updated_at, {ts} AS effective_ts"#
        ));
    }

    /// The thread-level terms and the stream's start, both index conditions
    /// of its walk: `below` in a round, else the cursor after the first page.
    /// A round's `below` is a thread the cursor's condition already listed,
    /// so it replaces the cursor.
    fn push_stream_filters(
        &self,
        builder: &mut QueryBuilder<'static, Postgres>,
        ts: &str,
        below: Option<Below>,
    ) {
        self.thread_terms
            .clone()
            .push_into(builder, &self.params.user_id);
        if let Some(Below { effective_ts, id }) = below {
            builder.push(format!(" AND ({ts}, t.id) < ("));
            builder.push_bind(effective_ts);
            builder.push("::timestamptz, ");
            builder.push_bind(id);
            builder.push("::uuid)");
        } else if let Some(cursor_timestamp) = self.params.cursor_timestamp {
            builder.push(format!(" AND ({ts}, t.id) < ("));
            builder.push_bind(cursor_timestamp);
            builder.push("::timestamptz, ");
            builder.push_bind(self.params.cursor_id_str.clone());
            builder.push("::uuid)");
        }
    }
}
