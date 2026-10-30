//! Compose trigger context for every harness.

use chrono::{DateTime, Utc};
use lexical_client::LexicalClient;
use lexical_client::parse_markdown::{
    AgentContextCurrentTime, AgentContextPeople, AgentContextPerson,
};
use macro_user_id::user_id::MacroUserIdStr;
use trigger_context::TriggerContext;

use crate::domain::error::{HarnessError, Result};
use crate::domain::model::{CurrentTime, PromptPeople};
use crate::domain::ports::{AgentPromptComposer, UserTimeZones};

/// Lexical-service-backed agent prompt composer. Every prompt states the
/// current time in its reader's time zone.
pub struct LexicalAgentPromptComposer<TimeZones> {
    lexical: LexicalClient,
    time_zones: TimeZones,
    clock: fn() -> DateTime<Utc>,
}

impl<TimeZones> LexicalAgentPromptComposer<TimeZones> {
    /// Build a composer backed by `lexical` and `time_zones`.
    pub fn new(lexical: LexicalClient, time_zones: TimeZones) -> Self {
        Self {
            lexical,
            time_zones,
            clock: Utc::now,
        }
    }

    /// Read the current time from `clock` instead of the system clock.
    pub fn with_clock(self, clock: fn() -> DateTime<Utc>) -> Self {
        Self { clock, ..self }
    }
}

impl<TimeZones: UserTimeZones> AgentPromptComposer for LexicalAgentPromptComposer<TimeZones> {
    async fn compose(
        &self,
        prompt_markdown: &str,
        instructions: Option<&str>,
        people: Option<&PromptPeople>,
        trigger: Option<&TriggerContext>,
    ) -> Result<String> {
        // The reply is read by whoever sent the prompt, else by the owner.
        let reader = people.map(|people| people.sender.as_ref().unwrap_or(&people.owner));
        let time_zone = match reader {
            Some(reader) => self.time_zones.time_zone(reader).await,
            None => None,
        };
        let now = CurrentTime::new((self.clock)(), time_zone.as_deref());
        let current_time = AgentContextCurrentTime {
            iso: &now.iso,
            local: &now.local,
            time_zone: now.time_zone.as_deref(),
        };
        let people = people.map(|people| AgentContextPeople {
            owner: person(&people.owner),
            sender: people.sender.as_ref().map(person),
        });
        self.lexical
            .compose_agent_context(
                prompt_markdown,
                instructions,
                people.as_ref(),
                Some(&current_time),
                trigger,
            )
            .await
            .map_err(|error| HarnessError::PromptComposition(rootcause::report!(error).into()))
    }
}

/// A user as the context names them: by email, the way message authors are.
fn person<'a>(user: &'a MacroUserIdStr<'static>) -> AgentContextPerson<'a> {
    AgentContextPerson {
        id: user.as_ref(),
        name: user.email_str(),
    }
}

#[cfg(test)]
mod test;
