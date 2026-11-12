//! Code mode for channel-mention replies, behind a per-user PostHog flag.
//!
//! The bot's programs run through a [`MentionCodeMode`] (in production, the
//! agent harness's internal user-execution route, the only host with a Deno
//! runtime) as the mentioning user, attributed to Macro AI: the same identity
//! the bot's direct tools use.

use std::sync::Arc;

use agent_code_mode::domain::{
    CodeModeError, MentionCodeMode, MentionContext, UserCodeMode, UserExecutionReceipt,
};
use agent_code_mode::inbound::toolset::UserCodeModeToolContext;
use ai_tools::{AiToolSet, ToolServiceContext, ToolSetWithPrompt};
use ai_toolset::{
    AsyncToolCollection, RequestContext, RequestSchema, SearchableTool, ToolCallFuture, ToolCaller,
    ToolInfo, ToolSet,
};
use async_trait::async_trait;
use code_execution::domain::ExecuteRequest;
use feature_flags::FeatureFlags;
use macro_user_id::user_id::MacroUserIdStr;
use tokio_util::sync::CancellationToken;

use crate::domain::models::BotMention;

#[cfg(test)]
mod test;

/// Per-user PostHog flag that moves mention replies to code mode.
pub const CODE_MODE_FLAG: &str = "ai-channel-bot-code-mode";

/// Whether a user's mention replies run code mode. Object-safe (the
/// responder holds `Arc<dyn CodeModeGate>`), hence `async_trait`.
#[async_trait]
pub trait CodeModeGate: Send + Sync {
    /// `false` unless the rollout is positively on for `user`.
    async fn enabled(&self, user: &MacroUserIdStr<'static>) -> bool;
}

/// [`CODE_MODE_FLAG`] read for the mentioning user. Fails closed: an unset,
/// disabled or unreadable flag keeps the direct tools.
pub struct FlaggedCodeMode<Flags>(pub Flags);

#[async_trait]
impl<Flags: FeatureFlags> CodeModeGate for FlaggedCodeMode<Flags> {
    async fn enabled(&self, user: &MacroUserIdStr<'static>) -> bool {
        match self.0.load(user).await {
            Ok(snapshot) => snapshot.is_enabled(CODE_MODE_FLAG),
            Err(error) => {
                tracing::warn!(error = ?error, "channel bot code-mode flag unreadable; using direct tools");
                false
            }
        }
    }
}

/// Everything a code-mode reply needs beyond the direct tools.
pub struct ChannelBotCodeMode {
    /// The filtered direct tools and the code-mode prompt.
    pub tools: ToolSetWithPrompt,
    /// The harness route programs run on.
    pub executions: Arc<dyn MentionCodeMode>,
    /// Who gets code mode.
    pub gate: Arc<dyn CodeModeGate>,
}

/// The tools and system prompt one reply runs with.
pub(crate) struct ReplyTools {
    pub(crate) toolset: Arc<dyn ToolSet<ToolServiceContext> + Send + Sync>,
    pub(crate) system_prompt: Arc<str>,
    pub(crate) code_mode: bool,
}

/// Chooses each reply's tools: code mode where the gate allows it and the
/// host configured it, the direct tools otherwise.
pub(crate) struct ToolModes {
    direct: Arc<AiToolSet>,
    direct_prompt: Arc<str>,
    code: Option<CodeTools>,
}

struct CodeTools {
    direct: Arc<AiToolSet>,
    prompt: Arc<str>,
    user_tools: Arc<AsyncToolCollection<UserCodeModeToolContext>>,
    executions: Arc<dyn MentionCodeMode>,
    gate: Arc<dyn CodeModeGate>,
}

impl ToolModes {
    pub(crate) fn direct(tools: ToolSetWithPrompt) -> Self {
        Self {
            direct: tools.toolset,
            direct_prompt: system_prompt(&tools),
            code: None,
        }
    }

    pub(crate) fn with_code_mode(mut self, code: ChannelBotCodeMode) -> Self {
        self.code = Some(CodeTools {
            prompt: system_prompt(&code.tools),
            direct: code.tools.toolset,
            user_tools: Arc::new(agent_code_mode::inbound::toolset::user_toolset()),
            executions: code.executions,
            gate: code.gate,
        });
        self
    }

    pub(crate) async fn for_reply(
        &self,
        user: &MacroUserIdStr<'static>,
        mention: &BotMention,
        cognition: Option<Arc<dyn cognition::domain::Cognition>>,
    ) -> ReplyTools {
        let code = match &self.code {
            Some(code) if code.gate.enabled(user).await => code,
            _ => {
                return ReplyTools {
                    toolset: self.direct.clone(),
                    system_prompt: self.direct_prompt.clone(),
                    code_mode: false,
                };
            }
        };
        ReplyTools {
            toolset: Arc::new(CodeModeTools {
                direct: code.direct.clone(),
                code: code.user_tools.clone(),
                context: UserCodeModeToolContext {
                    service: Arc::new(MentionPrograms {
                        executions: code.executions.clone(),
                        mention: MentionContext {
                            message_id: mention.message_id,
                            root_id: mention.root_id,
                        },
                    }),
                    cognition,
                    caller: ToolCaller::Agent(bot_id::MACRO_AI_BOT_ID),
                    session: None,
                },
            }),
            system_prompt: code.prompt.clone(),
            code_mode: true,
        }
    }
}

/// The channel rules go last so they are the freshest instructions the model
/// reads; ahead of the tool prompt they were often ignored.
fn system_prompt(tools: &ToolSetWithPrompt) -> Arc<str> {
    format!("{}\n{}", tools.prompt, prompt::channel_mention::PROMPT).into()
}

/// One mention's programs, run for that mention's user. The caller and
/// session the tools pass are the ones [`ToolModes::for_reply`] bound
/// (Macro AI, none); the harness credentials them itself.
struct MentionPrograms {
    executions: Arc<dyn MentionCodeMode>,
    mention: MentionContext,
}

#[async_trait]
impl UserCodeMode for MentionPrograms {
    async fn execute(
        &self,
        user: &MacroUserIdStr<'static>,
        _caller: &ToolCaller,
        _session: Option<uuid::Uuid>,
        request: ExecuteRequest,
        cancel: CancellationToken,
    ) -> Result<UserExecutionReceipt, CodeModeError> {
        self.executions
            .execute(user, &self.mention, request, cancel)
            .await
    }
}

/// The direct tools plus the user-scoped code tools, which run with their own
/// per-reply context.
struct CodeModeTools {
    direct: Arc<AiToolSet>,
    code: Arc<AsyncToolCollection<UserCodeModeToolContext>>,
    context: UserCodeModeToolContext,
}

impl ToolSet<ToolServiceContext> for CodeModeTools {
    fn dispatch_tool_call<'a>(
        &'a self,
        context: ToolServiceContext,
        request_context: RequestContext,
        tool_name: &'a str,
        json: &'a serde_json::Value,
    ) -> ToolCallFuture<'a> {
        if self.code.tools.contains_key(tool_name) {
            self.code
                .dispatch_tool_call(self.context.clone(), request_context, tool_name, json)
        } else {
            self.direct
                .dispatch_tool_call(context, request_context, tool_name, json)
        }
    }

    fn request_schemas(&self) -> Option<Vec<RequestSchema>> {
        let mut schemas = self.direct.request_schemas().unwrap_or_default();
        schemas.extend(self.code.request_schemas().unwrap_or_default());
        (!schemas.is_empty()).then_some(schemas)
    }

    fn searchable_catalog(&self) -> Vec<SearchableTool> {
        self.direct.searchable_catalog()
    }

    fn searchable_toolset_names(&self) -> Vec<String> {
        self.direct.searchable_toolset_names()
    }

    fn routing_description<'a>(&'a self, tool_name: &'a str) -> Option<ToolInfo> {
        if self.code.tools.contains_key(tool_name) {
            self.code.routing_description(tool_name)
        } else {
            self.direct.routing_description(tool_name)
        }
    }
}
