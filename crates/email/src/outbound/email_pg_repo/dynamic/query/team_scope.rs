//! A CRM record's Emails tab in its Team view: the All Mail threads of every
//! contributing teammate's inbox that touch a company's domains or a
//! contact's addresses, one row per conversation, newest first.
//!
//! The general builder sorts every matching thread in the team, checks the
//! privacy rule on each before its LIMIT and dedupes the copies after, so a
//! domain that covers most of a mailbox ran into the statement timeout on
//! every page. [`TeamRead`] reads the same page in page order and stops when
//! it is full:
//!
//! - A *stream* lists threads in `(effective_ts, id)` order with only the
//!   conditions an index serves: the inbox, the filter's thread-level terms
//!   and the cursor. The *superset* stream sorts the threads the address
//!   indexes list for the record (`matching_threads`, without mailbox facts),
//!   which is cheap when the record is rare in the team's mail. The *inbox*
//!   stream merges each inbox's newest threads from
//!   `idx_email_threads_non_spam_link_ts_id`, up to a window of
//!   `limit × window_per_row`, which is cheap when the record is common.
//! - Each streamed thread then gets the full message match and the privacy
//!   rule, in order, until the page fills.
//! - A thread stays only when no better copy of its conversation (the
//!   caller's own inbox first, then the newest, then the highest id) passes
//!   the same checks. The representative never depends on the cursor, so
//!   pages neither repeat nor skip a conversation.
//!
//! A probe counts the superset up to `superset_limit` to choose the stream.
//! The inbox stream's page is final when its window filled the page;
//! otherwise the superset stream reads it.

use std::time::Instant;

use filter_ast::Expr;
use item_filters::SharedEmailFilter;
use item_filters::ast::email::EmailLiteral;
use sqlx::{PgConnection, Postgres, QueryBuilder};
use tracing::field::Empty;
use uuid::Uuid;

use super::super::SqlFragment;
use super::super::filters::{
    AddressSuperset, build_address_superset, build_thread_conjunct_filter,
    build_thread_message_exists_filter, get_sort_timestamp_field, top_level_owners,
};
use super::{
    QueryParams, dedupe_key_sql, limit_statement_time, map_row, push_page_head, push_page_tail,
    uses_view_history,
};
use crate::domain::models::{PreviewView, PreviewViewStandardLabel};
use crate::outbound::email_pg_repo::db_types::ThreadPreviewCursorDbRow;

#[cfg(test)]
mod test;

/// Where [`TeamRead`] switches streams.
#[derive(Clone, Copy, Debug)]
pub(crate) struct TeamReadTuning {
    /// The most superset rows the superset stream reads first. Past it the
    /// inbox stream reads first.
    pub(crate) superset_limit: i64,
    /// The inbox stream's window, in threads per page row.
    pub(crate) window_per_row: i64,
}

impl TeamReadTuning {
    pub(crate) const DEFAULT: Self = Self {
        superset_limit: 5_000,
        window_per_row: 20,
    };
}

/// The stream a page reads its threads from, in page order.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Stream {
    /// The threads the address indexes list for the record, sorted.
    Superset,
    /// Each inbox's newest threads, merged, up to a window.
    Inboxes,
}

/// `crm_email_thread_allowed` for thread `t`, set-based: the
/// `contributing`, `team_blocked` and `personal_blocked` CTEs hold its
/// mailbox conditions and blocklists once per page instead of once per
/// participant of every thread. A participant
/// domain is blocked when it, or what follows any of its dots, equals a
/// blocked domain, which is the function's `right(…) = '.' || domain` test.
/// `IS TRUE` keeps the membership test a hashed subplan.
const ALLOWED: &str = r#"
                  AND EXISTS (
                      SELECT 1 FROM contributing cb
                      WHERE cb.link_id = t.link_id
                        AND EXISTS (
                            SELECT 1 FROM email_messages pm
                            WHERE pm.thread_id = t.id AND NOT pm.is_draft
                        )
                        AND NOT EXISTS (
                            SELECT 1 FROM (
                                SELECT lower(split_part(pc.email_address, '@', 2)) AS domain
                                FROM email_messages pm
                                JOIN email_contacts pc ON pc.id = pm.from_contact_id
                                WHERE pm.thread_id = t.id AND NOT pm.is_draft
                                UNION
                                SELECT lower(split_part(pc.email_address, '@', 2))
                                FROM email_messages pm
                                JOIN email_message_recipients pr ON pr.message_id = pm.id
                                JOIN email_contacts pc ON pc.id = pr.contact_id
                                WHERE pm.thread_id = t.id AND NOT pm.is_draft
                            ) participant
                            CROSS JOIN LATERAL (
                                SELECT participant.domain AS suffix
                                UNION ALL
                                SELECT substr(participant.domain, dot + 1)
                                FROM generate_series(1, length(participant.domain)) dot
                                WHERE substr(participant.domain, dot, 1) = '.'
                            ) suffix
                            WHERE (suffix.suffix IN (SELECT suffix FROM team_blocked)) IS TRUE
                               OR ((cb.macro_id, suffix.suffix)
                                   IN (SELECT macro_id, suffix FROM personal_blocked)) IS TRUE
                        )
                  )"#;

/// A thread whose own id is its dedupe key (it has no root Message-ID) is a
/// copy of a conversation keyed by that id's text.
const UUID_TEXT: &str = "'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'";

/// A team-scoped All Mail page for one CRM record. See the module docs.
pub(super) struct TeamRead<'a> {
    view: &'a PreviewView,
    email_filter: &'a Expr<EmailLiteral>,
    params: QueryParams,
    tuning: TeamReadTuning,
    team_id: Uuid,
    /// The contributing inboxes the filter's top-level `Owner` terms allow.
    inboxes: Vec<Uuid>,
    superset: AddressSuperset,
    /// The full message match on `t`, `build_thread_message_exists_filter`.
    message_match: SqlFragment,
    /// The filter's top-level thread-level terms on `t`, which the streams
    /// apply as they read.
    thread_terms: SqlFragment,
}

impl<'a> TeamRead<'a> {
    /// A read for a team-scoped All Mail request whose filter has one
    /// positive OR-tree of addresses (a CRM record) among its top-level
    /// terms; other requests get their params back.
    pub(super) fn new(
        view: &'a PreviewView,
        email_filter: &'a Expr<EmailLiteral>,
        params: QueryParams,
        tuning: TeamReadTuning,
    ) -> Result<Self, Box<QueryParams>> {
        let covered = matches!(
            view,
            PreviewView::StandardLabel(PreviewViewStandardLabel::All)
        ) && !uses_view_history(email_filter, &params.sort_method_str)
            && matches!(params.shared, SharedEmailFilter::Exclude)
            && params.project_scope.is_none();
        let team_id = match params.team_id {
            Some(team_id) if covered => team_id,
            _ => return Err(Box::new(params)),
        };
        let owners = top_level_owners(email_filter);
        let inboxes: Option<Vec<Uuid>> = params.resolved.contributing_link_ids().map(|links| {
            links
                .iter()
                .copied()
                .filter(|inbox| owners.iter().all(|owner| owner == inbox))
                .collect()
        });
        let Some(inboxes) = inboxes else {
            return Err(Box::new(params));
        };
        let Some(superset) = build_address_superset(email_filter, &params.resolved, &inboxes)
        else {
            return Err(Box::new(params));
        };
        let sort_ts_field = get_sort_timestamp_field(view);
        Ok(Self {
            view,
            email_filter,
            message_match: build_thread_message_exists_filter(email_filter, view, &params.resolved),
            thread_terms: build_thread_conjunct_filter(email_filter, sort_ts_field),
            params,
            tuning,
            team_id,
            inboxes,
            superset,
        })
    }

    /// Reads the page, each statement bounded by what is left until
    /// `deadline`.
    #[tracing::instrument(
        name = "crm.team_emails",
        skip_all,
        fields(
            team_id = %self.team_id,
            inboxes = self.inboxes.len(),
            superset_rows = Empty,
            stream = Empty,
            rows = Empty,
        ),
        err
    )]
    pub(super) async fn fetch(
        self,
        connection: &mut PgConnection,
        deadline: Instant,
    ) -> Result<Vec<ThreadPreviewCursorDbRow>, sqlx::Error> {
        let span = tracing::Span::current();
        let (stream, rows) = if self.inboxes.is_empty() {
            ("none", Vec::new())
        } else {
            limit_statement_time(connection, deadline).await?;
            let superset_rows: i64 = self
                .probe()
                .build_query_scalar()
                .persistent(false)
                .fetch_one(&mut *connection)
                .await?;
            span.record("superset_rows", superset_rows);
            self.read(connection, deadline, superset_rows).await?
        };
        span.record("stream", stream);
        span.record("rows", rows.len());
        Ok(rows)
    }

    /// The page and the streams that read it.
    async fn read(
        &self,
        connection: &mut PgConnection,
        deadline: Instant,
        superset_rows: i64,
    ) -> Result<(&'static str, Vec<ThreadPreviewCursorDbRow>), sqlx::Error> {
        if superset_rows <= self.tuning.superset_limit {
            let rows = self.page(connection, deadline, Stream::Superset).await?;
            return Ok(("superset", rows));
        }
        let rows = self.page(connection, deadline, Stream::Inboxes).await?;
        if rows.len() as i64 >= self.params.query_limit {
            return Ok(("inboxes", rows));
        }
        let rows = self.page(connection, deadline, Stream::Superset).await?;
        Ok(("inboxes_then_superset", rows))
    }

    async fn page(
        &self,
        connection: &mut PgConnection,
        deadline: Instant,
        stream: Stream,
    ) -> Result<Vec<ThreadPreviewCursorDbRow>, sqlx::Error> {
        limit_statement_time(connection, deadline).await?;
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
        let AddressSuperset {
            contact_ctes,
            branches,
        } = self.superset.clone();
        let mut separator = "WITH ";
        for (name, body) in contact_ctes {
            builder.push(format!("{separator}{name} AS MATERIALIZED (\n            "));
            body.push_into(&mut builder, &self.params.user_id);
            builder.push("\n        )");
            separator = ",\n        ";
        }
        builder.push("\n        SELECT count(*) FROM (SELECT 1 FROM (\n            ");
        self.push_branches(&mut builder, branches, "UNION ALL");
        builder.push("\n        ) AS superset LIMIT ");
        builder.push_bind(self.tuning.superset_limit.saturating_add(1));
        builder.push(") AS capped");
        builder
    }

    fn push_branches(
        &self,
        builder: &mut QueryBuilder<'static, Postgres>,
        branches: Vec<SqlFragment>,
        operator: &str,
    ) {
        for (index, branch) in branches.into_iter().enumerate() {
            if index > 0 {
                builder.push(format!("\n            {operator}\n            "));
            }
            branch.push_into(builder, &self.params.user_id);
        }
    }

    fn build_page(&self, stream: Stream) -> QueryBuilder<'static, Postgres> {
        let sort_ts_field = get_sort_timestamp_field(self.view);
        let mut builder = QueryBuilder::new("");
        self.push_ctes(&mut builder, stream);
        push_page_head(&mut builder, &self.params, true);
        builder.push(format!(
            r#"
            SELECT ranked.* FROM (
                SELECT stream.*,
                    {} AS dedupe_key,
                    stream.link_id = ANY("#,
            dedupe_key_sql("stream")
        ));
        builder.push_bind(self.params.link_ids.clone());
        builder.push(
            r#") AS is_own_link
                FROM ("#,
        );
        self.push_stream(&mut builder, stream, sort_ts_field);
        // The checks run per streamed thread, in order: `OFFSET 0` keeps the
        // planner from turning them into a join over the whole stream, and
        // the ORDER BY, already the stream's, keeps it from sorting.
        builder.push(
            r#"
                ) AS stream
                WHERE EXISTS (
                    SELECT 1 FROM email_threads t
                    WHERE t.id = stream.id"#,
        );
        self.push_checks(&mut builder);
        builder.push(
            r#"
                    OFFSET 0
                )
                ORDER BY stream.effective_ts DESC, stream.id DESC
                OFFSET 0
            ) AS ranked
            WHERE NOT EXISTS (
                SELECT 1 FROM (
                    SELECT km.thread_id AS id FROM email_messages km
                    WHERE km.link_id = ANY("#,
        );
        builder.push_bind(self.inboxes.clone());
        builder.push(format!(
            r#")
                      AND km.global_id = ranked.dedupe_key AND NOT km.is_draft
                    UNION ALL
                    SELECT CASE WHEN ranked.dedupe_key ~ {UUID_TEXT}
                                THEN ranked.dedupe_key::uuid END
                ) AS copy
                JOIN email_threads t ON t.id = copy.id
                WHERE t.id <> ranked.id AND t.link_id = ANY("#
        ));
        builder.push_bind(self.inboxes.clone());
        builder.push(")");
        self.thread_terms
            .clone()
            .push_into(&mut builder, &self.params.user_id);
        builder.push("\n                  AND (t.link_id = ANY(");
        builder.push_bind(self.params.link_ids.clone());
        builder.push(format!(
            r#"), {sort_ts_field}, t.id)
                      > (ranked.is_own_link, ranked.effective_ts, ranked.id)
                  AND {} = ranked.dedupe_key"#,
            dedupe_key_sql("t")
        ));
        self.push_checks(&mut builder);
        builder.push(
            r#"
                OFFSET 0
            )
            ORDER BY ranked.effective_ts DESC, ranked.id DESC
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

    /// The `WITH` list: the privacy rule's mailboxes and blocklists, and for
    /// the superset stream the record's threads.
    fn push_ctes(&self, builder: &mut QueryBuilder<'static, Postgres>, stream: Stream) {
        builder.push(
            r#"
        WITH contributing AS MATERIALIZED (
            SELECT l.id AS link_id, l.macro_id
            FROM email_links l
            JOIN crm_email_consent consent
              ON consent.team_id = "#,
        );
        builder.push_bind(self.team_id);
        builder.push(
            r#" AND consent.user_id = l.macro_id
             AND consent.link_id = l.id AND consent.enabled
            JOIN team_user member ON member.team_id = "#,
        );
        builder.push_bind(self.team_id);
        builder.push(
            r#" AND member.user_id = l.macro_id
            WHERE l.id = ANY("#,
        );
        builder.push_bind(self.inboxes.clone());
        builder.push(
            r#") AND l.is_primary AND l.deleting_at IS NULL
        ),
        team_blocked AS MATERIALIZED (
            SELECT lower(domain) AS suffix FROM crm_blocked_domains WHERE team_id = "#,
        );
        builder.push_bind(self.team_id);
        builder.push(
            r#"
            UNION ALL
            SELECT lower(d.domain) FROM crm_domains d
            JOIN crm_companies c ON c.id = d.company_id
            WHERE d.team_id = "#,
        );
        builder.push_bind(self.team_id);
        builder.push(
            r#" AND NOT c.email_sync
        ),
        personal_blocked AS MATERIALIZED (
            SELECT b.user_id AS macro_id, lower(b.domain) AS suffix
            FROM crm_personal_email_blocklist b
            WHERE b.team_id = "#,
        );
        builder.push_bind(self.team_id);
        builder.push(
            r#" AND b.user_id IN (SELECT macro_id FROM contributing)
        )"#,
        );
        if stream == Stream::Superset {
            let AddressSuperset {
                contact_ctes,
                branches,
            } = self.superset.clone();
            for (name, body) in contact_ctes {
                builder.push(format!(",\n        {name} AS MATERIALIZED (\n            "));
                body.push_into(builder, &self.params.user_id);
                builder.push("\n        )");
            }
            builder.push(",\n        matching_threads AS MATERIALIZED (\n            ");
            self.push_branches(builder, branches, "UNION");
            builder.push("\n        )");
        }
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
                let window = self
                    .params
                    .query_limit
                    .saturating_mul(self.tuning.window_per_row);
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

    /// A stream's columns, up to its `WHERE`.
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

    /// The message match and the privacy rule on `t`.
    fn push_checks(&self, builder: &mut QueryBuilder<'static, Postgres>) {
        self.message_match
            .clone()
            .push_into(builder, &self.params.user_id);
        builder.push(ALLOWED);
    }
}
