#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct HighlightContent {
    /// Contains an array of highlighted text fragments
    pub content: Vec<String>,
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct Hit<T, U> {
    pub _score: Option<f64>,
    pub _source: T,
    /// Highlights may or may not be present since we could match
    /// purely on the title of the item
    pub highlight: Option<U>,
}

pub type DefaultHit<T> = Hit<T, HighlightContent>;

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct Total {
    pub value: i64,
    pub relation: String,
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct Hits<T, U> {
    pub total: Total,
    pub max_score: Option<f64>,
    pub hits: Vec<Hit<T, U>>,
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct Shards {
    pub total: i32,
    pub successful: i32,
    pub skipped: i32,
    pub failed: i32,
}

pub type DefaultSearchResponse<T> = SearchResponse<T, HighlightContent>;

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct SearchResponse<T, U> {
    pub hits: Hits<T, U>,
    pub took: i32,
    pub timed_out: bool,
    pub _shards: Shards,
}
