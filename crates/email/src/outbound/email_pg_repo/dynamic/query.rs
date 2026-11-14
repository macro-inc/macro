mod team_scope;

use super::filters::*;
use super::resolve::{ResolvedFilters, can_short_circuit, resolve_filters};
use crate::domain::models::{PreviewView, PreviewViewStandardLabel};
use crate::outbound::email_pg_repo::db_types::*;
use chrono::{DateTime, Utc};
use entity_access::outbound::get_user_source_ids;
use filter_ast::Expr;
use item_filters::SharedEmailFilter;
use item_filters::ast::email::EmailLiteral;
use macro_user_id::user_id::MacroUserIdStr;
use models_pagination::{Query, SimpleSortMethod};
use recursion::CollapsibleExt;
use sqlx::postgres::PgRow;
use sqlx::{PgConnection, PgPool, Postgres, QueryBuilder, Row};
use std::sync::Arc;
use std::time::{Duration, Instant};
use team_scope::TeamRead;
pub(crate) use team_scope::TeamReadTuning;
use uuid::Uuid;

struct QueryParams {
    link_ids: Vec<Uuid>,
    sort_method_str: String,
    query_limit: i64,
    cursor_timestamp: Option<DateTime<Utc>>,
    cursor_id_str: Option<String>,
    is_important: bool,
    shared: SharedEmailFilter,
    user_id: String,
    resolved: ResolvedFilters,
    /// When `Some(team_id)`, the "Owned" candidate source expands from
    /// `t.link_id = ANY($link_ids)` to `t.link_id IN (primary links of every
    /// member of $team_id)`. A link is primary when its `email_address` is
    /// the owning member's own macro_id email — connected secondary
    /// mailboxes never feed team-scoped results. Set only after CRM scope
    /// has been validated upstream.
    /// Also switches the candidate select into dedupe mode: team-member
    /// copies of the same conversation collapse to one row (see
    /// [`build_query`]).
    team_id: Option<Uuid>,
    /// When `Some`, a project-scoped candidate source is UNIONed in: every
    /// thread with this `project_id`, gated on the caller's entity_access
    /// sources granting access to the project itself. Set only when the
    /// filter AST carries a (non-negated) `ProjectId` literal.
    project_scope: Option<ProjectScope>,
}

/// See [`QueryParams::project_scope`].
struct ProjectScope {
    project_ids: Vec<String>,
    source_ids: Vec<String>,
}

#[derive(Clone, Copy)]
enum ThreadCandidateSource {
    Owned,
    Shared,
    Project,
}

/// `email_user_history` (`uh`) only drives ordering/cursoring for the
/// viewed-based sort modes. For every other mode it supplies just the
/// `viewed_at` output column, so the join can be deferred until after the
/// candidate `LIMIT` — joining once per returned row instead of once per
/// candidate thread. Returns true when the join must stay in the candidate
/// stage (i.e. it cannot be deferred).
fn sort_uses_view_history(sort_method_str: &str) -> bool {
    matches!(sort_method_str, "viewed_at" | "viewed_updated")
}

/// A viewed_at predicate also requires the caller-specific history row in
/// the candidate stage, even when ordering uses a non-viewed timestamp.
fn filter_uses_view_history(ast: &Expr<EmailLiteral>) -> bool {
    ast.collapse_frames(|frame| match frame {
        filter_ast::ExprFrame::And(a, b) | filter_ast::ExprFrame::Or(a, b) => a || b,
        filter_ast::ExprFrame::Not(a) => a,
        filter_ast::ExprFrame::Literal(EmailLiteral::ViewedAt(_)) => true,
        filter_ast::ExprFrame::Literal(_) => false,
    })
}

fn uses_view_history(ast: &Expr<EmailLiteral>, sort_method_str: &str) -> bool {
    sort_uses_view_history(sort_method_str) || filter_uses_view_history(ast)
}

/// Pushes the `user_source_ids AS (…), SharedEmailThreads AS (…)` CTE pair
/// (without the leading `WITH` keyword and without trailing comma) into the
/// builder. Caller is responsible for emitting the `WITH` keyword and any
/// commas between sibling CTEs.
fn push_shared_cte(builder: &mut QueryBuilder<'static, Postgres>, params: &QueryParams) {
    builder.push(
        r#"user_source_ids AS (
            SELECT cp.channel_id::text as source_id FROM comms_channel_participants cp
                WHERE cp.user_id = "#,
    );
    builder.push_bind(params.user_id.clone());
    builder.push(
        r#" AND cp.left_at IS NULL
            UNION ALL
            SELECT t.team_id::text FROM team_user t
                WHERE t.user_id = "#,
    );
    builder.push_bind(params.user_id.clone());
    builder.push(
        r#"
            UNION ALL
            SELECT "#,
    );
    builder.push_bind(params.user_id.clone());
    builder.push(
        r#"
        ),
        SharedEmailThreads AS (
            SELECT entity_id AS thread_id
            FROM entity_access
            WHERE source_id = ANY(SELECT source_id FROM user_source_ids)
              AND entity_type = 'email_thread'
        )"#,
    );
}

/// Which inbox predicate an Owned candidate scan applies.
#[derive(Clone, Copy)]
enum LinkScope {
    /// `t.link_id = ANY(link_ids)`, or the team's links when team-scoped.
    All,
    /// One inbox of the `unnest` fanout.
    Lateral,
    /// One inbox as a bound value, so the planner reads its own statistics.
    Bound(Uuid),
}

/// True when a top-level subject term splits each owned inbox's scan in
/// two (see push_thread_candidate_select). Folder views sort on their
/// folder subquery's date, which the second step cannot read.
fn uses_subject_subscans(view: &PreviewView, email_filter: &Expr<EmailLiteral>) -> bool {
    !super::folders::is_folder(view) && build_subject_prefilter(email_filter).is_some()
}

fn push_source_scope(
    builder: &mut QueryBuilder<'static, Postgres>,
    params: &QueryParams,
    source: ThreadCandidateSource,
    links: LinkScope,
) {
    match source {
        ThreadCandidateSource::Owned => match params.team_id {
            // Normal per-mailbox query.
            None => match links {
                LinkScope::All => {
                    builder.push("t.link_id = ANY(");
                    builder.push_bind(params.link_ids.clone());
                    builder.push(")");
                }
                LinkScope::Lateral => {
                    builder.push("t.link_id = links.link_id");
                }
                LinkScope::Bound(link_id) => {
                    builder.push("t.link_id = ");
                    builder.push_bind(link_id);
                }
            },
            // CRM-scoped query: expand to every primary email_link owned by
            // any member of the team. Non-primary links (connected secondary
            // mailboxes, whose address differs from the owner's macro_id
            // email) are excluded. The receipt has already been validated
            // upstream, so the team_id is trusted here.
            //
            // resolve_filters pre-resolves the team's primary link ids: the
            // ANY probe gives the planner a tight static link set, and the
            // membership subquery revalidates it at execution time so a
            // member or link removed between resolve_filters and this query
            // can't leak threads (same belt-and-suspenders rationale as the
            // per-thread consent check below). The subquery alone remains as a
            // fallback for resolutions that didn't carry team links.
            Some(team_id) => {
                if let Some(team_links) = params.resolved.team_link_ids() {
                    builder.push("t.link_id = ANY(");
                    builder.push_bind(team_links.to_vec());
                    builder.push(") AND ");
                }
                builder.push(
                    r#"t.link_id IN (
                        SELECT el.id
                        FROM email_links el
                        JOIN team_user tu ON tu.user_id = el.macro_id
                        WHERE tu.team_id = "#,
                );
                builder.push_bind(team_id);
                builder.push(" AND el.is_primary)");
            }
        },
        ThreadCandidateSource::Shared => {
            builder.push("t.id IN (SELECT thread_id FROM SharedEmailThreads)");
        }
        // All threads in the requested projects, across every inbox — each
        // row gated on the caller's sources having an entity_access grant
        // on that row's project (same check as thread_access.rs Source 3).
        ThreadCandidateSource::Project => {
            let scope = params
                .project_scope
                .as_ref()
                .expect("Project candidate source requires project_scope");
            builder.push("t.project_id = ANY(");
            builder.push_bind(scope.project_ids.clone());
            builder.push(
                r#") AND EXISTS (
                        SELECT 1 FROM entity_access pea
                        WHERE pea.entity_id::text = t.project_id
                          AND pea.entity_type = 'project'
                          AND pea.source_id = ANY("#,
            );
            builder.push_bind(scope.source_ids.clone());
            builder.push("))");
            // Shared=Only means "not my own threads" — keep the project
            // widening for teammates' threads but exclude the caller's.
            if matches!(params.shared, SharedEmailFilter::Only) {
                builder.push(" AND NOT (t.link_id = ANY(");
                builder.push_bind(params.link_ids.clone());
                builder.push("))");
            }
        }
    }
}

/// True when the candidates are exactly the returned rows: one per-link
/// index walk that stops at the page LIMIT. Each thread's preview message
/// is then picked while the thread is scanned, and that pick both filters
/// the candidate and supplies its preview, replacing the candidate EXISTS
/// and a second pick after the LIMIT. With several links, or branches that
/// sort their whole candidate set (team, shared, project, folders, or a
/// view-history sort), most
/// candidates are discarded, and fetching their previews costs more than
/// the second pick saves. Subject subscans match after ordering instead.
fn picks_preview_in_candidates(
    view: &PreviewView,
    email_filter: &Expr<EmailLiteral>,
    params: &QueryParams,
) -> bool {
    wants_message_exists_pushdown(view)
        && !uses_subject_subscans(view, email_filter)
        && !super::folders::is_folder(view)
        && matches!(params.shared, SharedEmailFilter::Exclude)
        && params.project_scope.is_none()
        && params.team_id.is_none()
        && params.link_ids.len() == 1
        && !sort_uses_view_history(&params.sort_method_str)
}

/// Pushes the latest message of `t` that the view and filter accept, as
/// the `subject, snippet, from_contact_id, from_name, is_draft` preview.
fn push_preview_message_select(
    builder: &mut QueryBuilder<'static, Postgres>,
    view: &PreviewView,
    email_filter: &Expr<EmailLiteral>,
    params: &QueryParams,
) {
    builder.push(
        r#"
            SELECT
                   m.subject,
                   m.snippet,
                   m.from_contact_id,
                   m.from_name,
                   m.is_draft
            FROM email_messages m
            WHERE m.thread_id = t.id
              AND "#,
    );
    build_preview_message_predicate(email_filter, view, &params.resolved)
        .push_into(builder, &params.user_id);
    builder.push(
        r#"
            ORDER BY COALESCE(m.internal_date_ts, m.created_at) DESC, m.id DESC
            LIMIT 1"#,
    );
}

fn push_thread_candidate_select(
    builder: &mut QueryBuilder<'static, Postgres>,
    view: &PreviewView,
    email_filter: &Expr<EmailLiteral>,
    params: &QueryParams,
    sort_ts_field: &str,
    source: ThreadCandidateSource,
) {
    // Owned scans fan out one ordered, LIMITed subscan per link.
    // `link_id = ANY(...)` cannot return index order, even for a single id,
    // so the planner fetches every matching thread and sorts. A per-link
    // equality walk stops at LIMIT. Team scope stays on ANY: a per-link
    // LIMIT would starve the cross-mailbox dedupe.
    let per_link_fanout = matches!(source, ThreadCandidateSource::Owned)
        && params.team_id.is_none()
        && !params.link_ids.is_empty();

    // Subject terms split each subscan in two steps: list the inbox's
    // threads in order with only the index-backed subject match, then run
    // the full match (mailbox facts) on that stream until LIMIT. In one step
    // the planner joins every subject hit to its facts before sorting, which
    // costs seconds for common words in a large mailbox. Whether walking the
    // ordered index beats reading the trigram index depends on the inbox's
    // size, so each inbox is bound rather than read from `unnest`, which
    // would plan every inbox as the table's average one.
    if per_link_fanout && uses_subject_subscans(view, email_filter) {
        builder.push(
            r#"
                SELECT per_link.* FROM ("#,
        );
        for (index, link_id) in params.link_ids.iter().enumerate() {
            if index > 0 {
                builder.push(
                    r#"
                UNION ALL"#,
                );
            }
            builder.push(
                r#"
                (SELECT ordered.* FROM ("#,
            );
            push_candidate_body(
                builder,
                view,
                email_filter,
                params,
                sort_ts_field,
                source,
                LinkScope::Bound(*link_id),
            );
            push_subject_subscan_match(builder, view, email_filter, params, sort_ts_field);
            builder.push(")");
        }
        builder.push(
            r#"
                ) AS per_link"#,
        );
        return;
    }

    if !per_link_fanout {
        push_candidate_body(
            builder,
            view,
            email_filter,
            params,
            sort_ts_field,
            source,
            LinkScope::All,
        );
        return;
    }

    builder.push(
        r#"
                SELECT per_link.* FROM unnest("#,
    );
    builder.push_bind(params.link_ids.clone());
    builder.push(
        r#") AS links(link_id)
                CROSS JOIN LATERAL ("#,
    );
    push_candidate_body(
        builder,
        view,
        email_filter,
        params,
        sort_ts_field,
        source,
        LinkScope::Lateral,
    );
    // Per-link top-N: the outer candidate sort only ever needs the best
    // `query_limit` rows from each inbox.
    builder.push(
        r#"
                ORDER BY effective_ts DESC, id DESC
                LIMIT "#,
    );
    builder.push_bind(params.query_limit);
    builder.push(
        r#"
                ) AS per_link"#,
    );
}

/// Ends a bound subject subscan: the inner step's order, then the full
/// match per thread until LIMIT. `OFFSET 0` keeps both steps as written.
/// With no outer sort or join, the planner passes LIMIT down: dense
/// keywords walk the ordered index, rare ones read the trigram index, and
/// the full match runs per thread in this order. It mirrors the lateral's
/// message match, so LIMIT counts only threads the lateral shows.
fn push_subject_subscan_match(
    builder: &mut QueryBuilder<'static, Postgres>,
    view: &PreviewView,
    email_filter: &Expr<EmailLiteral>,
    params: &QueryParams,
    sort_ts_field: &str,
) {
    builder.push(
        r#"
                ORDER BY effective_ts DESC, id DESC
                OFFSET 0
                ) AS ordered
                WHERE EXISTS (SELECT 1 FROM email_threads t"#,
    );
    if uses_view_history(email_filter, &params.sort_method_str) {
        builder.push(
            " LEFT JOIN email_user_history uh ON uh.thread_id = t.id AND uh.link_id = t.link_id",
        );
    }
    builder.push(" WHERE t.id = ordered.id");
    if wants_message_exists_pushdown(view) {
        build_thread_message_exists_filter(email_filter, view, &params.resolved)
            .push_into(builder, &params.user_id);
    } else {
        build_thread_email_filter(email_filter, sort_ts_field, &params.resolved)
            .push_into(builder, &params.user_id);
    }
    builder.push(
        r#" OFFSET 0)
                LIMIT "#,
    );
    builder.push_bind(params.query_limit);
}

/// The key team-member copies of one conversation share: the RFC-822
/// Message-ID (`global_id`) of the thread's first non-draft message, stable
/// across mailboxes unlike provider thread ids. Drafts' Message-IDs are
/// mailbox-local, and a thread with none keeps its own id, so it never
/// dedupes. `alias` names the `email_threads` row.
fn dedupe_key_sql(alias: &str) -> String {
    format!(
        r#"COALESCE(
                        (SELECT m_root.global_id FROM email_messages m_root
                         WHERE m_root.thread_id = {alias}.id
                           AND m_root.global_id IS NOT NULL
                           AND m_root.is_draft = FALSE
                         ORDER BY m_root.internal_date_ts ASC NULLS LAST, m_root.id ASC
                         LIMIT 1),
                        {alias}.id::text
                    )"#
    )
}

/// One candidate scan: the projection, its source and inbox predicates, the
/// filters, and the cursor. Callers add any ORDER BY and LIMIT.
fn push_candidate_body(
    builder: &mut QueryBuilder<'static, Postgres>,
    view: &PreviewView,
    email_filter: &Expr<EmailLiteral>,
    params: &QueryParams,
    sort_ts_field: &str,
    source: ThreadCandidateSource,
    links: LinkScope,
) {
    let pick_preview = picks_preview_in_candidates(view, email_filter, params);
    let defer_uh = !uses_view_history(email_filter, &params.sort_method_str);
    // All Mail displays the latest eligible message date, even when a newer
    // junk/trash message or a read-state write updates the thread metadata.
    let updated_at_field = match view {
        PreviewView::StandardLabel(
            PreviewViewStandardLabel::All
            | PreviewViewStandardLabel::Spam
            | PreviewViewStandardLabel::Trash,
        ) => sort_ts_field,
        _ => "t.updated_at",
    };
    let subject_prefilter = match links {
        LinkScope::Bound(_) => build_subject_prefilter(email_filter),
        LinkScope::All | LinkScope::Lateral => None,
    };

    builder.push(
        r#"
                SELECT
                    t.id,
                    t.provider_id,
                    t.link_id,
                    t.inbox_visible,
                    t.is_read,
                    t.is_signal,
                    t.project_id,
        "#,
    );

    if defer_uh {
        // viewed-history isn't the sort key here, so `viewed_at` is projected
        // by the deferred outer join (see build_query) and effective_ts
        // collapses to the plain sort field — no `uh` reference in the
        // candidate stage.
        builder.push(format!(
            r#"
                    {field} AS created_at,
                    {updated_at_field} AS updated_at,
                    {field} AS effective_ts"#,
            field = sort_ts_field
        ));
    } else {
        builder.push(format!(
            r#"
                    {} AS created_at,
                    {updated_at_field} AS updated_at,
                    uh.updated_at AS viewed_at,
                    CASE "#,
            sort_ts_field
        ));

        builder.push_bind(params.sort_method_str.clone());

        builder.push(format!(
            r#"
                        WHEN 'viewed_at' THEN COALESCE(uh."updated_at", '1970-01-01 00:00:00+00')
                        WHEN 'viewed_updated' THEN COALESCE(uh.updated_at, {})
                        ELSE {}
                    END AS effective_ts"#,
            sort_ts_field, sort_ts_field
        ));
    }

    if pick_preview {
        builder.push(
            r#",
                    lmp.subject,
                    lmp.snippet,
                    lmp.from_contact_id,
                    lmp.from_name,
                    lmp.is_draft"#,
        );
    }

    // Team-scoped queries return one thread copy per team member on the
    // same conversation; is_own_link feeds the DISTINCT ON preference in
    // build_query so the caller's copy wins.
    if params.team_id.is_some() {
        builder.push(format!(
            r#",
                    {} AS dedupe_key,
                    t.link_id = ANY("#,
            dedupe_key_sql("t")
        ));
        builder.push_bind(params.link_ids.clone());
        builder.push(") AS is_own_link");
    }

    if super::folders::is_folder(view) {
        super::folders::push_folder_threads(builder, view, |builder| {
            push_source_scope(builder, params, source, links);
        });
    } else {
        builder.push(" FROM email_threads t ");
    }
    if !defer_uh {
        builder.push(
            " LEFT JOIN email_user_history uh ON uh.thread_id = t.id AND uh.link_id = t.link_id ",
        );
    }
    if pick_preview {
        builder.push(" CROSS JOIN LATERAL (");
        push_preview_message_select(builder, view, email_filter, params);
        builder.push(") AS lmp ");
    }
    builder.push(" WHERE ");

    push_source_scope(builder, params, source, links);

    let view_thread_filter = build_view_thread_filter(view);
    if !view_thread_filter.is_empty() {
        view_thread_filter.push_into(builder, &params.user_id);
    }

    if let Some(prefilter) = subject_prefilter {
        // The full match runs after ordering, in push_subject_subscan_match.
        build_thread_conjunct_filter(email_filter, sort_ts_field)
            .push_into(builder, &params.user_id);
        prefilter.push_into(builder, &params.user_id);
    } else {
        if has_thread_literals(email_filter) {
            build_thread_email_filter(email_filter, sort_ts_field, &params.resolved)
                .push_into(builder, &params.user_id);
        }

        // Ensure the candidate LIMIT only counts threads that will survive the
        // CROSS JOIN LATERAL's message match. When a view-level message filter
        // is in play mirror the full lateral predicate as a correlated EXISTS;
        // otherwise push address-only constraints through the index-driven
        // `matching_threads` CTE referenced via
        // `t.id IN (SELECT thread_id FROM matching_threads)`. A preview picked
        // in the candidate stage already is that message match.
        if wants_message_exists_pushdown(view) && !pick_preview {
            build_thread_message_exists_filter(email_filter, view, &params.resolved)
                .push_into(builder, &params.user_id);
        }
    }
    if has_address_literals(email_filter)
        && (!wants_message_exists_pushdown(view)
            || matches!(
                view,
                PreviewView::StandardLabel(PreviewViewStandardLabel::All)
            ))
    {
        build_thread_address_filter(email_filter).push_into(builder, &params.user_id);
    }

    // Team-scoped: the cursor moves outside the dedupe wrapper (see
    // build_query) so the representative choice is cursor-independent.
    // Filtering before DISTINCT ON would let a copy excluded by the
    // cursor on page N hand its conversation back to a duplicate copy
    // on page N+1.
    if params.team_id.is_some() {
        return;
    }

    if defer_uh {
        // effective_ts == sort_ts_field for these modes, so the cursor
        // compares the plain sort field directly — no `uh` reference.
        builder.push(
            r#"
                  -- Cursor logic
                  AND (("#,
        );
        builder.push_bind(params.cursor_timestamp);
        builder.push(format!(
            r#"::timestamptz IS NULL) OR (({}, t.id) < ("#,
            sort_ts_field
        ));
        builder.push_bind(params.cursor_timestamp);
        builder.push("::timestamptz, ");
        builder.push_bind(params.cursor_id_str.clone());
        // Three closes: right row operand, the grouped row-comparison, the
        // outer AND-group opened by `AND ((`.
        builder.push("::uuid)))");
    } else {
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

        builder.push_bind(params.sort_method_str.clone());

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
        builder.push_bind(params.cursor_id_str.clone());
        builder.push("::uuid))");
    }
}

/// The page's columns over the limited candidate relation `t`, up to the
/// `FROM (` that opens it. [`push_page_tail`] closes it and joins the
/// preview message `lmp`, its sender `c` and the owning inbox `el`.
fn push_page_head(
    builder: &mut QueryBuilder<'static, Postgres>,
    params: &QueryParams,
    defer_uh: bool,
) {
    builder.push(
        r#"
        SELECT
            t.id,
            t.provider_id,
            t.inbox_visible,
            t.is_read,
            t.is_signal,
            t.effective_ts AS sort_ts,
            t.created_at,
            t.updated_at,
            "#,
    );

    // viewed_at comes from the deferred outer join (added below) when the sort
    // mode allowed deferral; otherwise it was computed per candidate as
    // `t.viewed_at`.
    if defer_uh {
        builder.push("uh.updated_at AS viewed_at,");
    } else {
        builder.push("t.viewed_at,");
    }

    // Provider attention is evidence. The Importance filter separately uses
    // Macro Signal, including the user's overrides.
    builder.push(
        r#"
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
                        JOIN email_message_mailbox_facts mf ON mf.id = m_imp.id
                        WHERE m_imp.thread_id = t.id AND mf.is_present AND NOT mf.in_trash AND mf.provider_is_important
                    )
                )
            END AS is_important,
            c.email_address AS sender_email,
            COALESCE(lmp.from_name, c.name) AS sender_name,
            c.sfs_photo_url as sender_photo_url,
            el.macro_id AS owner_id,
            el.id AS link_id
        FROM ("#,
    );
}

/// Closes the candidate relation opened by [`push_page_head`] as `t`, picks
/// each thread's preview message, joins its sender and inbox, and orders the
/// page.
fn push_page_tail(
    builder: &mut QueryBuilder<'static, Postgres>,
    view: &PreviewView,
    email_filter: &Expr<EmailLiteral>,
    params: &QueryParams,
    defer_uh: bool,
) {
    builder.push(") AS t");
    if picks_preview_in_candidates(view, email_filter, params) {
        builder.push(
            r#"
        -- Step 2: the preview message was picked with the candidate
        CROSS JOIN LATERAL (
            SELECT t.subject, t.snippet, t.from_contact_id, t.from_name, t.is_draft
        ) AS lmp"#,
        );
    } else {
        if super::folders::is_folder(view) {
            // Preserve the folder sort date inside mixed thread/message predicates
            // in the preview LATERAL, after the candidate relation has been limited.
            builder.push(
                " CROSS JOIN LATERAL (SELECT t.created_at AS latest_folder_message_ts) folder ",
            );
        }
        builder.push(
            r#"
        -- Step 2: For each thread, find its latest message matching the filter
        CROSS JOIN LATERAL ("#,
        );
        push_preview_message_select(builder, view, email_filter, params);
        builder.push(
            r#"
        ) AS lmp"#,
        );
    }
    builder.push(
        r#"
        -- Step 3: Join to get the sender's details
        LEFT JOIN email_contacts c ON lmp.from_contact_id = c.id
        -- Step 4: Join to get the thread owner's macro user ID
        JOIN email_links el ON t.link_id = el.id
        "#,
    );

    // Step 5 (deferred): attach the caller's per-thread viewed_at. Kept out of
    // the candidate stage so it runs once per returned row rather than once per
    // candidate thread. `email_user_history` is unique per (link_id, thread_id),
    // so this LEFT JOIN can neither drop nor duplicate rows.
    if defer_uh {
        builder.push(
            r#"        LEFT JOIN email_user_history uh ON uh.thread_id = t.id AND uh.link_id = t.link_id
        "#,
        );
    }

    builder.push(
        r#"        ORDER BY t.effective_ts DESC, t.id DESC
        "#,
    );
}

/// Builds a dynamic email thread query with filters applied.
/// All user-controlled values are parameterized via `push_bind`.
fn build_query(
    view: &PreviewView,
    email_filter: &Expr<EmailLiteral>,
    mut params: QueryParams,
) -> QueryBuilder<'static, Postgres> {
    params.resolved.include_trash = matches!(
        view,
        PreviewView::StandardLabel(PreviewViewStandardLabel::Trash)
    );
    let sort_ts_field = get_sort_timestamp_field(view);
    // When neither ordering nor filtering needs view history, the
    // `email_user_history` join is pushed past the candidate `LIMIT` so it
    // runs once per returned row instead of once per candidate thread.
    let defer_uh = !uses_view_history(email_filter, &params.sort_method_str);

    let needs_shared_cte = !matches!(params.shared, SharedEmailFilter::Exclude);
    // All Mail keeps its index-driven address prefilter as well as the exact
    // message check, so large mailbox/CRM queries do not scan every thread.
    // Other message-filtered views retain their correlated EXISTS plan.
    let matching_threads = if wants_message_exists_pushdown(view)
        && !matches!(
            view,
            PreviewView::StandardLabel(PreviewViewStandardLabel::All)
        ) {
        None
    } else {
        // Owned-only queries can scope the CTE's contact/message scans to
        // the links the candidate WHERE will accept: the caller's own links,
        // or every team-member primary link when team-scoped (a thread's
        // messages/contacts share its link_id, so this can't drop rows).
        // Shared/project candidates include threads from arbitrary links,
        // so any scope there would.
        let link_scope = (matches!(params.shared, SharedEmailFilter::Exclude)
            && params.project_scope.is_none())
        .then(|| match params.team_id {
            Some(_) => params.resolved.team_link_ids(),
            None => Some(params.link_ids.as_slice()),
        })
        .flatten();
        build_matching_threads_ctes(email_filter, &params.resolved, link_scope)
    };

    let mut builder = sqlx::QueryBuilder::new("");
    if needs_shared_cte || matching_threads.is_some() {
        builder.push("\n        WITH ");
        let mut needs_comma = false;
        if needs_shared_cte {
            push_shared_cte(&mut builder, &params);
            needs_comma = true;
        }
        if let Some(ctes) = matching_threads {
            // Hoisted contact-lookup CTEs first — matching_threads' branches
            // reference them by name.
            for (name, body) in ctes.contact_ctes {
                if needs_comma {
                    builder.push(",\n        ");
                }
                builder.push(format!("{name} AS MATERIALIZED (\n            "));
                body.push_into(&mut builder, &params.user_id);
                builder.push("\n        )");
                needs_comma = true;
            }
            if needs_comma {
                builder.push(",\n        ");
            }
            builder.push("matching_threads AS MATERIALIZED (\n            ");
            ctes.body.push_into(&mut builder, &params.user_id);
            builder.push("\n        )");
        }
        builder.push("\n        ");
    }

    push_page_head(&mut builder, &params, defer_uh);
    builder.push(
        r#"
            -- Step 1: Efficiently find and sort candidate threads
            SELECT *
            FROM (
        "#,
    );

    // Team-scoped: dedupe team-member copies of a conversation before the
    // cursor is applied, so the chosen representative is stable across
    // pages. The caller's own copy wins; ties break by recency then id.
    if params.team_id.is_some() {
        builder.push(
            r#"
                SELECT DISTINCT ON (dedupe_key) *
                FROM (
                SELECT * FROM (
        "#,
        );
    }

    match params.shared {
        SharedEmailFilter::Exclude => push_thread_candidate_select(
            &mut builder,
            view,
            email_filter,
            &params,
            sort_ts_field,
            ThreadCandidateSource::Owned,
        ),
        SharedEmailFilter::Include => {
            push_thread_candidate_select(
                &mut builder,
                view,
                email_filter,
                &params,
                sort_ts_field,
                ThreadCandidateSource::Owned,
            );
            builder.push(
                r#"
                UNION
                "#,
            );
            push_thread_candidate_select(
                &mut builder,
                view,
                email_filter,
                &params,
                sort_ts_field,
                ThreadCandidateSource::Shared,
            );
        }
        SharedEmailFilter::Only => push_thread_candidate_select(
            &mut builder,
            view,
            email_filter,
            &params,
            sort_ts_field,
            ThreadCandidateSource::Shared,
        ),
    }

    // Project-scoped source is additive: callers without project access
    // still get their own (and shared) threads from the branches above.
    if params.project_scope.is_some() {
        builder.push(
            r#"
                UNION
                "#,
        );
        push_thread_candidate_select(
            &mut builder,
            view,
            email_filter,
            &params,
            sort_ts_field,
            ThreadCandidateSource::Project,
        );
    }

    if let Some(team_id) = params.team_id {
        // Every CRM candidate, including the caller's own copy and explicit
        // shares, must satisfy current mailbox consent and domain exclusions.
        // The check walks every participant of a thread, so it runs on the
        // fenced candidate set: `OFFSET 0` stops the planner from pushing it
        // into the thread scan, where it ran once per thread in each team
        // mailbox before the cheap filters had narrowed anything.
        builder.push(
            r#"
                OFFSET 0
                ) AS unchecked_candidates
                WHERE crm_email_thread_allowed("#,
        );
        builder.push_bind(team_id);
        builder.push(
            r#", unchecked_candidates.id)
                ) AS candidate_threads
                ORDER BY dedupe_key, is_own_link DESC, effective_ts DESC, id DESC
            ) AS deduped_threads
            -- Cursor logic (post-dedupe, on the representative row)
            WHERE (("#,
        );
        builder.push_bind(params.cursor_timestamp);
        builder.push("::timestamptz IS NULL) OR ((effective_ts, id) < (");
        builder.push_bind(params.cursor_timestamp);
        builder.push("::timestamptz, ");
        builder.push_bind(params.cursor_id_str.clone());
        builder.push(
            r#"::uuid)))
            ORDER BY effective_ts DESC, id DESC
            LIMIT "#,
        );
    } else {
        builder.push(
            r#"
            ) AS candidate_threads
            ORDER BY effective_ts DESC, id DESC
            LIMIT "#,
        );
    }

    builder.push_bind(params.query_limit);
    push_page_tail(&mut builder, view, email_filter, &params, defer_uh);
    builder
}

#[cfg(test)]
pub(super) fn debug_build_query_sql(
    view: &PreviewView,
    email_filter: &Expr<EmailLiteral>,
) -> String {
    debug_build_query_sql_with_resolved(view, email_filter, ResolvedFilters::empty())
}

#[cfg(test)]
pub(super) fn debug_build_query_sql_with_resolved(
    view: &PreviewView,
    email_filter: &Expr<EmailLiteral>,
    resolved: ResolvedFilters,
) -> String {
    debug_build_query_sql_inner(
        view,
        email_filter,
        resolved,
        None,
        SimpleSortMethod::UpdatedAt,
    )
}

#[cfg(test)]
pub(super) fn debug_build_query_sql_with_sort(
    view: &PreviewView,
    email_filter: &Expr<EmailLiteral>,
    sort_method: SimpleSortMethod,
) -> String {
    debug_build_query_sql_inner(
        view,
        email_filter,
        ResolvedFilters::empty(),
        None,
        sort_method,
    )
}

#[cfg(test)]
pub(super) fn debug_build_query_sql_team_scoped(
    view: &PreviewView,
    email_filter: &Expr<EmailLiteral>,
) -> String {
    debug_build_query_sql_inner(
        view,
        email_filter,
        ResolvedFilters::empty(),
        Some(Uuid::nil()),
        SimpleSortMethod::UpdatedAt,
    )
}

#[cfg(test)]
pub(super) fn debug_build_query_sql_team_scoped_with_resolved(
    view: &PreviewView,
    email_filter: &Expr<EmailLiteral>,
    resolved: ResolvedFilters,
) -> String {
    debug_build_query_sql_inner(
        view,
        email_filter,
        resolved,
        Some(Uuid::nil()),
        SimpleSortMethod::UpdatedAt,
    )
}

#[cfg(test)]
pub(super) fn debug_build_query_sql_multi_link(
    view: &PreviewView,
    email_filter: &Expr<EmailLiteral>,
) -> String {
    debug_build_query_sql_full(
        view,
        email_filter,
        vec![Uuid::nil(), Uuid::from_u128(1)],
        ResolvedFilters::empty(),
        None,
        SimpleSortMethod::UpdatedAt,
    )
}

#[cfg(test)]
pub(super) fn debug_build_query_sql_team_scoped_multi_link(
    view: &PreviewView,
    email_filter: &Expr<EmailLiteral>,
) -> String {
    debug_build_query_sql_full(
        view,
        email_filter,
        vec![Uuid::nil(), Uuid::from_u128(1)],
        ResolvedFilters::empty(),
        Some(Uuid::nil()),
        SimpleSortMethod::UpdatedAt,
    )
}

#[cfg(test)]
fn debug_build_query_sql_inner(
    view: &PreviewView,
    email_filter: &Expr<EmailLiteral>,
    resolved: ResolvedFilters,
    team_id: Option<Uuid>,
    sort_method: SimpleSortMethod,
) -> String {
    debug_build_query_sql_full(
        view,
        email_filter,
        vec![Uuid::nil()],
        resolved,
        team_id,
        sort_method,
    )
}

#[cfg(test)]
fn debug_build_query_sql_full(
    view: &PreviewView,
    email_filter: &Expr<EmailLiteral>,
    link_ids: Vec<Uuid>,
    resolved: ResolvedFilters,
    team_id: Option<Uuid>,
    sort_method: SimpleSortMethod,
) -> String {
    use sqlx::Execute;

    let shared = extract_shared_filter(email_filter);
    // Mirror the real path's scope derivation with a fixed source id in
    // place of the get_user_source_ids DB lookup.
    let project_ids = extract_project_filter(email_filter);
    let project_scope = (!project_ids.is_empty()).then(|| ProjectScope {
        project_ids,
        source_ids: vec!["test-user".to_string()],
    });
    let is_important = matches!(
        view,
        PreviewView::StandardLabel(PreviewViewStandardLabel::Important)
    );

    build_query(
        view,
        email_filter,
        QueryParams {
            link_ids,
            sort_method_str: sort_method.to_string(),
            query_limit: 50,
            cursor_timestamp: None,
            cursor_id_str: None,
            is_important,
            shared,
            user_id: "test-user".to_string(),
            resolved,
            team_id,
            project_scope,
        },
    )
    .build()
    .sql()
    .to_string()
}

/// Extracts the [SharedEmailFilter] from the email filter AST, defaulting to Exclude.
fn extract_shared_filter(ast: &Expr<EmailLiteral>) -> SharedEmailFilter {
    ast.collapse_frames(
        |frame: filter_ast::ExprFrame<SharedEmailFilter, EmailLiteral>| match frame {
            filter_ast::ExprFrame::Literal(EmailLiteral::Shared(s)) => s,
            filter_ast::ExprFrame::And(a, b) | filter_ast::ExprFrame::Or(a, b) => {
                if !a.is_default() { a } else { b }
            }
            filter_ast::ExprFrame::Not(a) => a,
            _ => SharedEmailFilter::Exclude,
        },
    )
}

/// Every `ProjectId` literal in the tree. A negated `ProjectId` ("not in
/// project X") must not widen the candidate set, so anything under a `Not`
/// is ignored.
fn extract_project_filter(ast: &Expr<EmailLiteral>) -> Vec<String> {
    ast.collapse_frames(
        |frame: filter_ast::ExprFrame<Vec<String>, EmailLiteral>| match frame {
            filter_ast::ExprFrame::Literal(EmailLiteral::ProjectId(id)) => vec![id],
            filter_ast::ExprFrame::And(mut a, b) | filter_ast::ExprFrame::Or(mut a, b) => {
                a.extend(b);
                a
            }
            filter_ast::ExprFrame::Not(_) => Vec::new(),
            _ => Vec::new(),
        },
    )
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
#[tracing::instrument(skip(pool, user_id), err)]
pub(crate) async fn dynamic_email_thread_cursor(
    pool: &PgPool,
    link_ids: &[Uuid],
    limit: u32,
    view: &PreviewView,
    query: Query<Uuid, SimpleSortMethod, Arc<Expr<EmailLiteral>>>,
    user_id: &str,
    team_id: Option<Uuid>,
) -> Result<Vec<ThreadPreviewCursorDbRow>, sqlx::Error> {
    dynamic_email_thread_cursor_with(
        pool,
        link_ids,
        limit,
        view,
        query,
        user_id,
        team_id,
        Some(TeamReadTuning::DEFAULT),
    )
    .await
}

/// [`dynamic_email_thread_cursor`] with the team read's switch points given,
/// or with `team_read: None`, team scope read by the general builder, as the
/// parity tests compare.
#[expect(
    clippy::too_many_arguments,
    reason = "the entry point's arguments plus the team read's tuning"
)]
pub(crate) async fn dynamic_email_thread_cursor_with(
    pool: &PgPool,
    link_ids: &[Uuid],
    limit: u32,
    view: &PreviewView,
    query: Query<Uuid, SimpleSortMethod, Arc<Expr<EmailLiteral>>>,
    user_id: &str,
    team_id: Option<Uuid>,
    team_read: Option<TeamReadTuning>,
) -> Result<Vec<ThreadPreviewCursorDbRow>, sqlx::Error> {
    let query_limit = limit as i64;
    let sort_method_str = query.sort_method().to_string();
    let (cursor_id, cursor_timestamp) = query.vals();
    let cursor_id_str = cursor_id.as_ref().map(|u| u.to_string());

    // Extract email filter from query
    let email_filter = query.filter();
    let shared = extract_shared_filter(email_filter);

    // Project-scoped queries widen the candidate set to every thread in the
    // project, so resolve the caller's entity_access sources up front (the
    // lookup is memoized for 30s). On failure, degrade to the un-widened
    // query rather than erroring — the scope can only ever add rows.
    let project_ids = extract_project_filter(email_filter);
    let project_scope = if project_ids.is_empty() {
        None
    } else {
        let user = MacroUserIdStr::parse_from_str(user_id).ok();
        match get_user_source_ids(pool, user.as_deref()).await {
            Ok(source_ids) => Some(ProjectScope {
                project_ids,
                source_ids: source_ids.0,
            }),
            Err(e) => {
                tracing::error!(error=?e, "unable to fetch source ids for project-scoped email query");
                None
            }
        }
    };

    let is_important = matches!(
        view,
        PreviewView::StandardLabel(PreviewViewStandardLabel::Important)
    );

    // Resolve Complete email addresses to contact ids and look up the TRASH
    // label id once, so the candidate WHERE can use direct id equality
    // instead of joining email_contacts/email_labels per message row.
    //
    // When team_id is set, resolution spans every team-member's link so the
    // resulting contact_id / TRASH label_id sets cover all team mailboxes.
    let resolved = resolve_filters(pool, link_ids, team_id, email_filter).await?;
    if can_short_circuit(email_filter, &resolved) {
        return Ok(Vec::new());
    }
    let subject_subscans =
        team_id.is_none() && !link_ids.is_empty() && uses_subject_subscans(view, email_filter);

    let params = QueryParams {
        link_ids: link_ids.to_vec(),
        sort_method_str,
        query_limit,
        cursor_timestamp: cursor_timestamp.copied(),
        cursor_id_str,
        is_important,
        shared,
        user_id: user_id.to_string(),
        resolved,
        team_id,
        project_scope,
    };

    if team_id.is_some() {
        return read_team_page(pool, view, email_filter, params, team_read).await;
    }

    let mut qb = build_query(view, email_filter, params);
    // Unnamed statement: the SQL text varies per filter shape (and per
    // interpolated date literal), so cached prepared statements get little
    // reuse but do flip to generic plans after five executions — and the
    // generic plan's inflated cost estimate also triggers JIT compilation per
    // execution. Planning with real bind values each time keeps the plan
    // stable for ~1ms of planning.
    let query = qb.build().persistent(false).try_map(map_row);

    if subject_subscans {
        // Parallel workers on a subject subscan run ahead of its LIMIT: for
        // a word in about 1% of a large inbox's threads they walked eight
        // times the threads one page needs and read 15 times the buffers,
        // so the page took 2.5 times as long warm, and far longer cold.
        let mut transaction = pool.begin().await?;
        sqlx::query!("SET LOCAL max_parallel_workers_per_gather = 0")
            .execute(&mut *transaction)
            .await?;
        let rows = query.fetch_all(&mut *transaction).await?;
        transaction.commit().await?;
        return Ok(rows);
    }

    query.fetch_all(pool).await
}

/// How long a team-scoped (CRM) page may run in the database, across all its
/// statements: under the web client's 12s Soup request timeout, after which
/// nobody reads the page. The server never cancels a query its client
/// dropped, so the database enforces the bound.
const TEAM_READ_BUDGET: Duration = Duration::from_secs(10);

/// Reads a team-scoped page with [`TeamRead`] when it covers the request, and
/// with the general builder otherwise, within [`TEAM_READ_BUDGET`].
async fn read_team_page(
    pool: &PgPool,
    view: &PreviewView,
    email_filter: &Expr<EmailLiteral>,
    params: QueryParams,
    tuning: Option<TeamReadTuning>,
) -> Result<Vec<ThreadPreviewCursorDbRow>, sqlx::Error> {
    let deadline = Instant::now() + TEAM_READ_BUDGET;
    let team_read = match tuning {
        Some(tuning) => TeamRead::new(view, email_filter, params, tuning),
        None => Err(Box::new(params)),
    };
    let mut transaction = pool.begin().await?;
    let rows = match team_read {
        Ok(read) => read.fetch(&mut transaction, deadline).await?,
        Err(params) => {
            limit_statement_time(&mut transaction, deadline).await?;
            let mut qb = build_query(view, email_filter, *params);
            qb.build()
                .persistent(false)
                .try_map(map_row)
                .fetch_all(&mut *transaction)
                .await?
        }
    };
    transaction.commit().await?;
    Ok(rows)
}

/// Bounds the transaction's next statement by what is left until `deadline`.
async fn limit_statement_time(
    connection: &mut PgConnection,
    deadline: Instant,
) -> Result<(), sqlx::Error> {
    // A zero statement_timeout disables the bound, so a spent budget still
    // allows one millisecond and fails the statement.
    let remaining = deadline
        .saturating_duration_since(Instant::now())
        .as_millis()
        .max(1);
    sqlx::query_scalar!(
        "SELECT set_config('statement_timeout', $1, true)",
        format!("{remaining}ms")
    )
    .fetch_one(connection)
    .await?;
    Ok(())
}

/// Maps one page row, as [`push_page_head`] names its columns.
fn map_row(row: PgRow) -> Result<ThreadPreviewCursorDbRow, sqlx::Error> {
    Ok(ThreadPreviewCursorDbRow {
        id: row.try_get("id")?,
        provider_id: row.try_get("provider_id")?,
        inbox_visible: row.try_get("inbox_visible")?,
        is_read: row.try_get("is_read")?,
        is_draft: row.try_get("is_draft")?,
        is_important: row.try_get("is_important")?,
        is_signal: row.try_get("is_signal")?,
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
        owner_id: row.try_get("owner_id")?,
        link_id: row.try_get("link_id")?,
    })
}
