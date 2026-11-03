//! Loading the skills a turn needs: who has it, and what a session has loaded.

use std::collections::HashMap;
use std::sync::{Mutex, PoisonError};
use std::time::Duration;
use std::{future::Future, pin::Pin};

use agent_session::domain::model::AgentSessionId;
use feature_flags::FeatureFlags;
use macro_user_id::user_id::MacroUserIdStr;
use skills::domain::selection::LoadedSkill;
use tokio::time::Instant;
use uuid::Uuid;

#[cfg(test)]
mod eval;
#[cfg(test)]
mod test;

/// PostHog key evaluated for the session owner.
pub const AUTO_SKILLS: &str = "auto-skills";

/// Most skills one session keeps loaded; the oldest go first.
pub const SKILLS_PER_SESSION: usize = 8;

/// How long a session's skills outlive its last turn.
pub const SESSION_IDLE: Duration = Duration::from_secs(24 * 60 * 60);

/// Whether a turn loads skills on its own.
pub trait SkillRoutingPolicy: Send + Sync {
    /// Whether `owner`'s turns route skills; unavailable flags do not.
    fn routes<'a>(
        &'a self,
        owner: &'a MacroUserIdStr<'_>,
    ) -> Pin<Box<dyn Future<Output = bool> + Send + 'a>>;
}

/// Default when this deployment has no feature-flag provider.
pub struct NoSkillRouting;

impl SkillRoutingPolicy for NoSkillRouting {
    fn routes<'a>(
        &'a self,
        _: &'a MacroUserIdStr<'_>,
    ) -> Pin<Box<dyn Future<Output = bool> + Send + 'a>> {
        Box::pin(async { false })
    }
}

/// Routes skills for owners with [`AUTO_SKILLS`].
pub struct FlaggedSkillRouting<F> {
    flags: F,
}

impl<F: FeatureFlags> FlaggedSkillRouting<F> {
    /// Compose with a provider whose load has a bounded deadline.
    pub fn new(flags: F) -> Self {
        Self { flags }
    }
}

impl<F: FeatureFlags> SkillRoutingPolicy for FlaggedSkillRouting<F> {
    fn routes<'a>(
        &'a self,
        owner: &'a MacroUserIdStr<'_>,
    ) -> Pin<Box<dyn Future<Output = bool> + Send + 'a>> {
        Box::pin(async move {
            self.flags
                .load(owner)
                .await
                .inspect_err(|error| {
                    tracing::warn!(?error, "feature flags unavailable; not routing skills");
                })
                .unwrap_or_default()
                .is_enabled(AUTO_SKILLS)
        })
    }
}

/// The skills each session has loaded, so a skill stays in effect for the
/// rest of the session without being routed again. Kept in memory: after a
/// restart a session routes from its next message.
#[derive(Default)]
pub struct SessionSkills {
    sessions: Mutex<HashMap<AgentSessionId, Loaded>>,
}

struct Loaded {
    touched: Instant,
    skills: Vec<LoadedSkill>,
}

impl SessionSkills {
    /// The skills `session` has loaded, oldest first.
    pub fn loaded(&self, session: AgentSessionId) -> Vec<LoadedSkill> {
        self.sessions
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .get(&session)
            .map(|loaded| loaded.skills.clone())
            .unwrap_or_default()
    }

    /// The ids of the skills `session` has loaded.
    pub fn loaded_ids(&self, session: AgentSessionId) -> Vec<Uuid> {
        self.loaded(session).iter().map(|skill| skill.id).collect()
    }

    /// Add `skills` to what `session` has loaded and return all of it,
    /// oldest first. Forgets sessions idle for [`SESSION_IDLE`].
    pub fn add(&self, session: AgentSessionId, skills: Vec<LoadedSkill>) -> Vec<LoadedSkill> {
        let now = Instant::now();
        let mut sessions = self.sessions.lock().unwrap_or_else(PoisonError::into_inner);
        sessions.retain(|_, loaded| now.duration_since(loaded.touched) < SESSION_IDLE);
        let loaded = sessions.entry(session).or_insert_with(|| Loaded {
            touched: now,
            skills: Vec::new(),
        });
        loaded.touched = now;
        for skill in skills {
            if !loaded.skills.iter().any(|known| known.id == skill.id) {
                loaded.skills.push(skill);
            }
        }
        let excess = loaded.skills.len().saturating_sub(SKILLS_PER_SESSION);
        loaded.skills.drain(..excess);
        loaded.skills.clone()
    }
}
