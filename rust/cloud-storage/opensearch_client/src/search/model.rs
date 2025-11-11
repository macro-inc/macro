use std::{collections::HashMap, fmt::Display};

use crate::{SearchOn, search::query::Keys};

/// macro open/close tags for highlight matches
#[derive(Debug, PartialEq)]
pub enum MacroEm {
    /// Open tag <macro_em>
    Open,
    /// Close tag </macro_em>
    Close,
}

impl Display for MacroEm {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Open => write!(f, "<macro_em>"),
            Self::Close => write!(f, "</macro_em>"),
        }
    }
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct Hit<T> {
    pub _score: Option<f64>,
    pub _source: T,
    /// Highlights may or may not be present since we could match
    /// purely on the title of the item
    pub highlight: Option<HashMap<String, Vec<String>>>,
}

pub(crate) fn parse_highlight_hit(
    highlight: HashMap<String, Vec<String>>,
    keys: Keys,
    search_on: SearchOn,
) -> Vec<String> {
    match search_on {
        SearchOn::Name => highlight
            .get(keys.title_key)
            .map(|v| v.to_vec())
            .unwrap_or_default(),
        SearchOn::Content => highlight
            .get(keys.content_key)
            .map(|v| v.to_vec())
            .unwrap_or_default(),
        SearchOn::NameContent => {
            let mut result = Vec::new();

            if let Some(highlight) = highlight.get(keys.title_key) {
                result.extend(highlight.to_vec());
            }

            if let Some(highlight) = highlight.get(keys.content_key) {
                result.extend(highlight.to_vec());
            }

            result
        }
    }
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct Total {
    pub value: i64,
    pub relation: String,
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct Hits<T> {
    pub total: Total,
    pub max_score: Option<f64>,
    pub hits: Vec<Hit<T>>,
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct Shards {
    pub total: i32,
    pub successful: i32,
    pub skipped: i32,
    pub failed: i32,
}

pub type DefaultSearchResponse<T> = SearchResponse<T>;

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct SearchResponse<T> {
    pub hits: Hits<T>,
    pub took: i32,
    pub timed_out: bool,
    pub _shards: Shards,
}
