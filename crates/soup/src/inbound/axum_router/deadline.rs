use chrono::{DateTime, Utc};
use models_grouping::DeadlineBoundaries;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// Opaque continuation accepted by the grouped Soup endpoint.
#[derive(Debug, Default, Deserialize)]
pub struct GroupedSoupCursorParams {
    /// Cursor from a previous grouped response.
    pub cursor: Option<String>,
}
/// Frozen viewer-local day boundaries used to group task deadlines.
#[derive(Debug, Clone, Copy, Deserialize, Serialize, ToSchema)]
pub struct ApiDeadlineBoundaries {
    /// UTC start of the viewer's current local day.
    pub today: DateTime<Utc>,
    /// UTC start of the viewer's next local day.
    pub tomorrow: DateTime<Utc>,
    /// UTC start of the viewer's local day two days ahead.
    pub day_two: DateTime<Utc>,
    /// UTC start of the viewer's local day eight days ahead.
    pub day_eight: DateTime<Utc>,
}

impl From<ApiDeadlineBoundaries> for DeadlineBoundaries {
    fn from(value: ApiDeadlineBoundaries) -> Self {
        Self {
            today: value.today,
            tomorrow: value.tomorrow,
            day_two: value.day_two,
            day_eight: value.day_eight,
        }
    }
}
