//! Database row source for unified search.
//!
//! Rows are found in their own index and shown only after
//! [`DatabaseRowSearch`] checks each in Postgres, so they don't flow through
//! the OpenSearch split/enrich path: [`search_database_rows`] returns the
//! shown rows as `SearchHit`s to merge with the other sources, plus their
//! finished response items, which the unified handler returns as they are.

use std::collections::HashMap;

use macro_user_id::{lowercased::Lowercase, user_id::MacroUserId};
use models_opensearch::SearchEntityType;
use models_search::MatchType;
use models_search::database_row::DatabaseRowSearchResponseItem;
use models_search_cursor::{SearchCursorOption, SearchMethodCursor};
use opensearch_client::search::model::{Highlight, SearchHit};
use uuid::Uuid;

use crate::api::context::SearchHandlerState;
use crate::api::search::simple::SearchError;
use crate::domain::database_rows::{DatabaseRowSearch, RowMatchType, RowPosition, RowQuery};
use crate::outbound::database_rows::DatabaseRowPgSource;

/// How a request's match type matches rows; rows have no regexp or
/// query-string matching, so those requests leave rows out.
pub(in crate::api::search) fn row_match_type(match_type: MatchType) -> Option<RowMatchType> {
    match match_type {
        MatchType::Partial => Some(RowMatchType::Partial),
        MatchType::Exact => Some(RowMatchType::Exact),
        MatchType::Regexp | MatchType::Query => None,
    }
}

/// One page of shown rows.
pub(in crate::api::search) struct RowHits {
    pub hits: Vec<SearchHit>,
    pub items: HashMap<Uuid, DatabaseRowSearchResponseItem>,
    pub cursor: SearchCursorOption,
}

impl RowHits {
    pub(in crate::api::search) fn done() -> Self {
        Self {
            hits: Vec::new(),
            items: HashMap::new(),
            cursor: SearchCursorOption::Done,
        }
    }
}

/// The rows matching `terms` that the caller may see, resuming from
/// `cursor`, at most `limit`. Records on the current span what filling the
/// page read; the terms stay off it.
pub(in crate::api::search) async fn search_database_rows(
    ctx: &SearchHandlerState,
    user_id: &MacroUserId<Lowercase<'_>>,
    terms: &[String],
    match_type: RowMatchType,
    limit: u32,
    cursor: SearchCursorOption,
) -> Result<RowHits, SearchError> {
    let after = match cursor {
        SearchCursorOption::Done => return Ok(RowHits::done()),
        SearchCursorOption::NotDone(None) => None,
        SearchCursorOption::NotDone(Some(position)) => {
            let (row_id, updated_at) =
                position.as_updated_at().ok_or(SearchError::InvalidCursor)?;
            Some(RowPosition { updated_at, row_id })
        }
    };
    let Some(query) = RowQuery::new(terms, match_type) else {
        return Ok(RowHits::done());
    };

    let search = DatabaseRowSearch(DatabaseRowPgSource {
        primary_db: ctx.primary_db.clone(),
        entity_access: ctx.entity_access_service.clone(),
        opensearch: ctx.opensearch_client.clone(),
    });
    let page = search
        .page(user_id, &query, terms, limit, after)
        .await
        .map_err(|error| SearchError::InternalError(anyhow::anyhow!("{error}")))?;

    let span = tracing::Span::current();
    span.record("search.database_row_rounds", page.stats.rounds);
    span.record("search.database_row_proposed", page.stats.proposed);
    span.record("search.database_row_shown", page.stats.shown);
    span.record(
        "search.database_row_bound_reached",
        page.stats.bound_reached,
    );

    let cursor = match page.next {
        Some(next) => SearchCursorOption::NotDone(Some(SearchMethodCursor::UpdatedAt {
            entity_id: next.row_id,
            updated_at: next.updated_at,
        })),
        None => SearchCursorOption::Done,
    };
    let mut hits = Vec::with_capacity(page.rows.len());
    let mut items = HashMap::with_capacity(page.rows.len());
    for row in page.rows {
        hits.push(SearchHit {
            entity_id: row.item.row_id,
            entity_type: SearchEntityType::DatabaseRows,
            score: None,
            highlight: Highlight::default(),
            goto: None,
            updated_at: Some(row.position.updated_at),
        });
        items.insert(row.item.row_id, row.item);
    }
    Ok(RowHits {
        hits,
        items,
        cursor,
    })
}
