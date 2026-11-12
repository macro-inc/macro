//! Which toolset the in-app chat runs for a user: its direct tools, or code
//! mode for users the `ai-chat-code-mode` rollout is on for.
use crate::{AiToolSet, ToolSetWithPrompt, tools_for, tools_for_chat_code_mode, AiHost};
use macro_user_id::user_id::MacroUserIdStr;
use pipedream_mcp::domain::ports::ConnectRollout;
use std::sync::Arc;

#[cfg(test)]
mod test;

/// One turn's tools and the tool-use prompt that describes them.
#[derive(Clone)]
pub struct ChatTools {
    /// Every static tool the turn may call.
    pub toolset: Arc<AiToolSet>,
    /// The prompt describing [`Self::toolset`].
    pub prompt: Arc<str>,
}

impl From<ToolSetWithPrompt> for ChatTools {
    fn from(tools: ToolSetWithPrompt) -> Self {
        Self {
            toolset: tools.toolset,
            prompt: tools.prompt.to_string().into(),
        }
    }
}

/// The chat's direct tools, and its code-mode tools behind their rollout.
#[derive(Clone)]
pub struct ChatToolsets {
    direct: ChatTools,
    code_mode: Option<(ChatTools, ConnectRollout)>,
}

impl ChatToolsets {
    /// Direct tools for everyone, unless this process can run code
    /// (`code_runner`) and reads the rollout; then code mode for the users it
    /// is on for. Without either, or when a user's flag can't be read, chat
    /// stays direct.
    pub fn new(rollout: Option<ConnectRollout>, code_runner: bool) -> Self {
        Self {
            direct: tools_for(AiHost::Chat).into(),
            code_mode: rollout
                .filter(|_| code_runner)
                .map(|rollout| (tools_for_chat_code_mode().into(), rollout)),
        }
    }

    /// The direct tools, for callers that never move to code mode.
    pub fn direct(&self) -> &ChatTools {
        &self.direct
    }

    /// The tools `user`'s turns run with.
    #[tracing::instrument(skip_all, fields(code_mode = tracing::field::Empty))]
    pub async fn for_user(&self, user: &MacroUserIdStr<'static>) -> ChatTools {
        let code_mode = match &self.code_mode {
            Some((tools, rollout)) if rollout(user.clone()).await => Some(tools),
            Some(_) | None => None,
        };
        tracing::Span::current().record("code_mode", code_mode.is_some());
        code_mode.unwrap_or(&self.direct).clone()
    }
}
