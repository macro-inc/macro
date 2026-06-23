use std::collections::HashMap;

use crate::{
    Result, delegate_methods,
    search::{
        builder::{SearchQueryBuilder, SearchQueryConfig},
        model::{Highlight, SearchGotoContent, SearchGotoDocument, SearchHit, parse_highlight_hit},
        query::Keys,
    },
};

use chrono::{DateTime, Utc};
use models_opensearch::{OpenSearchEntityType, SearchEntityType};
use opensearch_query_builder::{
    BoolQueryBuilder, HasChildQuery, InnerHits, MatchPhrasePrefixQuery, MatchPhraseQuery,
    NestedQuery, QueryType, ToOpenSearchJson,
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

/// Cap on terms a `match_phrase_prefix` may expand the last word to.
/// OpenSearch's default of 50 is too aggressive — a prefix like `wo`
/// can expand to far more real tokens. Picking a fixed ceiling keeps
/// query cost bounded without truncating common cases.
const MATCH_PHRASE_PREFIX_MAX_EXPANSIONS: u32 = 256;

/// Which fields a document search matches against.
///
/// `Content` (the default) preserves the chunk-only `has_child` behavior.
/// `Name` matches the parent `document_name`. `NameContent` matches either.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum DocumentSearchMode {
    /// Match terms against the parent `document_name` only.
    Name,
    /// Match terms against child chunk `content` only.
    #[default]
    Content,
    /// Match a document by its name or its content.
    NameContent,
}

/// Nested path holding denormalized entity properties on the parent doc.
const PROPERTIES_PATH: &str = "properties";

/// A property-equality filter applied against the indexed `properties` nested
/// field. Matches parents that have a nested entry whose `definition_id`
/// equals `definition_id` and whose `values` contains any of `values`.
/// Empty `values` means "no constraint" and is dropped before querying.
#[derive(Debug, Clone)]
pub struct PropertyFilterArg {
    /// The property definition id to match on.
    pub definition_id: String,
    /// Candidate values (OR'd). Select-option UUIDs and entity-ref ids both
    /// live in the indexed `values` keyword array.
    pub values: Vec<String>,
}

#[derive(Clone)]
pub(crate) struct DocumentSearchConfig;

impl SearchQueryConfig for DocumentSearchConfig {
    const USER_ID_KEY: Option<&'static str> = Some("owner_id");
    const TITLE_KEY: &'static str = "document_name";
    const ENTITY_INDEX: OpenSearchEntityType = OpenSearchEntityType::Documents;
}

pub(crate) struct DocumentQueryBuilder {
    inner: SearchQueryBuilder<DocumentSearchConfig>,
    sub_types: Vec<String>,
    mode: DocumentSearchMode,
    property_filters: Vec<PropertyFilterArg>,
}

impl DocumentQueryBuilder {
    pub fn new(terms: Vec<String>) -> Self {
        Self {
            inner: SearchQueryBuilder::new(terms),
            sub_types: Vec::new(),
            mode: DocumentSearchMode::default(),
            property_filters: Vec::new(),
        }
    }

    pub fn mode(mut self, mode: DocumentSearchMode) -> Self {
        self.mode = mode;
        self
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

    pub fn property_filters(mut self, property_filters: Vec<PropertyFilterArg>) -> Self {
        self.property_filters = property_filters;
        self
    }

    /// Parent/child join query: one `has_child` clause per term, ANDed
    /// inside `bool.must`. Parent metadata filters (owner, ids,
    /// sub_type) sit on `bool.filter` directly because they live on
    /// the parent doc.
    pub fn build_bool_query<'a>(&'a self) -> Result<BoolQueryBuilder<'a>> {
        if self.inner.ids_only && self.inner.ids.is_empty() {
            return Err(crate::error::OpensearchClientError::EmptyIdsWithIdsOnly(
                DocumentSearchConfig::ENTITY_INDEX,
            ));
        }
        if self.inner.terms.is_empty() {
            return Err(crate::error::OpensearchClientError::NoTermsProvided);
        }

        let mut bool_query = BoolQueryBuilder::new();

        // Restrict to parent documents in the documents alias.
        bool_query.filter(QueryType::term(
            "_index",
            DocumentSearchConfig::ENTITY_INDEX.index_name().to_string(),
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

        // Property filters: one nested clause per filter, ANDed via bool.filter.
        // Each matches a `properties` entry whose definition_id and value line
        // up within the same nested object. On bool.filter, so they constrain
        // both name and content matches.
        for filter in &self.property_filters {
            if let Some(nested) = build_property_filter(filter) {
                bool_query.filter(nested);
            }
        }

        // Match clause(s) per mode: the parent `document_name` (Name), child
        // chunk `content` via has_child (Content), or either (NameContent).
        let include_name = matches!(
            self.mode,
            DocumentSearchMode::Name | DocumentSearchMode::NameContent
        );
        let include_content = matches!(
            self.mode,
            DocumentSearchMode::Content | DocumentSearchMode::NameContent
        );

        if include_name && include_content {
            // A document matches when its name matches every term, or every
            // term matches some chunk's content.
            let mut content_bool = BoolQueryBuilder::new();
            for clause in self.build_content_has_child_clauses() {
                content_bool.must(clause);
            }
            let mut matched = BoolQueryBuilder::new();
            matched.minimum_should_match(1);
            matched.should(content_bool.build().into());
            matched.should(self.inner.build_title_term_query()?);
            bool_query.must(matched.build().into());
        } else if include_name {
            bool_query.must(self.inner.build_title_term_query()?);
        } else {
            // Content-only: one has_child clause per term, ANDed via bool.must.
            for clause in self.build_content_has_child_clauses() {
                bool_query.must(clause);
            }
        }

        Ok(bool_query)
    }

    /// One `has_child` clause per term, each carrying its own `inner_hits` so
    /// highlights and chunk-nav data come back alongside the parent. `size` is
    /// bumped well above OpenSearch's default of 3 so a doc with many matching
    /// chunks returns all of them. The shared `highlight_query` ORs every term
    /// so a returned chunk gets tagged for every term it contains, not just the
    /// one its clause matched.
    fn build_content_has_child_clauses<'a>(&'a self) -> Vec<QueryType<'a>> {
        let highlight_query =
            build_all_terms_highlight_query(&self.inner.terms, &self.inner.match_type);
        self.inner
            .terms
            .iter()
            .enumerate()
            .map(|(idx, term)| {
                let inner_query = build_child_content_query(term, &self.inner.match_type);
                let inner_hits = InnerHits::new()
                    .name(format!("term_{idx}"))
                    .size(INNER_HITS_PER_TERM)
                    .highlight(inner_hits_content_highlight(&highlight_query));
                HasChildQuery::new(CHILD_RELATION, inner_query)
                    .inner_hits(inner_hits)
                    .into()
            })
            .collect()
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

/// Build a `nested` query over `properties` for one property filter:
/// a parent matches when it has a nested entry with `definition_id` equal to
/// the filter's id AND `values` containing any of the filter's values.
/// Returns `None` when the filter carries no values.
fn build_property_filter<'a>(filter: &PropertyFilterArg) -> Option<QueryType<'a>> {
    if filter.values.is_empty() {
        return None;
    }
    let mut inner = BoolQueryBuilder::new();
    inner.filter(QueryType::term(
        format!("{PROPERTIES_PATH}.definition_id"),
        filter.definition_id.clone(),
    ));
    inner.filter(QueryType::terms(
        format!("{PROPERTIES_PATH}.values"),
        filter.values.clone(),
    ));
    // ignore_unmapped: the unified query spans indices that don't map
    // `properties` as nested; there the clause is a no-op rather than an error.
    Some(
        NestedQuery::new(PROPERTIES_PATH, inner.build().into())
            .ignore_unmapped(true)
            .into(),
    )
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
                .max_expansions(MATCH_PHRASE_PREFIX_MAX_EXPANSIONS),
        )
    }
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub(crate) struct DocumentIndex {
    pub entity_id: uuid::Uuid,
    pub document_name: String,
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
    pub mode: DocumentSearchMode,
    pub property_filters: Vec<PropertyFilterArg>,
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
            .mode(args.mode)
            .property_filters(args.property_filters)
    }
}

// ---------------------------------------------------------------------------
// inner_hits → chunk-level SearchHits
// ---------------------------------------------------------------------------

/// One child chunk as it appears under `inner_hits.<term_name>.hits.hits[]`.
/// The fields we deserialize are exactly what we need to build a
/// `SearchHit` — anything else OpenSearch sends back is dropped.
#[derive(Debug, serde::Deserialize)]
struct ChunkInnerHit {
    #[serde(rename = "_id")]
    id: String,
    #[serde(rename = "_score")]
    score: Option<f64>,
    #[serde(rename = "_source")]
    source: ChunkSource,
    #[serde(default)]
    highlight: Option<HashMap<String, Vec<String>>>,
}

/// The chunk-only `_source` fields we surface in a `SearchHit.goto`.
#[derive(Debug, serde::Deserialize)]
struct ChunkSource {
    #[serde(default)]
    node_id: String,
    #[serde(default)]
    raw_content: Option<String>,
}

/// The shape of one entry under `inner_hits` — keyed by the
/// `has_child` clause name (e.g. `term_0`).
#[derive(Debug, serde::Deserialize)]
struct InnerHitsGroup {
    #[serde(default)]
    hits: InnerHitsList,
}

#[derive(Debug, Default, serde::Deserialize)]
struct InnerHitsList {
    #[serde(default)]
    hits: Vec<ChunkInnerHit>,
}

/// Walk the `inner_hits` block from a join-shape parent hit and emit
/// one `SearchHit` per matching chunk, carrying that chunk's
/// `node_id`, `raw_content`, score, and highlight.
///
/// A chunk matched by multiple `has_child` clauses (multi-term queries)
/// appears once per term in the response; we dedup by chunk `_id` so a
/// single chunk maps to a single `SearchHit` downstream.
///
/// Returns an empty vec if `inner_hits` is malformed or carries no
/// chunks — callers fall back to emitting a single parent hit so the
/// document still surfaces in results.
pub(crate) fn expand_inner_hits_to_search_hits(
    entity_id: uuid::Uuid,
    updated_at: Option<DateTime<Utc>>,
    inner_hits: &serde_json::Value,
) -> Vec<SearchHit> {
    let groups: HashMap<String, InnerHitsGroup> = match serde_json::from_value(inner_hits.clone()) {
        Ok(g) => g,
        Err(_) => return Vec::new(),
    };

    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut out: Vec<SearchHit> = Vec::new();
    for group in groups.into_values() {
        for chunk in group.hits.hits {
            if !seen.insert(chunk.id) {
                continue;
            }
            let highlight: Highlight = chunk
                .highlight
                .map(|h| {
                    parse_highlight_hit(
                        h,
                        Keys {
                            title_key: DocumentSearchConfig::TITLE_KEY,
                            content_key: DocumentSearchConfig::CONTENT_KEY,
                        },
                    )
                })
                .unwrap_or_default();
            out.push(SearchHit {
                entity_id,
                entity_type: SearchEntityType::Documents,
                score: chunk.score,
                highlight,
                goto: Some(SearchGotoContent::Documents(SearchGotoDocument {
                    node_id: chunk.source.node_id,
                    raw_content: chunk.source.raw_content,
                })),
                updated_at,
            });
        }
    }
    out
}

#[cfg(test)]
mod test;
