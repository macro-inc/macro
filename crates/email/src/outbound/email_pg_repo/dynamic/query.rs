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
use sqlx::{PgPool, Postgres, QueryBuilder, Row};
use std::sync::Arc;
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

fn push_thread_candidate_select(
    builder: &mut QueryBuilder<'static, Postgres>,
    view: &PreviewView,
    email_filter: &Expr<EmailLiteral>,
    params: &QueryParams,
    sort_ts_field: &str,
    source: ThreadCandidateSource,
) {
    let defer_uh = !uses_view_history(email_filter, &params.sort_method_str);

    // Multi-inbox owned scans fan out one ordered, LIMITed subscan per link:
    // `link_id = ANY(...)` index scans can't return ordered output (pre-PG17),
    // forcing a fetch-and-sort of every candidate thread across all inboxes.
    // Per-link scans walk the index in order and stop at LIMIT.
    let per_link_fanout = matches!(source, ThreadCandidateSource::Owned)
        && params.team_id.is_none()
        && params.link_ids.len() > 1;

    if per_link_fanout {
        builder.push(
            r#"
                SELECT per_link.* FROM unnest("#,
        );
        builder.push_bind(params.link_ids.clone());
        builder.push(
            r#") AS links(link_id)
                CROSS JOIN LATERAL ("#,
        );
    }

    builder.push(
        r#"
                SELECT
                    t.id,
                    t.provider_id,
                    t.link_id,
                    t.inbox_visible,
                    t.is_read,
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
                    t.updated_at AS updated_at,
                    {field} AS effective_ts"#,
            field = sort_ts_field
        ));
    } else {
        builder.push(format!(
            r#"
                    {} AS created_at,
                    t.updated_at AS updated_at,
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

    // Team-scoped queries return one thread copy per team member on the
    // same conversation. Dedupe on the root message's RFC-822 Message-ID
    // (email_messages.global_id) — stable across mailboxes, unlike
    // provider thread ids. Drafts are excluded (their Message-IDs are
    // mailbox-local), and threads with no usable global_id fall back to
    // their own id and never dedupe. is_own_link feeds the DISTINCT ON
    // preference in build_query so the caller's copy wins.
    if params.team_id.is_some() {
        builder.push(
            r#",
                    COALESCE(
                        (SELECT m_root.global_id FROM email_messages m_root
                         WHERE m_root.thread_id = t.id
                           AND m_root.global_id IS NOT NULL
                           AND m_root.is_draft = FALSE
                         ORDER BY m_root.internal_date_ts ASC NULLS LAST, m_root.id ASC
                         LIMIT 1),
                        t.id::text
                    ) AS dedupe_key,
                    t.link_id = ANY("#,
        );
        builder.push_bind(params.link_ids.clone());
        builder.push(") AS is_own_link");
    }

    if defer_uh {
        builder.push(
            r#"
                FROM email_threads t
                WHERE
                    "#,
        );
    } else {
        builder.push(
            r#"
                FROM email_threads t
                LEFT JOIN email_user_history uh ON uh.thread_id = t.id AND uh.link_id = t.link_id
                WHERE
                    "#,
        );
    }

    match source {
        ThreadCandidateSource::Owned => match params.team_id {
            // Normal per-mailbox query.
            None => {
                if per_link_fanout {
                    builder.push("t.link_id = links.link_id");
                } else {
                    builder.push("t.link_id = ANY(");
                    builder.push_bind(params.link_ids.clone());
                    builder.push(")");
                }
            }
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
            // crm_enabled EXISTS below). The subquery alone remains as a
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

    // Belt-and-suspenders killswitch check that covers both the Owned and
    // Shared branches. Without this, a CRM-scoped request with
    // `SharedEmailFilter::Include`/`Only` could still return rows after
    // `team_crm_settings.crm_enabled` flips false between the pre-check
    // and query execution. EXISTS short-circuits and Postgres planner
    // treats it as a constant once evaluated per query.
    if let Some(team_id) = params.team_id {
        builder.push(
            r#" AND EXISTS (
                SELECT 1 FROM team_crm_settings tcs
                WHERE tcs.team_id = "#,
        );
        builder.push_bind(team_id);
        builder.push(" AND tcs.crm_enabled)");
    }

    let view_thread_filter = build_view_thread_filter(view);
    if !view_thread_filter.is_empty() {
        view_thread_filter.push_into(builder);
    }

    if has_thread_literals(email_filter) {
        build_thread_email_filter(email_filter, sort_ts_field, &params.resolved).push_into(builder);
    }

    // Ensure the candidate LIMIT only counts threads that will survive the
    // CROSS JOIN LATERAL's message match. When a view-level message filter
    // is in play mirror the full lateral predicate as a correlated EXISTS;
    // otherwise push address-only constraints through the index-driven
    // `matching_threads` CTE referenced via
    // `t.id IN (SELECT thread_id FROM matching_threads)`.
    if wants_message_exists_pushdown(view) {
        build_thread_message_exists_filter(email_filter, view, &params.resolved).push_into(builder);
    } else if has_address_literals(email_filter) {
        build_thread_address_filter(email_filter).push_into(builder);
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

    if per_link_fanout {
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
}

/// Builds a dynamic email thread query with filters applied.
/// All user-controlled values are parameterized via `push_bind`.
fn build_query(
    view: &PreviewView,
    email_filter: &Expr<EmailLiteral>,
    params: QueryParams,
) -> QueryBuilder<'static, Postgres> {
    let sort_ts_field = get_sort_timestamp_field(view);
    let view_message_filter = build_view_message_filter(view);
    // When neither ordering nor filtering needs view history, the
    // `email_user_history` join is pushed past the candidate `LIMIT` so it
    // runs once per returned row instead of once per candidate thread.
    let defer_uh = !uses_view_history(email_filter, &params.sort_method_str);

    let needs_shared_cte = !matches!(params.shared, SharedEmailFilter::Exclude);
    // When the candidate stage pushes a full per-message EXISTS (view-level
    // message filter), it already enforces "thread has a message the lateral
    // will surface", so the address-only `matching_threads` CTE is redundant.
    let matching_threads = if wants_message_exists_pushdown(view) {
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
                body.push_into(&mut builder);
                builder.push("\n        )");
                needs_comma = true;
            }
            if needs_comma {
                builder.push(",\n        ");
            }
            builder.push("matching_threads AS MATERIALIZED (\n            ");
            ctes.body.push_into(&mut builder);
            builder.push("\n        )");
        }
        builder.push("\n        ");
    }

    builder.push(
        r#"
        SELECT
            t.id,
            t.provider_id,
            t.inbox_visible,
            t.is_read,
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

    // The is_important output column reflects Gmail's IMPORTANT label — a
    // different notion from the Importance filter, which reads the
    // denormalized email_threads.is_signal heuristic.
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
            c.sfs_photo_url as sender_photo_url,
            el.macro_id AS owner_id,
            el.id AS link_id
        FROM (
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

    if params.team_id.is_some() {
        builder.push(
            r#"
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
              AND "#,
    );
    build_lateral_trash_exclusion(&params.resolved).push_into(&mut builder);

    // Add view-specific message filters
    if !view_message_filter.is_empty() {
        view_message_filter.push_into(&mut builder);
    }

    if has_message_literals(email_filter) {
        build_message_email_filter(email_filter, &params.resolved, sort_ts_field)
            .push_into(&mut builder);
    }

    builder.push(
        r#"
            ORDER BY COALESCE(m.internal_date_ts, m.created_at) DESC
            LIMIT 1
        ) AS lmp
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
#[tracing::instrument(skip(pool), err)]
pub(crate) async fn dynamic_email_thread_cursor(
    pool: &PgPool,
    link_ids: &[Uuid],
    limit: u32,
    view: &PreviewView,
    query: Query<Uuid, SimpleSortMethod, Arc<Expr<EmailLiteral>>>,
    user_id: &str,
    team_id: Option<Uuid>,
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

    let mut qb = build_query(
        view,
        email_filter,
        QueryParams {
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
        },
    );

    qb.build()
        // Unnamed statement: the SQL text varies per filter shape (and per
        // interpolated date literal), so cached prepared statements get
        // little reuse but do flip to generic plans after five executions —
        // and the generic plan's inflated cost estimate also triggers JIT
        // compilation per execution. Planning with real bind values each
        // time keeps the plan stable for ~1ms of planning.
        .persistent(false)
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
                owner_id: row.try_get("owner_id")?,
                link_id: row.try_get("link_id")?,
            })
        })
        .fetch_all(pool)
        .await
}
