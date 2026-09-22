//! Composition of Macro's native tools for a realtime runtime.
//!
//! The speech model calls these tools directly. There is no agent loop or
//! second model between its function call and the product tool implementation.
//! User tools retain the same review flow as the ordinary Macro runtime.

use std::sync::{Arc, Mutex};

use agent::{FinishedUserTool, PendingUserTool};
use ai_tools::user_tool_review::{UserToolReviewer, user_tool_finisher_with_review_cancel};
use ai_tools::{AiHost, ToolServiceContext, tools_for};
use ai_toolset::{RequestContext, SearchableTool, ToolLoader, ToolSet};
use macro_user_id::user_id::MacroUserIdStr;
use mcp_toolset::RemoteMcpToolSet;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::PgPool;
use tokio_util::sync::CancellationToken;

use crate::domain::engine::AgentIdentity;
use crate::domain::user_input::SharedUserInputRequester;
use crate::inbound::ask_user::AskUserContext;
use crate::rig_engine::{InMemToolContext, fetch_user_memory, system_prompt, tools_for_turn};

/// Product context used to prepare one realtime runtime's tool capability.
#[derive(Clone)]
pub struct VoiceToolFactory {
    db: PgPool,
    context: ToolServiceContext,
}

/// Facts supplied by the owning session runtime, never by the browser or model.
pub struct VoiceToolSessionOptions {
    /// Canonical conversation to which usage belongs.
    pub session_id: macro_uuid::Uuid,
    /// Person whose session and integrations the tools use.
    pub owner: MacroUserIdStr<'static>,
    /// Selected agent's identity.
    pub identity: Option<AgentIdentity>,
    /// Selected agent's instructions.
    pub instructions: Option<String>,
    /// Connected integrations authorized for this session.
    pub mcp_tools: Option<RemoteMcpToolSet>,
    /// Canonical session question capability.
    pub user_input: Option<SharedUserInputRequester>,
    /// Canonical session review capability for consequential user tools.
    pub reviewer: Arc<dyn UserToolReviewer>,
}

/// Provider-neutral function definition for the realtime runtime.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceToolDefinition {
    /// Callable tool name.
    pub name: String,
    /// Instructions describing the tool's behavior.
    pub description: String,
    /// JSON Schema for the function arguments.
    pub parameters: Value,
}

/// A completed call and any functions made available by tool search.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceToolResult {
    /// Tool's structured response, or a structured failure.
    pub output: Value,
    /// Whether the tool failed.
    pub is_error: bool,
    /// Additional definitions to register before the model continues.
    pub loaded_tools: Vec<VoiceToolDefinition>,
}

/// One runtime's prepared product tools and prompt.
pub struct VoiceTools {
    /// Macro identity, standing instructions, persona, and user memory.
    pub instructions: String,
    /// Initially advertised native tools.
    pub definitions: Vec<VoiceToolDefinition>,
    native: Arc<ai_toolset::AsyncToolCollection<InMemToolContext>>,
    tools: Arc<dyn ToolSet<InMemToolContext>>,
    context: InMemToolContext,
    owner: MacroUserIdStr<'static>,
    reviewer: Arc<dyn UserToolReviewer>,
    session_id: macro_uuid::Uuid,
}

impl VoiceToolFactory {
    /// Build at the application composition root, beside the ordinary engine.
    pub fn new(db: PgPool, context: ToolServiceContext) -> Self {
        Self { db, context }
    }

    /// Prepare the same toolset and system context the text runtime uses.
    pub async fn prepare(&self, options: VoiceToolSessionOptions) -> VoiceTools {
        let base = tools_for(AiHost::AgentSession);
        let memory = fetch_user_memory(&self.db, &self.context, &options.owner).await;
        let instructions = system_prompt(
            &base.prompt,
            options.identity.as_ref(),
            options.instructions.as_deref(),
            memory.as_deref(),
        );
        let native = Arc::new(tools_for_turn(
            Arc::into_inner(base.toolset).expect("tools_for returns a fresh collection"),
            options.user_input.is_some(),
        ));
        let tools: Arc<dyn ToolSet<InMemToolContext>> = match options.mcp_tools {
            Some(remote) => Arc::new(mcp_select::CombinedToolSet::new(native.clone(), remote)),
            None => native.clone(),
        };
        let definitions = tools
            .request_schemas()
            .unwrap_or_default()
            .into_iter()
            .map(|schema| definition(schema.name, schema.schema.to_value(), None))
            .collect();
        let mut base = self.context.clone();
        base.usage_context =
            ai_usage::UsageContext::new(ai_usage::AiFeature::AgentSession, options.owner.clone());
        VoiceTools {
            instructions,
            definitions,
            native,
            tools,
            context: InMemToolContext {
                base,
                ask_user: AskUserContext {
                    requester: options.user_input,
                },
            },
            owner: options.owner,
            reviewer: options.reviewer,
            session_id: options.session_id,
        }
    }
}

impl VoiceTools {
    /// Execute one already-admitted call as the session owner.
    ///
    /// The runtime must deduplicate provider call ids and retain the future
    /// through audio interruptions. Only explicit work cancellation cancels
    /// `cancel`; stopping speech does not imply undoing a product action.
    pub async fn call(
        &self,
        call_id: &str,
        name: &str,
        arguments: &Value,
        cancel: CancellationToken,
        review_cancel: CancellationToken,
    ) -> VoiceToolResult {
        let loaded = Arc::new(Mutex::new(Vec::<SearchableTool>::new()));
        let sink = loaded.clone();
        let mut request = RequestContext::new(self.owner.clone())
            .with_genai_telemetry(false)
            .with_tool_search(
                Arc::new(self.tools.searchable_catalog()),
                ToolLoader::new(move |tools| {
                    sink.lock().expect("loaded tools poisoned").extend(tools)
                }),
            );
        request.cancel = cancel.clone();
        let response = if cancel.is_cancelled() {
            Err("The call was cancelled before execution.".to_owned())
        } else {
            match self
                .tools
                .try_tool_call(self.context.clone(), request, name, arguments)
                .await
            {
                Ok(Ok(value)) => Ok(value),
                Ok(Err(error)) => Err(error.description),
                Err(error) => Err(error.to_string()),
            }
        };
        let response = match response {
            Ok(value) if value == Value::String("PendingUserExecution".to_owned()) => {
                let finish = user_tool_finisher_with_review_cancel(
                    self.native.clone(),
                    self.context.clone(),
                    self.owner.clone(),
                    self.reviewer.clone(),
                    cancel,
                    review_cancel,
                );
                match finish(PendingUserTool {
                    tool_name: name.to_owned(),
                    tool_call_id: call_id.to_owned(),
                    args: arguments.clone(),
                })
                .await
                {
                    Some(FinishedUserTool::Result(value)) => Ok(value),
                    Some(FinishedUserTool::Error(error)) => Err(error),
                    None => Err("This call requires review and was not executed.".to_owned()),
                }
            }
            response => response,
        };
        let loaded_tools = loaded
            .lock()
            .expect("loaded tools poisoned")
            .drain(..)
            .map(|tool| definition(tool.name, tool.schema.to_value(), Some(tool.description)))
            .collect();
        match response {
            Ok(output) => VoiceToolResult {
                output,
                is_error: false,
                loaded_tools,
            },
            Err(error) => VoiceToolResult {
                output: serde_json::json!({"error": error}),
                is_error: true,
                loaded_tools,
            },
        }
    }

    /// Attribute provider token usage to the same user and conversation as tools.
    /// Pricing stays with the owning usage service; this records observed counts.
    pub fn record_usage(&self, model: String, input_tokens: u64, output_tokens: u64) {
        self.context.base.recorder.record(ai_usage::UsageEvent {
            feature: ai_usage::AiFeature::AgentSession,
            user: self.owner.clone(),
            entity: Some(self.session_id),
            model,
            input_tokens,
            output_tokens,
        });
    }
}

fn definition(name: String, parameters: Value, description: Option<String>) -> VoiceToolDefinition {
    VoiceToolDefinition {
        name,
        description: description.unwrap_or_else(|| {
            parameters
                .get("description")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned()
        }),
        parameters,
    }
}
