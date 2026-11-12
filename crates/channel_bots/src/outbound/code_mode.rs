//! Code mode for channel-mention replies, the bot's only tool path.
//!
//! The bot's programs run through a [`MentionCodeMode`] (in production, the
//! agent harness's internal user-execution route, the only host with a Deno
//! runtime) as the mentioning user, attributed to Macro AI: the same identity
//! the bot's direct tools used.

use std::sync::Arc;

use agent_code_mode::domain::{
    CodeModeError, MentionCodeMode, MentionContext, UserCodeMode, UserExecutionReceipt,
};
use agent_code_mode::inbound::toolset::UserCodeModeToolContext;
use ai_tools::{AiToolSet, ToolServiceContext};
use ai_toolset::{
    AsyncToolCollection, RequestContext, RequestSchema, SearchableTool, ToolCallFuture, ToolCaller,
    ToolInfo, ToolSet,
};
use async_trait::async_trait;
use code_execution::domain::ExecuteRequest;
use macro_user_id::user_id::MacroUserIdStr;
use tokio_util::sync::CancellationToken;

use crate::domain::models::BotMention;

#[cfg(test)]
mod test;

/// The channel bot's tools: the direct tools code mode keeps (see
/// [`ai_tools::tools_for_channel_bot_code_mode`]), the user-scoped
/// `ExecuteCode`/`DescribeCodeTools`/`ReadCodeDocs`, and the code-mode prompt.
pub struct ChannelBotTools {
    direct: Arc<AiToolSet>,
    system_prompt: String,
    code: Arc<AsyncToolCollection<UserCodeModeToolContext>>,
    executions: Arc<dyn MentionCodeMode>,
}

impl ChannelBotTools {
    /// Programs run through `executions`.
    pub fn new(executions: Arc<dyn MentionCodeMode>) -> Self {
        let tools = ai_tools::tools_for_channel_bot_code_mode();
        Self {
            // The channel rules go last so they are the freshest instructions
            // the model reads; ahead of the tool prompt they were often ignored.
            system_prompt: format!("{}\n{}", tools.prompt, prompt::channel_mention::PROMPT),
            direct: tools.toolset,
            code: Arc::new(agent_code_mode::inbound::toolset::user_toolset()),
            executions,
        }
    }

    pub(crate) fn system_prompt(&self) -> &str {
        &self.system_prompt
    }

    /// The tools for one reply, whose programs answer `mention`.
    pub(crate) fn for_mention(
        &self,
        mention: &BotMention,
        cognition: Option<Arc<dyn cognition::domain::Cognition>>,
    ) -> Arc<dyn ToolSet<ToolServiceContext> + Send + Sync> {
        Arc::new(CodeModeTools {
            direct: self.direct.clone(),
            code: self.code.clone(),
            context: UserCodeModeToolContext {
                service: Arc::new(MentionPrograms {
                    executions: self.executions.clone(),
                    mention: MentionContext {
                        message_id: mention.message_id,
                        root_id: mention.root_id,
                    },
                }),
                cognition,
                caller: ToolCaller::Agent(bot_id::MACRO_AI_BOT_ID),
                session: None,
            },
        })
    }
}

/// One mention's programs, run for that mention's user. The caller and
/// session the tools pass are the ones [`ChannelBotTools::for_mention`] bound
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

/// Where a code-mode reply's tool call goes.
#[derive(Debug, PartialEq, Eq)]
enum Route {
    Code,
    Direct,
    Refused,
}

impl CodeModeTools {
    fn route(&self, tool_name: &str) -> Route {
        if self.code.tools.contains_key(tool_name) {
            Route::Code
        } else if self.direct.tools.contains_key(tool_name) {
            Route::Direct
        } else {
            Route::Refused
        }
    }
}

fn hidden_tool_refusal(tool_name: &str) -> ToolCallError {
    ToolCallError {
        internal_error: anyhow::anyhow!("{tool_name} is not offered in code mode"),
        description: format!(
            "{tool_name} is not available here. Do this with ExecuteCode and the Macro SDK \
             (find the method with DescribeCodeTools)."
        ),
    }
}

impl ToolSet<ToolServiceContext> for CodeModeTools {
    fn dispatch_tool_call<'a>(
        &'a self,
        context: ToolServiceContext,
        request_context: RequestContext,
        tool_name: &'a str,
        json: &'a serde_json::Value,
    ) -> ToolCallFuture<'a> {
        match self.route(tool_name) {
            Route::Code => {
                self.code
                    .dispatch_tool_call(self.context.clone(), request_context, tool_name, json)
            }
            Route::Direct => {
                self.direct
                    .dispatch_tool_call(context, request_context, tool_name, json)
            }
            // Hidden means not callable: a name the reply was not offered is
            // refused here, never dispatched.
            Route::Refused => {
                let refusal = hidden_tool_refusal(tool_name);
                Box::pin(async move { Ok(Err(refusal)) })
            }
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
