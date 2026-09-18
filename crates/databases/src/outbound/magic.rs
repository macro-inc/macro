//! Magic tables: platform data exposed to SQL, permission-scoped per viewer.
//!
//! Each magic table is a contract — a SQL name, a typed column list, and one
//! blessed, permission-filtered query that produces it on demand for a
//! viewer. All magic tables are read-only (enforced by the executor's
//! authorizer and by the catalog marking them unwritable).
//!
//! Shipped here:
//! - `documents(id, title, owner_id, created_at, updated_at)` — documents the
//!   viewer owns or holds an `entity_access` grant on.
//! - `people(id, name, email)` — the viewer and everyone sharing a team with
//!   them.

use entity_access::outbound::get_user_source_ids;
use model_entity::EntityType;
use rootcause::compat::IntoRootcause;
use sqlx::PgPool;

use crate::domain::models::{
    ColumnSchema, MaterializedTable, SqlType, SqlValue, TableSchema, TableSource, Viewer,
};
use crate::domain::ports::MagicTables;

/// Errors from magic-table materialization.
#[derive(Debug, thiserror::Error)]
pub enum MagicTablesError {
    /// The named table is not part of the registry.
    #[error("unknown magic table: {0}")]
    Unknown(String),
    /// A backing store failed.
    #[error("magic table backend error")]
    Backend(#[from] sqlx::Error),
    /// The viewer's `entity_access` source ids could not be resolved.
    #[error("failed to resolve viewer source ids: {0:?}")]
    SourceIds(rootcause::Report),
}

/// The registry of every magic-table source, dispatched by SQL name.
#[derive(Debug, Clone)]
pub struct MagicTableRegistry {
    pool: PgPool,
}

const DOCUMENTS: &str = "documents";
const PEOPLE: &str = "people";

fn column(name: &str, entity_type: Option<EntityType>) -> ColumnSchema {
    ColumnSchema {
        sql_name: name.to_string(),
        sql_type: SqlType::Text,
        data_type: None,
        is_multi_select: false,
        definition_id: None,
        entity_type,
        writable: false,
        allowed_values: None,
        not_null: name == "id",
    }
}

fn schema(name: &str, columns: Vec<ColumnSchema>) -> TableSchema {
    TableSchema {
        sql_name: name.to_string(),
        source: TableSource::Magic(name.to_string()),
        columns,
        primary_key: vec!["id".to_string()],
        foreign_keys: vec![],
        writable: false,
        aliases: vec![],
    }
}

fn documents_schema() -> TableSchema {
    schema(
        DOCUMENTS,
        vec![
            column("id", Some(EntityType::Document)),
            column("title", None),
            column("owner_id", Some(EntityType::User)),
            column("created_at", None),
            column("updated_at", None),
        ],
    )
}

fn people_schema() -> TableSchema {
    schema(
        PEOPLE,
        vec![
            column("id", Some(EntityType::User)),
            column("name", None),
            column("email", None),
        ],
    )
}

/// Most rows a magic table contributes; callers learn when the cap bit.
pub const MAGIC_ROW_CAP: usize = 20_000;

/// Keep only the requested columns (always keeping `id`), in schema order.
fn project(full: TableSchema, rows: Vec<Vec<SqlValue>>, requested: &[String]) -> MaterializedTable {
    if requested.is_empty() {
        return MaterializedTable { schema: full, rows };
    }
    let keep: Vec<usize> = full
        .columns
        .iter()
        .enumerate()
        .filter(|(_, c)| c.sql_name == "id" || requested.iter().any(|r| r == &c.sql_name))
        .map(|(i, _)| i)
        .collect();
    let columns = keep.iter().map(|&i| full.columns[i].clone()).collect();
    let rows = rows
        .into_iter()
        .map(|row| keep.iter().map(|&i| row[i].clone()).collect())
        .collect();
    MaterializedTable {
        schema: TableSchema { columns, ..full },
        rows,
    }
}

fn text(value: impl Into<String>) -> SqlValue {
    SqlValue::Text(value.into())
}

fn opt_text(value: Option<String>) -> SqlValue {
    value.map(SqlValue::Text).unwrap_or(SqlValue::Null)
}

impl MagicTableRegistry {
    /// Create the registry over MacroDB.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    async fn documents(&self, viewer: &Viewer) -> Result<Vec<Vec<SqlValue>>, MagicTablesError> {
        let user_id: &str = viewer.user_id.as_ref();
        // Source ids come from `entity_access` itself; see the note on
        // [`crate::outbound::pg_access_directory`].
        let source_ids = get_user_source_ids(&self.pool, Some(&viewer.user_id))
            .await
            .map_err(|e| MagicTablesError::SourceIds(e.into_rootcause()))?;
        let rows = sqlx::query!(
            r#"
            WITH accessible AS (
                SELECT DISTINCT entity_id
                FROM entity_access
                WHERE entity_type = 'document'
                  AND source_id = ANY($3)
            )
            SELECT
                d.id AS "id!",
                d.name AS "title!",
                d.owner AS "owner_id!",
                d."createdAt"::timestamptz AS "created_at!",
                d."updatedAt"::timestamptz AS "updated_at!"
            FROM "Document" d
            WHERE d."deletedAt" IS NULL
              AND (d.owner = $1 OR d.id::uuid IN (SELECT entity_id FROM accessible))
            ORDER BY d."updatedAt" DESC
            LIMIT $2
            "#,
            user_id,
            (MAGIC_ROW_CAP + 1) as i64,
            &source_ids.0,
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .into_iter()
            .map(|r| {
                vec![
                    text(r.id),
                    text(r.title),
                    text(r.owner_id),
                    text(r.created_at.to_rfc3339()),
                    text(r.updated_at.to_rfc3339()),
                ]
            })
            .collect())
    }

    async fn people(&self, viewer: &Viewer) -> Result<Vec<Vec<SqlValue>>, sqlx::Error> {
        let user_id: &str = viewer.user_id.as_ref();
        let rows = sqlx::query!(
            r#"
            SELECT u.id AS "id!", u.name, u.email AS "email!"
            FROM "User" u
            WHERE u.id = $1
               OR u.id IN (
                    SELECT teammate.user_id
                    FROM team_user mine
                    JOIN team_user teammate ON teammate.team_id = mine.team_id
                    WHERE mine.user_id = $1
               )
            ORDER BY u.email
            LIMIT $2
            "#,
            user_id,
            (MAGIC_ROW_CAP + 1) as i64,
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .into_iter()
            .map(|r| vec![text(r.id), opt_text(r.name), text(r.email)])
            .collect())
    }
}

impl MagicTables for MagicTableRegistry {
    type Err = MagicTablesError;

    fn schemas(&self) -> Vec<TableSchema> {
        vec![documents_schema(), people_schema()]
    }

    #[tracing::instrument(skip(self, viewer), err)]
    async fn materialize(
        &self,
        viewer: &Viewer,
        sql_name: &str,
        columns: &[String],
    ) -> Result<(MaterializedTable, bool), Self::Err> {
        let (schema, mut rows) = match sql_name {
            DOCUMENTS => (documents_schema(), self.documents(viewer).await?),
            PEOPLE => (people_schema(), self.people(viewer).await?),
            other => return Err(MagicTablesError::Unknown(other.to_string())),
        };
        let truncated = rows.len() > MAGIC_ROW_CAP;
        rows.truncate(MAGIC_ROW_CAP);
        Ok((project(schema, rows, columns), truncated))
    }
}
