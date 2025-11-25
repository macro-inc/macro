//! This module contains the logic for generating queries using terms

use std::borrow::Cow;

use crate::{Result, error::OpensearchClientError, search_on::NameOrContent};

use opensearch_query_builder::*;
use unicode_segmentation::UnicodeSegmentation;

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

/// Validates that the last term lenght is >= 3 graphemes
fn validate_last_term_length(term: &str) -> bool {
    UnicodeSegmentation::graphemes(term, true).count() >= 3
}

pub(crate) struct CreateQueryParams<'a> {
    /// The query key to use
    /// This is only used if unified params are not provided
    pub query_key: QueryKey,
    /// The field to search on
    pub field: &'a str,
    /// The term to search for
    pub term: &'a str,
    /// Optional unified search params
    /// If present, the unified search field is used
    pub unified_params: Option<&'a CreateQueryUnifiedParams>,
}

pub(crate) struct CreateQueryUnifiedParams {
    /// Specifies whether the unified search field is a name or content field
    /// This is used to determine the boosting of the match queries
    pub name_or_content: NameOrContent,
}

/// Creates a query for a given term
pub(crate) fn create_query<'a>(params: CreateQueryParams<'a>) -> QueryType<'a> {
    let CreateQueryParams {
        query_key,
        field,
        term,
        unified_params,
    } = params;

    if let Some(unified_params) = unified_params {
        let name_or_content = unified_params.name_or_content;
        // base bool query
        let mut bool_query = BoolQueryBuilder::new();
        bool_query.minimum_should_match(1);

        let mut match_phrase_prefix_query = MatchPhrasePrefixQuery::new(field.to_string(), term);
        let mut match_query = MatchQuery::new(field.to_string(), term);

        match name_or_content {
            NameOrContent::Name => {
                match_phrase_prefix_query = match_phrase_prefix_query.boost(1000.0);
                match_query = match_query.boost(0.1).minimum_should_match("80%");
            }
            NameOrContent::Content => {
                match_phrase_prefix_query = match_phrase_prefix_query.boost(900.0);
                match_query = match_query
                    .boost(0.09)
                    .minimum_should_match(term.split(' ').count().to_string());
            }
        }

        bool_query.should(match_phrase_prefix_query.into());
        bool_query.should(match_query.into());

        bool_query.build().into()
    } else {
        // Fixes https://linear.app/macro-eng/issue/M-5094/unified-search-match-prefix-on-phrase-should-not-constrain-terms
        // We need to create a more complex combo query if the last word in a term is less than 3 characters.
        let mut terms = term.split(' ').collect::<Vec<_>>();
        let last_term = terms.last().unwrap_or(&"");
        let is_last_term_long_enough = validate_last_term_length(last_term);

        if !last_term.is_empty() && !is_last_term_long_enough && terms.len() > 1 {
            tracing::trace!("last value in term has length less than 3, building combo query");

            let last_part_of_term = terms.pop().unwrap();
            let first_part_of_term = terms.join(" ");
            let wildcard_pattern = format!("*{}*", last_part_of_term.to_lowercase());

            // build the first term query
            let first_term_query = match query_key {
                QueryKey::MatchPhrase => QueryType::MatchPhrase(MatchPhraseQuery::new(
                    field.to_string(),
                    first_part_of_term,
                )),
                QueryKey::MatchPhrasePrefix => QueryType::MatchPhrasePrefix(
                    MatchPhrasePrefixQuery::new(field.to_string(), first_part_of_term),
                ),
                QueryKey::Regexp => {
                    QueryType::Regexp(RegexpQuery::new(field.to_string(), first_part_of_term))
                }
            };

            let second_term_query = QueryType::WildCard(WildcardQuery::new(
                field.to_string(),
                wildcard_pattern,
                true,
            ));

            let mut bool_query = QueryType::bool_query();

            bool_query.must(first_term_query);
            bool_query.must(second_term_query);

            return bool_query.build().into();
        }

        match query_key {
            QueryKey::MatchPhrase => {
                QueryType::MatchPhrase(MatchPhraseQuery::new(field.to_string(), term.to_string()))
            }
            QueryKey::MatchPhrasePrefix => QueryType::MatchPhrasePrefix(
                MatchPhrasePrefixQuery::new(field.to_string(), term.to_string()),
            ),
            QueryKey::Regexp => {
                QueryType::Regexp(RegexpQuery::new(field.to_string(), term.to_string()))
            }
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

/// Generate the terms for the "must" query
pub(crate) fn generate_terms_must_query<'a>(
    query_key: QueryKey,
    field: &'a str,
    terms: impl Into<Cow<'a, [&'a str]>>,
    unified_params: Option<&'a CreateQueryUnifiedParams>,
) -> QueryType<'a> {
    let mut terms_must_query = BoolQueryBuilder::new();

    terms_must_query.minimum_should_match(1);

    let terms = terms.into();

    // Map terms to queries
    let queries: Vec<_> = terms
        .iter()
        .map(|term| {
            create_query(CreateQueryParams {
                query_key,
                field,
                term,
                unified_params,
            })
        })
        .collect();

    // If we only have 1 query returned, we can just return that singular query
    // to go into the main bool must
    if queries.len() == 1 {
        return queries[0].clone();
    }

    // Otherwise, we need to add all the queries to a new bool should in order to properly search
    // over multiple terms
    for query in queries {
        terms_must_query.should(query);
    }

    terms_must_query.build().into()
}

/// Generates the term queries SearchOn::NameContent
pub(crate) fn generate_name_content_query(keys: &Keys, terms: &[String]) -> QueryType<'static> {
    let mut terms_must_query = BoolQueryBuilder::new();

    terms_must_query.minimum_should_match(1);

    let queries: Vec<QueryType> = terms
        .iter()
        .map(|term| {
            // base bool query
            let mut bool_query = BoolQueryBuilder::new();
            bool_query.minimum_should_match(1);

            bool_query.should(QueryType::MatchPhrasePrefix(
                MatchPhrasePrefixQuery::new(keys.title_key.to_string(), term.clone()).boost(1000.0),
            ));

            bool_query.should(QueryType::MatchPhrasePrefix(
                MatchPhrasePrefixQuery::new(keys.content_key.to_string(), term.clone())
                    .boost(900.0),
            ));

            bool_query.should(QueryType::Match(
                MatchQuery::new(keys.title_key.to_string(), term.clone())
                    .boost(0.1)
                    .minimum_should_match("80%"), // TODO: we may need to play around with this to get the best highlight match
            ));

            bool_query.should(QueryType::Match(
                MatchQuery::new(keys.content_key.to_string(), term.clone())
                    .boost(0.09)
                    .minimum_should_match(term.split(' ').count().to_string()), // TODO: we may need to play around with this to get the best highlight match
            ));

            bool_query.build().into()
        })
        .collect();

    // If we only have 1 query created, we can just return that singular query to be added to the
    // main bool must query
    if queries.len() == 1 {
        return queries[0].clone();
    }

    // Otherwise, we need to add all the queries to a new bool should in order to properly search
    // over multiple terms
    for query in queries {
        terms_must_query.should(query);
    }

    terms_must_query.build().into()
}

#[cfg(test)]
mod test;
