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
    let terms = terms.into();

    let queries: Vec<_> = terms
        .iter()
        .map(|term| {
            create_query(CreateQueryParams {
                query_key,
                field,
                term,
            })
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
