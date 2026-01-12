use models_search::unified::UnifiedSearchResponseItem;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

pub const PAGE_SIZE: i64 = 50;

#[derive(Serialize, Deserialize, Debug, JsonSchema)]
pub struct SearchToolResponse {
    pub results: Vec<UnifiedSearchResponseItem>,
}
