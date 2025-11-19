use std::{collections::HashMap, fmt::Display};

use crate::search::query::Keys;

#[derive(Debug, Clone, Hash, Eq, PartialEq, strum::Display, strum::EnumString, strum::AsRefStr)]
#[strum(serialize_all = "lowercase")]
pub enum SearchIndex {
    Channels,
    Chats,
    Documents,
    Emails,
    Projects,
}

/// macro open/close tags for highlight matches
#[derive(Debug, PartialEq)]
pub(crate) enum MacroEm {
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
pub(crate) struct Hit<T> {
    pub _score: Option<f64>,
    pub _source: T,
    /// Highlights may or may not be present since we could match
    /// purely on the title of the item
    pub highlight: Option<HashMap<String, Vec<String>>>,
}

#[derive(Debug, serde::Serialize, serde::Deserialize, Default, Clone)]
pub struct Highlight {
    /// The highlight name match if present
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,

    /// The highlight content matches
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub content: Vec<String>,
}

pub(crate) fn parse_highlight_hit(
    highlight: HashMap<String, Vec<String>>,
    keys: Keys,
) -> Highlight {
    let name = highlight
        .get(keys.title_key)
        .and_then(|v| v.first())
        .map(|v| v.to_string());

    Highlight {
        name,
        content: highlight
            .get(keys.content_key)
            .map(|v| v.to_vec())
            .unwrap_or_default(),
    }
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub(crate) struct Total {
    pub value: i64,
    pub relation: String,
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub(crate) struct Hits<T> {
    pub total: Total,
    pub max_score: Option<f64>,
    pub hits: Vec<Hit<T>>,
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub(crate) struct Shards {
    pub total: i32,
    pub successful: i32,
    pub skipped: i32,
    pub failed: i32,
}

pub(crate) type DefaultSearchResponse<T> = SearchResponse<T>;

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub(crate) struct SearchResponse<T> {
    pub hits: Hits<T>,
    pub took: i32,
    pub timed_out: bool,
    pub _shards: Shards,
}
