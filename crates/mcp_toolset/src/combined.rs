//! Static tools and MCP tools presented to the AI loop as one toolset.

use crate::MANGLED_PREFIX;
use ai_toolset::{
    AsyncToolCollection, RequestContext, RequestSchema, SearchableTool, ToolInfo, ToolResult,
    ToolSet, ToolSetError,
};
use std::pin::Pin;
use std::sync::Arc;

#[cfg(test)]
mod test;

/// Wraps a static [`AsyncToolCollection`] and a set of MCP tools, presenting
/// them as a single toolset to the AI loop.
///
/// `Mcp` is any MCP toolset: chat passes a user's connections, the in-process
/// agent runtime the servers it was handed. A tool whose name has the mangled
/// MCP prefix goes to `Mcp`, every other tool to the static collection.
pub struct CombinedToolSet<T, Mcp> {
    static_tools: Arc<AsyncToolCollection<T>>,
    mcp_tools: Mcp,
    eager_mcp_tools: Vec<String>,
}

impl<T, Mcp> CombinedToolSet<T, Mcp> {
    /// Combine the static tools with an already-built MCP toolset.
    pub fn new(static_tools: Arc<AsyncToolCollection<T>>, mcp_tools: Mcp) -> Self {
        Self {
            static_tools,
            mcp_tools,
            eager_mcp_tools: Vec::new(),
        }
    }

    /// Advertise these exact MCP names on the first model request when the
    /// connected servers provide them. All other MCP tools remain searchable.
    pub fn with_eager_mcp_tools(mut self, names: &[&str]) -> Self {
        self.eager_mcp_tools = names.iter().map(|name| (*name).to_owned()).collect();
        self
    }

    fn is_eager(&self, name: &str) -> bool {
        self.eager_mcp_tools.iter().any(|eager| eager == name)
    }
}

impl<T: Send + Sync + 'static, Mcp: ToolSet<T>> ToolSet<T> for CombinedToolSet<T, Mcp> {
    fn dispatch_tool_call<'a>(
        &'a self,
        context: T,
        request_context: RequestContext,
        tool_name: &'a str,
        json: &'a serde_json::Value,
    ) -> Pin<
        Box<dyn Future<Output = Result<ToolResult<serde_json::Value>, ToolSetError>> + 'a + Send>,
    > {
        if tool_name.starts_with(MANGLED_PREFIX) {
            self.mcp_tools
                .dispatch_tool_call(context, request_context, tool_name, json)
        } else {
            self.static_tools
                .dispatch_tool_call(context, request_context, tool_name, json)
        }
    }

    fn request_schemas(&self) -> Option<Vec<RequestSchema>> {
        if self.eager_mcp_tools.is_empty() {
            return self.static_tools.request_schemas();
        }
        let mut schemas = self.static_tools.request_schemas().unwrap_or_default();
        schemas.extend(
            self.mcp_tools
                .searchable_catalog()
                .into_iter()
                .filter(|tool| self.is_eager(&tool.name))
                .map(|tool| RequestSchema {
                    name: tool.name,
                    description: tool.description,
                    schema: tool.schema,
                }),
        );
        (!schemas.is_empty()).then_some(schemas)
    }

    fn searchable_catalog(&self) -> Vec<SearchableTool> {
        ToolSet::<T>::searchable_catalog(&self.mcp_tools)
            .into_iter()
            // Catalog entries are deferred by providers that use tool search,
            // even when their schemas are also present in request_schemas.
            .filter(|tool| !self.is_eager(&tool.name))
            .collect()
    }

    fn searchable_toolset_names(&self) -> Vec<String> {
        ToolSet::<T>::searchable_toolset_names(&self.mcp_tools)
    }

    fn routing_description<'a>(&'a self, tool_name: &'a str) -> Option<ToolInfo> {
        if tool_name.starts_with(MANGLED_PREFIX) {
            ToolSet::<T>::routing_description(&self.mcp_tools, tool_name)
        } else {
            self.static_tools.routing_description(tool_name)
        }
    }
}
