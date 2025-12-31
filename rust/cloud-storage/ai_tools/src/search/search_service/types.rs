use models_search::SimpleSearchResponseItem;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

pub const PAGE_SIZE: i64 = 50;

#[derive(Serialize, Deserialize, Debug, JsonSchema)]
pub struct SearchResponse {
    pub results: Vec<SimpleSearchResponseItem>,
}
