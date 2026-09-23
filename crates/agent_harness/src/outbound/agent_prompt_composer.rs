//! Compose channel context for every harness.

use lexical_client::LexicalClient;
use lexical_client::parse_markdown::{AgentContextAnchor, AgentContextMessage};

use crate::domain::error::{HarnessError, Result};
use crate::domain::model::ConversationContext;
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
        parent: Option<&messages::domain::models::MessageParent>,
        context: Option<&ConversationContext>,
    ) -> Result<String> {
        let messages = context.map(|context| {
            context
                .messages
                .iter()
                .map(|message| AgentContextMessage {
                    sender: &message.sender,
                    content: &message.content,
                })
                .collect::<Vec<_>>()
        });
        let anchor = context
            .and_then(|context| context.anchor.as_ref())
            .map(|anchor| AgentContextAnchor {
                mark_id: &anchor.mark_id,
                marked_text: anchor.marked_text.as_deref(),
                current_marked_text: anchor.current.as_ref().map(|c| c.marked_text.as_str()),
                surrounding_text: anchor.current.as_ref().map(|c| c.surrounding_text.as_str()),
            });

        self.lexical
            .compose_agent_context(
                prompt_markdown,
                parent,
                anchor.as_ref(),
                messages.as_deref(),
            )
            .await
            .map_err(|error| HarnessError::PromptComposition(rootcause::report!(error).into()))
    }
}

#[cfg(test)]
mod test;
