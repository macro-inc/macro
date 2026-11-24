//! Rows of Macro databases the `database_rows` index proposes for a search.
//!
//! The index is for finding rows only. It holds no access field, so a query
//! is always narrowed to databases the caller may view, and what it returns
//! is a row id and its place in the index's order: the search service decides
//! from Postgres whether to show each row and what to show.

use chrono::{DateTime, Utc};
use opensearch_query_builder::{
    BoolQueryBuilder, FieldSort, QueryType, SearchRequest, SearchRequestBuilder, SortOrder,
    SortType, ToOpenSearchJson as _,
};
use uuid::Uuid;

use super::model::DefaultSearchResponse;
use super::query::{QueryKey, TermCombine, generate_terms_must_query_for_fields};
use crate::error::{OpensearchClientError, OpensearchOperation, ResponseExt as _, error_chain};
use crate::retry::resend_on_lost_connection;
use crate::{OpensearchClient, Result};

#[cfg(test)]
mod test;

/// The text fields a term matches; it may match either.
const TEXT_FIELDS: [&str; 2] = ["title", "cell_text"];

/// How a row search's terms match.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DatabaseRowMatchType {
    /// Each term's words in order, the last one as a prefix.
    Partial,
    /// Each term's words in order, each whole.
    Exact,
}

/// A row's place in the index's order: newest write first, then row id.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DatabaseRowPosition {
    /// When the row was last written, as indexed.
    pub updated_at: DateTime<Utc>,
    /// The row id.
    pub row_id: Uuid,
}

/// What to propose.
#[derive(Debug, Clone)]
pub struct DatabaseRowSearchArgs {
    /// Only rows of these databases. Empty matches nothing.
    pub database_ids: Vec<Uuid>,
    /// Every term must match the row's title or one of its cells.
    pub terms: Vec<String>,
    pub match_type: DatabaseRowMatchType,
    /// Rows after this position; from the first when `None`.
    pub after: Option<DatabaseRowPosition>,
    pub limit: u32,
}

#[derive(Debug, serde::Deserialize)]
struct RowSource {
    row_id: Uuid,
    /// Epoch milliseconds.
    updated_at: i64,
}

fn build_request(args: &DatabaseRowSearchArgs) -> Result<SearchRequest<'static>> {
    if args.terms.is_empty() {
        return Err(OpensearchClientError::NoTermsProvided);
    }
    let query_key = QueryKey::from_match_type(match args.match_type {
        DatabaseRowMatchType::Partial => "partial",
        DatabaseRowMatchType::Exact => "exact",
    })?;

    let mut bool_query = BoolQueryBuilder::new();
    bool_query.filter(QueryType::terms(
        "database_id",
        args.database_ids
            .iter()
            .map(|id| id.to_string())
            .collect::<Vec<_>>(),
    ));
    let terms: Vec<&str> = args.terms.iter().map(String::as_str).collect();
    bool_query.must(
        generate_terms_must_query_for_fields(query_key, &TEXT_FIELDS, terms, TermCombine::And)
            .to_owned(),
    );

    let mut request = SearchRequestBuilder::new();
    request.query(bool_query.build().into());
    request.size(args.limit);
    request.add_sort(SortType::Field(FieldSort::new(
        "updated_at",
        SortOrder::Desc,
    )));
    request.add_sort(SortType::Field(FieldSort::new("row_id", SortOrder::Asc)));
    request.set_source_fields(["row_id", "updated_at"]);
    request.track_total_hits(false);
    if let Some(after) = args.after {
        request.set_search_after(vec![
            serde_json::json!(after.updated_at.timestamp_millis()),
            serde_json::json!(after.row_id.to_string()),
        ]);
    }
    Ok(request.build())
}

impl OpensearchClient {
    /// Rows of the given databases whose indexed text matches every term, in
    /// the index's order. Nothing here says the caller may see them.
    #[tracing::instrument(skip_all, err)]
    pub async fn search_database_rows(
        &self,
        args: &DatabaseRowSearchArgs,
    ) -> Result<Vec<DatabaseRowPosition>> {
        resend_on_lost_connection(|| search_database_rows(&self.inner, args)).await
    }
}

/// Rows matching `args`, in the index's order, at most `args.limit`.
#[tracing::instrument(
    skip_all,
    fields(
        database_count = args.database_ids.len(),
        term_count = args.terms.len(),
        limit = args.limit,
        hit_count = tracing::field::Empty,
        opensearch_took_ms = tracing::field::Empty,
    )
)]
async fn search_database_rows(
    client: &opensearch::OpenSearch,
    args: &DatabaseRowSearchArgs,
) -> Result<Vec<DatabaseRowPosition>> {
    if args.database_ids.is_empty() || args.limit == 0 {
        return Ok(Vec::new());
    }
    let request = build_request(args)?.to_json();

    // Before the index is created, rows match nothing rather than failing
    // the search they are part of.
    let response = client
        .send(
            opensearch::http::Method::Post,
            &format!(
                "/{}/_search",
                models_opensearch::OpenSearchEntityType::DatabaseRows.index_name()
            ),
            opensearch::http::headers::HeaderMap::new(),
            Some(&[("ignore_unavailable", "true")]),
            Some(opensearch::http::request::JsonBody::new(request)),
            None,
        )
        .await
        .map_client_error(OpensearchOperation::SearchDatabaseRows)
        .await?;

    let bytes = response
        .bytes()
        .await
        .map_err(|e| OpensearchClientError::HttpBytesError {
            details: error_chain(&e),
        })?;
    let result: DefaultSearchResponse<RowSource> = serde_json::from_slice(&bytes).map_err(|e| {
        OpensearchClientError::SearchDeserializationFailed {
            details: e.to_string(),
            raw_body: String::from_utf8_lossy(&bytes).to_string(),
        }
    })?;
    result.warn_on_shard_failures(OpensearchOperation::SearchDatabaseRows);

    let span = tracing::Span::current();
    span.record("hit_count", result.hits.hits.len());
    span.record("opensearch_took_ms", result.took);

    Ok(result
        .hits
        .hits
        .into_iter()
        .filter_map(|hit| {
            let updated_at = DateTime::from_timestamp_millis(hit.source.updated_at)?;
            Some(DatabaseRowPosition {
                updated_at,
                row_id: hit.source.row_id,
            })
        })
        .collect())
}
