//! PostgreSQL implementation of the [`ForeignEntityRepository`] port.

#[cfg(test)]
mod tests;

use chrono::{DateTime, Utc};
use filter_ast::Expr;
use item_filters::ast::foreign_entity::ForeignEntityLiteral;
use models_pagination::SimpleSortMethod;
use sqlx::PgPool;
use uuid::Uuid;

use crate::domain::models::{CreateForeignEntity, ForeignEntity, PatchForeignEntity, SourceId};
use crate::domain::ports::{ForeignEntityListQuery, ForeignEntityRepository};

struct ForeignEntityBatchQuery<'a> {
    source_ids: &'a [String],
    source_auth_entities: &'a [String],
    sort_method: SimpleSortMethod,
    filter_jsonpath: Option<&'a str>,
    participant_github_user_id: Option<&'a str>,
    /// Macro user id used to scope the per-user notification done/seen predicates.
    /// When a notification filter is requested but this is `None`, nothing matches.
    notification_user_id: Option<&'a str>,
    /// `Some(true)`/`Some(false)` keeps entities whose notification is/ isn't done; `None` ignores.
    notification_done: Option<bool>,
    /// `Some(true)`/`Some(false)` keeps entities whose notification is/ isn't seen; `None` ignores.
    notification_seen: Option<bool>,
    cursor_id: Option<Uuid>,
    cursor_value: Option<DateTime<Utc>>,
    limit: i64,
}

fn source_id_parts(source_ids: &[SourceId]) -> (Vec<String>, Vec<String>) {
    source_ids
        .iter()
        .map(|source_id| (source_id.id.clone(), source_id.auth_entity.clone()))
        .unzip()
}

/// Marker error for filters that place a hoisted literal (see [`is_hoisted_literal`]) somewhere it
/// cannot be lifted into a dedicated SQL predicate (under `Or`/`Not`).
struct UnsupportedHoistedFilter;

/// Filters lifted off the top-level AND spine into dedicated SQL predicates because they cannot be
/// expressed in the metadata jsonpath (they need indexed-containment or notification-table joins).
#[derive(Default)]
struct HoistedForeignEntityFilters {
    /// Whether the requesting user must be a participant in the entity's metadata.
    includes_me: bool,
    /// Notification done filter for the requesting user (`None` ignores).
    notification_done: Option<bool>,
    /// Notification seen filter for the requesting user (`None` ignores).
    notification_seen: Option<bool>,
    /// True when the AND spine carries contradictory predicates (e.g. done=true AND done=false),
    /// in which case the whole filter is unsatisfiable and must match nothing.
    unsatisfiable: bool,
    /// jsonpath for the residual (non-hoisted) filter, if any.
    jsonpath: Option<String>,
}

impl HoistedForeignEntityFilters {
    /// Combine two `Option<bool>` predicates taken from the two sides of an `And`. Returns the
    /// merged value plus whether the two sides contradicted each other (true AND false).
    fn merge_bool_filter(a: Option<bool>, b: Option<bool>) -> (Option<bool>, bool) {
        match (a, b) {
            (Some(x), Some(y)) if x != y => (None, true),
            (Some(x), Some(_)) => (Some(x), false),
            (Some(x), None) | (None, Some(x)) => (Some(x), false),
            (None, None) => (None, false),
        }
    }

    /// Combine two extracted filter halves taken from the two sides of an `And`.
    fn and(self, other: Self) -> Self {
        let (notification_done, done_conflict) =
            Self::merge_bool_filter(self.notification_done, other.notification_done);
        let (notification_seen, seen_conflict) =
            Self::merge_bool_filter(self.notification_seen, other.notification_seen);

        let jsonpath = match (self.jsonpath, other.jsonpath) {
            (Some(left), Some(right)) => Some(format!("({left} && {right})")),
            (left, right) => left.or(right),
        };
        Self {
            includes_me: self.includes_me || other.includes_me,
            notification_done,
            notification_seen,
            unsatisfiable: self.unsatisfiable
                || other.unsatisfiable
                || done_conflict
                || seen_conflict,
            jsonpath,
        }
    }
}

/// Literals that cannot be represented in the metadata jsonpath and must be lifted into dedicated
/// SQL predicates instead.
fn is_hoisted_literal(literal: &ForeignEntityLiteral) -> bool {
    matches!(
        literal,
        ForeignEntityLiteral::IncludesMe
            | ForeignEntityLiteral::NotificationDone(_)
            | ForeignEntityLiteral::NotificationSeen(_)
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

/// Strip hoisted literals ([`ForeignEntityLiteral::IncludesMe`], notification done/seen) off the
/// top-level AND spine of a filter tree, returning them alongside the jsonpath for the residual
/// filter. Hoisted literals cannot be expressed in the jsonpath (they need the indexed metadata
/// containment predicate or a join against the notification tables), so any occurrence under
/// `Or`/`Not` is an error.
fn extract_hoisted_filters(
    expr: &Expr<ForeignEntityLiteral>,
) -> Result<HoistedForeignEntityFilters, UnsupportedHoistedFilter> {
    match expr {
        Expr::And(left, right) => {
            Ok(extract_hoisted_filters(left)?.and(extract_hoisted_filters(right)?))
        }
        Expr::Literal(ForeignEntityLiteral::IncludesMe) => Ok(HoistedForeignEntityFilters {
            includes_me: true,
            ..Default::default()
        }),
        Expr::Literal(ForeignEntityLiteral::NotificationDone(done)) => {
            Ok(HoistedForeignEntityFilters {
                notification_done: Some(*done),
                ..Default::default()
            })
        }
        Expr::Literal(ForeignEntityLiteral::NotificationSeen(seen)) => {
            Ok(HoistedForeignEntityFilters {
                notification_seen: Some(*seen),
                ..Default::default()
            })
        }
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
        ForeignEntityLiteral::IncludesMe
        | ForeignEntityLiteral::NotificationDone(_)
        | ForeignEntityLiteral::NotificationSeen(_) => "(1 == 0)".to_string(),
    }
}

fn jsonpath_text_eq(field_name: &str, expected_value: &str) -> String {
    let expected_value = serde_json::to_string(expected_value)
        .expect("serializing a string literal to JSON should not fail");
    format!("($.{field_name} == {expected_value})")
}

/// PostgreSQL-backed foreign entity repository.
#[derive(Clone)]
pub struct PgForeignEntityRepo {
    pool: PgPool,
}

impl PgForeignEntityRepo {
    /// Create a new repository backed by the given connection pool.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    async fn get_foreign_entities_for_user_batch(
        &self,
        query: ForeignEntityBatchQuery<'_>,
    ) -> Result<Vec<ForeignEntity>, sqlx::Error> {
        let ForeignEntityBatchQuery {
            source_ids,
            source_auth_entities,
            sort_method,
            filter_jsonpath,
            participant_github_user_id,
            notification_user_id,
            notification_done,
            notification_seen,
            cursor_id,
            cursor_value,
            limit,
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
                SELECT DISTINCT ON (fe.foreign_entity_source, fe.foreign_entity_id)
                    fe.id,
                    fe.foreign_entity_id,
                    fe.foreign_entity_source,
                    fe.metadata,
                    fe.stored_for_id,
                    fe.stored_for_auth_entity,
                    fe.created_at,
                    fe.updated_at,
                    CASE $3::text
                        WHEN 'created_at' THEN fe.created_at
                        ELSE fe.updated_at
                    END AS sort_at
                FROM foreign_entity fe
                WHERE EXISTS (
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
                    $8::text IS NULL
                    OR (fe.metadata -> 'participantGithubUserIds') ? $8::text
                  )
                  AND (
                    $9::bool IS NULL
                    OR EXISTS (
                        SELECT 1
                        FROM notification n
                        JOIN user_notification un ON un.notification_id = n.id
                        WHERE un.user_id = $11::text
                          AND un.deleted_at IS NULL
                          AND n.event_item_type = 'foreign_entity'
                          AND n.event_item_id = fe.id::text
                          AND un.done = $9::bool
                    )
                  )
                  AND (
                    $10::bool IS NULL
                    OR EXISTS (
                        SELECT 1
                        FROM notification n
                        JOIN user_notification un ON un.notification_id = n.id
                        WHERE un.user_id = $11::text
                          AND un.deleted_at IS NULL
                          AND n.event_item_type = 'foreign_entity'
                          AND n.event_item_id = fe.id::text
                          AND (un.seen_at IS NOT NULL) = $10::bool
                    )
                  )
                ORDER BY fe.foreign_entity_source, fe.foreign_entity_id, sort_at DESC, fe.id DESC
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
               OR (sort_at, id) < ($5::timestamptz, $6::uuid)
            ORDER BY sort_at DESC, id DESC
            LIMIT $7
            "#,
            source_ids,
            source_auth_entities,
            sort_method,
            filter_jsonpath,
            cursor_value,
            cursor_id,
            limit,
            participant_github_user_id,
            notification_done,
            notification_seen,
            notification_user_id,
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

impl ForeignEntityRepository for PgForeignEntityRepo {
    type Err = sqlx::Error;

    #[tracing::instrument(err, skip(self))]
    async fn get_foreign_entity_by_id(&self, id: Uuid) -> Result<Option<ForeignEntity>, Self::Err> {
        sqlx::query_as!(
            ForeignEntity,
            r#"
            SELECT
                id as "id!: Uuid",
                foreign_entity_id as "foreign_entity_id!: String",
                foreign_entity_source as "foreign_entity_source!: String",
                metadata as "metadata!: serde_json::Value",
                stored_for_id as "stored_for_id!: String",
                stored_for_auth_entity as "stored_for_auth_entity!: String",
                created_at as "created_at!: DateTime<Utc>",
                updated_at as "updated_at!: DateTime<Utc>"
            FROM foreign_entity
            WHERE id = $1
            LIMIT 1
            "#,
            id,
        )
        .fetch_optional(&self.pool)
        .await
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_foreign_entities_by_foreign_entity_id(
        &self,
        foreign_entity_id: &str,
        foreign_entity_source: Option<&str>,
    ) -> Result<Vec<ForeignEntity>, Self::Err> {
        sqlx::query_as!(
            ForeignEntity,
            r#"
            SELECT
                id as "id!: Uuid",
                foreign_entity_id as "foreign_entity_id!: String",
                foreign_entity_source as "foreign_entity_source!: String",
                metadata as "metadata!: serde_json::Value",
                stored_for_id as "stored_for_id!: String",
                stored_for_auth_entity as "stored_for_auth_entity!: String",
                created_at as "created_at!: DateTime<Utc>",
                updated_at as "updated_at!: DateTime<Utc>"
            FROM foreign_entity
            WHERE foreign_entity_id = $1
              AND ($2::text IS NULL OR foreign_entity_source = $2)
            ORDER BY created_at ASC, id ASC
            "#,
            foreign_entity_id,
            foreign_entity_source,
        )
        .fetch_all(&self.pool)
        .await
    }

    #[tracing::instrument(err, skip(self, source_ids, query))]
    async fn get_foreign_entities_for_user(
        &self,
        requesting_user: Option<String>,
        source_ids: Vec<SourceId>,
        limit: u32,
        query: ForeignEntityListQuery,
    ) -> Result<Vec<ForeignEntity>, Self::Err> {
        if source_ids.is_empty() || limit == 0 {
            return Ok(Vec::new());
        }

        let HoistedForeignEntityFilters {
            includes_me,
            notification_done,
            notification_seen,
            unsatisfiable,
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
                    "IncludesMe/notification literal under Or/Not in a foreign entity filter is unsupported; returning no results"
                );
                return Ok(Vec::new());
            }
        };

        // Contradictory predicates on the AND spine (e.g. done=true AND done=false) can never
        // match, so short-circuit before doing any work.
        if unsatisfiable {
            return Ok(Vec::new());
        }

        let participant_github_user_id = if includes_me {
            let Some(requesting_user) = requesting_user.as_deref() else {
                return Ok(Vec::new());
            };
            match self.github_user_id_for_macro_user(requesting_user).await? {
                Some(github_user_id) => Some(github_user_id),
                // No linked GitHub identity: the user participates in nothing.
                None => return Ok(Vec::new()),
            }
        } else {
            None
        };

        // Notification done/seen are scoped to the requesting user's per-user notification row.
        // Without a requesting user the predicate matches nothing, so an active notification
        // filter yields no results (consistent with the participant filter above).
        let notification_user_id = requesting_user.as_deref();

        let (source_ids, source_auth_entities) = source_id_parts(&source_ids);
        let (cursor_id, cursor_value) = query.vals();

        self.get_foreign_entities_for_user_batch(ForeignEntityBatchQuery {
            source_ids: &source_ids,
            source_auth_entities: &source_auth_entities,
            sort_method: *query.sort_method(),
            filter_jsonpath: filter_jsonpath.as_deref(),
            participant_github_user_id: participant_github_user_id.as_deref(),
            notification_user_id,
            notification_done,
            notification_seen,
            cursor_id: cursor_id.copied(),
            cursor_value: cursor_value.copied(),
            limit: limit as i64,
        })
        .await
    }

    #[tracing::instrument(err, skip(self, create))]
    async fn create_foreign_entity(
        &self,
        id: Uuid,
        create: CreateForeignEntity,
    ) -> Result<ForeignEntity, Self::Err> {
        sqlx::query_as!(
            ForeignEntity,
            r#"
            INSERT INTO foreign_entity (
                id,
                foreign_entity_id,
                foreign_entity_source,
                metadata,
                stored_for_id,
                stored_for_auth_entity
            )
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING
                id as "id!: Uuid",
                foreign_entity_id as "foreign_entity_id!: String",
                foreign_entity_source as "foreign_entity_source!: String",
                metadata as "metadata!: serde_json::Value",
                stored_for_id as "stored_for_id!: String",
                stored_for_auth_entity as "stored_for_auth_entity!: String",
                created_at as "created_at!: DateTime<Utc>",
                updated_at as "updated_at!: DateTime<Utc>"
            "#,
            id,
            create.foreign_entity_id,
            create.foreign_entity_source,
            create.metadata,
            create.stored_for_id,
            create.stored_for_auth_entity,
        )
        .fetch_one(&self.pool)
        .await
    }

    #[tracing::instrument(err, skip(self))]
    async fn delete_foreign_entity(&self, id: Uuid) -> Result<bool, Self::Err> {
        let result = sqlx::query!(
            r#"
            DELETE FROM foreign_entity
            WHERE id = $1
            "#,
            id,
        )
        .execute(&self.pool)
        .await?;

        Ok(result.rows_affected() > 0)
    }

    #[tracing::instrument(err, skip(self, patch))]
    async fn patch_foreign_entity(
        &self,
        id: Uuid,
        patch: PatchForeignEntity,
    ) -> Result<Option<ForeignEntity>, Self::Err> {
        let PatchForeignEntity {
            foreign_entity_id,
            foreign_entity_source,
            metadata,
            stored_for_id,
            stored_for_auth_entity,
        } = patch;

        sqlx::query_as!(
            ForeignEntity,
            r#"
            UPDATE foreign_entity
            SET foreign_entity_id = COALESCE($2::text, foreign_entity_id),
                foreign_entity_source = COALESCE($3::text, foreign_entity_source),
                metadata = COALESCE($4::jsonb, metadata),
                stored_for_id = COALESCE($5::text, stored_for_id),
                stored_for_auth_entity = COALESCE($6::text, stored_for_auth_entity),
                updated_at = NOW()
            WHERE id = $1
            RETURNING
                id as "id!: Uuid",
                foreign_entity_id as "foreign_entity_id!: String",
                foreign_entity_source as "foreign_entity_source!: String",
                metadata as "metadata!: serde_json::Value",
                stored_for_id as "stored_for_id!: String",
                stored_for_auth_entity as "stored_for_auth_entity!: String",
                created_at as "created_at!: DateTime<Utc>",
                updated_at as "updated_at!: DateTime<Utc>"
            "#,
            id,
            foreign_entity_id,
            foreign_entity_source,
            metadata,
            stored_for_id,
            stored_for_auth_entity,
        )
        .fetch_optional(&self.pool)
        .await
    }
}
