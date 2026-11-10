//! What a routine suggestion is, as handed back, stored and served.

use chrono::{DateTime, Utc};
use macro_uuid::Uuid;
use routine_program::Surface;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use utoipa::ToSchema;

use crate::domain::models::{ActionConfiguration, CreatedItem, RoutineCheck};

/// A routine offered to one person: one AI suggested for them, or one of
/// Macro's catalog routines filling a surface.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RoutineSuggestion {
    /// Saving a routine from it passes this as `suggestion_id`; dismissing
    /// it uses it too.
    #[schema(value_type = String, format = Uuid)]
    pub id: Uuid,
    /// Who suggests it: AI, for this person, or Macro, as a template.
    pub from: SuggestionFrom,
    /// The sidebars it shows in, first the one it belongs to most.
    /// Dismissing it in one dismisses it everywhere.
    pub surfaces: Vec<Surface>,
    /// Why it fits this person, in a line; absent on Macro's templates.
    pub reason: Option<String>,
    /// AI's estimate, from 0 to 1, that the person keeps it on; absent on
    /// Macro's templates.
    pub keep_probability: Option<f32>,
    /// Onboarding shows it switched on: one of at most two catalog
    /// routines AI picked that are safe by default and likely kept. Never a
    /// drafted routine or a template.
    pub on_by_default: bool,
    #[serde(flatten)]
    pub pick: SuggestedPick,
}

/// Who suggests a routine.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema, strum::AsRefStr)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum SuggestionFrom {
    /// AI suggested it for this person, with a reason.
    ForYou,
    /// One of Macro's catalog routines, as a template.
    Macro,
}

/// What is suggested: a catalog routine with its knobs, or a routine AI
/// drafted and checked.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SuggestedPick {
    /// A catalog routine (`GET /scheduled-actions/catalog`), with the knob
    /// values AI filled in. Its trigger and steps come from the catalog.
    Catalog {
        /// The catalog routine, e.g. `inbox`.
        key: String,
        /// Knob values by knob name; knobs left out keep the catalog's.
        #[schema(value_type = Object)]
        knobs: Map<String, Value>,
    },
    /// A routine AI drafted that passed saving's checks, as it would be
    /// saved (switched off), for the person to review first.
    Routine { routine: ActionConfiguration },
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
    /// Never generated: no inbox was connected yet. Only Macro's templates
    /// show.
    None,
    /// AI is suggesting; its suggestions appear as each is handed back.
    Generating,
    /// Generation finished.
    Ready,
    /// Generation failed, after a retry; Macro's templates fill in.
    Failed,
}

/// A person's suggestions, and whether more are on the way.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RoutineSuggestions {
    pub status: GenerationStatus,
    /// Per surface, AI's first, best first, then Macro's templates, so each
    /// surface has at least one and ideally three. A suggestion with
    /// several surfaces appears once.
    pub suggestions: Vec<RoutineSuggestion>,
}

/// What a suggestion session hands back through `macro.routines.suggest`.
#[derive(Debug, Clone, Deserialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum SuggestRequest {
    /// A catalog routine, with knob values.
    #[serde(rename_all = "camelCase")]
    Catalog {
        key: String,
        #[serde(default)]
        #[schema(value_type = Object)]
        knobs: Map<String, Value>,
        reason: String,
        surfaces: Vec<Surface>,
        keep_probability: f32,
    },
    /// A routine the catalog lacks, checked as saving checks it.
    #[serde(rename_all = "camelCase")]
    Routine {
        routine: ActionConfiguration,
        /// What the session created for it, as `macro.routines.check` takes.
        #[serde(default)]
        created: Vec<CreatedItem>,
        reason: String,
        surfaces: Vec<Surface>,
        keep_probability: f32,
    },
}

impl SuggestRequest {
    pub fn kind_name(&self) -> &'static str {
        match self {
            Self::Catalog { .. } => "catalog",
            Self::Routine { .. } => "routine",
        }
    }
}

/// What became of a suggestion handed back.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SuggestOutcome {
    /// Whether it was kept.
    pub ok: bool,
    /// Why it wasn't, to fix and suggest again.
    pub problems: Vec<String>,
    /// A drafted routine's check, as `macro.routines.check` returns it.
    pub check: Option<RoutineCheck>,
    /// The kept suggestion's id.
    #[schema(value_type = Option<String>, format = Uuid)]
    pub id: Option<Uuid>,
}

/// A suggestion's pick as stored.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum StoredPick {
    Catalog {
        key: String,
        knobs: Map<String, Value>,
    },
    /// The routine as its check would store it, switched off.
    Routine { routine: ActionConfiguration },
}

/// A suggestion checked and ready to store.
#[derive(Debug, Clone, PartialEq)]
pub struct CheckedSuggestion {
    pub surfaces: Vec<Surface>,
    pub reason: String,
    pub keep_probability: f32,
    pub pick: StoredPick,
}

/// A stored suggestion AI made.
#[derive(Debug, Clone, PartialEq)]
pub struct StoredSuggestion {
    pub id: Uuid,
    pub surfaces: Vec<Surface>,
    pub reason: String,
    pub keep_probability: f32,
    pub pick: StoredPick,
    pub dismissed: bool,
    pub created_at: DateTime<Utc>,
}

/// A person's generation, as stored.
#[derive(Debug, Clone, PartialEq)]
pub struct StoredGeneration {
    pub status: GenerationStatus,
    pub started_at: DateTime<Utc>,
    pub finished_at: Option<DateTime<Utc>>,
}

/// How a generation ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq, strum::AsRefStr)]
#[strum(serialize_all = "snake_case")]
pub enum GenerationOutcome {
    /// Suggestions are off for the person.
    Off,
    /// They were generated before; generation runs once.
    Done,
    /// Every session handed back at least one suggestion.
    Ready,
    /// Some sessions handed back none, even after a retry.
    Partial,
    /// No session handed back any; Macro's templates fill in.
    Failed,
    /// The process is stopping.
    Cancelled,
}
