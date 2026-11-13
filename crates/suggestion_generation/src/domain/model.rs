//! What a generation is: a run of hidden sessions for one person.

use bot_id::BotId;
use chrono_tz::Tz;
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use routine_program::Surface;
use serde::Serialize;
use utoipa::ToSchema;

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

/// A session row a stopped process left open.
#[derive(Debug, Clone, PartialEq)]
pub struct StaleSession {
    /// The agent session.
    pub session: Uuid,
    /// Whose it is.
    pub user: MacroUserIdStr<'static>,
    /// The agent it runs as.
    pub agent: BotId,
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

/// How a generation ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq, strum::AsRefStr)]
#[strum(serialize_all = "snake_case")]
pub enum GenerationOutcome {
    /// Every session finished its turn.
    Ready,
    /// Some sessions failed, timed out or were stopped.
    Partial,
    /// No session finished.
    Failed,
    /// The process is stopping.
    Cancelled,
}

/// Why a generation call failed.
#[derive(Debug, thiserror::Error)]
pub enum GenerationError {
    /// Neither suggestions nor routine suggestions are on for the person.
    #[error("suggestions are off")]
    NotFound,
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
