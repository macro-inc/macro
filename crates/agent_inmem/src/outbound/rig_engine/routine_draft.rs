//! A routine draft's turn. The session answers its drafter, not a person, so
//! its only tools are code mode's three, and every program it runs is a dry
//! run (the host's credential decides that from the same stored origin). It
//! hands its draft back by checking it with `macro.routines.check`, which
//! saves nothing. No native tools that write, no connected apps, no memory,
//! no skills, no opening line. Usage is automation usage.

use std::sync::Arc;

use agent::{AgentError, AgentLoop, StreamPart, SystemPrompt, ToolResultLimit};
use ai_tools::ToolServiceContext;
use ai_toolset::{RequestContext, RequestSchema, ToolCallFuture, ToolSetError};
use futures::StreamExt as _;
use mcp_toolset::RemoteMcpToolSet;
use model_owner::Owner;
use tokio::sync::mpsc;

use super::{AiToolSet, CODE_MODE_MCP_TOOLS, InMemToolContext};
use crate::domain::engine::{SessionRole, TurnPurpose, TurnRequest};
use crate::inbound::ask_user::AskUserContext;

#[cfg(test)]
#[path = "routine_draft/test.rs"]
mod test;

/// Ahead of the drafter's own words in the system prompt.
const PREAMBLE: &str = "You work for a program, not a person: nobody reads your messages. \
Your only tools are ExecuteCode, DescribeCodeTools and ReadCodeDocs, and every program you run \
is a dry run: reads return real data, and writes are skipped and return {}. When you are done, \
stop with one short line.";

/// Run one turn of a routine draft's session.
pub(super) async fn drive_draft_turn(
    base_context: ToolServiceContext,
    request: TurnRequest,
    parts: &mpsc::Sender<Result<StreamPart, AgentError>>,
) -> Result<(), AgentError> {
    let TurnRequest {
        purpose,
        owner,
        model,
        reasoning_effort,
        speed,
        identity,
        instructions,
        messages,
        mcp_tools,
        cancel,
        agent_key,
        ..
    } = request;
    let Owner::User(owner) = owner else {
        return Err(AgentError::Other(anyhow::anyhow!(
            "a routine draft runs as the person who asked for it"
        )));
    };
    let usage = ai_usage::UsageContext::new(SessionRole::RoutineDraft.feature(), owner.clone());
    // A summary condenses the conversation with no tools.
    let (system_prompt, tools) = if purpose == TurnPurpose::Summary {
        (
            SystemPrompt::from(instructions.unwrap_or_default()),
            DraftTools { code: None },
        )
    } else {
        let requested = messages
            .iter()
            .rev()
            .find(|message| message.role == agent::types::Role::User)
            .and_then(|message| message.content.user_message_text())
            .unwrap_or_default();
        let docs = agent_code_mode::domain::select_documentation(
            &owner,
            &requested,
            base_context.cognition_tool_context.service.as_ref(),
            agent_code_mode::domain::Guidance::Inline,
            &cancel,
        )
        .await;
        (
            SystemPrompt::split(PREAMBLE, instructions.unwrap_or_default()).with_turn(docs),
            DraftTools { code: mcp_tools },
        )
    };

    let mut tool_context = base_context.clone();
    tool_context.usage_context = usage.clone();
    if let Some(identity) = &identity {
        tool_context = tool_context
            .with_actor(identity.bot)
            .with_actor_name(&identity.name);
    }
    let tool_results = ToolResultLimit::default();
    let tool_context = InMemToolContext {
        base: tool_context,
        ask_user: AskUserContext { requester: None },
        tool_results: tool_results.clone(),
    };
    let mut agent_loop = AgentLoop::new(base_context.recorder.clone())
        .with_model(&model)
        .with_reasoning_effort(reasoning_effort)
        .with_speed(speed)?
        .with_genai_telemetry(false)
        .with_streamed_tool_calls()
        .with_tool_result_limit(tool_results.clone());
    let loop_usage = match agent_key {
        Some(key) => {
            agent_loop = agent_loop.with_provider_api_key(key.key.expose())?;
            usage.with_agent_api_key(key.bot_id)
        }
        None => usage,
    };
    let toolset: Arc<dyn AiToolSet<InMemToolContext> + Send + Sync> = Arc::new(tools);
    let session = agent_loop
        .session(toolset, Arc::new(tool_context), system_prompt, loop_usage)
        .await;
    let (mut session, loop_cancel) = session.cancellable();
    let forward = tokio_util::task::AbortOnDropHandle::new(tokio::spawn({
        let loop_cancel = loop_cancel.clone();
        let cancel = cancel.clone();
        async move {
            cancel.cancelled().await;
            loop_cancel.cancel();
        }
    }));
    let rig_messages = agent::to_rig_messages_limited(&messages, &tool_results);
    let result = async {
        let mut stream = session.send_message(rig_messages).await?;
        while let Some(part) = stream.next().await {
            if parts.send(part).await.is_err() {
                loop_cancel.cancel();
                break;
            }
        }
        Ok(())
    }
    .await;
    forward.abort();
    result
}

/// Code mode's tools, kept by name from the session's MCP servers. Any
/// other name is not a tool here.
struct DraftTools {
    code: Option<RemoteMcpToolSet>,
}

impl<Context: Send + Sync + 'static> AiToolSet<Context> for DraftTools {
    fn dispatch_tool_call<'a>(
        &'a self,
        context: Context,
        request_context: RequestContext,
        tool_name: &'a str,
        json: &'a serde_json::Value,
    ) -> ToolCallFuture<'a> {
        Box::pin(async move {
            match &self.code {
                Some(code) if CODE_MODE_MCP_TOOLS.contains(&tool_name) => {
                    code.dispatch_tool_call(context, request_context, tool_name, json)
                        .await
                }
                _ => Err(ToolSetError::NotFound(tool_name.to_owned())),
            }
        })
    }

    fn request_schemas(&self) -> Option<Vec<RequestSchema>> {
        let schemas: Vec<RequestSchema> = self
            .code
            .as_ref()
            .and_then(|code| AiToolSet::<Context>::request_schemas(code))
            .unwrap_or_default()
            .into_iter()
            .filter(|schema| CODE_MODE_MCP_TOOLS.contains(&schema.name.as_str()))
            .collect();
        (!schemas.is_empty()).then_some(schemas)
    }
}
