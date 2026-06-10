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

/// Marker error for filters that place [`ForeignEntityLiteral::IncludesMe`] somewhere it cannot
/// be hoisted into the dedicated SQL predicate (under `Or`/`Not`).
struct UnsupportedIncludesMe;

fn contains_includes_me(expr: &Expr<ForeignEntityLiteral>) -> bool {
    match expr {
        Expr::And(left, right) | Expr::Or(left, right) => {
            contains_includes_me(left) || contains_includes_me(right)
        }
        Expr::Not(inner) => contains_includes_me(inner),
        Expr::Literal(literal) => matches!(literal, ForeignEntityLiteral::IncludesMe),
    }
}

/// Strip [`ForeignEntityLiteral::IncludesMe`] literals off the top-level AND spine of a filter
/// tree, returning the flag and the jsonpath for the residual filter. The literal cannot be
/// expressed in the jsonpath (it needs the indexed metadata containment predicate), so any
/// occurrence under `Or`/`Not` is an error.
fn extract_includes_me(
    expr: &Expr<ForeignEntityLiteral>,
) -> Result<(bool, Option<String>), UnsupportedIncludesMe> {
    match expr {
        Expr::And(left, right) => {
            let (left_me, left_jsonpath) = extract_includes_me(left)?;
            let (right_me, right_jsonpath) = extract_includes_me(right)?;
            let jsonpath = match (left_jsonpath, right_jsonpath) {
                (Some(left), Some(right)) => Some(format!("({left} && {right})")),
                (left, right) => left.or(right),
            };
            Ok((left_me || right_me, jsonpath))
        }
        Expr::Literal(ForeignEntityLiteral::IncludesMe) => Ok((true, None)),
        other => {
            if contains_includes_me(other) {
                Err(UnsupportedIncludesMe)
            } else {
                Ok((false, Some(foreign_entity_expr_jsonpath(other))))
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
        // IncludesMe is hoisted into a dedicated SQL predicate by extract_includes_me and never
        // reaches the jsonpath; if one slips through, match nothing rather than everything.
        ForeignEntityLiteral::IncludesMe => "(1 == 0)".to_string(),
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

        let (includes_me, filter_jsonpath) = match query
            .filter()
            .as_deref()
            .map(extract_includes_me)
            .transpose()
        {
            Ok(split) => split.unwrap_or((false, None)),
            Err(UnsupportedIncludesMe) => {
                tracing::warn!(
                    "IncludesMe under Or/Not in a foreign entity filter is unsupported; returning no results"
                );
                return Ok(Vec::new());
            }
        };

        let participant_github_user_id = if includes_me {
            let Some(requesting_user) = requesting_user else {
                return Ok(Vec::new());
            };
            match self.github_user_id_for_macro_user(&requesting_user).await? {
                Some(github_user_id) => Some(github_user_id),
                // No linked GitHub identity: the user participates in nothing.
                None => return Ok(Vec::new()),
            }
        } else {
            None
        };

        let (source_ids, source_auth_entities) = source_id_parts(&source_ids);
        let (cursor_id, cursor_value) = query.vals();

        self.get_foreign_entities_for_user_batch(ForeignEntityBatchQuery {
            source_ids: &source_ids,
            source_auth_entities: &source_auth_entities,
            sort_method: *query.sort_method(),
            filter_jsonpath: filter_jsonpath.as_deref(),
            participant_github_user_id: participant_github_user_id.as_deref(),
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
