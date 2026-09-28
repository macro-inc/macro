//! Compose channel context for every harness.

use lexical_client::LexicalClient;
use lexical_client::parse_markdown::{
    AgentContext, AgentContextAnchor, AgentContextMessage, AgentContextReplyTarget,
    AgentContextThread,
};

use crate::domain::error::{HarnessError, Result};
use crate::domain::model::{
    CommentAnchor, ContextMessage, ContextThread, ConversationContext, ReplyTarget,
};
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
        let context = context.map(|context| AgentContext {
            anchor: context.anchor.as_ref().map(anchor),
            reply_target: context.reply_target.as_ref().map(reply_target),
            prompt_message_id: context.prompt_message_id.map(|id| id.to_string()),
            thread: context.thread.as_ref().map(thread),
            channel: context.channel.iter().map(thread).collect(),
        });

        self.lexical
            .compose_agent_context(prompt_markdown, parent, context.as_ref())
            .await
            .map_err(|error| HarnessError::PromptComposition(rootcause::report!(error).into()))
    }
}

fn anchor(anchor: &CommentAnchor) -> AgentContextAnchor<'_> {
    match anchor {
        CommentAnchor::Mark {
            mark_id,
            marked_text,
            current,
        } => AgentContextAnchor::Markdown {
            mark_id,
            marked_text: marked_text.as_deref(),
            current_marked_text: current.as_ref().map(|c| c.marked_text.as_str()),
            surrounding_text: current.as_ref().map(|c| c.surrounding_text.as_str()),
        },
        CommentAnchor::PdfHighlight {
            anchor_id,
            marked_text,
        } => AgentContextAnchor::PdfHighlight {
            anchor_id,
            marked_text: marked_text.as_deref(),
        },
        CommentAnchor::PdfPin { anchor_id } => AgentContextAnchor::PdfPin { anchor_id },
    }
}

fn reply_target(target: &ReplyTarget) -> AgentContextReplyTarget<'_> {
    match target {
        ReplyTarget::Quote {
            message_id,
            thread_id,
            preview,
            message: quoted,
        } => AgentContextReplyTarget::Quote {
            message_id: message_id.to_string(),
            thread_id: thread_id.to_string(),
            preview,
            message: quoted.as_ref().map(message),
        },
        ReplyTarget::Thread { root_id } => AgentContextReplyTarget::Thread {
            thread_id: root_id.to_string(),
        },
        ReplyTarget::None => AgentContextReplyTarget::None,
    }
}

fn thread(thread: &ContextThread) -> AgentContextThread<'_> {
    AgentContextThread {
        root_id: thread.root_id.to_string(),
        messages: thread.messages.iter().map(message).collect(),
        messages_omitted: thread.messages_omitted,
    }
}

fn message(message: &ContextMessage) -> AgentContextMessage<'_> {
    AgentContextMessage {
        id: message.id.to_string(),
        sender_id: &message.sender_id,
        author: &message.author,
        content: &message.content,
        posted_at: message
            .posted_at
            .to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
    }
}

#[cfg(test)]
mod test;
