use crate::{
    Result, delegate_methods,
    documents_shape::{alias_uses_join_shape, documents_search_alias},
    search::builder::{SearchQueryBuilder, SearchQueryConfig},
};

use models_opensearch::OpenSearchEntityType;
use opensearch_query_builder::{
    BoolQueryBuilder, HasChildQuery, InnerHits, MatchPhrasePrefixQuery, MatchPhraseQuery, QueryType,
    ToOpenSearchJson,
};

/// Relation names for the join field. Kept in sync with the upsert path
/// in `upsert::document`.
const PARENT_RELATION: &str = "document";
const CHILD_RELATION: &str = "chunk";

/// Minimum prefix length before we emit a `match_phrase_prefix`. Matches
/// the email keyword-field threshold — shorter prefixes explode the term
/// set on the analyzer and risk hitting `max_clause_count`.
const MIN_PREFIX_LEN: usize = 3;

/// Cap on chunks returned per `has_child` clause inside `inner_hits`.
/// OpenSearch's default is 3 which would silently drop matches on docs
/// with many hits; pick a number well above any reasonable document's
/// matching-chunk count for a single search.
const INNER_HITS_PER_TERM: u32 = 100;

#[derive(Clone)]
pub(crate) struct DocumentSearchConfig;

impl SearchQueryConfig for DocumentSearchConfig {
    const USER_ID_KEY: Option<&'static str> = Some("owner_id");
    const TITLE_KEY: &'static str = "name";
    const ENTITY_INDEX: OpenSearchEntityType = OpenSearchEntityType::Documents;
}

pub(crate) struct DocumentQueryBuilder {
    inner: SearchQueryBuilder<DocumentSearchConfig>,
    sub_types: Vec<String>,
}

impl DocumentQueryBuilder {
    pub fn new(terms: Vec<String>) -> Self {
        Self {
            inner: SearchQueryBuilder::new(terms),
            sub_types: Vec::new(),
        }
    }

    // Copy function signature from SearchQueryBuilder
    delegate_methods! {
        fn match_type(match_type: &str) -> Self;
        fn page(page: u32) -> Self;
        fn page_size(page_size: u32) -> Self;
        fn user_id(user_id: &str) -> Self;
        fn collapse(collapse: bool) -> Self;
        fn ids(ids: Vec<String>) -> Self;
        fn ids_only(ids_only: bool) -> Self;
    }

    pub fn sub_types(mut self, sub_types: Vec<String>) -> Self {
        self.sub_types = sub_types;
        self
    }

    pub fn build_bool_query<'a>(&'a self) -> Result<BoolQueryBuilder<'a>> {
        if alias_uses_join_shape() {
            return self.build_bool_query_join();
        }
        self.build_bool_query_flat()
    }

    /// Legacy flat-chunk path used by `documents_v1`. The whole user
    /// query is a single phrase[-prefix] match on `content`.
    fn build_bool_query_flat<'a>(&'a self) -> Result<BoolQueryBuilder<'a>> {
        let mut query = self.inner.build_content_bool_query()?;

        if !self.sub_types.is_empty() {
            query.filter(QueryType::terms(
                "sub_type".to_string(),
                self.sub_types.clone(),
            ));
        }

        Ok(query)
    }

    /// Parent/child join path used by `documents_v2`. One `has_child`
    /// clause per term, ANDed inside `bool.must`. Parent metadata filters
    /// (owner, ids, sub_type) sit on `bool.filter` directly because they
    /// live on the parent doc.
    fn build_bool_query_join<'a>(&'a self) -> Result<BoolQueryBuilder<'a>> {
        if self.inner.ids_only && self.inner.ids.is_empty() {
            return Err(crate::error::OpensearchClientError::EmptyIdsWithIdsOnly(
                DocumentSearchConfig::ENTITY_INDEX,
            ));
        }
        if self.inner.terms.is_empty() {
            return Err(crate::error::OpensearchClientError::NoTermsProvided);
        }

        let mut bool_query = BoolQueryBuilder::new();

        // Restrict to parent documents in the documents alias (overridable
        // via DOCUMENTS_INDEX_NAME for local end-to-end testing against a
        // side alias).
        bool_query.filter(QueryType::term(
            "_index",
            documents_search_alias().to_string(),
        ));
        bool_query.filter(QueryType::term(
            "document_relation",
            PARENT_RELATION.to_string(),
        ));

        // Access control: filter on parent fields (owner_id and/or entity_id).
        bool_query.filter(self.build_parent_filter()?);

        // Optional sub_type filter (parent field).
        if !self.sub_types.is_empty() {
            bool_query.filter(QueryType::terms("sub_type", self.sub_types.clone()));
        }

        // One has_child clause per term, ANDed via bool.must. Each carries
        // its own inner_hits so highlights and chunk-nav data come back
        // alongside the parent. `size` is bumped well above the OpenSearch
        // default of 3 so a doc with many matching chunks returns all of
        // them (the flat shape had no per-doc cap; this preserves parity).
        //
        // The inner_hits highlight uses a shared `highlight_query` that
        // ORs every search term, so a chunk returned by any one
        // has_child clause gets tags around *every* term it contains —
        // not just the term whose clause produced it.
        let highlight_query = build_all_terms_highlight_query(&self.inner.terms, &self.inner.match_type);
        for (idx, term) in self.inner.terms.iter().enumerate() {
            let inner_query = build_child_content_query(term, &self.inner.match_type);
            let inner_hits = InnerHits::new()
                .name(format!("term_{idx}"))
                .size(INNER_HITS_PER_TERM)
                .highlight(inner_hits_content_highlight(&highlight_query));
            let has_child = HasChildQuery::new(CHILD_RELATION, inner_query).inner_hits(inner_hits);
            bool_query.must(has_child.into());
        }

        Ok(bool_query)
    }

    /// Build the access-control filter using parent-side fields: either
    /// `entity_id ∈ ids` (ids_only), `owner_id` alone, or a should-bool of
    /// both when ids are provided alongside the owner.
    fn build_parent_filter<'a>(&'a self) -> Result<QueryType<'a>> {
        let owner_key =
            DocumentSearchConfig::USER_ID_KEY.expect("documents config has owner_id key");

        if self.inner.ids_only {
            return Ok(QueryType::terms("entity_id", self.inner.ids.clone()));
        }
        let owner_query = QueryType::term(owner_key.to_string(), self.inner.user_id.clone());
        if self.inner.ids.is_empty() {
            return Ok(owner_query);
        }
        let mut filter = BoolQueryBuilder::new();
        filter.minimum_should_match(1);
        filter.should(QueryType::terms("entity_id", self.inner.ids.clone()));
        filter.should(owner_query);
        Ok(filter.build().into())
    }
}

/// Highlight config attached to each `has_child` inner_hits block.
/// Matches the top-level documents highlight (plain highlighter,
/// `<macro_em>` tags, single fragment) so chunk hits come back with
/// the same shape downstream consumers already handle.
///
/// `highlight_query` lets each clause tag every search term in the
/// returned chunk content, not just the term its own has_child matched.
fn inner_hits_content_highlight(highlight_query: &serde_json::Value) -> serde_json::Value {
    serde_json::json!({
        "require_field_match": true,
        "pre_tags": ["<macro_em>"],
        "post_tags": ["</macro_em>"],
        "fields": {
            "content": {
                "type": "plain",
                "number_of_fragments": 1,
                "fragment_size": 1000,
                "highlight_query": highlight_query,
            }
        }
    })
}

/// Combined OR-of-all-terms query used as the inner_hits highlight_query.
/// Single-term queries return that one term's query directly; multi-term
/// builds a `bool.should` so the highlighter tags every search term it
/// finds in the chunk's content.
fn build_all_terms_highlight_query(terms: &[String], match_type: &str) -> serde_json::Value {
    let term_queries: Vec<serde_json::Value> = terms
        .iter()
        .map(|t| build_child_content_query(t, match_type).to_json())
        .collect();
    if term_queries.len() == 1 {
        return term_queries.into_iter().next().unwrap();
    }
    serde_json::json!({
        "bool": {
            "should": term_queries,
            "minimum_should_match": 1,
        }
    })
}

/// Build the per-term query that runs inside `has_child` against `content`.
///
/// - Quoted phrases (term contains whitespace) → `match_phrase` (exact).
/// - Short terms (< `MIN_PREFIX_LEN`) → `match_phrase` (no prefix expansion).
/// - `match_type` = "exact" → `match_phrase` always.
/// - Otherwise → `match_phrase_prefix`.
fn build_child_content_query<'a>(term: &str, match_type: &str) -> QueryType<'a> {
    let exact = match_type == "exact"
        || term.chars().any(|c| c.is_whitespace())
        || term.chars().count() < MIN_PREFIX_LEN;
    if exact {
        QueryType::MatchPhrase(MatchPhraseQuery::new(
            "content".to_string(),
            term.to_string(),
        ))
    } else {
        QueryType::MatchPhrasePrefix(
            MatchPhrasePrefixQuery::new("content".to_string(), term.to_string())
                .max_expansions(256),
        )
    }
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub(crate) struct DocumentIndex {
    pub entity_id: uuid::Uuid,
    pub document_name: String,
    /// Optional because join-shape parents in `documents_v2` have no
    /// `node_id` in `_source` — that field lives on chunk children.
    /// Flat-shape `documents_v1` hits always populate it. Join-shape
    /// callers should consume the chunk's `node_id` from `inner_hits`
    /// instead.
    #[serde(default)]
    pub node_id: Option<String>,
    pub raw_content: Option<String>,
    pub owner_id: String,
    pub file_type: String,
    pub updated_at_seconds: Option<i64>,
}

#[derive(Debug)]
pub struct DocumentSearchArgs {
    pub terms: Vec<String>,
    pub user_id: String,
    pub document_ids: Vec<String>,
    pub page: u32,
    pub page_size: u32,
    pub match_type: String,
    pub collapse: bool,
    pub ids_only: bool,
    pub sub_types: Vec<String>,
}

impl From<DocumentSearchArgs> for DocumentQueryBuilder {
    fn from(args: DocumentSearchArgs) -> Self {
        DocumentQueryBuilder::new(args.terms)
            .match_type(&args.match_type)
            .page_size(args.page_size)
            .page(args.page)
            .user_id(&args.user_id)
            .ids(args.document_ids)
            .collapse(args.collapse)
            .ids_only(args.ids_only)
            .sub_types(args.sub_types)
    }
}

#[cfg(test)]
mod test;
