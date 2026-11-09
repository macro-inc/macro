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
        /// Never set: a catalog pick is not shown among ideas.
        #[serde(default)]
        idea: Option<RoutineIdea>,
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
        /// How it shows among the person's ideas.
        idea: RoutineIdea,
    },
}

/// How a drafted routine suggestion shows among the person's ideas: every
/// routine a session drafts is also one idea, kept and closed with it.
#[derive(Debug, Clone, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RoutineIdea {
    /// What it does for the person, in a few words.
    pub title: String,
    /// 0 to 100: how much the person would regret missing it this week.
    pub importance: u8,
    /// The feed's filters it shows under.
    #[serde(default)]
    pub categories: Vec<ideas::domain::model::Category>,
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
    /// A drafted routine's idea.
    pub idea: Option<CheckedRoutineIdea>,
}

/// A drafted routine's idea, checked.
#[derive(Debug, Clone, PartialEq)]
pub struct CheckedRoutineIdea {
    pub title: String,
    pub importance: u8,
    pub categories: Vec<ideas::domain::model::Category>,
}

/// A stored suggestion AI made.
#[derive(Debug, Clone, PartialEq)]
pub struct StoredSuggestion {
    pub id: Uuid,
    pub surfaces: Vec<Surface>,
    pub reason: String,
    pub keep_probability: f32,
    pub pick: StoredPick,
    /// When the person dismissed it.
    pub dismissed_at: Option<DateTime<Utc>>,
    /// When a nightly session retired it.
    pub retired_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

impl StoredSuggestion {
    /// Neither dismissed nor retired.
    pub fn is_open(&self) -> bool {
        self.dismissed_at.is_none() && self.retired_at.is_none()
    }
}

/// Where one of the person's suggestions is, for a routines session
/// managing them.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ReviewedState {
    /// Shown.
    Open,
    /// The person turned it down; never suggest it again.
    Dismissed,
    /// A session found it no longer fits; it may be suggested again.
    Retired,
    /// The person saved a routine from it.
    Saved,
}

/// One suggestion AI made for the person, as a routines session reviews it.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReviewedSuggestion {
    #[schema(value_type = String, format = Uuid)]
    pub id: Uuid,
    pub surfaces: Vec<Surface>,
    pub reason: String,
    pub keep_probability: f32,
    pub state: ReviewedState,
    /// When it was suggested.
    pub created_at: DateTime<Utc>,
    /// When it was dismissed or retired.
    pub closed_at: Option<DateTime<Utc>>,
    #[serde(flatten)]
    pub pick: SuggestedPick,
}

/// Every suggestion AI made for the person, for a routines session.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SuggestionReview {
    pub suggestions: Vec<ReviewedSuggestion>,
    /// Suggestions this session may still hand back.
    pub kept_left: u32,
}

/// Retiring an open suggestion that no longer fits.
#[derive(Debug, Clone, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RetireSuggestion {
    /// Why, for the change log.
    pub reason: String,
}

/// What a generation's routines sessions did, for its log events.
#[derive(Debug, Clone, PartialEq)]
pub struct RoutineGenerationReport {
    /// `onboarding` or `nightly`.
    pub trigger: &'static str,
    /// `ready` (every session kept one), `partial`, `failed` (none kept
    /// any) or `cancelled`.
    pub outcome: &'static str,
    pub sessions: usize,
    pub kept: u32,
    pub retries: usize,
    pub started_at: DateTime<Utc>,
    pub duration_ms: u64,
}
