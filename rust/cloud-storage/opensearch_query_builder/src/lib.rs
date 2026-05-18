#![deny(missing_docs)]
//! This crate provides a simple way to dynamically build OpenSearch queries in a type-safe manner.

/// Trait for converting a Rust struct to an OpenSearch JSON object.
pub trait ToOpenSearchJson {
    /// Converts the struct to an OpenSearch JSON object.
    fn to_json(&self) -> serde_json::Value;
}

mod query;
mod request;
mod util;

pub use query::{
    BoolQuery, BoolQueryBuilder, BoostMode, DecayFunction, FieldValueFactor, FunctionScoreQuery,
    FunctionScoreQueryBuilder, MatchPhrasePrefixQuery, MatchPhraseQuery, MatchQuery, QueryType,
    RandomScore, RangeQuery, RangeQueryBuilder, RegexpQuery, RegexpQueryFlags, ScoreFunction,
    ScoreFunctionType, ScoreMode, ScriptScore, SimpleQueryStringQuery, TermQuery, TermsQuery,
    WildcardQuery,
};
pub use request::{
    AggregationType, CardinalityAggregation, Collapse, FieldSort, Highlight, HighlightField, Lang,
    ScoreWithOrderSort, Script, ScriptSort, ScriptSortType, SearchRequest, SearchRequestBuilder,
    SortMode, SortOrder, SortType, TermsAggregation,
};
