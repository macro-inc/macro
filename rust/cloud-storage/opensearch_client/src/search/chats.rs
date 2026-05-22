use std::collections::HashMap;

use crate::{
    Result,
    chats_shape::{alias_uses_join_shape, chats_search_alias},
    delegate_methods,
    search::{
        builder::{SearchQueryBuilder, SearchQueryConfig},
        model::{Highlight, SearchGotoChat, SearchGotoContent, SearchHit, parse_highlight_hit},
        query::Keys,
        utils::should_wildcard_field_query_builder,
    },
};

use chrono::{DateTime, Utc};
use models_opensearch::{OpenSearchEntityType, SearchEntityType};
use opensearch_query_builder::{
    BoolQueryBuilder, HasChildQuery, InnerHits, MatchPhrasePrefixQuery, MatchPhraseQuery,
    QueryType, ToOpenSearchJson,
};

/// Relation names for the join field. Kept in sync with the upsert path
/// in `upsert::chat_message`.
const PARENT_RELATION: &str = "chat";
const CHILD_RELATION: &str = "message";

/// Minimum prefix length before we emit a `match_phrase_prefix`. Mirrors
/// the documents threshold — shorter prefixes risk hitting
/// `max_clause_count` on expansion.
const MIN_PREFIX_LEN: usize = 3;

/// Cap on messages returned per `has_child` clause inside `inner_hits`.
/// OpenSearch's default is 3 which would silently drop matches on chats
/// with many hits.
const INNER_HITS_PER_TERM: u32 = 100;

/// Cap on terms a `match_phrase_prefix` may expand the last word to.
const MATCH_PHRASE_PREFIX_MAX_EXPANSIONS: u32 = 256;

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub(crate) struct ChatIndex {
    pub entity_id: uuid::Uuid,
    /// Present on flat-shape (legacy) message docs. Absent on join-shape
    /// parent docs — those carry chat-level metadata only and the
    /// matching message ids come via `inner_hits`.
    #[serde(default)]
    pub chat_message_id: Option<uuid::Uuid>,
    pub user_id: String,
    /// Present on flat-shape message docs. Absent on join-shape parents.
    #[serde(default)]
    pub role: Option<String>,
    pub title: String,
    pub updated_at_seconds: Option<i64>,
}

pub(crate) struct ChatSearchConfig;

impl SearchQueryConfig for ChatSearchConfig {
    const USER_ID_KEY: Option<&'static str> = Some("user_id");
    const TITLE_KEY: &'static str = "name";
    const ENTITY_INDEX: OpenSearchEntityType = OpenSearchEntityType::Chats;
}

pub(crate) struct ChatQueryBuilder {
    inner: SearchQueryBuilder<ChatSearchConfig>,
    /// The role of the chat message
    role: Vec<String>,
}

impl ChatQueryBuilder {
    pub fn new(terms: Vec<String>) -> Self {
        Self {
            inner: SearchQueryBuilder::new(terms),
            role: Vec::new(),
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

    pub fn role(mut self, role: Vec<String>) -> Self {
        self.role = role;
        self
    }

    pub fn build_bool_query<'a>(&'a self) -> Result<BoolQueryBuilder<'a>> {
        if alias_uses_join_shape() {
            return self.build_bool_query_join();
        }
        self.build_bool_query_flat()
    }

    /// Flat one-doc-per-message path: the whole user query is a single
    /// phrase match on `content` and metadata filters sit on the same
    /// doc as the content.
    fn build_bool_query_flat<'a>(&'a self) -> Result<BoolQueryBuilder<'a>> {
        let mut content_bool_query = self.inner.build_content_bool_query()?;

        if !self.role.is_empty() {
            let should_query = should_wildcard_field_query_builder("role", &self.role);
            content_bool_query.filter(should_query);
        }

        Ok(content_bool_query)
    }

    /// Parent/child join path: one `has_child` clause per term, ANDed
    /// inside `bool.must` so each term must match some message in the
    /// same chat. Parent metadata filters (user, ids) sit on
    /// `bool.filter` because they live on the parent doc.
    fn build_bool_query_join<'a>(&'a self) -> Result<BoolQueryBuilder<'a>> {
        if self.inner.ids_only && self.inner.ids.is_empty() {
            return Err(crate::error::OpensearchClientError::EmptyIdsWithIdsOnly(
                ChatSearchConfig::ENTITY_INDEX,
            ));
        }
        if self.inner.terms.is_empty() {
            return Err(crate::error::OpensearchClientError::NoTermsProvided);
        }

        let mut bool_query = BoolQueryBuilder::new();

        // Restrict to parent chats in the chats alias (overridable via
        // CHATS_INDEX_NAME for local end-to-end testing against a side
        // alias).
        bool_query.filter(QueryType::term("_index", chats_search_alias().to_string()));
        bool_query.filter(QueryType::term(
            "chat_relation",
            PARENT_RELATION.to_string(),
        ));

        // Access control on parent fields (user_id and/or entity_id).
        bool_query.filter(self.build_parent_filter()?);

        // Role is a child-side field, so it has to live inside a
        // `has_child` clause rather than on the outer bool. Use a
        // dedicated clause that doesn't carry inner_hits — the
        // term-clauses below handle highlights.
        if !self.role.is_empty() {
            let role_query = should_wildcard_field_query_builder("role", &self.role);
            let role_has_child = HasChildQuery::new(CHILD_RELATION, role_query);
            bool_query.filter(role_has_child.into());
        }

        // One has_child clause per term, ANDed via bool.must. Each
        // carries its own inner_hits so highlights + message-nav data
        // come back alongside the parent. Shared `highlight_query`
        // tags every search term on a returned message regardless of
        // which has_child clause produced it.
        let highlight_query =
            build_all_terms_highlight_query(&self.inner.terms, &self.inner.match_type);
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

    fn build_parent_filter<'a>(&'a self) -> Result<QueryType<'a>> {
        let user_key = ChatSearchConfig::USER_ID_KEY.expect("chats config has user_id key");

        if self.inner.ids_only {
            return Ok(QueryType::terms("entity_id", self.inner.ids.clone()));
        }
        let user_query = QueryType::term(user_key.to_string(), self.inner.user_id.clone());
        if self.inner.ids.is_empty() {
            return Ok(user_query);
        }
        let mut filter = BoolQueryBuilder::new();
        filter.minimum_should_match(1);
        filter.should(QueryType::terms("entity_id", self.inner.ids.clone()));
        filter.should(user_query);
        Ok(filter.build().into())
    }
}

/// Highlight config attached to each `has_child` inner_hits block.
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

#[derive(Debug)]
pub struct ChatSearchArgs {
    pub terms: Vec<String>,
    pub user_id: String,
    pub chat_ids: Vec<String>,
    pub page: u32,
    pub page_size: u32,
    pub match_type: String,
    pub role: Vec<String>,
    pub collapse: bool,
    pub ids_only: bool,
}

impl From<ChatSearchArgs> for ChatQueryBuilder {
    fn from(args: ChatSearchArgs) -> Self {
        ChatQueryBuilder::new(args.terms)
            .match_type(&args.match_type)
            .page_size(args.page_size)
            .page(args.page)
            .user_id(&args.user_id)
            .ids(args.chat_ids)
            .role(args.role)
            .collapse(args.collapse)
            .ids_only(args.ids_only)
    }
}

// ---------------------------------------------------------------------------
// inner_hits → message-level SearchHits
// ---------------------------------------------------------------------------

#[derive(Debug, serde::Deserialize)]
struct MessageInnerHit {
    #[serde(rename = "_id")]
    id: String,
    #[serde(rename = "_score")]
    score: Option<f64>,
    #[serde(rename = "_source")]
    source: MessageSource,
    #[serde(default)]
    highlight: Option<HashMap<String, Vec<String>>>,
}

#[derive(Debug, serde::Deserialize)]
struct MessageSource {
    chat_message_id: uuid::Uuid,
    #[serde(default)]
    role: Option<String>,
}

#[derive(Debug, serde::Deserialize)]
struct InnerHitsGroup {
    #[serde(default)]
    hits: InnerHitsList,
}

#[derive(Debug, Default, serde::Deserialize)]
struct InnerHitsList {
    #[serde(default)]
    hits: Vec<MessageInnerHit>,
}

/// Walk the `inner_hits` block from a join-shape parent hit and emit
/// one `SearchHit` per matching child message, carrying that message's
/// `chat_message_id`, `role`, score, and highlight.
///
/// A message matched by multiple `has_child` clauses (multi-term
/// queries) appears once per term in the response; we dedup by message
/// `_id` so a single message maps to a single `SearchHit` downstream.
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
        for msg in group.hits.hits {
            if !seen.insert(msg.id) {
                continue;
            }
            let highlight: Highlight = msg
                .highlight
                .map(|h| {
                    parse_highlight_hit(
                        h,
                        Keys {
                            title_key: ChatSearchConfig::TITLE_KEY,
                            content_key: ChatSearchConfig::CONTENT_KEY,
                        },
                    )
                })
                .unwrap_or_default();
            out.push(SearchHit {
                entity_id,
                entity_type: SearchEntityType::Chats,
                score: msg.score,
                highlight,
                goto: Some(SearchGotoContent::Chats(SearchGotoChat {
                    chat_message_id: msg.source.chat_message_id,
                    role: msg.source.role.unwrap_or_default(),
                })),
                updated_at,
            });
        }
    }
    out
}

#[cfg(test)]
mod test;
