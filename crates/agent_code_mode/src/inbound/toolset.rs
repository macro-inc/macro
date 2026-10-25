//! SDK discovery and one awaited code execution exposed as ordinary tools.
use crate::domain::{
    CodeModeError, ExecutionId, ExecutionReceipt, SessionCodeMode, TaskDocumentation, UserCodeMode,
    UserExecutionReceipt, documentation_for_task,
};
use agent_session::domain::model::AgentSession;
use ai_toolset::{
    AsyncTool, AsyncToolCollection, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations,
    ToolCallError, ToolResult,
};
use async_trait::async_trait;
use code_execution::domain::ExecuteRequest;
use cognition::domain::Cognition;
use macro_user_id::user_id::MacroUserIdStr;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio_util::sync::CancellationToken;

#[cfg(test)]
mod test;

/// Session facts supplied by the authenticated MCP adapter.
#[derive(Clone)]
pub struct CodeModeToolContext {
    /// Code-mode use cases.
    pub service: Arc<dyn SessionCodeMode>,
    /// The session authenticated by the request's bearer credential.
    pub session: AgentSession,
    /// Jev, for selecting documentation by task; absent falls back to the catalog.
    pub cognition: Option<Arc<dyn Cognition>>,
}

/// Tools advertised only when a runner is configured.
pub fn toolset() -> AsyncToolCollection<CodeModeToolContext> {
    AsyncToolCollection::new()
        .add_tool::<ExecuteCode, CodeModeToolContext>()
        .add_tool::<DescribeCodeTools, CodeModeToolContext>()
}

/// Facts supplied by an adapter that authenticated a user, not a session.
#[derive(Clone)]
pub struct UserCodeModeToolContext {
    /// User-scoped execution.
    pub service: Arc<dyn UserCodeMode>,
    /// Jev, for selecting documentation by task; absent falls back to the catalog.
    pub cognition: Option<Arc<dyn Cognition>>,
}

/// Code mode for clients outside agent sessions, such as the public MCP.
pub fn user_toolset() -> AsyncToolCollection<UserCodeModeToolContext> {
    AsyncToolCollection::new()
        .add_tool::<UserExecuteCode, UserCodeModeToolContext>()
        .add_tool::<DescribeCodeTools, UserCodeModeToolContext>()
}

/// Who discovery is written for.
#[derive(Clone, Copy, PartialEq, Eq)]
enum CodeHost {
    /// Agent sessions, with review stacks and per-turn documentation.
    Session,
    /// A signed-in user outside any session.
    User,
}

/// Execute a JavaScript module with the real Macro SDK.
#[derive(Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
#[schemars(
    title = "ExecuteCode",
    description = concat!(
        include_str!("toolset/session/execute_code.md"),
        "\n",
        include_str!("toolset/shared/program.md"),
        "\n",
        include_str!("toolset/shared/runtime.md")
    )
)]
pub struct ExecuteCode {
    /// Fresh UUID for this execution, recorded in the tool input so results can
    /// be recovered even if the session stops before the tool replies.
    #[schemars(
        description = "A fresh unique UUID for this execution, used to recover saved results if interrupted. Never use a placeholder, repeated-digit example, or an ID from another session. Reusing your existing ID with identical source returns its saved receipt without running again; different source is rejected. If an ID is unavailable, choose a fresh UUID."
    )]
    pub execution_id: ExecutionId,
    /// Choose whose account authenticates every SDK operation in this execution.
    pub acting_as: ai_toolset::actor::ToolActor,
    /// Copy the current server-issued turn_id from the prompt's execution context.
    /// Never reuse an ID from another turn or discover a replacement for a stale call.
    pub turn_id: macro_uuid::Uuid,
    /// A JavaScript ES module, with imports and an exported async main function.
    #[schemars(
        description = "JavaScript module, at most 64 KiB. Import { Macro } from '@macro-inc/sdk' and Handlebars from 'handlebars'. Export async function main({token, hosts}) { const macro = new Macro({token, hosts}); return {data: ...}; }. The optional reviews array defaults to empty. Dependencies are preinstalled; no TypeScript syntax or package downloads. The token and hosts are supplied by the runner; never return or log the token."
    )]
    pub source: String,
    /// Deadline including queueing and API calls.
    #[serde(default = "default_timeout")]
    #[schemars(
        description = "Total deadline in milliseconds, from 1 to 30000; defaults to 30000."
    )]
    pub timeout_ms: u64,
}

fn default_timeout() -> u64 {
    30_000
}

impl ToolAnnotated for ExecuteCode {
    const ANNOTATIONS: ToolAnnotations =
        ToolAnnotations::destructive("Execute code").with_open_world();
}

#[async_trait]
impl AsyncTool<CodeModeToolContext> for ExecuteCode {
    type Output = ExecutionReceipt;

    async fn call(
        &self,
        context: ServiceContext<CodeModeToolContext>,
        request: RequestContext,
    ) -> ToolResult<Self::Output> {
        context
            .service
            .execute(
                &context.session,
                self.execution_id,
                self.acting_as,
                self.turn_id,
                ExecuteRequest {
                    source: self.source.clone(),
                    timeout_ms: self.timeout_ms,
                },
                request.cancel,
            )
            .await
            .map_err(tool_error)
    }
}

/// Execute a JavaScript module with the real Macro SDK as the signed-in user.
#[derive(Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
#[schemars(
    title = "ExecuteCode",
    description = concat!(
        include_str!("toolset/user/execute_code.md"),
        "\n",
        include_str!("toolset/shared/program.md"),
        "\n",
        include_str!("toolset/shared/runtime.md")
    )
)]
pub struct UserExecuteCode {
    /// A JavaScript ES module, with imports and an exported async main function.
    #[schemars(
        description = "JavaScript module, at most 64 KiB. Export async function main({macro}) { return {data: ...}; }. Optional imports: {Macro} from '@macro-inc/sdk' and Handlebars from 'handlebars'. Dependencies are preinstalled; no TypeScript syntax or package downloads. Never return or log the token main receives."
    )]
    pub source: String,
    /// Deadline including queueing and API calls.
    #[serde(default = "default_timeout")]
    #[schemars(
        description = "Total deadline in milliseconds, from 1 to 30000; defaults to 30000."
    )]
    pub timeout_ms: u64,
}

impl ToolAnnotated for UserExecuteCode {
    const ANNOTATIONS: ToolAnnotations =
        ToolAnnotations::destructive("Execute code").with_open_world();
}

#[async_trait]
impl AsyncTool<UserCodeModeToolContext> for UserExecuteCode {
    type Output = UserExecutionReceipt;

    async fn call(
        &self,
        context: ServiceContext<UserCodeModeToolContext>,
        request: RequestContext,
    ) -> ToolResult<Self::Output> {
        context
            .service
            .execute(
                &request.user_id,
                ExecuteRequest {
                    source: self.source.clone(),
                    timeout_ms: self.timeout_ms,
                },
                request.cancel,
            )
            .await
            .map_err(tool_error)
    }
}

/// Discover the public SDK entity catalog and method declarations.
#[derive(Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
#[schemars(
    title = "DescribeCodeTools",
    description = "Look up Macro SDK documentation for ExecuteCode. Before writing a program, pass task, a short description of what the program must do, to receive every relevant SDK entity reference in one call; skip it only when the references you need are already in context. Request up to five entity names together for full declarations, e.g. entities omitted for size. Request topics for workflow guides. With no arguments, returns the compact entity catalog."
)]
pub struct DescribeCodeTools {
    /// What the next program must do; selects relevant references.
    #[serde(default)]
    #[schemars(
        description = "What the program you are about to write must do, in the user's terms, e.g. 'find unread emails from Acme this week and summarize them'. Returns every relevant SDK entity reference."
    )]
    pub task: Option<String>,
    /// Exact method names; empty means list the catalog.
    #[serde(default)]
    #[schemars(
        description = "Up to five SDK entity names such as documents, email, ai, or core. Empty names, topics and task list the compact entity catalog."
    )]
    pub names: Vec<String>,
    /// Workflow guides to read directly, without starting a code execution.
    #[serde(default)]
    pub topics: Vec<CodeGuideTopic>,
}

/// Available SDK workflow guides.
#[derive(Clone, Copy, Debug, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum CodeGuideTopic {
    /// Scoped searches and evidence collection.
    Search,
    /// AI generation and Jev classification.
    Ai,
    /// Local Handlebars rendering.
    Templates,
    /// Worked examples, including email triage and structured extraction.
    Examples,
}

impl CodeGuideTopic {
    fn markdown(self) -> &'static str {
        match self {
            Self::Search => include_str!("toolset/guides/search.md"),
            Self::Ai => include_str!("toolset/guides/ai.md"),
            Self::Templates => include_str!("toolset/guides/templates.md"),
            Self::Examples => include_str!("../../SKILL.md"),
        }
    }
}

/// One requested Markdown guide.
#[derive(Serialize, JsonSchema)]
pub struct CodeGuide {
    /// The requested topic.
    pub topic: CodeGuideTopic,
    /// Usage guidance and examples.
    pub markdown: String,
}

/// Runtime and discovery instructions beside selected entity declarations.
#[derive(Serialize, JsonSchema)]
pub struct CodeToolsDescription {
    /// References selected for the requested task.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub task_documentation: Option<TaskDocumentation>,
    /// SDK overview and how to request detailed guides.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sdk_guide: Option<String>,
    /// Requested workflow guides; empty unless topics were supplied.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub guides: Vec<CodeGuide>,
    /// How to execute methods and interpret discovery results.
    pub instructions: String,
    /// SDK entities; full declarations are omitted in the compact catalog.
    pub tools: Vec<CodeToolDescription>,
}

pub use crate::domain::{SdkDocumentation as CodeToolDescription, sdk_documentation};

impl ToolAnnotated for DescribeCodeTools {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::read_only("Discover code tools");
}

#[async_trait]
impl AsyncTool<CodeModeToolContext> for DescribeCodeTools {
    type Output = CodeToolsDescription;

    async fn call(
        &self,
        context: ServiceContext<CodeModeToolContext>,
        request: RequestContext,
    ) -> ToolResult<Self::Output> {
        self.describe(
            CodeHost::Session,
            &request.user_id,
            context.cognition.as_ref(),
            &request.cancel,
        )
        .await
        .map_err(tool_error)
    }
}

#[async_trait]
impl AsyncTool<UserCodeModeToolContext> for DescribeCodeTools {
    type Output = CodeToolsDescription;

    async fn call(
        &self,
        context: ServiceContext<UserCodeModeToolContext>,
        request: RequestContext,
    ) -> ToolResult<Self::Output> {
        self.describe(
            CodeHost::User,
            &request.user_id,
            context.cognition.as_ref(),
            &request.cancel,
        )
        .await
        .map_err(tool_error)
    }
}

impl DescribeCodeTools {
    async fn describe(
        &self,
        host: CodeHost,
        user: &MacroUserIdStr<'static>,
        cognition: Option<&Arc<dyn Cognition>>,
        cancel: &CancellationToken,
    ) -> Result<CodeToolsDescription, CodeModeError> {
        if self.names.len() > 5 {
            return Err(CodeModeError::Invalid(
                "Request at most five SDK entities.".into(),
            ));
        }
        if self.topics.len() > 4 {
            return Err(CodeModeError::Invalid(
                "Request at most four guide topics.".into(),
            ));
        }
        if host == CodeHost::User
            && self
                .topics
                .iter()
                .any(|topic| matches!(topic, CodeGuideTopic::Templates | CodeGuideTopic::Examples))
        {
            return Err(CodeModeError::Invalid(
                "Only the search and ai guides are available here.".into(),
            ));
        }
        let task_documentation = match self.task.as_deref().map(str::trim) {
            Some(task) if !task.is_empty() => {
                Some(documentation_for_task(user, task, cognition, cancel).await)
            }
            _ => None,
        };
        let selected = task_documentation
            .as_ref()
            .is_some_and(|task| !task.entities.is_empty());
        let catalog = sdk_documentation();
        let tools = if !self.names.is_empty() {
            self.names
                .iter()
                .map(|name| {
                    catalog
                        .iter()
                        .find(|doc| &doc.name == name)
                        .cloned()
                        .ok_or_else(|| {
                            CodeModeError::Invalid(format!(
                                "Unknown SDK entity {name}; request the catalog first."
                            ))
                        })
                })
                .collect::<Result<Vec<_>, _>>()?
        } else if self.topics.is_empty() && !selected {
            catalog
                .into_iter()
                .map(|mut doc| {
                    doc.documentation = None;
                    doc
                })
                .collect()
        } else {
            Vec::new()
        };
        let (overview, instructions) = match host {
            CodeHost::Session => (
                concat!(
                    include_str!("toolset/session/overview.md"),
                    include_str!("toolset/shared/entities.md")
                ),
                include_str!("toolset/session/discovery.md"),
            ),
            CodeHost::User => (
                concat!(
                    include_str!("toolset/user/overview.md"),
                    include_str!("toolset/shared/entities.md")
                ),
                include_str!("toolset/user/discovery.md"),
            ),
        };
        Ok(CodeToolsDescription {
            task_documentation,
            sdk_guide: Some(overview.into()),
            guides: self
                .topics
                .iter()
                .map(|topic| CodeGuide {
                    topic: *topic,
                    markdown: topic.markdown().into(),
                })
                .collect(),
            instructions: instructions.into(),
            tools,
        })
    }
}

fn tool_error(error: CodeModeError) -> ToolCallError {
    ToolCallError {
        description: error.to_string(),
        internal_error: anyhow::Error::msg(error.to_string()),
    }
}
