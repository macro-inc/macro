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
//! - A *stream* lists threads in `(effective_ts, id)` order after applying
//!   the inbox, the filter's thread-level terms and the cursor. The *superset*
//!   stream fetches each distinct address-index match by primary key, then
//!   filters and sorts those rows (`matching_threads`, without mailbox facts),
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
//! For non-viewed sorts, the inbox stream's page is final when its window
//! filled the page; otherwise the superset stream reads it.
//!
//! ViewedUpdated instead merges saved views with never-viewed threads in
//! their respective index orders. A saved view overrides message recency,
//! even when it is older. Underfilled windows continue below their last raw
//! candidate in the same snapshot and within the same request deadline.
//! Source filters and timestamp ties can inspect more rows than a window
//! emits; the window is not a physical-work bound.

use crate::outbound::email_pg_repo::{PreviewReadError, RuleDiscoveryPort};
use crm::domain::email_rule_discovery::EmailRuleDiscoveryRequest;
use std::time::{Duration, Instant};

use filter_ast::Expr;
use item_filters::SharedEmailFilter;
use item_filters::ast::email::EmailLiteral;
use sqlx::{PgConnection, PgPool, Postgres, QueryBuilder};
use tracing::field::Empty;
use uuid::Uuid;

use super::super::SqlFragment;
use super::super::filters::{
    AddressSuperset, build_address_superset, build_thread_conjunct_filter,
    build_thread_message_exists_filter, get_sort_timestamp_field, top_level_owners,
};
use super::super::resolve::{can_short_circuit, resolve_filters_on};
use super::{
    QueryParams, begin_snapshot, build_query, dedupe_key_sql, filter_uses_view_history,
    limit_statement_time, map_row, push_page_head, push_page_tail,
};
use crate::domain::models::{PreviewView, PreviewViewStandardLabel};
use crate::outbound::email_pg_repo::db_types::ThreadPreviewCursorDbRow;

#[cfg(test)]
mod test;
mod viewed;

/// How long a Team page may run across all its statements, under the web
/// client's 12-second request timeout. The database enforces the bound even
/// if the caller disconnects.
const TEAM_READ_BUDGET: Duration = Duration::from_secs(10);

/// Resolve contributor modes, discover rules and read any Team page in one snapshot.
/// All-mail contributors skip rule discovery.
#[tracing::instrument(
    name = "crm.team_email_read",
    skip_all,
    fields(team_id = Empty, sort = %params.sort_method_str, path = Empty, rows = Empty),
    err
)]
pub(super) async fn read_team_page(
    pool: &PgPool,
    view: &PreviewView,
    email_filter: &Expr<EmailLiteral>,
    mut params: QueryParams,
    tuning: Option<TeamReadTuning>,
    discovery: Option<&RuleDiscoveryPort>,
) -> Result<Vec<ThreadPreviewCursorDbRow>, PreviewReadError> {
    let span = tracing::Span::current();
    if let Some(team_id) = params.team_id {
        span.record("team_id", tracing::field::display(team_id));
    }
    let deadline = Instant::now() + TEAM_READ_BUDGET;
    let mut transaction = begin_snapshot(pool).await.inspect_err(|_| {
        span.record("path", "resolving");
    })?;
    params.resolved = resolve_filters_on(
        &mut transaction,
        &params.link_ids,
        params.team_id,
        email_filter,
        Some(deadline),
    )
    .await
    .inspect_err(|_| {
        span.record("path", "resolving");
    })?;
    if can_short_circuit(email_filter, &params.resolved) {
        span.record("path", "empty");
        span.record("rows", 0_i64);
        transaction.commit().await?;
        return Ok(Vec::new());
    }
    #[cfg(test)]
    test::selected::pause_after_resolution(&params.resolved).await;

    let team_read = match tuning {
        Some(tuning) => TeamRead::new(view, email_filter, params, tuning),
        None => Err(Box::new(params)),
    };
    let rows = match team_read {
        Ok(read) => {
            span.record("path", "optimized");
            read.fetch(&mut transaction, deadline, discovery).await?
        }
        Err(params) => {
            span.record("path", "general");
            // A top-level Owner conjunction can exclude a selected mailbox
            // entirely. Its live growth must not block another owner's page.
            let owners = top_level_owners(email_filter);
            let selected: Vec<_> = params
                .resolved
                .selected_link_ids()
                .unwrap_or_default()
                .iter()
                .copied()
                .filter(|inbox| owners.iter().all(|owner| owner == inbox))
                .collect();
            if !selected.is_empty() {
                discovery
                    .ok_or(PreviewReadError::RuleDiscoveryUnavailable)?
                    .discover(
                        &mut transaction,
                        EmailRuleDiscoveryRequest {
                            team_id: params.team_id.ok_or(PreviewReadError::MissingTeamScope)?,
                            links: Some(selected),
                            proposed: None,
                        },
                        deadline,
                    )
                    .await?;
            }
            // Keep the page with the mode decision and discovery. A new
            // snapshot could see selected rules that were never checked, or
            // a different policy from the one whose discovery completed.
            limit_statement_time(&mut transaction, deadline).await?;
            let mut qb = build_query(view, email_filter, *params);
            qb.build()
                .persistent(false)
                .try_map(map_row)
                .fetch_all(&mut *transaction)
                .await?
        }
    };
    span.record("rows", rows.len() as i64);
    transaction.commit().await?;
    Ok(rows)
}

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
    /// Chosen on a production-size team: past 5,000 superset rows a record
    /// usually fills its page within 100 threads per row of the inboxes; a
    /// window that doesn't costs about a quarter second on a warm cache
    /// before the superset reads the page. The superset reads all its rows
    /// before the first thread, so a higher limit made records of 10,000 to
    /// 20,000 rows slower warm and, from a cold cache, overran the
    /// statement budget.
    pub(crate) const DEFAULT: Self = Self {
        superset_limit: 5_000,
        window_per_row: 100,
    };
}

/// The stream a page reads its threads from, in page order.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Stream {
    /// The threads the address indexes list for the record, sorted.
    Superset,
    /// A superset the initial capped probe found small enough for indexed lookups.
    SparseSuperset,
    /// Each inbox's newest threads, merged, up to a window.
    Inboxes,
    /// All-mail contributors' record matches plus selected contributors'
    /// positive targets. A capped probe chooses this for sparse selections.
    Selection,
    /// Viewed and never-viewed threads merged in ViewedUpdated order.
    ViewedUpdated {
        window: i64,
        below: Option<viewed::Below>,
    },
}

/// `crm_email_thread_allowed` for thread `t`, set-based: the
/// `contributing`, `team_blocked` and `personal_blocked` CTEs hold its
/// mailbox conditions and blocklists once per page instead of once per
/// participant of every thread. The separate thread-exclusion veto is an
/// indexed lookup for each candidate or competing copy. A participant
/// domain is blocked when it, or what follows any of its dots, equals a
/// blocked domain, which is the function's `right(…) = '.' || domain` test.
/// `IS TRUE` keeps the membership test a hashed subplan.
const ALLOWED_HEAD: &str = r#"
                  AND EXISTS (
                      SELECT 1 FROM contributing cb
                      WHERE cb.link_id = t.link_id
                        AND NOT crm_email_thread_excluded(cb.team_id, cb.macro_id, cb.link_id, t.id)
"#;
const ALLOWED: &str = include_str!("team_scope/allowed.sql");

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
    /// The record matches of the contributors resolved in all-mail mode.
    /// Selected inboxes enter through their positive targets instead.
    all_mail_superset: AddressSuperset,
    selected_inboxes: Vec<Uuid>,
    /// Complete discovery in this read snapshot, reused by probe and page.
    selected_contacts: Option<Vec<(Uuid, Uuid)>>,
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
        mut params: QueryParams,
        tuning: TeamReadTuning,
    ) -> Result<Self, Box<QueryParams>> {
        let covered = matches!(
            view,
            PreviewView::StandardLabel(PreviewViewStandardLabel::All)
        ) && params.sort_method_str != "viewed_at"
            && !filter_uses_view_history(email_filter)
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
        let selected_inboxes: Vec<Uuid> = params
            .resolved
            .selected_link_ids()
            .unwrap_or_default()
            .iter()
            .copied()
            .filter(|inbox| inboxes.contains(inbox))
            .collect();
        if !selected_inboxes.is_empty() {
            // Resolve record contact matches within the requested mailboxes;
            // live selected targets must not add global contact scans.
            params.resolved = params.resolved.fenced_text_matches_within(&inboxes);
        }
        let Some(superset) = build_address_superset(
            email_filter,
            &params.resolved,
            &inboxes,
            tuning.superset_limit,
        ) else {
            return Err(Box::new(params));
        };
        let all_mail_inboxes: Vec<Uuid> = inboxes
            .iter()
            .copied()
            .filter(|inbox| !selected_inboxes.contains(inbox))
            .collect();
        let all_mail_superset = if selected_inboxes.is_empty() || all_mail_inboxes.is_empty() {
            // No selection stream is needed for all-mail pages. For selected
            // pages, omit empty all-mail branches: a generic plan cannot infer
            // that a bound mailbox array is empty before reading its indexes.
            AddressSuperset {
                contact_ctes: Vec::new(),
                branches: Vec::new(),
                indexed_branches: Vec::new(),
            }
        } else if let Some(superset) = build_address_superset(
            email_filter,
            &params.resolved,
            &all_mail_inboxes,
            tuning.superset_limit,
        ) {
            superset
        } else {
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
            all_mail_superset,
            selected_inboxes,
            selected_contacts: None,
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
            selection_rows = Empty,
            stream = Empty,
            rounds = Empty,
            rows = Empty,
        ),
        err
    )]
    pub(super) async fn fetch(
        mut self,
        connection: &mut PgConnection,
        deadline: Instant,
        discovery: Option<&RuleDiscoveryPort>,
    ) -> Result<Vec<ThreadPreviewCursorDbRow>, PreviewReadError> {
        let span = tracing::Span::current();
        let (stream, rows) = if self.inboxes.is_empty() || self.superset.branches.is_empty() {
            ("none", Vec::new())
        } else {
            if !self.selected_inboxes.is_empty() {
                let complete = discovery
                    .ok_or(PreviewReadError::RuleDiscoveryUnavailable)?
                    .discover(
                        connection,
                        EmailRuleDiscoveryRequest {
                            team_id: self.team_id,
                            links: Some(self.selected_inboxes.clone()),
                            proposed: None,
                        },
                        deadline,
                    )
                    .await?;
                self.selected_contacts = Some(complete.contacts);
            }
            self.read(connection, deadline).await?
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
    ) -> Result<(&'static str, Vec<ThreadPreviewCursorDbRow>), PreviewReadError> {
        // A sparse selected policy can be much smaller than the CRM record's
        // mailbox history. Resolve that bounded stream before probing the
        // record, including when its only selected thread is far in the past.
        if !self.selected_inboxes.is_empty() {
            limit_statement_time(connection, deadline).await?;
            let selection_rows: i64 = self
                .selection_probe()?
                .build_query_scalar()
                .persistent(false)
                .fetch_one(&mut *connection)
                .await?;
            tracing::Span::current().record("selection_rows", selection_rows);
            if selection_rows <= self.tuning.superset_limit {
                let rows = self.page(connection, deadline, Stream::Selection).await?;
                return Ok(("selection", rows));
            }
        }
        limit_statement_time(connection, deadline).await?;
        let superset_rows: i64 = self
            .probe()
            .build_query_scalar()
            .persistent(false)
            .fetch_one(&mut *connection)
            .await?;
        tracing::Span::current().record("superset_rows", superset_rows);
        #[cfg(test)]
        test::pause_after_probe(superset_rows).await;
        if superset_rows <= self.tuning.superset_limit {
            let rows = self
                .page(connection, deadline, Stream::SparseSuperset)
                .await?;
            return Ok(("superset", rows));
        }
        if self.viewed_updated() {
            let rows = self.read_viewed(connection, deadline).await?;
            return Ok(("viewed_updated", rows));
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
    ) -> Result<Vec<ThreadPreviewCursorDbRow>, PreviewReadError> {
        self.page_with_limit(connection, deadline, stream, self.params.query_limit)
            .await
    }

    async fn page_with_limit(
        &self,
        connection: &mut PgConnection,
        deadline: Instant,
        stream: Stream,
        limit: i64,
    ) -> Result<Vec<ThreadPreviewCursorDbRow>, PreviewReadError> {
        limit_statement_time(connection, deadline).await?;
        let mut builder = self.build_page_with_limit(stream, limit)?;
        Ok(builder
            .build()
            .persistent(false)
            .try_map(map_row)
            .fetch_all(&mut *connection)
            .await?)
    }

    /// Counts the superset's rows (a thread once per message that lists
    /// it), stopping one past `superset_limit`.
    fn probe(&self) -> QueryBuilder<'static, Postgres> {
        let mut builder = QueryBuilder::new("");
        let AddressSuperset {
            contact_ctes,
            indexed_branches: branches,
            ..
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

    /// A sparse selected policy must not walk every record-matching thread
    /// to discover the few it includes. Probe its positive target indexes,
    /// together with the all-mail contributors' ordinary record superset.
    fn selection_probe(&self) -> Result<QueryBuilder<'static, Postgres>, PreviewReadError> {
        let mut builder = QueryBuilder::new("");
        self.push_ctes(&mut builder, Stream::Inboxes)?;
        self.push_selection_contacts(&mut builder)?;
        builder.push(" SELECT count(*) FROM (SELECT 1 FROM (");
        self.push_selection_threads(&mut builder);
        builder.push(") AS selected_matches LIMIT ");
        builder.push_bind(self.tuning.superset_limit.saturating_add(1).max(0));
        builder.push(") AS capped");
        Ok(builder)
    }

    fn push_selection_contacts(
        &self,
        builder: &mut QueryBuilder<'static, Postgres>,
    ) -> Result<(), PreviewReadError> {
        if let Some(contacts) = &self.selected_contacts {
            builder.push(", selected_email_contacts AS MATERIALIZED (SELECT * FROM unnest(");
            builder.push_bind(contacts.iter().map(|(link, _)| *link).collect::<Vec<_>>());
            builder.push("::uuid[], ");
            builder.push_bind(contacts.iter().map(|(_, id)| *id).collect::<Vec<_>>());
            builder.push("::uuid[]) AS contact(link_id, id))");
        } else {
            return Err(PreviewReadError::IncompleteRuleDiscovery);
        }
        for (name, body) in self.all_mail_superset.contact_ctes.clone() {
            builder.push(format!(",\n        {name} AS MATERIALIZED (\n            "));
            body.push_into(builder, &self.params.user_id);
            builder.push("\n        )");
        }
        Ok(())
    }

    fn push_selection_threads(&self, builder: &mut QueryBuilder<'static, Postgres>) {
        if !self.all_mail_superset.branches.is_empty() {
            self.push_branches(
                builder,
                self.all_mail_superset.indexed_branches.clone(),
                "UNION ALL",
            );
            builder.push("\n UNION ALL\n ");
        }
        builder.push(include_str!("team_scope/selection_threads.sql"));
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

    #[cfg(test)]
    fn build_page(
        &self,
        stream: Stream,
    ) -> Result<QueryBuilder<'static, Postgres>, PreviewReadError> {
        self.build_page_with_limit(stream, self.params.query_limit)
    }

    fn build_page_with_limit(
        &self,
        stream: Stream,
        limit: i64,
    ) -> Result<QueryBuilder<'static, Postgres>, PreviewReadError> {
        let sort_ts_field = get_sort_timestamp_field(self.view);
        let mut builder = QueryBuilder::new("");
        self.push_ctes(&mut builder, stream)?;
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
        // the ORDER BY, already the stream's, keeps it from sorting. They
        // read only the thread's id and inbox, which the stream already
        // holds, so no thread is fetched again.
        builder.push(
            r#"
                ) AS stream
                WHERE EXISTS (
                    SELECT 1 FROM (SELECT stream.id, stream.link_id) AS t
                    WHERE TRUE"#,
        );
        self.push_checks(&mut builder);
        // A better copy is any copy in the inboxes that passes the same
        // checks, listed by this stream or not. The superset stream lists
        // every such copy, but only because a message lists only its own
        // inbox's contacts; a message naming another inbox's contact would
        // let a copy the superset misses hide this one
        // (docs/CRM_EMAIL_PRIVACY.md).
        // Fetch each copy by primary key before dedupe or privacy checks.
        // Stale statistics can otherwise rescan the mailbox and repeat
        // root-message lookups for each returned row.
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
                CROSS JOIN LATERAL (
                    SELECT * FROM email_threads WHERE id = copy.id OFFSET 0
                ) AS t"#
        ));
        if self.viewed_updated() {
            viewed::push_history(&mut builder);
        }
        builder.push("\n                WHERE t.id <> ranked.id AND t.link_id = ANY(");
        builder.push_bind(self.inboxes.clone());
        builder.push(")");
        self.thread_terms
            .clone()
            .push_into(&mut builder, &self.params.user_id);
        builder.push("\n                  AND (t.link_id = ANY(");
        builder.push_bind(self.params.link_ids.clone());
        let copy_timestamp = self.effective_timestamp(sort_ts_field);
        builder.push(format!(
            r#"), {copy_timestamp}, t.id)
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
        builder.push_bind(limit);
        push_page_tail(
            &mut builder,
            self.view,
            self.email_filter,
            &self.params,
            true,
        );
        Ok(builder)
    }

    /// The `WITH` list: the privacy rule's mailboxes and blocklists, and for
    /// the superset stream the record's threads.
    fn push_ctes(
        &self,
        builder: &mut QueryBuilder<'static, Postgres>,
        stream: Stream,
    ) -> Result<(), PreviewReadError> {
        builder.push(
            r#"
        WITH contributing AS MATERIALIZED (
            SELECT consent.team_id, l.id AS link_id, l.macro_id"#,
        );
        if !self.selected_inboxes.is_empty() {
            builder.push(",\n                   consent.mode, consent.active_rule_revision, member.team_role");
        }
        builder.push(
            r#"
            FROM email_links l
            JOIN crm_email_consent consent
              ON consent.team_id = "#,
        );
        builder.push_bind(self.team_id);
        builder.push(
            r#" AND consent.user_id = l.macro_id
             AND consent.link_id = l.id AND "#,
        );
        builder.push(if self.selected_inboxes.is_empty() {
            "consent.enabled"
        } else {
            "(consent.enabled OR consent.selected_enabled)"
        });
        builder.push(
            r#"
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
        // Domain writes always use their company's immutable team. Preserve
        // the existing all-mail SQL; selected reads also state that invariant.
        if !self.selected_inboxes.is_empty() {
            builder.push(" AND c.team_id = d.team_id");
        }
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
        if !self.selected_inboxes.is_empty() {
            builder.push(include_str!("team_scope/selected_targets.sql"));
        }
        if matches!(stream, Stream::Superset | Stream::SparseSuperset) {
            let AddressSuperset {
                contact_ctes,
                branches,
                indexed_branches,
            } = self.superset.clone();
            let branches = if stream == Stream::SparseSuperset {
                indexed_branches
            } else {
                branches
            };
            for (name, body) in contact_ctes {
                builder.push(format!(",\n        {name} AS MATERIALIZED (\n            "));
                body.push_into(builder, &self.params.user_id);
                builder.push("\n        )");
            }
            builder.push(",\n        matching_threads AS MATERIALIZED (\n            ");
            self.push_branches(builder, branches, "UNION");
            builder.push("\n        )");
        } else if stream == Stream::Selection {
            self.push_selection_contacts(builder)?;
            builder.push(", matching_threads AS MATERIALIZED (SELECT DISTINCT thread_id FROM (");
            self.push_selection_threads(builder);
            builder.push(") AS selected_matches)");
        }
        Ok(())
    }

    fn push_stream(
        &self,
        builder: &mut QueryBuilder<'static, Postgres>,
        stream: Stream,
        sort_ts_field: &str,
    ) {
        match stream {
            Stream::Superset | Stream::SparseSuperset | Stream::Selection => {
                // A single address branch can list a thread once per message;
                // preserve ANY's set semantics before fetching by primary key.
                // The fence keeps stale statistics from turning the IDs
                // into a filter over every thread in the contributing inboxes.
                self.push_stream_columns(builder, sort_ts_field);
                builder.push(
                    r#"
                    FROM (SELECT DISTINCT thread_id FROM matching_threads) matched
                    CROSS JOIN LATERAL (
                        SELECT * FROM email_threads WHERE id = matched.thread_id OFFSET 0
                    ) AS t"#,
                );
                if self.viewed_updated() {
                    viewed::push_history(builder);
                }
                builder.push("\n                    WHERE t.link_id = ANY(");
                builder.push_bind(self.inboxes.clone());
                builder.push(")");
                self.push_stream_filters(builder, self.effective_timestamp(sort_ts_field));
                builder.push(
                    r#"
                    ORDER BY effective_ts DESC, id DESC
                    OFFSET 0"#,
                );
            }
            Stream::Inboxes => {
                if self.viewed_updated() {
                    self.push_viewed_stream(
                        builder,
                        self.params
                            .query_limit
                            .saturating_mul(self.tuning.window_per_row)
                            .max(1),
                        None,
                    );
                    return;
                }
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
                    self.push_stream_columns(builder, sort_ts_field);
                    builder.push(
                        r#"
                    FROM email_threads t
                    WHERE t.link_id = "#,
                    );
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
            Stream::ViewedUpdated { window, below } => {
                self.push_viewed_stream(builder, window, below);
            }
        }
    }

    /// A stream's projected columns, before its source.
    fn push_stream_columns(&self, builder: &mut QueryBuilder<'static, Postgres>, ts: &str) {
        self.push_stream_columns_with_sort(builder, ts, self.effective_timestamp(ts));
    }

    fn push_stream_columns_with_sort(
        &self,
        builder: &mut QueryBuilder<'static, Postgres>,
        ts: &str,
        effective_ts: &str,
    ) {
        builder.push(format!(
            r#"
                    SELECT t.id, t.provider_id, t.link_id, t.inbox_visible, t.is_read,
                           t.is_signal, t.project_id,
                           {ts} AS created_at, {ts} AS updated_at, {effective_ts} AS effective_ts"#
        ));
    }

    /// The thread-level terms and, after the first page, the cursor. Inbox
    /// walks can use their index; matched threads apply them after the ID lookup.
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
        self.push_allowed(builder);
    }

    fn push_allowed(&self, builder: &mut QueryBuilder<'static, Postgres>) {
        if !self.selected_inboxes.is_empty() {
            // Inclusion and exclusions inspect the same full thread. Share
            // its participants so long threads are not expanded twice for
            // each candidate or competing copy. All-mail-only SQL is unchanged.
            builder.push(include_str!("team_scope/selected_participants.sql"));
            builder.push(include_str!("team_scope/selected_match.sql"));
            builder.push(include_str!("team_scope/selected_allowed.sql").trim_end());
        } else {
            builder.push(ALLOWED_HEAD);
            builder.push(ALLOWED.trim_end());
        }
    }
}
