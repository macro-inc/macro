use std::collections::HashMap;

use crate::{
    Result,
    call_records_shape::{alias_uses_join_shape, call_records_search_alias},
    delegate_methods,
    search::{
        builder::{SearchQueryBuilder, SearchQueryConfig},
        model::{
            Highlight, SearchGotoCallRecord, SearchGotoContent, SearchHit, parse_highlight_hit,
        },
        query::Keys,
    },
};

use chrono::DateTime;
use models_opensearch::{OpenSearchEntityType, SearchEntityType};
use opensearch_query_builder::{
    BoolQueryBuilder, HasChildQuery, InnerHits, MatchPhrasePrefixQuery, MatchPhraseQuery,
    QueryType, ToOpenSearchJson,
};

/// Relation names for the join field. Kept in sync with the upsert path
/// in `upsert::call_record`.
const PARENT_RELATION: &str = "call";
const CHILD_RELATION: &str = "segment";

/// Minimum prefix length before we emit a `match_phrase_prefix`. Mirrors
/// the documents/chats threshold.
const MIN_PREFIX_LEN: usize = 3;

/// Cap on segments returned per `has_child` clause inside `inner_hits`.
/// OpenSearch's default is 3 which would silently drop matches on calls
/// with many matching segments.
const INNER_HITS_PER_TERM: u32 = 100;

const MATCH_PHRASE_PREFIX_MAX_EXPANSIONS: u32 = 256;

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub(crate) struct CallRecordIndex {
    pub entity_id: uuid::Uuid,
    pub channel_id: uuid::Uuid,
    /// Present on flat-shape (legacy) segment docs. Absent on join-shape
    /// parent docs — the matching segments come via `inner_hits`.
    #[serde(default)]
    pub transcript_id: Option<uuid::Uuid>,
    #[serde(default)]
    pub participant_ids: Vec<String>,
    #[serde(default)]
    pub channel_name: Option<String>,
    /// Present on flat-shape segment docs. Absent on join-shape parents.
    #[serde(default)]
    pub speaker_id: Option<String>,
    #[serde(default)]
    pub sequence_num: Option<i32>,
    pub started_at_seconds: i64,
    #[serde(default)]
    pub ended_at_seconds: Option<i64>,
}

pub(crate) struct CallRecordSearchConfig;

impl SearchQueryConfig for CallRecordSearchConfig {
    const TITLE_KEY: &'static str = "channel_name";
    const ENTITY_INDEX: OpenSearchEntityType = OpenSearchEntityType::CallRecords;
}

pub(crate) struct CallRecordQueryBuilder {
    inner: SearchQueryBuilder<CallRecordSearchConfig>,
    channel_ids: Vec<String>,
    speaker_ids: Vec<String>,
}

impl CallRecordQueryBuilder {
    pub fn new(terms: Vec<String>) -> Self {
        Self {
            inner: SearchQueryBuilder::new(terms),
            channel_ids: Vec::new(),
            speaker_ids: Vec::new(),
        }
    }

    delegate_methods! {
        fn match_type(match_type: &str) -> Self;
        fn page(page: u32) -> Self;
        fn page_size(page_size: u32) -> Self;
        fn user_id(user_id: &str) -> Self;
        fn collapse(collapse: bool) -> Self;
        fn ids(ids: Vec<String>) -> Self;
        fn ids_only(ids_only: bool) -> Self;
    }

    pub fn channel_ids(mut self, channel_ids: Vec<String>) -> Self {
        self.channel_ids = channel_ids;
        self
    }

    pub fn speaker_ids(mut self, speaker_ids: Vec<String>) -> Self {
        self.speaker_ids = speaker_ids;
        self
    }

    pub fn build_bool_query<'a>(&'a self) -> Result<BoolQueryBuilder<'a>> {
        if alias_uses_join_shape() {
            return self.build_bool_query_join();
        }
        self.build_bool_query_flat()
    }

    /// Flat one-doc-per-segment path: the whole user query becomes a
    /// single phrase[-prefix] match on `content` and the channel /
    /// speaker filters sit on the same doc as the content.
    fn build_bool_query_flat<'a>(&'a self) -> Result<BoolQueryBuilder<'a>> {
        // Access comes from `ids_only` + accessible call_ids; these just narrow.
        let mut content_bool_query = self.inner.build_content_bool_query()?;

        if !self.channel_ids.is_empty() {
            content_bool_query.filter(QueryType::terms("channel_id", self.channel_ids.clone()));
        }

        if !self.speaker_ids.is_empty() {
            content_bool_query.filter(QueryType::terms("speaker_id", self.speaker_ids.clone()));
        }

        Ok(content_bool_query)
    }

    /// Parent/child join path: one `has_child` clause per term, ANDed
    /// inside `bool.must` so every search term must match some segment
    /// in the same call. channel_id lives on the parent so it sits on
    /// `bool.filter` directly; speaker_id is child-side so it's a
    /// has_child filter clause.
    fn build_bool_query_join<'a>(&'a self) -> Result<BoolQueryBuilder<'a>> {
        if self.inner.ids_only && self.inner.ids.is_empty() {
            return Err(crate::error::OpensearchClientError::EmptyIdsWithIdsOnly(
                CallRecordSearchConfig::ENTITY_INDEX,
            ));
        }
        if self.inner.terms.is_empty() {
            return Err(crate::error::OpensearchClientError::NoTermsProvided);
        }

        let mut bool_query = BoolQueryBuilder::new();

        // Restrict to parent calls in the call_records alias (overridable
        // via CALL_RECORDS_INDEX_NAME for local end-to-end testing).
        bool_query.filter(QueryType::term(
            "_index",
            call_records_search_alias().to_string(),
        ));
        bool_query.filter(QueryType::term(
            "call_relation",
            PARENT_RELATION.to_string(),
        ));

        // Access is via accessible call ids only — no user_id field.
        if self.inner.ids_only {
            bool_query.filter(QueryType::terms("entity_id", self.inner.ids.clone()));
        } else if !self.inner.ids.is_empty() {
            // ids list narrows even when not ids_only.
            bool_query.filter(QueryType::terms("entity_id", self.inner.ids.clone()));
        }

        // channel_id is denormalized onto the parent in v2.
        if !self.channel_ids.is_empty() {
            bool_query.filter(QueryType::terms("channel_id", self.channel_ids.clone()));
        }

        // One has_child clause per term, ANDed via bool.must. Each
        // carries its own inner_hits; the shared highlight_query tags
        // every search term on a returned segment regardless of which
        // clause produced it.
        //
        // speaker_id is a child-side field — it lives inside each
        // has_child clause alongside the term query so the same segment
        // that matches the term must also be from one of the requested
        // speakers. Filtering speaker_id at the bool level instead
        // would only require *some* segment in the call to have the
        // speaker, not necessarily the segment matching the term.
        let highlight_query =
            build_all_terms_highlight_query(&self.inner.terms, &self.inner.match_type);
        for (idx, term) in self.inner.terms.iter().enumerate() {
            let term_query = build_child_content_query(term, &self.inner.match_type);
            let inner_query = if self.speaker_ids.is_empty() {
                term_query
            } else {
                let mut combined = BoolQueryBuilder::new();
                combined.must(term_query);
                combined.must(QueryType::terms("speaker_id", self.speaker_ids.clone()));
                combined.build().into()
            };
            let inner_hits = InnerHits::new()
                .name(format!("term_{idx}"))
                .size(INNER_HITS_PER_TERM)
                .highlight(inner_hits_content_highlight(&highlight_query));
            let has_child = HasChildQuery::new(CHILD_RELATION, inner_query).inner_hits(inner_hits);
            bool_query.must(has_child.into());
        }

        Ok(bool_query)
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

#[derive(Debug, Default)]
pub struct CallRecordSearchArgs {
    pub terms: Vec<String>,
    pub user_id: String,
    pub call_ids: Vec<String>,
    pub channel_ids: Vec<String>,
    pub speaker_ids: Vec<String>,
    pub page: u32,
    pub page_size: u32,
    pub match_type: String,
    pub collapse: bool,
    pub ids_only: bool,
}

impl From<CallRecordSearchArgs> for CallRecordQueryBuilder {
    fn from(args: CallRecordSearchArgs) -> Self {
        CallRecordQueryBuilder::new(args.terms)
            .match_type(&args.match_type)
            .page_size(args.page_size)
            .page(args.page)
            .user_id(&args.user_id)
            .ids(args.call_ids)
            .channel_ids(args.channel_ids)
            .speaker_ids(args.speaker_ids)
            .collapse(args.collapse)
            .ids_only(args.ids_only)
    }
}

// ---------------------------------------------------------------------------
// inner_hits → segment-level SearchHits
// ---------------------------------------------------------------------------

#[derive(Debug, serde::Deserialize)]
struct SegmentInnerHit {
    #[serde(rename = "_id")]
    id: String,
    #[serde(rename = "_score")]
    score: Option<f64>,
    #[serde(rename = "_source")]
    source: SegmentSource,
    #[serde(default)]
    highlight: Option<HashMap<String, Vec<String>>>,
}

#[derive(Debug, serde::Deserialize)]
struct SegmentSource {
    transcript_id: uuid::Uuid,
    #[serde(default)]
    speaker_id: Option<String>,
    #[serde(default)]
    sequence_num: Option<i32>,
    started_at_seconds: i64,
    #[serde(default)]
    ended_at_seconds: Option<i64>,
}

#[derive(Debug, serde::Deserialize)]
struct InnerHitsGroup {
    #[serde(default)]
    hits: InnerHitsList,
}

#[derive(Debug, Default, serde::Deserialize)]
struct InnerHitsList {
    #[serde(default)]
    hits: Vec<SegmentInnerHit>,
}

/// Walk the `inner_hits` block from a join-shape parent hit and emit
/// one `SearchHit` per matching child segment, carrying that segment's
/// `transcript_id`, `speaker_id`, `sequence_num`, timestamps, and
/// highlight — plus the parent's `channel_id` and `participant_ids`
/// threaded through for goto-navigation.
pub(crate) fn expand_inner_hits_to_search_hits(
    parent: &CallRecordIndex,
    inner_hits: &serde_json::Value,
) -> Vec<SearchHit> {
    let groups: HashMap<String, InnerHitsGroup> = match serde_json::from_value(inner_hits.clone()) {
        Ok(g) => g,
        Err(_) => return Vec::new(),
    };

    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut out: Vec<SearchHit> = Vec::new();
    for group in groups.into_values() {
        for seg in group.hits.hits {
            if !seen.insert(seg.id) {
                continue;
            }
            let highlight: Highlight = seg
                .highlight
                .map(|h| {
                    parse_highlight_hit(
                        h,
                        Keys {
                            title_key: CallRecordSearchConfig::TITLE_KEY,
                            content_key: CallRecordSearchConfig::CONTENT_KEY,
                        },
                    )
                })
                .unwrap_or_default();
            out.push(SearchHit {
                entity_id: parent.entity_id,
                entity_type: SearchEntityType::CallRecords,
                score: seg.score,
                highlight,
                goto: Some(SearchGotoContent::CallRecords(SearchGotoCallRecord {
                    channel_id: parent.channel_id,
                    transcript_id: seg.source.transcript_id,
                    speaker_id: seg.source.speaker_id.unwrap_or_default(),
                    sequence_num: seg.source.sequence_num.unwrap_or_default(),
                    started_at: DateTime::from_timestamp(seg.source.started_at_seconds, 0)
                        .unwrap_or_default(),
                    ended_at: seg
                        .source
                        .ended_at_seconds
                        .and_then(|s| DateTime::from_timestamp(s, 0)),
                    participant_ids: parent.participant_ids.clone(),
                })),
                updated_at: DateTime::from_timestamp(parent.started_at_seconds, 0),
            });
        }
    }
    out
}
