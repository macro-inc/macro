//! Deferring tools: keeping their schemas out of every request.
//!
//! A deferred tool stays callable, but only its name and description are
//! offered upfront, in [`ToolSet::searchable_catalog`]. The agent loop's tool
//! search (`LoadTools`, `SearchTools`, or a call to an unloaded tool) registers
//! its schema once the model asks for it.

#[cfg(test)]
mod test;

use std::sync::Arc;

use ai_toolset::{
    AsyncToolCollection, RequestContext, RequestSchema, SearchableTool, ToolCallFuture, ToolInfo,
    ToolSet,
};

/// Catalog entries for every tool in `tools` except `eager`.
pub fn deferred_tools<Context>(
    tools: &AsyncToolCollection<Context>,
    eager: &[&str],
) -> Arc<[SearchableTool]> {
    tools
        .tools
        .values()
        .filter(|tool| !eager.contains(&tool.name.as_str()))
        .map(|tool| SearchableTool {
            name: tool.name.clone(),
            description: tool.description.clone(),
            schema: tool.input_schema.clone().into(),
        })
        .collect()
}

/// `tools` with `deferred` taken out of every request and offered in the
/// catalog instead, ahead of whatever `tools` already catalogs.
pub struct DeferredToolSet<Context> {
    tools: Arc<dyn ToolSet<Context> + Send + Sync>,
    deferred: Arc<[SearchableTool]>,
}

impl<Context> DeferredToolSet<Context> {
    /// Defer `deferred` from `tools`.
    pub fn new(
        tools: Arc<dyn ToolSet<Context> + Send + Sync>,
        deferred: Arc<[SearchableTool]>,
    ) -> Self {
        Self { tools, deferred }
    }

    fn is_deferred(&self, name: &str) -> bool {
        self.deferred.iter().any(|tool| tool.name == name)
    }
}

impl<Context> ToolSet<Context> for DeferredToolSet<Context>
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
        self.tools
            .dispatch_tool_call(context, request_context, tool_name, json)
    }

    fn request_schemas(&self) -> Option<Vec<RequestSchema>> {
        let schemas: Vec<RequestSchema> = self
            .tools
            .request_schemas()?
            .into_iter()
            .filter(|schema| !self.is_deferred(&schema.name))
            .collect();
        (!schemas.is_empty()).then_some(schemas)
    }

    fn searchable_catalog(&self) -> Vec<SearchableTool> {
        let mut catalog = self.deferred.to_vec();
        catalog.extend(self.tools.searchable_catalog());
        catalog
    }

    fn searchable_toolset_names(&self) -> Vec<String> {
        self.tools.searchable_toolset_names()
    }

    fn routing_description<'a>(&'a self, tool_name: &'a str) -> Option<ToolInfo> {
        self.tools.routing_description(tool_name)
    }
}
