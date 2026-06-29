use models_search::MatchType;
use models_search::unified::UnifiedSearchResponseItem;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

pub const PAGE_SIZE: i64 = 50;

/// How search tools match query terms. Restricted to partial/exact — the
/// backend also supports regexp and an internal query mode, but those are not
/// offered to the model.
#[derive(Serialize, Deserialize, Debug, Clone, Copy, Default, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum SearchMatchType {
    /// Prefix matching: a single-word term matches tokens that start with it.
    #[default]
    Partial,
    /// Whole-token / exact-phrase matching, no prefix expansion.
    Exact,
}

impl From<SearchMatchType> for MatchType {
    fn from(value: SearchMatchType) -> Self {
        match value {
            SearchMatchType::Partial => MatchType::Partial,
            SearchMatchType::Exact => MatchType::Exact,
        }
    }
}

#[derive(Serialize, Deserialize, Debug, JsonSchema)]
pub struct SearchToolResponse {
    pub results: Vec<UnifiedSearchResponseItem>,
}
