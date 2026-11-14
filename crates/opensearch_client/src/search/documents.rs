use std::collections::{BTreeMap, HashMap};

use crate::{
    Result, delegate_methods,
    search::{
        builder::{SearchQueryBuilder, SearchQueryConfig},
        model::{Highlight, SearchGotoContent, SearchGotoDocument, SearchHit, parse_highlight_hit},
        properties::{PROPERTIES_PATH, build_tag_filter},
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

/// Budget of chunks returned for one document, shared by its `has_child`
/// clauses. Every returned chunk is re-analysed by the plain highlighter and
/// shipped in the response, so fetch time and payload follow the chunk count,
/// not the term count. A grouped result row previews one passage and expands
/// to the rest.
const INNER_HITS_PER_DOCUMENT: u32 = 10;

/// The chunk `_source` fields a `SearchHit` carries. Inner hits do not inherit
/// the request-level `_source` filter, so without this every chunk comes back
/// with its full `content`, which only the highlight needs.
const CHUNK_SOURCE_FIELDS: [&str; 2] = ["node_id", "raw_content"];

/// Fewest terms a query needs before [`DocumentTermMatching::Dynamic`]
/// relaxes it. Shorter queries stay a strict AND.
pub const MIN_TERMS_FOR_DYNAMIC_MATCHING: usize = 3;

/// Words too common to tell passages apart. A sentence query matches on its
/// other words. This is Lucene's English stop set.
const STOPWORDS: [&str; 33] = [
    "a", "an", "and", "are", "as", "at", "be", "but", "by", "for", "if", "in", "into", "is", "it",
    "no", "not", "of", "on", "or", "such", "that", "the", "their", "then", "there", "these",
    "they", "this", "to", "was", "will", "with",
];

/// Cap on terms a `match_phrase_prefix` may expand the last word to.
/// OpenSearch's default of 50 is too aggressive — a prefix like `wo`
/// can expand to far more real tokens. Picking a fixed ceiling keeps
/// query cost bounded without truncating common cases.
const MATCH_PHRASE_PREFIX_MAX_EXPANSIONS: u32 = 256;

/// Name of the one `inner_hits` block of the passage clause.
const PASSAGE_INNER_HITS_NAME: &str = "passage";

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

/// How a multi-term content search combines its terms.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum DocumentTermMatching {
    /// Every term matches somewhere in the document, each as a prefix.
    #[default]
    All,
    /// Queries of three or more terms match a document when one passage holds
    /// most of the terms that are not stopwords; only the last term is a
    /// prefix. Shorter queries behave as `All`. Neither set contains the
    /// other: a sentence missing a word now matches, while terms scattered
    /// over different chunks, or cut short before the last one, no longer do.
    Dynamic,
}

/// UTC bounds for an indexed DATE property.
#[derive(Debug, Clone, Copy)]
pub struct PropertyDateRange {
    /// Inclusive lower bound, when provided.
    pub start: Option<DateTime<Utc>>,
    /// Exclusive upper bound, when provided.
    pub end: Option<DateTime<Utc>>,
}

/// A property-equality filter applied against the indexed `properties` nested
/// field. Matches parents that have a nested entry whose `definition_id`
/// equals `definition_id` and whose `values` contains any of `values`.
/// Empty `values` imposes no membership constraint; date predicates still apply.
#[derive(Debug, Clone)]
pub struct PropertyFilterArg {
    /// The property definition id to match on.
    pub definition_id: String,
    /// Candidate values (OR'd). Select-option UUIDs and entity-ref ids both
    /// live in the indexed `values` keyword array.
    pub values: Vec<String>,
    /// UTC range with optional inclusive start and exclusive end.
    pub date_range: Option<PropertyDateRange>,
    /// True for a non-null DATE; false for absent, null, or cleared values.
    pub has_date: Option<bool>,
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
    tag_option_ids: Vec<String>,
    match_all_tags: bool,
    term_matching: DocumentTermMatching,
}

impl DocumentQueryBuilder {
    pub fn new(terms: Vec<String>) -> Self {
        Self {
            inner: SearchQueryBuilder::new(terms),
            sub_types: Vec::new(),
            mode: DocumentSearchMode::default(),
            property_filters: Vec::new(),
            tag_option_ids: Vec::new(),
            match_all_tags: false,
            term_matching: DocumentTermMatching::default(),
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

    pub fn tag_option_ids(mut self, tag_option_ids: Vec<String>) -> Self {
        self.tag_option_ids = tag_option_ids;
        self
    }

    pub fn match_all_tags(mut self, match_all_tags: bool) -> Self {
        self.match_all_tags = match_all_tags;
        self
    }

    pub fn term_matching(mut self, term_matching: DocumentTermMatching) -> Self {
        self.term_matching = term_matching;
        self
    }

    /// Parent/child join query: one `has_child` clause per term, ANDed
    /// inside `bool.must`, or a single passage clause under
    /// [`DocumentTermMatching::Dynamic`]. Parent metadata filters (owner, ids,
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

        // Tag filter: nested clause(s) matching `properties.values` with no
        // definition_id constraint. Option ids are globally unique, so this
        // ORs (or ANDs, for match-all) tags across definitions.
        if let Some(nested) = build_tag_filter(&self.tag_option_ids, self.match_all_tags) {
            bool_query.filter(nested);
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
            // A document matches when its name matches every term, or its
            // content matches.
            let mut content_bool = BoolQueryBuilder::new();
            for clause in self.build_content_clauses() {
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
            for clause in self.build_content_clauses() {
                bool_query.must(clause);
            }
        }

        Ok(bool_query)
    }

    /// The clauses a document's content must all satisfy.
    fn build_content_clauses<'a>(&'a self) -> Vec<QueryType<'a>> {
        match self.build_passage_has_child_clause() {
            Some(passage_clause) => vec![passage_clause],
            None => self.build_content_has_child_clauses(),
        }
    }

    /// One `has_child` clause per term, each carrying its own `inner_hits` so
    /// highlights and chunk-nav data come back alongside the parent. The
    /// clauses split [`INNER_HITS_PER_DOCUMENT`] between them, so a document
    /// returns at most that many chunks however many terms the query has. The
    /// shared `highlight_query` ORs every term so a returned chunk gets tagged
    /// for every term it contains, not just the one its clause matched.
    fn build_content_has_child_clauses<'a>(&'a self) -> Vec<QueryType<'a>> {
        let term_queries: Vec<QueryType<'a>> = self
            .inner
            .terms
            .iter()
            .map(|term| build_child_content_query(term, &self.inner.match_type))
            .collect();
        let highlight_query = build_any_term_highlight_query(&term_queries);
        // Past the budget, only the first clauses carry inner hits. A matching
        // document has a chunk for every term, so each row still gets passages.
        let clauses_with_inner_hits = u32::try_from(term_queries.len())
            .unwrap_or(u32::MAX)
            .clamp(1, INNER_HITS_PER_DOCUMENT);
        let inner_hits_per_term = INNER_HITS_PER_DOCUMENT / clauses_with_inner_hits;

        term_queries
            .into_iter()
            .zip(0u32..)
            .map(|(inner_query, idx)| {
                let has_child = HasChildQuery::new(CHILD_RELATION, inner_query);
                if idx >= clauses_with_inner_hits {
                    return has_child.into();
                }
                let inner_hits = InnerHits::new()
                    .name(format!("term_{idx}"))
                    .size(inner_hits_per_term)
                    .source_fields(CHUNK_SOURCE_FIELDS)
                    .highlight(inner_hits_content_highlight(&highlight_query));
                has_child.inner_hits(inner_hits).into()
            })
            .collect()
    }

    /// The single `has_child` clause of [`DocumentTermMatching::Dynamic`], or
    /// `None` when the query keeps the per-term AND: it has too few terms, or
    /// nothing but stopwords.
    ///
    /// A document matches when one chunk holds enough of the query's terms:
    /// all of them up to two, three quarters (rounded down) beyond that.
    /// Stopwords and repeated terms are left out of the count. Only the last
    /// term expands as a prefix, because it is the one still being typed; the
    /// per-term AND expands every term, which is what makes long queries slow
    /// to match.
    fn build_passage_has_child_clause<'a>(&'a self) -> Option<QueryType<'a>> {
        let terms = &self.inner.terms;
        if self.term_matching != DocumentTermMatching::Dynamic
            || terms.len() < MIN_TERMS_FOR_DYNAMIC_MATCHING
        {
            return None;
        }

        let mut counted_terms: Vec<String> = Vec::new();
        let mut term_queries: Vec<QueryType<'a>> = Vec::new();
        for (idx, term) in terms.iter().enumerate() {
            let is_last_term = idx + 1 == terms.len();
            let match_type = if is_last_term {
                self.inner.match_type.as_str()
            } else {
                "exact"
            };
            let term_query = build_child_content_query(term, match_type);

            // A last term that expands as a prefix is a word still being
            // typed: `for` may be the start of `forecast`, so it is kept.
            let is_prefix = matches!(term_query, QueryType::MatchPhrasePrefix(_));
            let lowercase = term.to_lowercase();
            if counted_terms.contains(&lowercase)
                || (STOPWORDS.contains(&lowercase.as_str()) && !is_prefix)
            {
                continue;
            }
            counted_terms.push(lowercase);
            term_queries.push(term_query);
        }
        if term_queries.is_empty() {
            return None;
        }

        let highlight_query = build_any_term_highlight_query(&term_queries);
        let required = i32::try_from(required_term_count(term_queries.len())).ok()?;
        let mut passage = BoolQueryBuilder::new();
        passage.minimum_should_match(required);
        for term_query in term_queries {
            passage.should(term_query);
        }

        let inner_hits = InnerHits::new()
            .name(PASSAGE_INNER_HITS_NAME)
            .size(INNER_HITS_PER_DOCUMENT)
            .source_fields(CHUNK_SOURCE_FIELDS)
            .highlight(inner_hits_content_highlight(&highlight_query));
        Some(
            HasChildQuery::new(CHILD_RELATION, passage.build().into())
                .inner_hits(inner_hits)
                .into(),
        )
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
    if filter.values.is_empty() && filter.date_range.is_none() && filter.has_date.is_none() {
        return None;
    }
    let definition_field = format!("{PROPERTIES_PATH}.definition_id");
    let date_field = format!("{PROPERTIES_PATH}.date_value");
    let nested = |value_query: QueryType<'a>| {
        let mut inner = BoolQueryBuilder::new();
        inner.filter(QueryType::term(
            definition_field.clone(),
            filter.definition_id.clone(),
        ));
        inner.filter(value_query);
        NestedQuery::new(PROPERTIES_PATH, inner.build().into())
            .ignore_unmapped(true)
            .into()
    };
    if filter.date_range.is_none() && filter.has_date.is_none() {
        return Some(nested(QueryType::terms(
            format!("{PROPERTIES_PATH}.values"),
            filter.values.clone(),
        )));
    }
    let mut outer = BoolQueryBuilder::new();
    if !filter.values.is_empty() {
        outer.filter(nested(QueryType::terms(
            format!("{PROPERTIES_PATH}.values"),
            filter.values.clone(),
        )));
    }
    if let Some(bounds) = filter.date_range {
        let mut range = QueryType::range(date_field.clone());
        if let Some(start) = bounds.start {
            range.gte(start.timestamp_millis());
        }
        if let Some(end) = bounds.end {
            range.lt(end.timestamp_millis());
        }
        outer.filter(nested(range.build().into()));
    }
    match filter.has_date {
        Some(true) => outer.filter(nested(QueryType::Exists(date_field.into()))),
        Some(false) => outer.must_not(nested(QueryType::Exists(date_field.into()))),
        None => &mut outer,
    };
    Some(outer.build().into())
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
        "max_analyzer_offset": super::HIGHLIGHT_MAX_ANALYZER_OFFSET,
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
fn build_any_term_highlight_query(term_queries: &[QueryType<'_>]) -> serde_json::Value {
    if let [term_query] = term_queries {
        return term_query.to_json();
    }
    let term_queries: Vec<serde_json::Value> =
        term_queries.iter().map(ToOpenSearchJson::to_json).collect();
    serde_json::json!({
        "bool": {
            "should": term_queries,
            "minimum_should_match": 1,
        }
    })
}

/// How many of `term_count` terms one passage must hold under
/// [`DocumentTermMatching::Dynamic`]: all of them up to two, three quarters
/// (rounded down) beyond that. OpenSearch writes this rule `2<75%`.
fn required_term_count(term_count: usize) -> usize {
    if term_count <= 2 {
        return term_count;
    }
    term_count * 3 / 4
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
    #[serde(default)]
    pub updated_at_millis: Option<i64>,
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
    pub tag_option_ids: Vec<String>,
    pub match_all_tags: bool,
    pub term_matching: DocumentTermMatching,
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
            .tag_option_ids(args.tag_option_ids)
            .match_all_tags(args.match_all_tags)
            .term_matching(args.term_matching)
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
/// single chunk maps to a single `SearchHit` downstream. Clauses are read in
/// name order, so the same response always yields the same first passage.
///
/// Returns an empty vec if `inner_hits` is malformed or carries no
/// chunks — callers fall back to emitting a single parent hit so the
/// document still surfaces in results.
pub(crate) fn expand_inner_hits_to_search_hits(
    entity_id: uuid::Uuid,
    updated_at: Option<DateTime<Utc>>,
    inner_hits: &serde_json::Value,
) -> Vec<SearchHit> {
    let groups: BTreeMap<String, InnerHitsGroup> = match serde_json::from_value(inner_hits.clone())
    {
        Ok(g) => g,
        Err(_) => return Vec::new(),
    };
    // `term_10` sorts before `term_2` as a string; shorter names first puts
    // the groups back in clause order.
    let mut groups: Vec<(String, InnerHitsGroup)> = groups.into_iter().collect();
    groups.sort_by_key(|(name, _)| name.len());

    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut out: Vec<SearchHit> = Vec::new();
    for (_, group) in groups {
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
