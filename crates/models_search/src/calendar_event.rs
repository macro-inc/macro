use crate::{SearchHighlight, SearchResponse, SearchResponseItem};
use chrono::{DateTime, Utc};
use models_soup::SoupProperty;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// Timed or all-day span of a calendar event.
///
/// Deliberately a local mirror of `models_soup::calendar_event::SoupCalendarEventTime`
/// rather than a reuse of it: this module needs both `ToSchema` (OpenAPI) and
/// `JsonSchema` (AI tool schemas), and `models_soup` carries no schemars
/// dependency. The wire shape is identical and must stay that way, so a
/// client can decode a search row and a soup row with one mapping.
///
/// Fields are camelCased per variant rather than via `rename_all_fields`,
/// which utoipa ignores.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema, JsonSchema)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum CalendarEventSearchTime {
    /// Absolute timed event.
    #[serde(rename_all = "camelCase")]
    Timed {
        /// Inclusive start.
        starts_at: DateTime<Utc>,
        /// Exclusive end.
        ends_at: DateTime<Utc>,
        /// Original IANA time zone.
        time_zone: Option<String>,
    },
    /// All-day event with an exclusive end date.
    #[serde(rename_all = "camelCase")]
    AllDay {
        /// Inclusive start date.
        start_date: chrono::NaiveDate,
        /// Exclusive end date.
        end_date: chrono::NaiveDate,
    },
}

#[derive(Debug, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct CalendarEventSearchResult {
    pub highlight: SearchHighlight,
    /// The score of the result
    #[serde(skip_serializing_if = "Option::is_none")]
    pub score: Option<f64>,
}

/// Metadata associated with calendar event search, to be used with
/// SearchResponseItem
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct CalendarEventSearchMetadata {
    pub event_id: uuid::Uuid,
    pub owner_id: String,
    pub title: String,
    pub updated_at: DateTime<Utc>,
    pub created_at: DateTime<Utc>,
}

/// The instance a search row points at.
///
/// A recurring series is indexed once, as its master. Which instance the row
/// should show is decided per request rather than baked into the index: the
/// next occurrence at or after now, else the most recent past one. This is
/// the same resolution a calendar mention performs, so a search row and a
/// mention of the same event agree on where they land.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CalendarEventSearchOccurrence {
    /// Stable key of the resolved instance within its series.
    pub occurrence_key: String,
    /// Span of the resolved instance.
    pub time: CalendarEventSearchTime,
}

/// The event's organizer — its creator, in Google's model. Either field can be
/// absent when the source does not name it.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CalendarEventOrganizer {
    /// Display name, when the source provided one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// Organizer email address, when known.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
}

/// A single response item, part of the CalendarEventSearchResponse object
#[derive(Debug, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct CalendarEventSearchResponseItem {
    /// Standardized fields that all item types will share.
    pub id: uuid::Uuid,
    pub name: String,
    pub owner_id: String,

    pub updated_at: DateTime<Utc>,
    pub created_at: DateTime<Utc>,
    pub calendar_event_search_results: Vec<CalendarEventSearchResult>,
}

/// Metadata for a calendar event fetched from the database.
///
/// The index carries the master span for ranking, but the occurrence a row
/// should display depends on when the query ran, so it is resolved here
/// rather than indexed.
#[derive(Debug, Serialize, Deserialize, ToSchema, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CalendarEventMetadata {
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    /// Canonical status (`confirmed`, `tentative`, `cancelled`).
    pub status: String,
    /// The series' own span.
    pub time: CalendarEventSearchTime,
    /// Whether the series carries a recurrence rule. Lets a row render a
    /// recurring badge without parsing the rules.
    pub is_recurring: bool,
    /// The instance this row points at. `None` when the series has no
    /// materialized occurrence — occurrences exist only inside a rolling
    /// window, so a row can legitimately fall back to `time`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub occurrence: Option<CalendarEventSearchOccurrence>,
    /// Direct conference join URL when known.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub conference_url: Option<String>,
    /// Whether the canonical source prohibits mutation.
    pub is_read_only: bool,
    /// The event's organizer (creator), when the source names one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub organizer: Option<CalendarEventOrganizer>,
    /// Free-text description, when the event carries one. May contain HTML from
    /// the source; clients render a plain-text preview.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

/// CalendarEventSearchResponseItem with metadata fetched from macrodb.
#[derive(Debug, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct CalendarEventSearchResponseItemWithMetadata {
    /// Metadata from the database. None if the event no longer exists.
    pub metadata: Option<CalendarEventMetadata>,
    /// Entity properties (e.g. tags) on the event.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schemars(skip)]
    pub properties: Option<Vec<SoupProperty>>,
    #[serde(flatten)]
    pub extra: CalendarEventSearchResponseItem,
}

impl From<SearchResponseItem<CalendarEventSearchResult, CalendarEventSearchMetadata>>
    for CalendarEventSearchResponseItem
{
    fn from(
        response: SearchResponseItem<CalendarEventSearchResult, CalendarEventSearchMetadata>,
    ) -> Self {
        CalendarEventSearchResponseItem {
            id: response.metadata.event_id,
            name: response.metadata.title,
            owner_id: response.metadata.owner_id,
            updated_at: response.metadata.updated_at,
            created_at: response.metadata.created_at,
            calendar_event_search_results: response.results,
        }
    }
}

/// Calendar Event Search Response
pub type CalendarEventSearchResponse = SearchResponse<CalendarEventSearchResponseItemWithMetadata>;

#[derive(Debug, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct SimpleCalendarEventSearchResponseBaseItem<T> {
    /// The calendar event id
    pub calendar_event_id: String,
    #[schema(inline)]
    /// The time the event was last updated
    pub updated_at: T,
    #[schema(inline)]
    /// The time the event was created
    pub created_at: T,
    /// The event title
    pub title: String,
    /// The owner of this event projection
    pub user_id: String,
    /// Whether the series carries a recurrence rule
    pub is_recurring: bool,
    /// Stable key of the instance this row points at, when one resolved
    #[serde(skip_serializing_if = "Option::is_none")]
    pub occurrence_key: Option<String>,
    /// The highlights on the event
    pub highlight: SearchHighlight,
}

pub type SimpleCalendarEventSearchResponseItem =
    SimpleCalendarEventSearchResponseBaseItem<crate::HumanReadableTimestamp>;
