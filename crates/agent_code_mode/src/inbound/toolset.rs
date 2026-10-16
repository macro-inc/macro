//! SDK discovery and one awaited code execution exposed as ordinary tools.
use crate::domain::{CodeModeError, ExecutionId, ExecutionReceipt, SessionCodeMode};
use agent_session::domain::model::AgentSession;
use ai_toolset::{
    AsyncTool, AsyncToolCollection, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations,
    ToolCallError, ToolResult,
};
use async_trait::async_trait;
use code_execution::domain::ExecuteRequest;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

#[cfg(test)]
mod test;

/// Session facts supplied by the authenticated MCP adapter.
#[derive(Clone)]
pub struct CodeModeToolContext {
    /// Code-mode use cases.
    pub service: Arc<dyn SessionCodeMode>,
    /// The session authenticated by the request's bearer credential.
    pub session: AgentSession,
}

/// Tools advertised only when a runner is configured.
pub fn toolset() -> AsyncToolCollection<CodeModeToolContext> {
    AsyncToolCollection::new()
        .add_tool::<ExecuteCode, CodeModeToolContext>()
        .add_tool::<DescribeCodeTools, CodeModeToolContext>()
}

/// Execute a JavaScript module with the real Macro SDK.
#[derive(Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
#[schemars(
    title = "ExecuteCode",
    description = include_str!("toolset/execute_code.md")
)]
pub struct ExecuteCode {
    /// Fresh UUID for this execution, recorded in the tool input so results can
    /// be recovered even if the session stops before the tool replies.
    #[schemars(
        description = "A fresh unique UUID for this execution, used to recover saved results if interrupted. Never use a placeholder, repeated-digit example, or an ID from another session. Reusing your existing ID with identical source returns its saved receipt without running again; different source is rejected. If an ID is unavailable, choose a fresh UUID."
    )]
    pub execution_id: ExecutionId,
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
    description = "Look up SDK documentation missing from the current context. Entity reference sections may already be loaded before your turn: use them to write ExecuteCode directly, without calling this tool again for confirmation. Request up to five missing SDK entity names together for their public TypeScript declarations. Request topics for search, AI, Handlebars, or workflow examples; topic-only requests omit the tool catalog. Empty names and topics return the compact catalog. Reuse documentation already learned in this conversation."
)]
pub struct DescribeCodeTools {
    /// Exact method names; empty means list the catalog.
    #[serde(default)]
    #[schemars(
        description = "Up to five SDK entity names such as documents, email, ai, or core. Empty names and topics list the compact entity catalog."
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
        _context: ServiceContext<CodeModeToolContext>,
        _request: RequestContext,
    ) -> ToolResult<Self::Output> {
        self.describe().map_err(tool_error)
    }
}

impl DescribeCodeTools {
    fn describe(&self) -> Result<CodeToolsDescription, CodeModeError> {
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
        Ok(CodeToolsDescription {
            sdk_guide: Some(include_str!("toolset/guides/overview.md").into()),
            guides: self
                .topics
                .iter()
                .map(|topic| CodeGuide {
                    topic: *topic,
                    markdown: topic.markdown().into(),
                })
                .collect(),
            instructions: include_str!("toolset/discovery.md").into(),
            tools: if self.names.is_empty() && !self.topics.is_empty() {
                Vec::new()
            } else {
                let catalog = sdk_documentation();
                if self.names.is_empty() {
                    catalog
                        .into_iter()
                        .map(|mut doc| {
                            doc.documentation = None;
                            doc
                        })
                        .collect()
                } else {
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
                }
            },
        })
    }
}

fn tool_error(error: CodeModeError) -> ToolCallError {
    ToolCallError {
        description: error.to_string(),
        internal_error: anyhow::Error::msg(error.to_string()),
    }
}
