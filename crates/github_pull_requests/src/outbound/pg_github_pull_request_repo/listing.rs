//! Listing the pull request records a caller can see, for Soup's foreign entity leg.

#[cfg(test)]
mod test;

use std::sync::Arc;

use chrono::{DateTime, Utc};
use filter_ast::Expr;
use foreign_entity::domain::{
    models::{ForeignEntity, SourceId},
    ports::ForeignEntityListQuery,
};
use item_filters::ast::{
    LiteralTree,
    foreign_entity::ForeignEntityLiteral,
    github_pull_request::{GithubPullRequestLiteral, GithubPullRequestReviewStatus},
};
use models_pagination::SimpleSortMethod;
use uuid::Uuid;

use super::PgGithubPullRequestRepo;
use crate::domain::{
    models::{
        GITHUB_PULL_REQUEST_FOREIGN_ENTITY_SOURCE, GithubPullRequestReviewDecision,
        GithubPullRequestSortDirection,
    },
    ports::GithubPullRequestListingRepository,
};

struct ListingQuery<'a> {
    source_ids: &'a [String],
    source_auth_entities: &'a [String],
    sort_method: SimpleSortMethod,
    filter_jsonpath: Option<&'a str>,
    /// Macro user id used to scope the per-user notification state predicates.
    /// When a notification filter is requested but this is `None`, nothing matches.
    notification_user_id: Option<&'a str>,
    /// Accepted sets of states present on the entity (unseen=1, seen=2, done=4).
    /// None means no notification filter; an empty list matches nothing.
    notification_sets: Option<&'a [i32]>,
    cursor_id: Option<Uuid>,
    cursor_value: Option<DateTime<Utc>>,
    limit: i64,
    /// Keeps only pull requests whose typed columns match this jsonpath.
    github_pull_request_jsonpath: Option<&'a str>,
    /// Smallest sort value first, with the cursor paging toward larger values.
    ascending: bool,
    /// Exact hydration preserves source-scoped IDs instead of deduplicating by GitHub key.
    entity_ids: Option<&'a [Uuid]>,
}

/// Only positive ID disjunctions denote an exact hydration request. Broader filters
/// retain the normal one-row-per-PR listing semantics.
fn exact_entity_ids(expr: &Expr<ForeignEntityLiteral>) -> Option<Vec<Uuid>> {
    match expr {
        Expr::Literal(ForeignEntityLiteral::Id(id)) => Some(vec![*id]),
        Expr::Or(left, right) => {
            let mut ids = exact_entity_ids(left)?;
            ids.extend(exact_entity_ids(right)?);
            Some(ids)
        }
        _ => None,
    }
}

fn source_id_parts(source_ids: &[SourceId]) -> (Vec<String>, Vec<String>) {
    source_ids
        .iter()
        .map(|source_id| (source_id.id.clone(), source_id.auth_entity.clone()))
        .unzip()
}

/// A participant or mixed metadata/notification subtree cannot be lifted safely.
/// Pure notification subtrees support AND, OR, and NOT.
struct UnsupportedHoistedFilter;

/// Filters lifted off the top-level AND spine into dedicated SQL predicates because they cannot be
/// expressed in the metadata jsonpath (they need indexed-containment or notification-table joins).
#[derive(Default)]
struct HoistedForeignEntityFilters {
    includes_me: bool,
    // A truth table over the eight possible sets of notification states present
    // on an entity. AND combines truth tables, not row-level state predicates:
    // an unseen literal and a seen literal can match different notifications.
    notification_matches: Option<u8>,
    jsonpath: Option<String>,
}

impl HoistedForeignEntityFilters {
    fn and(self, other: Self) -> Self {
        Self {
            includes_me: self.includes_me || other.includes_me,
            notification_matches: match (self.notification_matches, other.notification_matches) {
                (Some(a), Some(b)) => Some(a & b),
                (a, b) => a.or(b),
            },
            jsonpath: match (self.jsonpath, other.jsonpath) {
                (Some(a), Some(b)) => Some(format!("({a} && {b})")),
                (a, b) => a.or(b),
            },
        }
    }
}

fn notification_matches(expr: &Expr<ForeignEntityLiteral>, present: u8) -> Option<bool> {
    match expr {
        Expr::Literal(ForeignEntityLiteral::NotificationState(state)) => {
            use item_filters::NotificationState::*;
            let bit = match state {
                Unseen => 1,
                Seen => 2,
                Done => 4,
            };
            Some(present & bit != 0)
        }
        Expr::And(a, b) => {
            let (a, b) = (
                notification_matches(a, present)?,
                notification_matches(b, present)?,
            );
            Some(a && b)
        }
        Expr::Or(a, b) => {
            let (a, b) = (
                notification_matches(a, present)?,
                notification_matches(b, present)?,
            );
            Some(a || b)
        }
        Expr::Not(expr) => notification_matches(expr, present).map(|v| !v),
        _ => None,
    }
}

fn notification_truth_table(expr: &Expr<ForeignEntityLiteral>) -> Option<u8> {
    (0..8).try_fold(0, |table, present| {
        notification_matches(expr, present).map(|matches| table | (u8::from(matches) << present))
    })
}

/// Literals that cannot be represented in the metadata jsonpath and must be lifted into dedicated
/// SQL predicates instead.
fn is_hoisted_literal(literal: &ForeignEntityLiteral) -> bool {
    matches!(
        literal,
        ForeignEntityLiteral::IncludesMe | ForeignEntityLiteral::NotificationState(_)
    )
}

fn contains_hoisted_literal(expr: &Expr<ForeignEntityLiteral>) -> bool {
    match expr {
        Expr::And(left, right) | Expr::Or(left, right) => {
            contains_hoisted_literal(left) || contains_hoisted_literal(right)
        }
        Expr::Not(inner) => contains_hoisted_literal(inner),
        Expr::Literal(literal) => is_hoisted_literal(literal),
    }
}

/// Lift participant predicates and pure notification subtrees off the AND spine.
/// Notification subtrees preserve their full boolean expression through a truth table;
/// other literals remain in the metadata jsonpath. Mixed OR/NOT subtrees fail closed.
fn extract_hoisted_filters(
    expr: &Expr<ForeignEntityLiteral>,
) -> Result<HoistedForeignEntityFilters, UnsupportedHoistedFilter> {
    if let Some(table) = notification_truth_table(expr) {
        return Ok(HoistedForeignEntityFilters {
            notification_matches: Some(table),
            ..Default::default()
        });
    }
    match expr {
        Expr::And(left, right) => {
            Ok(extract_hoisted_filters(left)?.and(extract_hoisted_filters(right)?))
        }
        Expr::Literal(ForeignEntityLiteral::IncludesMe) => Ok(HoistedForeignEntityFilters {
            includes_me: true,
            ..Default::default()
        }),
        other => {
            if contains_hoisted_literal(other) {
                Err(UnsupportedHoistedFilter)
            } else {
                Ok(HoistedForeignEntityFilters {
                    jsonpath: Some(foreign_entity_expr_jsonpath(other)),
                    ..Default::default()
                })
            }
        }
    }
}

fn foreign_entity_expr_jsonpath(expr: &Expr<ForeignEntityLiteral>) -> String {
    match expr {
        Expr::And(left, right) => format!(
            "({} && {})",
            foreign_entity_expr_jsonpath(left),
            foreign_entity_expr_jsonpath(right)
        ),
        Expr::Or(left, right) => format!(
            "({} || {})",
            foreign_entity_expr_jsonpath(left),
            foreign_entity_expr_jsonpath(right)
        ),
        Expr::Not(inner) => format!("(!{})", foreign_entity_expr_jsonpath(inner)),
        Expr::Literal(literal) => foreign_entity_literal_jsonpath(literal),
    }
}

fn foreign_entity_literal_jsonpath(literal: &ForeignEntityLiteral) -> String {
    match literal {
        ForeignEntityLiteral::Id(id) => jsonpath_text_eq("id", &id.to_string()),
        ForeignEntityLiteral::ForeignEntityId(id) => jsonpath_text_eq("foreignEntityId", id),
        ForeignEntityLiteral::ForeignEntitySource(source) => {
            jsonpath_text_eq("foreignEntitySource", source)
        }
        // IncludesMe and the notification literals are hoisted into dedicated SQL predicates by
        // extract_hoisted_filters and never reach the jsonpath; if one slips through, match nothing
        // rather than everything.
        ForeignEntityLiteral::IncludesMe | ForeignEntityLiteral::NotificationState(_) => {
            "(1 == 0)".to_string()
        }
    }
}

fn github_pull_request_expr_jsonpath(expr: &Expr<GithubPullRequestLiteral>) -> String {
    match expr {
        Expr::And(left, right) => format!(
            "({} && {})",
            github_pull_request_expr_jsonpath(left),
            github_pull_request_expr_jsonpath(right)
        ),
        Expr::Or(left, right) => format!(
            "({} || {})",
            github_pull_request_expr_jsonpath(left),
            github_pull_request_expr_jsonpath(right)
        ),
        Expr::Not(inner) => format!("(!{})", github_pull_request_expr_jsonpath(inner)),
        Expr::Literal(literal) => github_pull_request_literal_jsonpath(literal),
    }
}

fn github_pull_request_literal_jsonpath(literal: &GithubPullRequestLiteral) -> String {
    match literal {
        GithubPullRequestLiteral::RepositoryId(id) => format!("($.repositoryId == {id})"),
        GithubPullRequestLiteral::Author(id) => jsonpath_text_eq("authorId", id),
        GithubPullRequestLiteral::Status(state) => jsonpath_text_eq("status", state.as_str()),
        GithubPullRequestLiteral::Involves(id) => jsonpath_array_contains("participants", id),
        GithubPullRequestLiteral::ReviewRequested(id) => {
            jsonpath_array_contains("requestedReviewers", id)
        }
        GithubPullRequestLiteral::Draft(draft) => format!("($.draft == {draft})"),
        GithubPullRequestLiteral::Assignee(id) => jsonpath_array_contains("assignees", id),
        GithubPullRequestLiteral::Label(name) => jsonpath_array_contains("labels", name),
        GithubPullRequestLiteral::ReviewStatus(status) => {
            let decision = match status {
                GithubPullRequestReviewStatus::None => return "($.reviewCount == 0)".to_string(),
                GithubPullRequestReviewStatus::Required => {
                    GithubPullRequestReviewDecision::ReviewRequired
                }
                GithubPullRequestReviewStatus::Approved => {
                    GithubPullRequestReviewDecision::Approved
                }
                GithubPullRequestReviewStatus::ChangesRequested => {
                    GithubPullRequestReviewDecision::ChangesRequested
                }
            };
            jsonpath_text_eq("reviewDecision", decision.as_str())
        }
        GithubPullRequestLiteral::ReviewedBy(id) => jsonpath_array_contains("reviewers", id),
    }
}

fn jsonpath_array_contains(field_name: &str, expected_value: &str) -> String {
    let expected_value = serde_json::to_string(expected_value)
        .expect("serializing a string literal to JSON should not fail");
    format!("($.{field_name}[*] == {expected_value})")
}

fn jsonpath_text_eq(field_name: &str, expected_value: &str) -> String {
    let expected_value = serde_json::to_string(expected_value)
        .expect("serializing a string literal to JSON should not fail");
    format!("($.{field_name} == {expected_value})")
}

impl PgGithubPullRequestRepo {
    async fn fetch_listing(
        &self,
        query: ListingQuery<'_>,
    ) -> Result<Vec<ForeignEntity>, sqlx::Error> {
        let ListingQuery {
            source_ids,
            source_auth_entities,
            sort_method,
            filter_jsonpath,
            notification_user_id,
            notification_sets,
            cursor_id,
            cursor_value,
            limit,
            github_pull_request_jsonpath,
            ascending,
            entity_ids,
        } = query;
        let sort_method = sort_method.to_string();

        sqlx::query_as!(
            ForeignEntity,
            r#"
            WITH source_ids AS (
                SELECT DISTINCT stored_for_id, stored_for_auth_entity
                FROM UNNEST($1::text[], $2::text[])
                    AS source_rows(stored_for_id, stored_for_auth_entity)
            ),
            deduped AS (
                SELECT DISTINCT ON (fe.foreign_entity_source, fe.foreign_entity_id,
                    CASE WHEN $13::uuid[] IS NOT NULL THEN fe.id END)
                    fe.id,
                    fe.foreign_entity_id,
                    fe.foreign_entity_source,
                    fe.metadata,
                    fe.stored_for_id,
                    fe.stored_for_auth_entity,
                    fe.created_at,
                    COALESCE(gpr.github_updated_at, fe.updated_at) AS updated_at,
                    CASE $3::text
                        WHEN 'created_at' THEN fe.created_at
                        ELSE COALESCE(gpr.github_updated_at, fe.updated_at)
                    END AS sort_at
                FROM foreign_entity fe
                LEFT JOIN github_pull_request gpr ON gpr.github_key = fe.foreign_entity_id
                WHERE fe.foreign_entity_source = $10::text
                  AND ($13::uuid[] IS NULL OR fe.id = ANY($13))
                  AND EXISTS (
                    SELECT 1
                    FROM source_ids s
                    WHERE s.stored_for_id = fe.stored_for_id
                      AND s.stored_for_auth_entity = fe.stored_for_auth_entity
                )
                  AND (
                    $4::text IS NULL
                    OR jsonb_path_match(
                        jsonb_build_object(
                            'id', fe.id::text,
                            'foreignEntityId', fe.foreign_entity_id,
                            'foreignEntitySource', fe.foreign_entity_source
                        ),
                        ($4::text)::jsonpath
                    )
                  )
                  AND (
                    $11::text IS NULL
                    OR (gpr.github_key IS NOT NULL AND jsonb_path_match(
                        jsonb_build_object(
                            'repositoryId', gpr.repository_id,
                            'authorId', gpr.author_github_user_id,
                            'status', gpr.status,
                            'draft', gpr.draft,
                            'requestedReviewers', to_jsonb(gpr.requested_reviewer_github_user_ids),
                            'participants', to_jsonb(gpr.participant_github_user_ids),
                            'assignees', jsonb_path_query_array(gpr.assignees, '$[*].githubUserId'),
                            'labels', jsonb_path_query_array(gpr.labels, '$[*].name'),
                            'reviewers', jsonb_path_query_array(gpr.reviews, '$[*].reviewerGithubUserId'),
                            'reviewDecision', gpr.review_decision,
                            'reviewCount', jsonb_array_length(gpr.reviews)
                        ),
                        ($11::text)::jsonpath
                    ))
                  )
                  AND (
                    $8::int[] IS NULL
                    OR ($9::text IS NOT NULL AND (
                        SELECT COALESCE(bit_or(CASE un.state
                            WHEN 'unseen' THEN 1 WHEN 'seen' THEN 2 WHEN 'done' THEN 4 END), 0)
                        FROM notification n
                        JOIN user_notification un ON un.notification_id = n.id
                        WHERE un.user_id = $9::text
                          AND un.deleted_at IS NULL
                          AND n.event_item_type = 'foreign_entity'
                          AND n.event_item_id = fe.id::text
                    ) = ANY($8::int[]))
                  )
                ORDER BY
                    fe.foreign_entity_source,
                    fe.foreign_entity_id,
                    CASE WHEN $13::uuid[] IS NOT NULL THEN fe.id END,
                    sort_at DESC,
                    fe.updated_at DESC,
                    fe.id DESC
            )
            SELECT
                id as "id!: Uuid",
                foreign_entity_id as "foreign_entity_id!: String",
                foreign_entity_source as "foreign_entity_source!: String",
                metadata as "metadata!: serde_json::Value",
                stored_for_id as "stored_for_id!: String",
                stored_for_auth_entity as "stored_for_auth_entity!: String",
                created_at as "created_at!: DateTime<Utc>",
                updated_at as "updated_at!: DateTime<Utc>"
            FROM deduped
            WHERE $5::timestamptz IS NULL
               OR ($12::bool AND (sort_at, id) > ($5::timestamptz, $6::uuid))
               OR (NOT $12::bool AND (sort_at, id) < ($5::timestamptz, $6::uuid))
            ORDER BY
                CASE WHEN $12::bool THEN sort_at END ASC,
                CASE WHEN $12::bool THEN id END ASC,
                sort_at DESC,
                id DESC
            LIMIT $7
            "#,
            source_ids,
            source_auth_entities,
            sort_method,
            filter_jsonpath,
            cursor_value,
            cursor_id,
            limit,
            notification_sets,
            notification_user_id,
            GITHUB_PULL_REQUEST_FOREIGN_ENTITY_SOURCE,
            github_pull_request_jsonpath,
            ascending,
            entity_ids,
        )
        .fetch_all(&self.pool)
        .await
    }

    async fn github_user_id_for_macro_user(
        &self,
        macro_user_id: &str,
    ) -> Result<Option<String>, sqlx::Error> {
        sqlx::query_scalar!(
            r#"
            SELECT github_user_id
            FROM github_links
            WHERE macro_id = $1
            "#,
            macro_user_id,
        )
        .fetch_optional(&self.pool)
        .await
    }
}

impl GithubPullRequestListingRepository for PgGithubPullRequestRepo {
    type Err = sqlx::Error;

    #[tracing::instrument(err, skip(self, source_ids, query, github_pull_request_filter))]
    async fn list_pull_requests(
        &self,
        requesting_user: Option<String>,
        source_ids: Vec<SourceId>,
        limit: u32,
        query: ForeignEntityListQuery,
        github_pull_request_filter: LiteralTree<GithubPullRequestLiteral>,
        sort_direction: GithubPullRequestSortDirection,
    ) -> Result<Vec<ForeignEntity>, Self::Err> {
        if source_ids.is_empty() || limit == 0 {
            return Ok(Vec::new());
        }

        let entity_ids = query.filter().as_deref().and_then(exact_entity_ids);
        let HoistedForeignEntityFilters {
            includes_me,
            notification_matches,
            jsonpath: filter_jsonpath,
        } = match query
            .filter()
            .as_deref()
            .map(extract_hoisted_filters)
            .transpose()
        {
            Ok(hoisted) => hoisted.unwrap_or_default(),
            Err(UnsupportedHoistedFilter) => {
                tracing::warn!(
                    "IncludesMe or mixed metadata/notification literal under Or/Not in a foreign entity filter is unsupported; returning no results"
                );
                return Ok(Vec::new());
            }
        };

        // No possible set of notifications satisfies this boolean expression.
        // Different state literals joined by AND are not inherently contradictory.
        if notification_matches == Some(0) {
            return Ok(Vec::new());
        }

        // `fef: me` predates the GitHub pull request filter: it means the requesting user takes part
        // in the pull request, which is the pull request filter's `inv` literal for their GitHub id.
        let involves_me = if includes_me {
            let Some(requesting_user) = requesting_user.as_deref() else {
                return Ok(Vec::new());
            };
            match self.github_user_id_for_macro_user(requesting_user).await? {
                Some(github_user_id) => Some(Expr::val(GithubPullRequestLiteral::Involves(
                    github_user_id,
                ))),
                // No linked GitHub identity: the user participates in nothing.
                None => return Ok(Vec::new()),
            }
        } else {
            None
        };
        let github_pull_request_filter = match (github_pull_request_filter, involves_me) {
            (Some(filter), Some(involves_me)) => {
                Some(Expr::and(Arc::unwrap_or_clone(filter), involves_me))
            }
            (filter, involves_me) => filter.map(Arc::unwrap_or_clone).or(involves_me),
        };

        let notification_sets: Option<Vec<i32>> = notification_matches.map(|table| {
            (0..8)
                .filter(|present| table & (1 << present) != 0)
                .collect()
        });
        // Notification states are scoped to the requesting user's per-user notification row.
        // Without a requesting user the predicate matches nothing, so an active notification
        // filter yields no results (consistent with `fef: me` above).
        let notification_user_id = requesting_user.as_deref();

        let (source_ids, source_auth_entities) = source_id_parts(&source_ids);
        let (cursor_id, cursor_value) = query.vals();
        let github_pull_request_jsonpath = github_pull_request_filter
            .as_ref()
            .map(github_pull_request_expr_jsonpath);

        self.fetch_listing(ListingQuery {
            source_ids: &source_ids,
            source_auth_entities: &source_auth_entities,
            sort_method: *query.sort_method(),
            filter_jsonpath: if entity_ids.is_some() {
                None
            } else {
                filter_jsonpath.as_deref()
            },
            notification_user_id,
            notification_sets: notification_sets.as_deref(),
            cursor_id: cursor_id.copied(),
            cursor_value: cursor_value.copied(),
            limit: limit as i64,
            github_pull_request_jsonpath: github_pull_request_jsonpath.as_deref(),
            ascending: sort_direction == GithubPullRequestSortDirection::Asc,
            entity_ids: entity_ids.as_deref(),
        })
        .await
    }
}
