//! Adapts a registered toolset without changing its authorization or metering.
use crate::domain::{CodeModeTools, ExecutionIdentity, ToolDocumentation};
use ai_toolset::{AsyncToolCollection, RequestContext, ToolSet};
use async_trait::async_trait;
use code_execution::domain::HostResult;
use serde_json::Value;
use std::sync::Arc;
use tokio_util::sync::CancellationToken;

/// Runs existing tools with a context bound by the composition root to the session.
pub struct ToolsetDispatcher<C> {
    tools: Arc<AsyncToolCollection<C>>,
    context: C,
    bind: fn(&C, &ExecutionIdentity) -> C,
}

impl<C> ToolsetDispatcher<C> {
    /// `bind` attributes writes and usage to the authenticated identity.
    pub fn new(
        tools: Arc<AsyncToolCollection<C>>,
        context: C,
        bind: fn(&C, &ExecutionIdentity) -> C,
    ) -> Self {
        Self {
            tools,
            context,
            bind,
        }
    }
}

#[async_trait]
impl<C: Clone + Send + Sync + 'static> CodeModeTools for ToolsetDispatcher<C> {
    fn catalog(&self) -> Vec<ToolDocumentation> {
        tool_documentation(&self.tools)
    }

    async fn call(
        &self,
        identity: &ExecutionIdentity,
        name: &str,
        args: &Value,
        cancel: CancellationToken,
    ) -> HostResult {
        let context = (self.bind)(&self.context, identity);
        let mut request = RequestContext::new(identity.owner.clone());
        request.cancel = cancel;
        // Inner calls do not travel through ACP, so the toolset owns their usual
        // metering/telemetry; the session actor reports the outer execution only.
        match self.tools.try_tool_call(context, request, name, args).await {
            Ok(Ok(value)) => HostResult::Ok { value },
            Ok(Err(error)) => HostResult::Error {
                message: error.description,
            },
            Err(error) => HostResult::Error {
                message: error.to_string(),
            },
        }
    }
}

/// Build SDK documentation from registered input contracts and output types.
pub fn tool_documentation<C>(tools: &AsyncToolCollection<C>) -> Vec<ToolDocumentation> {
    tools
        .tools
        .iter()
        .map(|(name, tool)| {
            let mut generator = schemars::SchemaGenerator::default();
            let (_, output) = (tool.schema_registrar)(&mut generator);
            let definitions = generator.take_definitions(true);
            let schema = |name: &str| {
                serde_json::json!({
                    "$ref": format!("#/$defs/{name}"), "$defs": definitions,
                })
            };
            ToolDocumentation {
                name: name.clone(),
                description: tool.description.clone(),
                // Model-facing input contracts can be richer than frontend
                // schemas (notably DisplayResults' widget vocabulary).
                input_schema: Value::Object(tool.input_schema.clone()),
                output_schema: schema(&output),
                user_tool: tools.user_tools.contains_key(name),
            }
        })
        .collect()
}
