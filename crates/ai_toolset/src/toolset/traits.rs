//! The core ToolSet trait implemented by the ToolSet and AsyncToolset
use crate::telemetry::ToolCallSpan;
use crate::toolset::types::{RequestSchema, ToolInfo};
use crate::{AsyncToolCollection, RequestContext, SearchableTool, ToolResult, ToolSetError};
use std::pin::Pin;
use tracing::Instrument as _;

/// The future a tool dispatch resolves to.
pub type ToolCallFuture<'a> =
    Pin<Box<dyn Future<Output = Result<ToolResult<serde_json::Value>, ToolSetError>> + 'a + Send>>;

/// An object with a set of tools
pub trait ToolSet<Context>: Send + Sync {
    /// Route a tool call by name to its implementation and return the result.
    ///
    /// This is the implementor's hook and carries **no telemetry**:
    /// [`Self::try_tool_call`] wraps it in the `execute_tool` span (see
    /// [`crate::telemetry`]). A toolset that delegates to child toolsets calls
    /// the children's `dispatch_tool_call`, so one tool call yields one span.
    fn dispatch_tool_call<'a>(
        &'a self,
        context: Context,
        request_context: RequestContext,
        tool_name: &'a str,
        json: &'a serde_json::Value,
    ) -> ToolCallFuture<'a>;

    /// Try to call a tool indexed by name with the provided raw json.
    ///
    /// This is what callers use — the agent loop, user-executed tools,
    /// pipelines. Every call runs inside `execute_tool` telemetry: the span is
    /// enriched when the agent runtime already opened it, opened otherwise, and
    /// records the arguments, the result and any failure (see
    /// [`crate::telemetry::ToolCallSpan`]).
    fn try_tool_call<'a>(
        &'a self,
        context: Context,
        request_context: RequestContext,
        tool_name: &'a str,
        json: &'a serde_json::Value,
    ) -> ToolCallFuture<'a>
    where
        Context: Send + 'a,
    {
        Box::pin(async move {
            let telemetry = ToolCallSpan::begin(tool_name, json);
            let result = self
                .dispatch_tool_call(context, request_context, tool_name, json)
                .instrument(telemetry.span().clone())
                .await;
            telemetry.finish(&result);
            result
        })
    }

    /// Returns the input schemas for the tools sent to the provider on every
    /// request. Tools loaded on demand via tool search are excluded — they are
    /// surfaced through [`Self::searchable_catalog`] instead.
    fn request_schemas(&self) -> Option<Vec<RequestSchema>>;

    /// The catalog of on-demand (searchable) tools — those not sent on every
    /// request but discoverable via the `SearchTools` tool. Defaults to empty.
    fn searchable_catalog(&self) -> Vec<SearchableTool> {
        Vec::new()
    }

    /// Names of the toolsets (e.g. connected MCP servers) whose tools are
    /// available via tool search but not advertised on every request. Used to
    /// tell the model which integrations it can reach via `SearchTools` /
    /// `LoadTools`. Defaults to empty (no searchable toolsets).
    fn searchable_toolset_names(&self) -> Vec<String> {
        Vec::new()
    }

    /// Dynamic routers use this to demangle tool names for frontend consumption
    fn routing_description<'a>(&'a self, _tool_name: &'a str) -> Option<ToolInfo> {
        None
    }
}

impl<Context> ToolSet<Context> for AsyncToolCollection<Context>
where
    Context: Send + Sync + 'static,
{
    fn dispatch_tool_call<'a>(
        &'a self,
        context: Context,
        request_context: RequestContext,
        tool_name: &'a str,
        json: &'a serde_json::Value,
    ) -> ToolCallFuture<'a> {
        Box::pin(self.try_tool_call_internal(context, request_context, tool_name, json))
    }

    fn request_schemas(&self) -> Option<Vec<RequestSchema>> {
        let schemas = self
            .tools
            .values()
            .map(|tool| RequestSchema {
                name: tool.name.clone(),
                schema: tool.input_schema.clone().into(),
            })
            .collect::<Vec<_>>();
        if schemas.is_empty() {
            None
        } else {
            Some(schemas)
        }
    }
}
