use std::borrow::Cow;

use serde::Serialize;

mod boost_mode;
mod decay_function;
mod field_value_factor;
mod random_score;
mod score_function;
mod score_mode;
mod script_score;

pub use boost_mode::*;
pub use decay_function::*;
pub use field_value_factor::*;
pub use random_score::*;
pub use score_function::*;
pub use score_mode::*;
pub use script_score::*;
use serde_json::{Map, Value};

use crate::util::is_empty_slice;
use crate::{QueryType, ToOpenSearchJson};

/// Function Score Query
#[derive(Debug, Clone, Serialize, Default)]
pub struct FunctionScoreQuery<'a> {
    /// The query to use for scoring
    #[serde(skip_serializing_if = "Option::is_none")]
    pub query: Option<Box<QueryType<'a>>>,
    /// The scoring functions to use
    #[serde(skip_serializing_if = "is_empty_slice", default, borrow)]
    pub functions: Cow<'a, [ScoreFunction<'a>]>,
    /// The score mode to use
    #[serde(skip_serializing_if = "Option::is_none")]
    pub score_mode: Option<ScoreMode>,
    /// The boost mode to use
    #[serde(skip_serializing_if = "Option::is_none")]
    pub boost_mode: Option<BoostMode>,
    /// The maximum boost to use
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_boost: Option<f64>,
    /// The boost to use
    #[serde(skip_serializing_if = "Option::is_none")]
    pub boost: Option<f64>,
    /// The minimum score to use
    #[serde(skip_serializing_if = "Option::is_none")]
    pub min_score: Option<f64>,
}

impl<'a> FunctionScoreQuery<'a> {
    /// Create a new empty FunctionScoreQuery
    pub fn new() -> Self {
        Self::default()
    }

    /// Set the query for this query
    pub fn query(mut self, query: QueryType<'a>) -> Self {
        self.query = Some(Box::new(query));
        self
    }

    /// Add a scoring function
    pub fn function(mut self, function: ScoreFunction<'a>) -> Self {
        self.functions.to_mut().push(function);
        self
    }

    /// Set the score mode
    pub fn score_mode(mut self, score_mode: ScoreMode) -> Self {
        self.score_mode = Some(score_mode);
        self
    }

    /// Set the boost mode
    pub fn boost_mode(mut self, boost_mode: BoostMode) -> Self {
        self.boost_mode = Some(boost_mode);
        self
    }

    /// Set the maximum boost
    pub fn max_boost(mut self, max_boost: f64) -> Self {
        self.max_boost = Some(max_boost);
        self
    }

    /// Set the boost
    pub fn boost(mut self, boost: f64) -> Self {
        self.boost = Some(boost);
        self
    }

    /// Set the minimum score
    pub fn min_score(mut self, min_score: f64) -> Self {
        self.min_score = Some(min_score);
        self
    }

    /// Convert to an owned version with 'static lifetime
    pub fn to_owned(&self) -> FunctionScoreQuery<'static> {
        FunctionScoreQuery {
            query: self.query.as_ref().map(|q| Box::new((**q).to_owned())),
            functions: Cow::Owned(self.functions.iter().map(|f| f.to_owned()).collect()),
            score_mode: self.score_mode.clone(),
            boost_mode: self.boost_mode.clone(),
            max_boost: self.max_boost,
            boost: self.boost,
            min_score: self.min_score,
        }
    }
}

impl<'a> From<FunctionScoreQuery<'a>> for QueryType<'a> {
    fn from(function_score_query: FunctionScoreQuery<'a>) -> Self {
        QueryType::FunctionScore(function_score_query)
    }
}

impl<'a> ToOpenSearchJson for FunctionScoreQuery<'a> {
    fn to_json(&self) -> Value {
        let mut function_score_obj = Map::new();

        // Add query if present
        if let Some(ref query) = self.query {
            function_score_obj.insert("query".to_string(), query.to_json());
        }

        // Add functions array if not empty
        if !self.functions.is_empty() {
            let functions: Vec<Value> = self.functions.iter().map(|f| f.to_json()).collect();
            function_score_obj.insert("functions".to_string(), Value::Array(functions));
        }

        // Add score_mode if present
        if let Some(ref score_mode) = self.score_mode {
            function_score_obj.insert(
                "score_mode".to_string(),
                Value::String(match score_mode {
                    ScoreMode::Multiply => "multiply".to_string(),
                    ScoreMode::Sum => "sum".to_string(),
                    ScoreMode::Avg => "avg".to_string(),
                    ScoreMode::First => "first".to_string(),
                    ScoreMode::Max => "max".to_string(),
                    ScoreMode::Min => "min".to_string(),
                }),
            );
        }

        // Add boost_mode if present
        if let Some(ref boost_mode) = self.boost_mode {
            function_score_obj.insert(
                "boost_mode".to_string(),
                Value::String(match boost_mode {
                    BoostMode::Multiply => "multiply".to_string(),
                    BoostMode::Replace => "replace".to_string(),
                    BoostMode::Sum => "sum".to_string(),
                    BoostMode::Avg => "avg".to_string(),
                    BoostMode::Max => "max".to_string(),
                    BoostMode::Min => "min".to_string(),
                }),
            );
        }

        // Add max_boost if present
        if let Some(max_boost) = self.max_boost {
            function_score_obj.insert("max_boost".to_string(), max_boost.into());
        }

        // Add boost if present
        if let Some(boost) = self.boost {
            function_score_obj.insert("boost".to_string(), boost.into());
        }

        // Add min_score if present
        if let Some(min_score) = self.min_score {
            function_score_obj.insert("min_score".to_string(), min_score.into());
        }

        let mut result = Map::new();
        result.insert(
            "function_score".to_string(),
            Value::Object(function_score_obj),
        );
        Value::Object(result)
    }
}

/// Builder pattern for FunctionScoreQuery that allows dynamic updates.
#[derive(Default)]
pub struct FunctionScoreQueryBuilder<'a> {
    /// The query to use for scoring
    pub query: Option<Box<QueryType<'a>>>,
    /// The scoring functions to use
    pub functions: Cow<'a, [ScoreFunction<'a>]>,
    /// The score mode to use
    pub score_mode: Option<ScoreMode>,
    /// The boost mode to use
    pub boost_mode: Option<BoostMode>,
    /// The maximum boost to use
    pub max_boost: Option<f64>,
    /// The boost to use
    pub boost: Option<f64>,
    /// The minimum score to use
    pub min_score: Option<f64>,
}

impl<'a> FunctionScoreQueryBuilder<'a> {
    /// Create a new empty FunctionScoreQueryBuilder
    pub fn new() -> Self {
        Self::default()
    }

    /// Set the query for this query (replaces existing query)
    pub fn query(&mut self, query: QueryType<'a>) -> &mut Self {
        self.query = Some(Box::new(query));
        self
    }

    /// Add a scoring function (can be called multiple times)
    pub fn function(&mut self, function: ScoreFunction<'a>) -> &mut Self {
        self.functions.to_mut().push(function);
        self
    }

    /// Set the score mode (replaces existing score mode)
    pub fn score_mode(&mut self, score_mode: ScoreMode) -> &mut Self {
        self.score_mode = Some(score_mode);
        self
    }

    /// Set the boost mode (replaces existing boost mode)
    pub fn boost_mode(&mut self, boost_mode: BoostMode) -> &mut Self {
        self.boost_mode = Some(boost_mode);
        self
    }

    /// Set the maximum boost (replaces existing maximum boost)
    pub fn max_boost(&mut self, max_boost: f64) -> &mut Self {
        self.max_boost = Some(max_boost);
        self
    }

    /// Set the boost (replaces existing boost)
    pub fn boost(&mut self, boost: f64) -> &mut Self {
        self.boost = Some(boost);
        self
    }

    /// Set the minimum score (replaces existing minimum score)
    pub fn min_score(&mut self, min_score: f64) -> &mut Self {
        self.min_score = Some(min_score);
        self
    }

    /// Build the final FunctionScoreQuery
    pub fn build(self) -> FunctionScoreQuery<'a> {
        FunctionScoreQuery {
            query: self.query,
            functions: self.functions,
            score_mode: self.score_mode,
            boost_mode: self.boost_mode,
            max_boost: self.max_boost,
            boost: self.boost,
            min_score: self.min_score,
        }
    }
}
