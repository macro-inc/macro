use super::filters::*;
use super::resolve::{ResolvedFilters, can_short_circuit, resolve_filters};
use crate::domain::models::{PreviewView, PreviewViewStandardLabel};
use crate::outbound::email_pg_repo::db_types::*;
use chrono::{DateTime, Utc};
use filter_ast::Expr;
use item_filters::SharedEmailFilter;
use item_filters::ast::email::EmailLiteral;
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
    /// `t.link_id = ANY($link_ids)` to `t.link_id IN (links of every member
    /// of $team_id)`. Set only after CRM scope has been validated upstream.
    /// Also switches the candidate select into dedupe mode: team-member
    /// copies of the same conversation collapse to one row (see
    /// [`build_query`]).
    team_id: Option<Uuid>,
}

enum ThreadCandidateSource {
    Owned,
    Shared,
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
              AND entity_type = 'thread'
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

    builder.push(
        r#"
                FROM email_threads t
                LEFT JOIN email_user_history uh ON uh.thread_id = t.id AND uh.link_id = t.link_id
                WHERE
                    "#,
    );

    match source {
        ThreadCandidateSource::Owned => match params.team_id {
            // Normal per-mailbox query.
            None => {
                builder.push("t.link_id = ANY(");
                builder.push_bind(params.link_ids.clone());
                builder.push(")");
            }
            // CRM-scoped query: expand to every email_link owned by any
            // member of the team. The receipt has already been validated
            // upstream, so the team_id is trusted here.
            Some(team_id) => {
                builder.push(
                    r#"t.link_id IN (
                        SELECT el.id
                        FROM email_links el
                        JOIN team_user tu ON tu.user_id = el.macro_id
                        WHERE tu.team_id = "#,
                );
                builder.push_bind(team_id);
                builder.push(")");
            }
        },
        ThreadCandidateSource::Shared => {
            builder.push("t.id IN (SELECT thread_id FROM SharedEmailThreads)");
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
        build_thread_email_filter(email_filter, sort_ts_field).push_into(builder);
    }

    // Push address (Sender/Cc/Bcc/Recipient) constraints into the candidate
    // WHERE so pagination's LIMIT counts threads that actually contain a
    // matching message. The actual matching set is materialized once in the
    // top-level `matching_threads` CTE; the candidate WHERE just references
    // it via `t.id IN (SELECT thread_id FROM matching_threads)`.
    if has_address_literals(email_filter) {
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

/// Builds a dynamic email thread query with filters applied.
/// All user-controlled values are parameterized via `push_bind`.
fn build_query(
    view: &PreviewView,
    email_filter: &Expr<EmailLiteral>,
    params: QueryParams,
) -> QueryBuilder<'static, Postgres> {
    let sort_ts_field = get_sort_timestamp_field(view);
    let view_message_filter = build_view_message_filter(view);

    let needs_shared_cte = !matches!(params.shared, SharedEmailFilter::Exclude);
    let matching_threads_body = build_matching_threads_cte_body(email_filter, &params.resolved);

    let mut builder = sqlx::QueryBuilder::new("");
    if needs_shared_cte || matching_threads_body.is_some() {
        builder.push("\n        WITH ");
        let mut needs_comma = false;
        if needs_shared_cte {
            push_shared_cte(&mut builder, &params);
            needs_comma = true;
        }
        if let Some(body) = matching_threads_body {
            if needs_comma {
                builder.push(",\n        ");
            }
            builder.push("matching_threads AS MATERIALIZED (\n            ");
            body.push_into(&mut builder);
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
            c.sfs_photo_url as sender_photo_url,
            el.macro_id AS owner_id
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
        build_message_email_filter(email_filter, &params.resolved).push_into(&mut builder);
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
        ORDER BY t.effective_ts DESC, t.id DESC
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
    debug_build_query_sql_inner(view, email_filter, resolved, None)
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
    )
}

#[cfg(test)]
fn debug_build_query_sql_inner(
    view: &PreviewView,
    email_filter: &Expr<EmailLiteral>,
    resolved: ResolvedFilters,
    team_id: Option<Uuid>,
) -> String {
    use sqlx::Execute;

    let shared = extract_shared_filter(email_filter);
    let is_important = matches!(
        view,
        PreviewView::StandardLabel(PreviewViewStandardLabel::Important)
    );

    build_query(
        view,
        email_filter,
        QueryParams {
            link_ids: vec![Uuid::nil()],
            sort_method_str: SimpleSortMethod::UpdatedAt.to_string(),
            query_limit: 50,
            cursor_timestamp: None,
            cursor_id_str: None,
            is_important,
            shared,
            user_id: "test-user".to_string(),
            resolved,
            team_id,
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
        },
    );

    qb.build()
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
            })
        })
        .fetch_all(pool)
        .await
}
