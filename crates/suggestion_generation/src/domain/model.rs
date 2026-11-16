//! What a generation is: a run of hidden sessions for one person.

use bot_id::BotId;
use chrono_tz::Tz;
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use routine_program::Surface;
use serde::Serialize;
use suggestions::domain::model::GenerationTrigger;
use utoipa::ToSchema;

use super::generation::{Admission, PastRun};
use super::session::SessionEnding;

/// The agent generation sessions run as, and their model.
#[derive(Debug, Clone)]
pub struct GenerationAgent {
    /// The in-process Macro agent.
    pub bot: BotId,
    /// The model its sessions run on.
    pub model: String,
}

/// How a generation splits routine suggestions' surfaces across its
/// parallel routines sessions.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionLayout {
    sessions: Vec<Vec<Surface>>,
}

/// Most routines sessions one generation runs at once.
pub const MAX_ROUTINE_SESSIONS: usize = 3;

/// Every surface routine suggestions show on.
pub const ALL_SURFACES: [Surface; 9] = [
    Surface::Email,
    Surface::Calendar,
    Surface::Tasks,
    Surface::Files,
    Surface::Crm,
    Surface::Chat,
    Surface::Calls,
    Surface::Reviews,
    Surface::Agents,
];

/// Why a layout was refused.
#[derive(Debug, thiserror::Error)]
#[error(
    "a layout has 1 to {MAX_ROUTINE_SESSIONS} sessions, none empty, and every surface in exactly one"
)]
pub struct InvalidLayout;

impl SessionLayout {
    /// `sessions` parallel sessions, each with its surfaces: at most
    /// [`MAX_ROUTINE_SESSIONS`], each surface in exactly one.
    pub fn new(sessions: Vec<Vec<Surface>>) -> Result<Self, InvalidLayout> {
        let mut seen = std::collections::HashSet::new();
        let unique = sessions
            .iter()
            .flatten()
            .all(|surface| seen.insert(*surface));
        let fits = !sessions.is_empty()
            && sessions.len() <= MAX_ROUTINE_SESSIONS
            && !sessions.iter().any(Vec::is_empty)
            && unique
            && seen.len() == ALL_SURFACES.len();
        if fits {
            Ok(Self { sessions })
        } else {
            Err(InvalidLayout)
        }
    }

    /// One session for every surface.
    pub fn single() -> Self {
        Self {
            sessions: vec![ALL_SURFACES.to_vec()],
        }
    }

    /// Each session's surfaces.
    pub fn sessions(&self) -> &[Vec<Surface>] {
        &self.sessions
    }
}

impl Default for SessionLayout {
    /// Three sessions by surface group, the layout the suggestion benchmark
    /// chose: each hands back its catalog picks in about 20 to 35 seconds,
    /// then drafts.
    fn default() -> Self {
        Self {
            sessions: vec![
                vec![Surface::Email, Surface::Calendar, Surface::Tasks],
                vec![Surface::Crm, Surface::Calls, Surface::Chat],
                vec![Surface::Files, Surface::Reviews, Surface::Agents],
            ],
        }
    }
}

/// A session the sweep cleans up: ended, and not yet deleted.
#[derive(Debug, Clone, PartialEq)]
pub struct StaleSession {
    /// The agent session.
    pub session: Uuid,
    /// Whose it is.
    pub user: MacroUserIdStr<'static>,
    /// The agent it runs as.
    pub agent: BotId,
    /// How its turn ended.
    pub ending: SessionEnding,
    /// How many deletes of it failed before.
    pub attempts: u8,
}

/// A generation whose heartbeat stopped, marked interrupted.
#[derive(Debug, Clone, PartialEq)]
pub struct LostGeneration {
    /// The generation.
    pub generation: Uuid,
    /// Whose it was.
    pub user: MacroUserIdStr<'static>,
    /// What started it.
    pub trigger: GenerationTrigger,
}

/// What admission reads about the person's generations of one trigger.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AdmissionFacts {
    /// Whether one of theirs is running, of any trigger.
    pub running: bool,
    /// Their latest of the trigger.
    pub latest: Option<PastRun>,
}

/// A generation to store as running.
#[derive(Debug, Clone, PartialEq)]
pub struct NewGeneration {
    /// Its id, new for every attempt.
    pub id: Uuid,
    /// Whose it is.
    pub user: MacroUserIdStr<'static>,
    /// What started it.
    pub trigger: GenerationTrigger,
    /// Which attempt it is, from 1.
    pub attempt: u8,
    /// When it starts.
    pub started_at: chrono::DateTime<chrono::Utc>,
    /// When the latest of its trigger that admission read started: it is
    /// stored only if none started since.
    pub after: Option<chrono::DateTime<chrono::Utc>>,
}

/// A person due a nightly generation.
#[derive(Debug, Clone, PartialEq)]
pub struct AudienceMember {
    /// Who.
    pub user: MacroUserIdStr<'static>,
    /// The zone their browser last reported.
    pub timezone: Tz,
    /// When they last loaded the app with suggestions on.
    pub seen_at: chrono::DateTime<chrono::Utc>,
}

/// What starting a generation did.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct GenerationStarted {
    /// Whether a run started; false when one ran before or is running.
    pub started: bool,
}

/// Why fresh suggestions weren't started.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum RegenerationRefusal {
    /// One of the person's generations is running.
    Running,
}

/// Fresh suggestions weren't started: a generation is running.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RegenerationRunning {
    /// Why.
    pub reason: RegenerationRefusal,
}

/// Fresh suggestions weren't started: the person asked within the hour.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RegenerationCooldown {
    /// When they may ask again.
    pub available_at: chrono::DateTime<chrono::Utc>,
}

/// What asking for a generation did.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StartOutcome {
    /// It started, in the background.
    Started,
    /// None started: [`Admission`] refused it.
    Refused(Admission),
    /// None started: nothing it would run is on or due.
    Nothing,
}

/// Why a generation call failed.
#[derive(Debug, thiserror::Error)]
pub enum GenerationError {
    /// What was asked for is off for the person.
    #[error("suggestions are off")]
    NotFound,
    /// One of the person's generations is running.
    #[error("a generation is running")]
    Running,
    /// The person asked for fresh suggestions within the hour.
    #[error("fresh suggestions are available at {available_at}")]
    Cooldown {
        /// When they may ask again.
        available_at: chrono::DateTime<chrono::Utc>,
    },
    /// Anything else.
    #[error("internal generation error: {0:?}")]
    Internal(rootcause::Report),
}

impl GenerationError {
    /// An adapter's error, as an internal one.
    pub fn internal<E: std::error::Error + Send + Sync + 'static>(error: E) -> Self {
        Self::Internal(rootcause::Report::new(error).into_dynamic())
    }
}
