//! Database row search reads: the `database_rows` index for proposals, and
//! the primary database for everything that decides what is shown, with
//! access read through the caller's memberships as they are now (never the
//! few-second source id cache other checks share).

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use entity_access::domain::ports::CurrentDatabaseAccess;
use macro_user_id::{lowercased::Lowercase, user_id::MacroUserId};
use opensearch_client::OpensearchClient;
use opensearch_client::search::database_rows::{
    DatabaseRowMatchType, DatabaseRowPosition, DatabaseRowSearchArgs,
};
use rootcause::Report;
use uuid::Uuid;

use crate::api::context::SearchEntityAccessService;
use crate::domain::database_rows::{
    CurrentRow, DatabaseRowSource, ProposalRequest, ProposedRow, RowMatchType, RowPosition,
};

#[cfg(test)]
mod test;

pub(crate) struct DatabaseRowPgSource {
    /// The primary: a replica can lag a revoked grant or a trashed database.
    pub primary_db: sqlx::PgPool,
    pub entity_access: Arc<SearchEntityAccessService>,
    pub opensearch: Arc<OpensearchClient>,
}

/// The names a shown row is placed by.
struct RowPlace {
    database_name: String,
    table_name: String,
}

impl DatabaseRowPgSource {
    /// The database and table names of those of `row_ids` whose database is
    /// a live app entity.
    async fn row_places(&self, row_ids: &[Uuid]) -> Result<HashMap<Uuid, RowPlace>, Report> {
        let rows = sqlx::query!(
            r#"
            SELECT r.id AS "row_id!", de.name AS "database_name!", t.name AS "table_name!"
            FROM database_rows r
            JOIN database_tables t ON t.id = r.table_id
            JOIN database_entities de ON de.database_id = t.database_id
            WHERE r.id = ANY($1)
                AND de.trashed_at IS NULL
            "#,
            row_ids,
        )
        .fetch_all(&self.primary_db)
        .await
        .map_err(|error| Report::new(error).into_dynamic())?;
        Ok(rows
            .into_iter()
            .map(|row| {
                (
                    row.row_id,
                    RowPlace {
                        database_name: row.database_name,
                        table_name: row.table_name,
                    },
                )
            })
            .collect())
    }
}

impl DatabaseRowSource for DatabaseRowPgSource {
    async fn viewable_database_ids(
        &self,
        user: &MacroUserId<Lowercase<'_>>,
    ) -> Result<Vec<Uuid>, Report> {
        // Every grant a database has is at least View.
        let databases = self
            .entity_access
            .current_accessible_databases(user)
            .await
            .map_err(|error| Report::new(error).into_dynamic())?;
        Ok(databases
            .into_iter()
            .map(|(database_id, _)| database_id)
            .collect())
    }

    async fn propose(&self, request: ProposalRequest<'_>) -> Result<Vec<ProposedRow>, Report> {
        let positions = self
            .opensearch
            .search_database_rows(&DatabaseRowSearchArgs {
                database_ids: request.database_ids.to_vec(),
                terms: request.terms.to_vec(),
                match_type: match request.match_type {
                    RowMatchType::Partial => DatabaseRowMatchType::Partial,
                    RowMatchType::Exact => DatabaseRowMatchType::Exact,
                },
                after: request.after.map(|after| DatabaseRowPosition {
                    updated_at: after.updated_at,
                    row_id: after.row_id,
                }),
                limit: request.limit,
            })
            .await
            .map_err(|error| Report::new(error).into_dynamic())?;
        Ok(positions
            .into_iter()
            .map(|position| ProposedRow {
                row_id: position.row_id,
                position: RowPosition {
                    updated_at: position.updated_at,
                    row_id: position.row_id,
                },
            })
            .collect())
    }

    async fn viewable_rows(
        &self,
        user: &MacroUserId<Lowercase<'_>>,
        row_ids: &[Uuid],
    ) -> Result<HashSet<Uuid>, Report> {
        self.entity_access
            .current_viewable_database_rows(user, row_ids)
            .await
            .map_err(|error| Report::new(error).into_dynamic())
    }

    async fn current_rows(&self, row_ids: &[Uuid]) -> Result<Vec<CurrentRow>, Report> {
        let mut places = self.row_places(row_ids).await?;
        let texts = database_row_search::read_row_search_text(&self.primary_db, row_ids)
            .await
            .map_err(|error| Report::new(error).into_dynamic())?;
        // A row read by one and not the other changed between the two reads;
        // it is left out.
        Ok(texts
            .into_iter()
            .filter_map(|text| {
                let place = places.remove(&text.row_id)?;
                Some(CurrentRow {
                    row_id: text.row_id,
                    table_id: text.table_id,
                    database_id: text.database_id,
                    database_name: place.database_name,
                    table_name: place.table_name,
                    title: text.title,
                    cell_text: text.cell_text,
                    updated_at: text.updated_at,
                })
            })
            .collect())
    }
}
