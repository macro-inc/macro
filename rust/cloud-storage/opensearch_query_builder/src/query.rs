use std::borrow::Cow;

use serde::Serialize;

mod bool;
mod function_score;
mod match_phrase;
mod match_phrase_prefix;
mod match_query;
mod range;
mod regexp;
mod term;
mod terms;
mod wildcard;

pub use bool::*;
pub use function_score::*;
pub use match_phrase::*;
pub use match_phrase_prefix::*;
pub use match_query::*;
pub use range::*;
pub use regexp::*;
use serde_json::Value;
pub use term::*;
pub use terms::*;
pub use wildcard::*;

use crate::ToOpenSearchJson;

/// Enum representing the different types of queries that can be used in a search request.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", content = "params")]
pub enum QueryType<'a> {
    /// Bool query
    Bool(BoolQuery<'a>),
    /// Function score query
    FunctionScore(FunctionScoreQuery<'a>),
    /// Match phrase query
    MatchPhrase(MatchPhraseQuery<'a>),
    /// Match phrase prefix query
    MatchPhrasePrefix(MatchPhrasePrefixQuery<'a>),
    /// Match query
    Match(MatchQuery<'a>),
    /// Range query
    Range(RangeQuery<'a>),
    /// Regexp query
    Regexp(RegexpQuery<'a>),
    /// Term query
    Term(TermQuery<'a>),
    /// Terms query
    Terms(TermsQuery<'a>),
    /// Wildcard query
    WildCard(WildcardQuery<'a>),
}

impl<'a> ToOpenSearchJson for QueryType<'a> {
    fn to_json(&self) -> Value {
        match self {
            QueryType::Bool(bool_query) => bool_query.to_json(),
            QueryType::FunctionScore(function_score) => function_score.to_json(),
            QueryType::MatchPhrase(match_phrase) => match_phrase.to_json(),
            QueryType::MatchPhrasePrefix(match_phrase_prefix) => match_phrase_prefix.to_json(),
            QueryType::Match(match_query) => match_query.to_json(),
            QueryType::Term(term) => term.to_json(),
            QueryType::Terms(terms) => terms.to_json(),
            QueryType::Range(range) => range.to_json(),
            QueryType::WildCard(wildcard_query) => wildcard_query.to_json(),
            QueryType::Regexp(regexp_query) => regexp_query.to_json(),
        }
    }
}

impl<'a> QueryType<'a> {
    /// Convenience method for creating a term query
    pub fn term<T: Into<Value>>(field: impl Into<Cow<'a, str>>, value: T) -> Self {
        QueryType::Term(TermQuery::new(field, value))
    }

    /// Convenience method for creating a terms query
    pub fn terms<T: Into<Value>>(
        field: impl Into<Cow<'a, str>>,
        values: impl IntoIterator<Item = T>,
    ) -> Self {
        QueryType::Terms(TermsQuery::new(field, values))
    }

    /// Convenience method for creating a wildcard query
    pub fn wildcard(
        field: impl Into<Cow<'a, str>>,
        value: impl Into<Cow<'a, str>>,
        case_insensitive: bool,
    ) -> Self {
        QueryType::WildCard(WildcardQuery::new(field, value, case_insensitive, None))
    }

    /// Convenience method for creating a regexp query
    pub fn regexp(field: impl Into<Cow<'a, str>>, value: impl Into<Cow<'a, str>>) -> Self {
        QueryType::Regexp(RegexpQuery::new(field, value))
    }

    /// Convenience method for creating a match query
    pub fn match_phrase(field: impl Into<Cow<'a, str>>, query: impl Into<Cow<'a, str>>) -> Self {
        QueryType::MatchPhrase(MatchPhraseQuery::new(field, query))
    }

    /// Convenience method for creating a match phrase prefix query
    pub fn match_phrase_prefix(
        field: impl Into<Cow<'a, str>>,
        query: impl Into<Cow<'a, str>>,
    ) -> Self {
        QueryType::MatchPhrasePrefix(MatchPhrasePrefixQuery::new(field, query))
    }

    /// Convenience method for starting a bool query
    pub fn bool_query() -> BoolQueryBuilder<'a> {
        BoolQueryBuilder::new()
    }

    /// Convenience method for starting a match query
    pub fn range(field: impl Into<Cow<'a, str>>) -> RangeQueryBuilder<'a> {
        RangeQueryBuilder::new(field)
    }

    /// Convenience method for starting a function score query
    pub fn function_score() -> FunctionScoreQueryBuilder<'a> {
        FunctionScoreQueryBuilder::new()
    }

    /// Convert to an owned version with 'static lifetime
    pub fn to_owned(&self) -> QueryType<'static> {
        match self {
            QueryType::Bool(bool_query) => QueryType::Bool(bool_query.to_owned()),
            QueryType::FunctionScore(function_score) => {
                QueryType::FunctionScore(function_score.to_owned())
            }
            QueryType::MatchPhrase(match_phrase) => QueryType::MatchPhrase(match_phrase.to_owned()),
            QueryType::MatchPhrasePrefix(match_phrase_prefix) => {
                QueryType::MatchPhrasePrefix(match_phrase_prefix.to_owned())
            }
            QueryType::Match(match_query) => QueryType::Match(match_query.to_owned()),
            QueryType::Range(range) => QueryType::Range(range.to_owned()),
            QueryType::Regexp(regexp) => QueryType::Regexp(regexp.to_owned()),
            QueryType::Term(term) => QueryType::Term(term.to_owned()),
            QueryType::Terms(terms) => QueryType::Terms(terms.to_owned()),
            QueryType::WildCard(wildcard) => QueryType::WildCard(wildcard.to_owned()),
        }
    }
}
