use chrono::{DateTime, Utc};
use item_filters::{CallFilters, CallStatus};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::{MatchType, SearchHighlight, SearchOn};

#[derive(Debug, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct CallRecordSearchResult {
    pub transcript_id: Option<uuid::Uuid>,
    pub speaker_id: Option<String>,
    pub sequence_num: Option<i32>,
    pub started_at: Option<DateTime<Utc>>,
    pub ended_at: Option<DateTime<Utc>>,
    pub highlight: SearchHighlight,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub score: Option<f64>,
}

#[derive(Debug, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct CallRecordSearchResponseItem {
    pub id: uuid::Uuid,
    pub name: Option<String>,
    pub owner_id: String,
    pub call_id: uuid::Uuid,
    pub channel_id: uuid::Uuid,
    pub participant_ids: Vec<String>,
    pub call_search_results: Vec<CallRecordSearchResult>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct CallRecordMetadata {
    pub created_by: String,
    pub started_at: DateTime<Utc>,
    pub ended_at: DateTime<Utc>,
    pub duration_ms: i64,
    pub updated_at: DateTime<Utc>,
    pub channel_name: Option<String>,
    pub status: CallStatus,
    pub attended: bool,
}

#[derive(Debug, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct CallRecordSearchResponseItemWithMetadata {
    /// `None` if the call has been deleted.
    pub metadata: Option<CallRecordMetadata>,
    #[serde(flatten)]
    pub extra: CallRecordSearchResponseItem,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct CallRecordSearchResponse {
    pub results: Vec<CallRecordSearchResponseItemWithMetadata>,
}

#[derive(Serialize, Deserialize, Debug, ToSchema, JsonSchema)]
pub struct CallRecordSearchRequest {
    pub query: Option<String>,
    pub terms: Option<Vec<String>>,
    pub match_type: MatchType,
    #[serde(flatten)]
    pub filters: Option<CallFilters>,
    #[serde(default)]
    pub search_on: SearchOn,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub collapse: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct SimpleCallRecordSearchResponseBaseItem<T> {
    pub call_id: String,
    pub channel_id: String,
    pub user_id: String,
    pub participant_ids: Vec<String>,
    #[schema(inline)]
    pub started_at: T,
    #[schema(inline)]
    pub ended_at: T,
    pub duration_ms: i64,
    pub channel_name: Option<String>,
    pub highlight: SearchHighlight,
}

pub type SimpleCallRecordSearchResponseItem =
    SimpleCallRecordSearchResponseBaseItem<crate::HumanReadableTimestamp>;

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct SimpleCallRecordSearchResponse {
    pub results: Vec<SimpleCallRecordSearchResponseItem>,
}
