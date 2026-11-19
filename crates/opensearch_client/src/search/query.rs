//! This module contains the logic for generating queries using terms

use std::borrow::Cow;

use crate::{Result, error::OpensearchClientError};

use opensearch_query_builder::*;

/// Containing keys for the title and content fields
pub struct Keys<'a> {
    /// The title field key
    pub title_key: &'a str,
    /// The content field key
    pub content_key: &'a str,
}

/// The different types of ways we can match terms
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum QueryKey {
    /// Match phrase
    MatchPhrase,
    /// Match phrase prefix
    MatchPhrasePrefix,
    /// Regexp
    Regexp,
}

const MATCH_PHRASE_PREFIX_MAX_EXPANSIONS: u32 = 256;

pub(crate) struct CreateQueryParams<'a> {
    /// The query key to use
    pub query_key: QueryKey,
    /// The field to search on
    pub field: &'a str,
    /// The term to search for
    pub term: &'a str,
}

/// Creates a query for a given term
pub(crate) fn create_query<'a>(params: CreateQueryParams<'a>) -> QueryType<'a> {
    let CreateQueryParams {
        query_key,
        field,
        term,
    } = params;

    match query_key {
        QueryKey::MatchPhrase => {
            QueryType::MatchPhrase(MatchPhraseQuery::new(field.to_string(), term.to_string()))
        }
        QueryKey::MatchPhrasePrefix => QueryType::MatchPhrasePrefix(
            MatchPhrasePrefixQuery::new(field.to_string(), term.to_string())
                .max_expansions(MATCH_PHRASE_PREFIX_MAX_EXPANSIONS),
        ),
        QueryKey::Regexp => {
            QueryType::Regexp(RegexpQuery::new(field.to_string(), term.to_string()))
        }
    }
}

/// Fewest characters a content term needs before it matches as a prefix.
/// Shorter prefixes expand to too many tokens.
const MIN_PREFIX_LEN: usize = 3;

/// Builds the per-term query a `has_child` clause runs against children's
/// `content`.
///
/// - `exact` match type, a quoted phrase (term with whitespace), or a term
///   shorter than [`MIN_PREFIX_LEN`] → `match_phrase`.
/// - A single ASCII word → `match_bool_prefix`, a prefix query over every
///   token starting with the word.
/// - Anything else (punctuation, non-ASCII text the analyzer may split into
///   several tokens) → `match_phrase_prefix`.
///
/// The single word avoids `match_phrase_prefix` because OpenSearch expands its
/// prefix again for every inner hit of every returned parent, and keeps only
/// the first `max_expansions` terms of each segment, silently dropping the
/// matches past them. A prefix query expands lazily and keeps every match.
/// Its children score as a constant, so inner hits come back in index order.
pub(crate) fn child_content_query<'a>(term: &str, match_type: &str) -> QueryType<'a> {
    let exact = match_type == "exact"
        || term.chars().any(char::is_whitespace)
        || term.chars().count() < MIN_PREFIX_LEN;
    if exact {
        return QueryType::MatchPhrase(MatchPhraseQuery::new("content", term.to_string()));
    }

    let single_word = term.chars().all(|c| c.is_ascii_alphanumeric());
    if single_word {
        return QueryType::MatchBoolPrefix(MatchBoolPrefixQuery::new("content", term.to_string()));
    }

    QueryType::MatchPhrasePrefix(
        MatchPhrasePrefixQuery::new("content", term.to_string())
            .max_expansions(MATCH_PHRASE_PREFIX_MAX_EXPANSIONS),
    )
}

impl QueryKey {
    /// Creates a query key given a match type
    pub fn from_match_type(match_type: &str) -> Result<Self> {
        match match_type {
            "exact" => Ok(Self::MatchPhrase),
            "partial" => Ok(Self::MatchPhrasePrefix),
            "regexp" => Ok(Self::Regexp),
            _ => Err(OpensearchClientError::InvalidMatchType {
                match_type: match_type.to_string(),
            }),
        }
    }
}

/// How multi-term content queries combine.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum TermCombine {
    #[default]
    And,
}

/// Generate the terms for the "must" query — each term becomes its own
/// `match_*` clause and the clauses are combined per `combine`.
pub(crate) fn generate_terms_must_query<'a>(
    query_key: QueryKey,
    field: &'a str,
    terms: impl Into<Cow<'a, [&'a str]>>,
    combine: TermCombine,
) -> QueryType<'a> {
    generate_terms_must_query_for_fields(query_key, &[field], terms, combine)
}

/// Each term must match at least one field on the same document.
pub(crate) fn generate_terms_must_query_for_fields<'a>(
    query_key: QueryKey,
    fields: &[&'a str],
    terms: impl Into<Cow<'a, [&'a str]>>,
    combine: TermCombine,
) -> QueryType<'a> {
    let terms = terms.into();

    let queries: Vec<_> = terms
        .iter()
        .map(|term| {
            let mut alternatives = BoolQueryBuilder::new();
            alternatives.minimum_should_match(1);
            for field in fields {
                let query = create_query(CreateQueryParams {
                    query_key,
                    field,
                    term,
                });
                if fields.len() == 1 {
                    return query;
                }
                alternatives.should(query);
            }
            alternatives.build().into()
        })
        .collect();

    if queries.len() == 1 {
        return queries[0].clone();
    }

    let mut bool_query = BoolQueryBuilder::new();
    match combine {
        TermCombine::And => {
            for query in queries {
                bool_query.must(query);
            }
        }
    }

    bool_query.build().into()
}

#[cfg(test)]
mod test;
