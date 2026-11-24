//! Database row search: which rows a search may show, and what it shows.
//!
//! The `database_rows` index only proposes rows. Its text can be older than
//! the row, and the caller's access can have changed since it was written, so
//! nothing it holds is shown and nothing is shown because of it. Each proposed
//! row is shown only when, read from Postgres for this search, the caller can
//! view its database, the database is a live app entity (not trashed, not CRM
//! storage), the row and its table exist, and the row's current text still
//! matches every term. The title and snippet are cut from that text.
//!
//! A page is filled with shown rows only, reading further proposals until it
//! holds one more row than it returns, the proposals end, or
//! [`MAX_ROUNDS`] reads. A next page exists only when that extra row was
//! found, and it resumes after the last row shown, so neither the page size,
//! the cursor nor whether there is more says anything about a row the caller
//! may not see.

use std::collections::{HashMap, HashSet};

use chrono::{DateTime, Utc};
use macro_user_id::{lowercased::Lowercase, user_id::MacroUserId};
use models_search::database_row::DatabaseRowSearchResponseItem;
use rootcause::Report;
use uuid::Uuid;

pub(crate) mod matching;

pub(crate) use matching::{RowMatchType, RowQuery};

#[cfg(test)]
mod test;

/// Most reads of proposed rows one page makes. A page that reaches it with
/// fewer rows than it can hold ends the search there: a next page is only
/// ever promised by a row the caller may see.
pub(crate) const MAX_ROUNDS: u8 = 5;

/// Most databases one search narrows the index to. Each is a term in the
/// OpenSearch filter, which refuses more than 65,536; a caller past it
/// searches the ones most recently updated.
pub(crate) const MAX_SEARCHED_DATABASES: usize = 10_000;

/// Fewest rows proposed per read, so a small page still skips past a few
/// rows the caller may not see in one read.
const MIN_PROPOSALS_PER_ROUND: u32 = 25;

/// Where a page of rows resumes: after the row with this position in the
/// index's order (newest write first, then row id).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct RowPosition {
    pub updated_at: DateTime<Utc>,
    pub row_id: Uuid,
}

/// One row the index proposes, at its place in the index's order.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct ProposedRow {
    pub row_id: Uuid,
    pub position: RowPosition,
}

/// What the index is asked for.
#[derive(Debug, Clone)]
pub(crate) struct ProposalRequest<'a> {
    /// Only rows of these databases.
    pub database_ids: &'a [Uuid],
    pub terms: &'a [String],
    pub match_type: RowMatchType,
    /// Rows after this position; from the first when `None`.
    pub after: Option<RowPosition>,
    pub limit: u32,
}

/// A row as Postgres holds it now, for a row whose table and database
/// exist and whose database is a live, untrashed app entity.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct CurrentRow {
    pub row_id: Uuid,
    pub table_id: Uuid,
    pub database_id: Uuid,
    pub database_name: String,
    pub table_name: String,
    /// The row's title cell as plain text.
    pub title: String,
    /// The row's searchable cells as plain text, by the index's rules.
    pub cell_text: Vec<String>,
    pub updated_at: DateTime<Utc>,
}

/// Reads row search needs. Every read except [`Self::propose`] is fresh:
/// Postgres's primary, no cache.
pub(crate) trait DatabaseRowSource {
    /// Who searches, as their access stands when the search starts: read once
    /// and checked against for the whole page.
    type Viewer: Send + Sync;

    /// The caller as they are now.
    fn viewer(
        &self,
        user: &MacroUserId<Lowercase<'_>>,
    ) -> impl Future<Output = Result<Self::Viewer, Report>> + Send;

    /// The databases the viewer may view, to narrow what the index proposes.
    fn viewable_database_ids(
        &self,
        viewer: &Self::Viewer,
    ) -> impl Future<Output = Result<Vec<Uuid>, Report>> + Send;

    /// The `limit` of `database_ids` updated most recently, for a caller who
    /// views more databases than one search reaches.
    fn most_recent_databases(
        &self,
        database_ids: &[Uuid],
        limit: usize,
    ) -> impl Future<Output = Result<Vec<Uuid>, Report>> + Send;

    /// Rows the index proposes, in its order. Fewer than `limit` means there
    /// are no more.
    fn propose(
        &self,
        request: ProposalRequest<'_>,
    ) -> impl Future<Output = Result<Vec<ProposedRow>, Report>> + Send;

    /// Which of `row_ids` the viewer may view, through their access to each
    /// row's database.
    fn viewable_rows(
        &self,
        viewer: &Self::Viewer,
        row_ids: &[Uuid],
    ) -> impl Future<Output = Result<HashSet<Uuid>, Report>> + Send;

    /// The current state of those of `row_ids` that still exist in a live
    /// database. Rows of a trashed database, CRM storage, or a deleted row,
    /// table or database are left out.
    fn current_rows(
        &self,
        row_ids: &[Uuid],
    ) -> impl Future<Output = Result<Vec<CurrentRow>, Report>> + Send;
}

/// One row a page shows.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ShownRow {
    /// Its place in the index's order, which pages resume from.
    pub position: RowPosition,
    pub item: DatabaseRowSearchResponseItem,
}

/// One page of rows.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub(crate) struct RowPage {
    pub rows: Vec<ShownRow>,
    /// Where the next page resumes; `None` when there is no next page.
    pub next: Option<RowPosition>,
    pub stats: RowPageStats,
}

/// What filling a page read, for the search span.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub(crate) struct RowPageStats {
    pub rounds: u8,
    pub proposed: usize,
    pub shown: usize,
    /// It stopped at [`MAX_ROUNDS`] with proposals left and the page short.
    pub bound_reached: bool,
    /// The caller views more than [`MAX_SEARCHED_DATABASES`] databases, so
    /// only the first ones were searched.
    pub databases_capped: bool,
}

pub(crate) struct DatabaseRowSearch<Source>(pub Source);

impl<Source: DatabaseRowSource> DatabaseRowSearch<Source> {
    /// The page of rows matching `query` after `after`, at most `limit`.
    pub(crate) async fn page(
        &self,
        user: &MacroUserId<Lowercase<'_>>,
        query: &RowQuery,
        terms: &[String],
        limit: u32,
        after: Option<RowPosition>,
    ) -> Result<RowPage, Report> {
        if limit == 0 {
            return Ok(RowPage::default());
        }
        let viewer = self.0.viewer(user).await?;
        let mut database_ids = self.0.viewable_database_ids(&viewer).await?;
        if database_ids.is_empty() {
            return Ok(RowPage::default());
        }
        let databases_capped = database_ids.len() > MAX_SEARCHED_DATABASES;
        if databases_capped {
            database_ids = self
                .0
                .most_recent_databases(&database_ids, MAX_SEARCHED_DATABASES)
                .await?;
        }

        // One more row than the page returns proves a next page exists.
        let wanted = limit as usize + 1;
        let proposals_per_round = (limit + 1).max(MIN_PROPOSALS_PER_ROUND);
        let mut shown: Vec<ShownRow> = Vec::new();
        let mut stats = RowPageStats {
            databases_capped,
            ..RowPageStats::default()
        };
        let mut read_after = after;
        let mut proposals_left = true;

        while shown.len() < wanted && proposals_left && stats.rounds < MAX_ROUNDS {
            stats.rounds += 1;
            let proposed = self
                .0
                .propose(ProposalRequest {
                    database_ids: &database_ids,
                    terms,
                    match_type: query.match_type(),
                    after: read_after,
                    limit: proposals_per_round,
                })
                .await?;
            stats.proposed += proposed.len();
            proposals_left = proposed.len() >= proposals_per_round as usize;
            let Some(last) = proposed.last() else {
                break;
            };
            read_after = Some(last.position);

            let row_ids: Vec<Uuid> = proposed.iter().map(|row| row.row_id).collect();
            let viewable = self.0.viewable_rows(&viewer, &row_ids).await?;
            // Only rows the caller may view are read at all.
            let viewable_ids: Vec<Uuid> = row_ids
                .iter()
                .copied()
                .filter(|row_id| viewable.contains(row_id))
                .collect();
            let mut current: HashMap<Uuid, CurrentRow> = if viewable_ids.is_empty() {
                HashMap::new()
            } else {
                self.0
                    .current_rows(&viewable_ids)
                    .await?
                    .into_iter()
                    .map(|row| (row.row_id, row))
                    .collect()
            };

            for proposal in proposed {
                if shown.len() == wanted {
                    break;
                }
                if !viewable.contains(&proposal.row_id) {
                    continue;
                }
                let Some(row) = current.remove(&proposal.row_id) else {
                    continue;
                };
                if let Some(item) = shown_item(query, row) {
                    shown.push(ShownRow {
                        position: proposal.position,
                        item,
                    });
                }
            }
        }

        stats.bound_reached = stats.rounds >= MAX_ROUNDS && proposals_left && shown.len() < wanted;
        let has_more = shown.len() == wanted;
        if has_more {
            shown.pop();
        }
        stats.shown = shown.len();
        let next = if has_more {
            shown.last().map(|row| row.position)
        } else {
            None
        };
        Ok(RowPage {
            rows: shown,
            next,
            stats,
        })
    }
}

/// The item a row shows when its current text matches `query`.
fn shown_item(query: &RowQuery, row: CurrentRow) -> Option<DatabaseRowSearchResponseItem> {
    let texts = std::iter::once(row.title.as_str()).chain(row.cell_text.iter().map(String::as_str));
    if !query.matches(texts) {
        return None;
    }
    // The title is shown whole; the snippet is the first other cell that
    // matches, so a row found by its title alone has none.
    let snippet = row
        .cell_text
        .iter()
        .filter(|text| **text != row.title)
        .find_map(|text| query.snippet(text));
    Some(DatabaseRowSearchResponseItem {
        database_id: row.database_id,
        table_id: row.table_id,
        row_id: row.row_id,
        database_name: row.database_name,
        table_name: row.table_name,
        title: row.title,
        snippet,
        updated_at: row.updated_at,
    })
}
