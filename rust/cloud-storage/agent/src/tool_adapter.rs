/// Adapts `ai_toolset` tool types into RIG [`ToolDyn`] objects.
#[cfg(test)]
mod test;

use ai_toolset::tool_object::ToolSetCallable;
use ai_toolset::{AsyncToolCollection, RequestContext, RequestSchema, ToolSet as AiToolSet};
use rig_core::completion::ToolDefinition;
use rig_core::tool::{ToolDyn, ToolError};
use rig_core::wasm_compat::WasmBoxedFuture;
use std::sync::{Arc, RwLock};

/// Ensure every object schema carries an explicit `properties` map.
///
/// Zero-argument tools serialize to `{"type": "object"}` with no
/// `properties` key, which OpenAI's strict function validation rejects
/// ("object schema missing properties"). Adding an empty map is a
/// semantic no-op accepted by every provider. Recurses through the
/// standard schema-bearing keywords.
pub fn normalize_request_schema(schema: &mut serde_json::Value) {
    let serde_json::Value::Object(map) = schema else {
        return;
    };

    if map.get("type").and_then(|t| t.as_str()) == Some("object") && !map.contains_key("properties")
    {
        map.insert(
            "properties".to_owned(),
            serde_json::Value::Object(serde_json::Map::new()),
        );
    }

    for key in ["properties", "$defs", "definitions"] {
        if let Some(serde_json::Value::Object(children)) = map.get_mut(key) {
            for child in children.values_mut() {
                normalize_request_schema(child);
            }
        }
    }
    for key in ["anyOf", "oneOf", "allOf", "prefixItems"] {
        if let Some(serde_json::Value::Array(children)) = map.get_mut(key) {
            for child in children.iter_mut() {
                normalize_request_schema(child);
            }
        }
    }
    for key in ["items", "additionalProperties", "not", "if", "then", "else"] {
        if let Some(child) = map.get_mut(key) {
            normalize_request_schema(child);
        }
    }
}

type Deserializer<Context> = Box<
    dyn Fn(
            &serde_json::Value,
        ) -> Result<Box<dyn ToolSetCallable<Context> + Send + Sync>, serde_json::Error>
        + Send
        + Sync,
>;

/// Wraps a single tool from an [`AsyncToolCollection`] as a RIG [`ToolDyn`].
///
/// The adapter captures the shared service context and a mutable request
/// context (user ID) so that `ai_toolset` tools can be called through
/// RIG's agentic loop without modification.
pub struct ToolsetToolAdapter<Context> {
    name: String,
    description: String,
    input_schema: serde_json::Value,
    deserializer: Deserializer<Context>,
    context: Arc<Context>,
    request_context: Arc<RwLock<RequestContext>>,
}

impl<Context> ToolsetToolAdapter<Context>
where
    Context: Clone + Send + Sync + 'static,
{
    /// Consume an [`AsyncToolCollection`] and produce one [`ToolsetToolAdapter`]
    /// per registered tool.
    ///
    /// `context` is the shared service context (e.g. `ToolServiceContext`).
    /// `request_context` is shared across all adapters and should be set before
    /// each session.
    pub fn from_collection(
        collection: AsyncToolCollection<Context>,
        context: Arc<Context>,
        request_context: Arc<RwLock<RequestContext>>,
    ) -> Vec<Self> {
        collection
            .tools
            .into_iter()
            .map(|(name, tool_object)| {
                let description = tool_object.description.clone();
                let mut input_schema = serde_json::Value::Object(tool_object.input_schema.clone());
                normalize_request_schema(&mut input_schema);
                let deserializer = Box::new(
                    move |json: &serde_json::Value| -> Result<
                        Box<dyn ToolSetCallable<Context> + Send + Sync>,
                        serde_json::Error,
                    > { tool_object.try_deserialize(json) },
                );

                ToolsetToolAdapter {
                    name,
                    description,
                    input_schema,
                    deserializer,
                    context: context.clone(),
                    request_context: request_context.clone(),
                }
            })
            .collect()
    }
}

// Safety: inner fields are all Send + Sync.
unsafe impl<C: Send + Sync> Send for ToolsetToolAdapter<C> {}
unsafe impl<C: Send + Sync> Sync for ToolsetToolAdapter<C> {}

impl<Context> ToolDyn for ToolsetToolAdapter<Context>
where
    Context: Clone + Send + Sync + 'static,
{
    fn name(&self) -> String {
        self.name.clone()
    }

    fn definition<'a>(&'a self, _prompt: String) -> WasmBoxedFuture<'a, ToolDefinition> {
        let def = ToolDefinition {
            name: self.name.clone(),
            description: self.description.clone(),
            parameters: self.input_schema.clone(),
        };
        Box::pin(async move { def })
    }

    fn call<'a>(&'a self, args: String) -> WasmBoxedFuture<'a, Result<String, ToolError>> {
        Box::pin(async move {
            let json: serde_json::Value =
                serde_json::from_str(&args).map_err(ToolError::JsonError)?;
            let callable = (self.deserializer)(&json).map_err(ToolError::JsonError)?;
            let ctx = (*self.context).clone();
            let req_ctx = self
                .request_context
                .read()
                .expect("request_context lock poisoned")
                .clone();
            match callable.call(ctx, req_ctx).await {
                Ok(value) => serde_json::to_string(&value).map_err(ToolError::JsonError),
                Err(e) => {
                    tracing::error!(error = ?e.internal_error, "toolset tool error");
                    Err(ToolError::ToolCallError(e.description.into()))
                }
            }
        })
    }
}

/// Wraps a single tool from a [`dyn AiToolSet`] as a RIG [`ToolDyn`].
///
/// Unlike [`ToolsetToolAdapter`] which takes ownership of tools from an
/// `AsyncToolCollection`, this adapter delegates every call through the
/// shared [`AiToolSet`] trait object. This supports `CombinedToolSet`
/// (static tools + MCP tools) without decomposing it.
pub struct DynToolSetAdapter<Context> {
    name: String,
    schema: serde_json::Value,
    toolset: Arc<dyn AiToolSet<Context> + Send + Sync>,
    context: Arc<Context>,
    request_context: Arc<RwLock<RequestContext>>,
}

impl<Context> DynToolSetAdapter<Context>
where
    Context: Clone + Send + Sync + 'static,
{
    /// Create one [`DynToolSetAdapter`] per tool in `toolset`.
    ///
    /// Tool names and schemas are read from
    /// [`AiToolSet::request_schemas`]. Calls are dispatched through the
    /// shared `toolset`.
    pub fn from_toolset(
        toolset: Arc<dyn AiToolSet<Context> + Send + Sync>,
        context: Arc<Context>,
        request_context: Arc<RwLock<RequestContext>>,
    ) -> Vec<Self> {
        let schemas = toolset.request_schemas().unwrap_or_default();
        schemas
            .into_iter()
            .map(|RequestSchema { name, schema }| {
                let mut schema_json = serde_json::to_value(&schema)
                    .unwrap_or(serde_json::Value::Object(serde_json::Map::new()));
                normalize_request_schema(&mut schema_json);
                DynToolSetAdapter {
                    name,
                    schema: schema_json,
                    toolset: toolset.clone(),
                    context: context.clone(),
                    request_context: request_context.clone(),
                }
            })
            .collect()
    }
}

unsafe impl<C: Send + Sync> Send for DynToolSetAdapter<C> {}
unsafe impl<C: Send + Sync> Sync for DynToolSetAdapter<C> {}

impl<Context> ToolDyn for DynToolSetAdapter<Context>
where
    Context: Clone + Send + Sync + 'static,
{
    fn name(&self) -> String {
        self.name.clone()
    }

    fn definition<'a>(&'a self, _prompt: String) -> WasmBoxedFuture<'a, ToolDefinition> {
        let def = ToolDefinition {
            name: self.name.clone(),
            description: String::new(),
            parameters: self.schema.clone(),
        };
        Box::pin(async move { def })
    }

    fn call<'a>(&'a self, args: String) -> WasmBoxedFuture<'a, Result<String, ToolError>> {
        Box::pin(async move {
            let json: serde_json::Value =
                serde_json::from_str(&args).map_err(ToolError::JsonError)?;
            let ctx = (*self.context).clone();
            let req_ctx = self
                .request_context
                .read()
                .expect("request_context lock poisoned")
                .clone();
            match self
                .toolset
                .try_tool_call(ctx, req_ctx, &self.name, &json)
                .await
            {
                Ok(Ok(value)) => serde_json::to_string(&value).map_err(ToolError::JsonError),
                Ok(Err(e)) => {
                    tracing::error!(error = ?e.internal_error, "tool error");
                    Err(ToolError::ToolCallError(e.description.into()))
                }
                Err(e) => Err(ToolError::ToolCallError(e.to_string().into())),
            }
        })
    }
}
