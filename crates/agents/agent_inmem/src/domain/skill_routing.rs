//! Loading the user's skills a turn needs: who has it, what a session has
//! loaded, and where loaded skills sit in the turn's context.

use std::collections::HashMap;
use std::sync::{Mutex, PoisonError};
use std::time::Duration;
use std::{future::Future, pin::Pin};

use agent_loop::types::{ChatMessage, ChatMessageContent, Role};
use agent_session::domain::model::AgentSessionId;
use feature_flags::FeatureFlags;
use macro_user_id::user_id::MacroUserIdStr;
use skills::domain::selection::{LoadedSkill, render_loaded};
use tokio::time::Instant;
use uuid::Uuid;

#[cfg(test)]
mod eval;
#[cfg(test)]
mod test;

pub use crate::domain::entity_routing::AUTO_SKILLS;

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

/// The skills each session has loaded, each with the request (the user
/// message, counted from 0) that loaded it, so a skill stays in effect without
/// being routed again and sits in the same place on every turn. Kept in
/// memory: after a restart a session routes again from its next message.
#[derive(Default)]
pub struct SessionSkills {
    sessions: Mutex<HashMap<AgentSessionId, Loaded>>,
}

struct Loaded {
    touched: Instant,
    skills: Vec<(usize, LoadedSkill)>,
}

impl SessionSkills {
    /// The skills `session` has loaded with their requests, oldest first.
    pub fn loaded(&self, session: AgentSessionId) -> Vec<(usize, LoadedSkill)> {
        self.sessions
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .get(&session)
            .map(|loaded| loaded.skills.clone())
            .unwrap_or_default()
    }

    /// The ids of the skills `session` has loaded.
    pub fn loaded_ids(&self, session: AgentSessionId) -> Vec<Uuid> {
        self.loaded(session)
            .iter()
            .map(|(_, skill)| skill.id)
            .collect()
    }

    /// Record that `request` loaded `skills` and return everything `session`
    /// has loaded. Keeps the newest [`SKILLS_PER_SESSION`]; forgets sessions
    /// idle for [`SESSION_IDLE`].
    pub fn add(
        &self,
        session: AgentSessionId,
        request: usize,
        skills: Vec<LoadedSkill>,
    ) -> Vec<(usize, LoadedSkill)> {
        let now = Instant::now();
        let mut sessions = self.sessions.lock().unwrap_or_else(PoisonError::into_inner);
        sessions.retain(|_, loaded| now.duration_since(loaded.touched) < SESSION_IDLE);
        let loaded = sessions.entry(session).or_insert_with(|| Loaded {
            touched: now,
            skills: Vec::new(),
        });
        loaded.touched = now;
        for skill in skills {
            if !loaded.skills.iter().any(|(_, known)| known.id == skill.id) {
                loaded.skills.push((request, skill));
            }
        }
        let excess = loaded.skills.len().saturating_sub(SKILLS_PER_SESSION);
        loaded.skills.drain(..excess);
        loaded.skills.clone()
    }
}

/// Append each loaded skill to the user message that loaded it, as one
/// `<loaded_skills>` block per message. Only the model's copy of the context
/// changes; the session log keeps what the user wrote.
pub fn inject(messages: &mut [ChatMessage], loaded: &[(usize, LoadedSkill)]) {
    let requests = messages
        .iter_mut()
        .filter(|message| message.role == Role::User)
        .enumerate();
    for (request, message) in requests {
        let skills: Vec<LoadedSkill> = loaded
            .iter()
            .filter(|(at, _)| *at == request)
            .map(|(_, skill)| skill.clone())
            .collect();
        if skills.is_empty() {
            continue;
        }
        if let ChatMessageContent::Text(text) = &mut message.content {
            text.push_str("\n\n");
            text.push_str(&render_loaded(&skills));
        }
    }
}
