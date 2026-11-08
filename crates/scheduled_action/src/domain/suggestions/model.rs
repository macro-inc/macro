//! What a routine suggestion is, as stored and as served.

use chrono::{DateTime, Utc};
use macro_uuid::Uuid;
use routine_program::Surface;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use utoipa::ToSchema;

/// A routine offered to one person, picked for them by AI.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RoutineSuggestion {
    #[schema(value_type = String, format = Uuid)]
    pub id: Uuid,
    /// Where it is offered: the sidebar of that part of the app.
    pub surface: Surface,
    /// Why it fits this person, in a line.
    pub reason: String,
    /// AI's estimate, from 0 to 1, that the person keeps it on.
    pub keep_probability: f32,
    /// It may be switched on before its owner changes anything: only a
    /// catalog routine marked safe by default, never a request.
    pub safe_default: bool,
    #[serde(flatten)]
    pub pick: SuggestionPick,
}

/// What AI picked: a catalog routine with its knobs, or a request for the
/// drafter.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SuggestionPick {
    /// A catalog routine, with the knob values AI filled in. Its trigger
    /// and steps come from the catalog, never from AI.
    Starter {
        /// The catalog routine, e.g. `inbox`.
        key: String,
        /// Knob values by knob name; knobs left out keep the catalog's.
        #[schema(value_type = Object)]
        knobs: Map<String, Value>,
    },
    /// What a routine the catalog lacks would do, in the person's words. The
    /// drafter writes it when the person accepts it, and they review it.
    Request {
        /// Its name, e.g. "Weekly supplier digest".
        title: String,
        /// What it does and when, e.g. "Every Friday, list the deliveries
        /// suppliers confirmed this week."
        request: String,
    },
}

/// A suggestion AI made and the scheduler checked, before it is stored.
#[derive(Debug, Clone, PartialEq)]
pub struct CheckedSuggestion {
    pub surface: Surface,
    pub reason: String,
    pub keep_probability: f32,
    pub pick: SuggestionPick,
}

/// Where a person's suggestions are in being generated.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Serialize,
    Deserialize,
    ToSchema,
    strum::EnumString,
    strum::AsRefStr,
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum GenerationStatus {
    /// None generated yet: the scheduler generates the first soon.
    Pending,
    /// A generation is running; earlier suggestions still show.
    Generating,
    /// The last generation finished.
    Ready,
    /// The last generation failed; earlier suggestions still show.
    Failed,
}

/// The last generation for a person, as stored.
#[derive(Debug, Clone, PartialEq)]
pub struct StoredGeneration {
    pub status: GenerationStatus,
    pub generation_id: Uuid,
    /// What the last finished generation read, to tell when it changed.
    pub inputs: Option<String>,
    pub started_at: DateTime<Utc>,
    pub generated_at: Option<DateTime<Utc>>,
}

/// A person's suggestions, and whether more are on the way.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RoutineSuggestions {
    pub status: GenerationStatus,
    /// When the suggestions shown were generated; absent before the first.
    pub generated_at: Option<DateTime<Utc>>,
    /// Best first within each surface.
    pub suggestions: Vec<RoutineSuggestion>,
}

/// What asking for a generation did.
#[derive(Debug, Clone, Copy, PartialEq, Eq, strum::AsRefStr)]
#[strum(serialize_all = "snake_case")]
pub enum GenerationOutcome {
    /// Suggestions are off for the person.
    Off,
    /// Another generation is running; it is left to finish.
    Running,
    /// New suggestions are stored.
    Ready,
    /// It failed; the earlier suggestions stay.
    Failed,
    /// A newer generation took over; its result wins.
    Superseded,
    /// The process is stopping.
    Cancelled,
}
