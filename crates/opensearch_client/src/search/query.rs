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

/// Whether the standard tokenizer keeps `term` as one word.
///
/// A one-word `match_phrase_prefix` rewrites into a disjunction of every
/// indexed term with that prefix (up to `max_expansions`), and OpenSearch
/// counts each of them against its 1024-clause limit, so a few short words
/// fail the whole search. `match_bool_prefix` on one word is the same prefix
/// match counted as one clause. It ignores word order, so anything that may
/// tokenize into several words stays a phrase. Leading and trailing ASCII
/// punctuation is dropped by the tokenizer, `_` joins, and `.`, `'` and `’`
/// join only between two letters or two digits. Scripts the tokenizer splits
/// per character (Han, kana) never count as one word.
pub(crate) fn is_single_word(term: &str) -> bool {
    let chars: Vec<char> = term
        .trim_matches(|c: char| c.is_ascii_punctuation())
        .chars()
        .collect();
    let is_word_char = |c: char| {
        c.is_alphanumeric()
            && !matches!(c, '\u{2E80}'..='\u{9FFF}' | '\u{F900}'..='\u{FAFF}' | '\u{20000}'..='\u{3FFFF}')
    };
    let joins_neighbors = |index: usize| {
        let before = index.checked_sub(1).and_then(|before| chars.get(before));
        match (before, chars.get(index + 1)) {
            (Some(before), Some(after)) => {
                (before.is_alphabetic() && after.is_alphabetic())
                    || (before.is_numeric() && after.is_numeric())
            }
            _ => false,
        }
    };
    !chars.is_empty()
        && chars.iter().enumerate().all(|(index, &c)| match c {
            '_' => true,
            '.' | '\'' | '\u{2019}' => joins_neighbors(index),
            c => is_word_char(c),
        })
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
        QueryKey::MatchPhrasePrefix if is_single_word(term) => QueryType::MatchBoolPrefix(
            MatchBoolPrefixQuery::new(field.to_string(), term.to_string()),
        ),
        QueryKey::MatchPhrasePrefix => QueryType::MatchPhrasePrefix(
            MatchPhrasePrefixQuery::new(field.to_string(), term.to_string())
                .max_expansions(MATCH_PHRASE_PREFIX_MAX_EXPANSIONS),
        ),
        QueryKey::Regexp => {
            QueryType::Regexp(RegexpQuery::new(field.to_string(), term.to_string()))
        }
    }
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
