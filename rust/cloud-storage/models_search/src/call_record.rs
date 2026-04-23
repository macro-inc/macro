use chrono::{DateTime, Utc};
use item_filters::CallFilters;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::{MatchType, SearchHighlight, SearchOn};

/// A match on a specific transcript segment within a call record.
/// Modelled after `ChannelSearchResult` — one of these per matched segment,
/// with all the metadata a frontend needs to navigate to and highlight it.
#[derive(Debug, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct CallRecordSearchResult {
    /// Primary key of the matched `call_record_transcripts` row.
    /// Present when the hit came from segment content.
    pub transcript_id: Option<uuid::Uuid>,
    /// The macro user id of the speaker for the matched segment.
    pub speaker_id: Option<String>,
    /// Position of the segment within the call.
    pub sequence_num: Option<i32>,
    /// When the segment started being spoken.
    pub started_at: Option<DateTime<Utc>>,
    /// When the segment ended (nullable — some segments have no end time).
    pub ended_at: Option<DateTime<Utc>>,
    /// The highlight fragments from the segment's text.
    pub highlight: SearchHighlight,
    /// The score of the match.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub score: Option<f64>,
}

/// A single response item, part of the CallRecordSearchResponse object.
#[derive(Debug, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct CallRecordSearchResponseItem {
    /// Aligned identifier across response item shapes.
    pub id: uuid::Uuid,
    /// Display name for the call — falls back to the channel name when available.
    pub name: Option<String>,
    /// The macro user id of the call creator.
    pub owner_id: String,

    /// The id of the call record.
    pub call_id: uuid::Uuid,
    /// The id of the channel the call belongs to.
    pub channel_id: uuid::Uuid,
    /// The macro user ids of call participants.
    pub participant_ids: Vec<String>,
    /// Hits for this call record (content matches).
    pub call_search_results: Vec<CallRecordSearchResult>,
}

/// Metadata for a call record fetched from the database.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct CallRecordMetadata {
    pub created_by: String,
    pub started_at: DateTime<Utc>,
    pub ended_at: DateTime<Utc>,
    pub duration_ms: i64,
    pub updated_at: DateTime<Utc>,
    pub channel_name: Option<String>,
    /// Whether the requesting user was a participant on the call.
    pub attended: bool,
}

/// CallRecordSearchResponseItem with metadata fetched from macrodb.
#[derive(Debug, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct CallRecordSearchResponseItemWithMetadata {
    /// Metadata from the database; `None` if the call record has since been deleted.
    pub metadata: Option<CallRecordMetadata>,
    #[serde(flatten)]
    pub extra: CallRecordSearchResponseItem,
}

/// The call record search response object.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct CallRecordSearchResponse {
    /// List containing results from call records.
    pub results: Vec<CallRecordSearchResponseItemWithMetadata>,
}

#[derive(Serialize, Deserialize, Debug, ToSchema, JsonSchema)]
pub struct CallRecordSearchRequest {
    /// The query to search for
    pub query: Option<String>,
    /// Multiple terms to search over
    pub terms: Option<Vec<String>>,
    /// The match type to use when searching
    pub match_type: MatchType,
    /// Search filters for call records
    #[serde(flatten)]
    pub filters: Option<CallFilters>,
    /// Fields to search on (Name, Content, NameContent). Defaults to Content
    #[serde(default)]
    pub search_on: SearchOn,
    /// If true, returns only 1 result per entity. False by default.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub collapse: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct SimpleCallRecordSearchResponseBaseItem<T> {
    /// The call record id
    pub call_id: String,
    /// The channel id
    pub channel_id: String,
    /// The macro user id of the creator
    pub user_id: String,
    /// Participants on the call
    pub participant_ids: Vec<String>,
    /// The call start time
    #[schema(inline)]
    pub started_at: T,
    /// The call end time
    #[schema(inline)]
    pub ended_at: T,
    /// The duration in milliseconds
    pub duration_ms: i64,
    /// The best-effort channel name
    pub channel_name: Option<String>,
    /// The highlights on the call record
    pub highlight: SearchHighlight,
}

pub type SimpleCallRecordSearchResponseItem =
    SimpleCallRecordSearchResponseBaseItem<crate::HumanReadableTimestamp>;

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct SimpleCallRecordSearchResponse {
    /// List containing results from call records.
    pub results: Vec<SimpleCallRecordSearchResponseItem>,
}
