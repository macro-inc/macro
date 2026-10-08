//! SDK discovery and one awaited code execution exposed as ordinary tools.
use crate::domain::{
    CodeModeError, ExecutionId, ExecutionReceipt, SessionCodeMode, ToolDocumentation,
};
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

/// Execute an async TypeScript function body with the session's SDK.
#[derive(Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
#[schemars(
    title = "ExecuteCode",
    description = "Run an async TypeScript function body in an isolated Deno sandbox. First use DescribeCodeTools to learn SDK methods. Call them as await sdk.ToolName({...}); use Promise.all for independent calls. Return a JSON-compatible value for the model; only that value and an execution receipt are returned, while real inner calls retain their normal Macro UI. No imports, filesystem, network, environment, subprocesses, or npm. Await all calls before returning. Human-interactive tools and subagents must be called directly. A failure or cancellation does not undo completed writes; never replay writes blindly."
)]
pub struct ExecuteCode {
    /// Fresh UUID for this execution, recorded in the tool input so results can
    /// be recovered even if the session stops before the tool replies.
    #[schemars(
        description = "A fresh UUID for this execution, used to recover saved results if interrupted. Reusing an ID with identical source returns its existing receipt without running again; different source is rejected. Use a new ID for a new execution."
    )]
    pub execution_id: ExecutionId,
    /// Async TypeScript function body, using `sdk` and an explicit `return`.
    #[schemars(
        description = "Async TypeScript function body, at most 64 KiB. Example: const r = await sdk.NameSearch({name: 'launch'}); return r;"
    )]
    pub source: String,
    /// Deadline including queueing and tool calls.
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

/// Discover the exact runtime SDK catalog and per-method input/output contracts.
#[derive(Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
#[schemars(
    title = "DescribeCodeTools",
    description = "Discover methods available to ExecuteCode. Call with names: [] for the compact catalog, then provide up to five exact names to retrieve their input and output JSON schemas. Each method is called as await sdk.<name>(input) and returns the documented JSON output. Schemas come from the same registered tools that execute the calls."
)]
pub struct DescribeCodeTools {
    /// Exact method names; empty means list the catalog.
    #[serde(default)]
    #[schemars(
        description = "Up to five exact SDK method names, or [] to list all available methods."
    )]
    pub names: Vec<String>,
}

/// Runtime and discovery instructions beside the selected schemas.
#[derive(Serialize, JsonSchema)]
pub struct CodeToolsDescription {
    /// How to execute methods and interpret discovery results.
    pub instructions: String,
    /// Registered methods; schemas are null in the compact catalog.
    pub tools: Vec<CodeToolDescription>,
}

/// A model-facing contract with schemas encoded as JSON text. Provider tool
/// results can reserve object keys such as `$ref` for multimedia references.
#[derive(Serialize, JsonSchema)]
pub struct CodeToolDescription {
    /// Exact method name under `sdk`.
    pub name: String,
    /// When and how to use this method.
    pub description: String,
    /// JSON-encoded input schema, including definitions; null in the catalog.
    pub input_schema: Option<String>,
    /// JSON-encoded output schema, including definitions; null in the catalog.
    pub output_schema: Option<String>,
}

impl From<ToolDocumentation> for CodeToolDescription {
    fn from(tool: ToolDocumentation) -> Self {
        Self {
            name: tool.name,
            description: tool.description,
            input_schema: (!tool.input_schema.is_null()).then(|| tool.input_schema.to_string()),
            output_schema: (!tool.output_schema.is_null()).then(|| tool.output_schema.to_string()),
        }
    }
}

impl ToolAnnotated for DescribeCodeTools {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::read_only("Discover code tools");
}

#[async_trait]
impl AsyncTool<CodeModeToolContext> for DescribeCodeTools {
    type Output = CodeToolsDescription;

    async fn call(
        &self,
        context: ServiceContext<CodeModeToolContext>,
        _request: RequestContext,
    ) -> ToolResult<Self::Output> {
        Ok(CodeToolsDescription {
            instructions: "Methods are async: await sdk.ToolName(input). Input and output schemas are JSON-encoded strings including their definitions. Null schemas mean this is the compact catalog; request exact names for details. Use Promise.all for independent calls, await every call, and return JSON. The SDK enforces the session owner's permissions. Use ordinary direct tools for human interaction or subagents. console.log is diagnostic only; use return for model-visible data.".into(),
            tools: context.service.describe(&self.names).map_err(tool_error)?.into_iter().map(CodeToolDescription::from).collect(),
        })
    }
}

fn tool_error(error: CodeModeError) -> ToolCallError {
    ToolCallError {
        description: error.to_string(),
        internal_error: anyhow::Error::msg(error.to_string()),
    }
}
