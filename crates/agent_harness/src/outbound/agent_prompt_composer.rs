//! Compose trigger context for every harness.

use lexical_client::LexicalClient;
use lexical_client::parse_markdown::{AgentContextPeople, AgentContextPerson};
use macro_user_id::user_id::MacroUserIdStr;
use trigger_context::TriggerContext;

use crate::domain::error::{HarnessError, Result};
use crate::domain::model::PromptPeople;
use crate::domain::ports::AgentPromptComposer;

/// Lexical-service-backed agent prompt composer.
pub struct LexicalAgentPromptComposer {
    lexical: LexicalClient,
}

impl LexicalAgentPromptComposer {
    /// Build a composer backed by `lexical`.
    pub const fn new(lexical: LexicalClient) -> Self {
        Self { lexical }
    }
}

impl AgentPromptComposer for LexicalAgentPromptComposer {
    async fn compose(
        &self,
        prompt_markdown: &str,
        instructions: Option<&str>,
        people: Option<&PromptPeople>,
        trigger: Option<&TriggerContext>,
    ) -> Result<String> {
        let people = people.map(|people| AgentContextPeople {
            owner: person(&people.owner),
            sender: people.sender.as_ref().map(person),
        });
        self.lexical
            .compose_agent_context(prompt_markdown, instructions, people.as_ref(), trigger)
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
