//! Compose channel-originated agent prompts through the lexical service.

use lexical_client::LexicalClient;
use lexical_client::parse_markdown::AgentContextMessage;

use crate::domain::error::{HarnessError, Result};
use crate::domain::model::PriorChannelMessage;
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
        messages: Option<&[PriorChannelMessage]>,
    ) -> Result<String> {
        let messages = messages.map(|messages| {
            messages
                .iter()
                .map(|message| AgentContextMessage {
                    sender: &message.sender,
                    content: &message.content,
                })
                .collect::<Vec<_>>()
        });

        self.lexical
            .compose_agent_context(prompt_markdown, messages.as_deref())
            .await
            .map_err(|error| HarnessError::PromptComposition(rootcause::report!(error).into()))
    }
}
