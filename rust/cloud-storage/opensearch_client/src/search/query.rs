//! This module contains the logic for generating queries using terms

use crate::{Result, error::OpensearchClientError};

use opensearch_query_builder::*;
use unicode_segmentation::UnicodeSegmentation;

pub struct Keys<'a> {
    pub title_key: &'a str,
    pub content_key: &'a str,
}

/// The different types of ways we can match terms
#[derive(Debug, Clone, Copy)]
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

    /// Creates a query given a field and term
    fn create_query(&self, field: &str, term: &str) -> QueryType {
        // Fixes https://linear.app/macro-eng/issue/M-5094/unified-search-match-prefix-on-phrase-should-not-constrain-terms
        // We need to create a more complex combo query if the last word in a term is less than 3 characters.
        let mut terms = term.split(' ').collect::<Vec<_>>();
        let last_term = terms.last().unwrap_or(&"");
        let is_last_term_long_enough = validate_last_term_length(last_term);

        // TODO: we need type validation that the term is not an empty string
        // As a workaround, we will check if last_term is empty before entering into this block
        if !last_term.is_empty() && !is_last_term_long_enough && terms.len() > 1 {
            tracing::trace!("last value in term has length less than 3, building combo query");

            let last_part_of_term = terms.pop().unwrap();
            let first_part_of_term = terms.join(" ");

            // build the first term query
            let first_term_query = match self {
                Self::MatchPhrase => {
                    QueryType::MatchPhrase(MatchPhraseQuery::new(field, &first_part_of_term))
                }
                Self::MatchPhrasePrefix => QueryType::MatchPhrasePrefix(
                    MatchPhrasePrefixQuery::new(field, &first_part_of_term),
                ),
                Self::Regexp => QueryType::Regexp(RegexpQuery::new(field, &first_part_of_term)),
            };

            let second_term_query = QueryType::WildCard(WildcardQuery::new(
                field,
                &format!("*{}*", last_part_of_term.to_lowercase()),
                true,
            ));

            let mut bool_query = QueryType::bool_query();

            bool_query.must(first_term_query);
            bool_query.must(second_term_query);

            return bool_query.build().into();
        }

        match self {
            Self::MatchPhrase => QueryType::MatchPhrase(MatchPhraseQuery::new(field, term)),
            Self::MatchPhrasePrefix => {
                QueryType::MatchPhrasePrefix(MatchPhrasePrefixQuery::new(field, term))
            }
            Self::Regexp => QueryType::Regexp(RegexpQuery::new(field, term)),
        }
    }
}

/// Generate the terms for the "must" query
pub(crate) fn generate_terms_must_query(
    query_key: QueryKey,
    fields: &[&str],
    terms: &[String],
) -> QueryType {
    let mut terms_must_query = BoolQueryBuilder::new();

    terms_must_query.minimum_should_match(1);

    // Map terms to queries
    let queries: Vec<_> = fields
        .iter()
        .flat_map(|field| terms.iter().map(|term| query_key.create_query(field, term)))
        .collect();

    // populate in in "should" field
    for query in queries {
        terms_must_query.should(query);
    }

    terms_must_query.build().into()
}

/// Generates the term queries SearchOn::NameContent
pub(crate) fn generate_name_content_query(keys: &Keys, terms: &[String]) -> QueryType {
    let mut terms_must_query = BoolQueryBuilder::new();

    terms_must_query.minimum_should_match(1);

    let queries: Vec<QueryType> = terms
        .iter()
        .map(|term| {
            // base bool query
            let mut bool_query = BoolQueryBuilder::new();
            bool_query.minimum_should_match(1);

            bool_query.should(QueryType::MatchPhrasePrefix(
                MatchPhrasePrefixQuery::new(keys.title_key, term).boost(1000.0),
            ));

            bool_query.should(QueryType::MatchPhrasePrefix(
                MatchPhrasePrefixQuery::new(keys.content_key, term).boost(900.0),
            ));

            bool_query.should(QueryType::Match(
                MatchQuery::new(keys.title_key, term)
                    .boost(0.1)
                    .minimum_should_match("80%"), // TODO: we may need to play around with this to get the best highlight match
            ));

            bool_query.should(QueryType::Match(
                MatchQuery::new(keys.content_key, term)
                    .boost(0.09)
                    .minimum_should_match(&term.split(' ').count().to_string()), // TODO: we may need to play around with this to get the best highlight match
            ));

            bool_query.build().into()
        })
        .collect();

    for query in queries {
        terms_must_query.should(query);
    }

    terms_must_query.build().into()
}
