//! Query and hit conversion for the user-visible projection of an agent session.

use std::collections::{BTreeMap, HashSet};

use models_opensearch::{OpenSearchEntityType, SearchEntityType};
use opensearch_query_builder::{BoolQueryBuilder, HasChildQuery, InnerHits, QueryType};

use super::{
    builder::{SearchQueryBuilder, SearchQueryConfig},
    chats::{
        build_all_terms_highlight_query, build_child_content_query, inner_hits_content_highlight,
    },
    model::{Hit, SearchGotoAgentSession, SearchGotoContent, SearchHit, parse_highlight_hit},
    query::Keys,
    utils::millis_to_datetime,
};
use crate::Result;

#[cfg(test)]
mod test;

/// Which fields of a folded conversation to search.
#[derive(Debug, Default, Clone, Copy)]
pub enum AgentSessionSearchMode {
    /// Only the session name.
    Name,
    /// Only folded messages.
    #[default]
    Content,
    /// Either the name or folded messages.
    NameContent,
}

/// Arguments resolved by the search service from current database access.
#[derive(Debug, Default, Clone)]
pub struct AgentSessionSearchArgs {
    /// Every term must match in the same session.
    pub terms: Vec<String>,
    /// Authorized session UUIDs. An empty list must never search all sessions.
    pub session_ids: Vec<String>,
    /// Name/content selection.
    pub mode: AgentSessionSearchMode,
}

struct AgentSessionSearchConfig;

impl SearchQueryConfig for AgentSessionSearchConfig {
    const ID_KEY: &'static str = "agent_session_id";
    const TITLE_KEY: &'static str = "name";
    const ENTITY_INDEX: OpenSearchEntityType = OpenSearchEntityType::AgentSessions;
}

pub(super) fn build_query(
    args: &AgentSessionSearchArgs,
    match_type: &str,
) -> Result<BoolQueryBuilder<'static>> {
    let inner = SearchQueryBuilder::<AgentSessionSearchConfig>::new(args.terms.clone())
        .ids(args.session_ids.clone())
        .ids_only(true)
        .match_type(match_type);
    if args.terms.is_empty() {
        return Err(crate::error::OpensearchClientError::NoTermsProvided);
    }
    let mut query = BoolQueryBuilder::new();
    query.filter(QueryType::term("_index", "agent_sessions"));
    query.filter(QueryType::term("agent_session_relation", "agent_session"));
    query.filter(inner.build_filter_query(None)?.to_owned());
    query.minimum_should_match(1);
    if matches!(
        args.mode,
        AgentSessionSearchMode::Name | AgentSessionSearchMode::NameContent
    ) {
        query.should(inner.build_title_term_query()?.to_owned());
    }
    if matches!(
        args.mode,
        AgentSessionSearchMode::Content | AgentSessionSearchMode::NameContent
    ) {
        let mut content = BoolQueryBuilder::new();
        let highlight = build_all_terms_highlight_query(&args.terms, match_type);
        for (index, term) in args.terms.iter().enumerate() {
            content.must(
                HasChildQuery::new("message", build_child_content_query(term, match_type))
                    .inner_hits(
                        InnerHits::new()
                            .name(format!("agent_term_{index}"))
                            .size(100)
                            .highlight(inner_hits_content_highlight(&highlight)),
                    )
                    .into(),
            );
        }
        query.should(content.build().into());
    }
    Ok(query)
}

/// Only projected metadata is decoded; raw ACP logs are never queried.
#[derive(Debug, serde::Deserialize)]
pub(crate) struct AgentSessionIndex {
    pub agent_session_id: uuid::Uuid,
    pub updated_at_millis: i64,
}

#[derive(serde::Deserialize)]
struct MessageHit {
    #[serde(rename = "_id")]
    id: String,
    #[serde(rename = "_score")]
    score: Option<f64>,
    #[serde(rename = "_source")]
    source: SearchGotoAgentSession,
    #[serde(default)]
    highlight: std::collections::HashMap<String, Vec<String>>,
}

#[derive(serde::Deserialize)]
struct MessageHits {
    hits: Vec<MessageHit>,
}

#[derive(serde::Deserialize)]
struct MessageGroup {
    hits: MessageHits,
}

const KEYS: Keys<'static> = Keys {
    title_key: "name",
    content_key: "content",
};

pub(super) fn expand(hit: Hit<AgentSessionIndex>) -> Vec<SearchHit> {
    let id = hit.source.agent_session_id;
    let updated_at = millis_to_datetime(Some(hit.source.updated_at_millis));
    let mut out = Vec::new();
    if let Some(highlight) = hit.highlight
        && highlight.contains_key("name")
    {
        out.push(SearchHit {
            entity_id: id,
            entity_type: SearchEntityType::AgentSessions,
            score: hit.score,
            highlight: parse_highlight_hit(highlight, KEYS),
            goto: None,
            updated_at,
        });
    }
    if let Some(inner) = hit.inner_hits {
        // Ordered groups and ID dedup make multi-term responses deterministic.
        let groups: BTreeMap<String, MessageGroup> = match serde_json::from_value(inner) {
            Ok(groups) => groups,
            Err(error) => {
                tracing::error!(error=?error, session_id=%id, "invalid agent-session inner hits");
                return out;
            }
        };
        let mut seen = HashSet::new();
        for group in groups.into_values() {
            for message in group.hits.hits {
                if !seen.insert(message.id) {
                    continue;
                }
                out.push(SearchHit {
                    entity_id: id,
                    entity_type: SearchEntityType::AgentSessions,
                    score: message.score,
                    highlight: parse_highlight_hit(message.highlight, KEYS),
                    goto: Some(SearchGotoContent::AgentSessions(message.source)),
                    updated_at,
                });
            }
        }
    }
    out
}
