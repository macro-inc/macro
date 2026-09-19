/// Adapts `ai_toolset` tool types into RIG [`DynamicTool`] objects.
use ai_toolset::tool_object::ToolSetCallable;
use ai_toolset::{AsyncToolCollection, RequestContext, RequestSchema, ToolSet as AiToolSet};
use rig_agent::tool::{DynamicTool, ToolExecutionError, ToolOutput};
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

type Deserializer<Context> = Arc<
    dyn Fn(
            &serde_json::Value,
        ) -> Result<Box<dyn ToolSetCallable<Context> + Send + Sync>, serde_json::Error>
        + Send
        + Sync,
>;

/// Builds RIG [`DynamicTool`]s from the tools of an [`AsyncToolCollection`].
///
/// The produced tools capture the shared service context and a mutable request
/// context (user ID) so that `ai_toolset` tools can be called through RIG's
/// agentic loop without modification.
pub struct ToolsetToolAdapter;

impl ToolsetToolAdapter {
    /// Consume an [`AsyncToolCollection`] and produce one [`DynamicTool`] per
    /// registered tool.
    ///
    /// `context` is the shared service context (e.g. `ToolServiceContext`).
    /// `request_context` is shared across all adapters and should be set before
    /// each session.
    pub fn from_collection<Context>(
        collection: AsyncToolCollection<Context>,
        context: Arc<Context>,
        request_context: Arc<RwLock<RequestContext>>,
    ) -> Vec<DynamicTool>
    where
        Context: Clone + Send + Sync + 'static,
    {
        collection
            .tools
            .into_iter()
            .map(|(name, tool_object)| {
                let description = tool_object.description.clone();
                let mut input_schema = serde_json::Value::Object(tool_object.input_schema.clone());
                normalize_request_schema(&mut input_schema);
                let deserializer: Deserializer<Context> = Arc::new(
                    move |json: &serde_json::Value| -> Result<
                        Box<dyn ToolSetCallable<Context> + Send + Sync>,
                        serde_json::Error,
                    > { tool_object.try_deserialize(json) },
                );
                let context = context.clone();
                let request_context = request_context.clone();

                DynamicTool::new(
                    name,
                    description,
                    input_schema,
                    move |_tool_ctx, args: serde_json::Value| {
                        let deserializer = deserializer.clone();
                        let context = context.clone();
                        let request_context = request_context.clone();
                        Box::pin(async move {
                            let callable =
                                (deserializer)(&args).map_err(invalid_args)?;
                            let ctx = (*context).clone();
                            let req_ctx = request_context
                                .read()
                                .expect("request_context lock poisoned")
                                .clone();
                            match callable.call(ctx, req_ctx).await {
                                Ok(value) => Ok(ToolOutput::json(value)),
                                Err(e) => {
                                    tracing::error!(error = ?e.internal_error, "toolset tool error");
                                    Err(ToolExecutionError::other(e.description))
                                }
                            }
                        })
                    },
                )
            })
            .collect()
    }
}

/// Builds RIG [`DynamicTool`]s that delegate through a shared
/// [`dyn AiToolSet`](AiToolSet).
///
/// Unlike [`ToolsetToolAdapter`] which takes ownership of tools from an
/// `AsyncToolCollection`, these tools dispatch every call through the shared
/// [`AiToolSet`] trait object. This supports `CombinedToolSet` (static tools +
/// MCP tools) without decomposing it.
pub struct DynToolSetAdapter;

impl DynToolSetAdapter {
    /// Create one [`DynamicTool`] per tool in `toolset`.
    ///
    /// Tool names and schemas are read from
    /// [`AiToolSet::request_schemas`]. Calls are dispatched through the
    /// shared `toolset`.
    pub fn from_toolset<Context>(
        toolset: Arc<dyn AiToolSet<Context> + Send + Sync>,
        context: Arc<Context>,
        request_context: Arc<RwLock<RequestContext>>,
    ) -> Vec<DynamicTool>
    where
        Context: Clone + Send + Sync + 'static,
    {
        let schemas = toolset.request_schemas().unwrap_or_default();
        schemas
            .into_iter()
            .map(|RequestSchema { name, schema }| {
                let schema_json = serde_json::to_value(&schema)
                    .unwrap_or(serde_json::Value::Object(serde_json::Map::new()));
                Self::build(
                    name,
                    schema_json,
                    toolset.clone(),
                    context.clone(),
                    request_context.clone(),
                )
            })
            .collect()
    }

    /// Build a single tool for one loaded on demand via tool search.
    ///
    /// Used to register a `SearchTools`-discovered tool with the live tool
    /// server mid-session so it becomes advertised and callable on the next
    /// turn. Calls dispatch through the shared `toolset` by name, exactly like
    /// [`Self::from_toolset`].
    pub fn loaded<Context>(
        name: String,
        schema: schemars::Schema,
        toolset: Arc<dyn AiToolSet<Context> + Send + Sync>,
        context: Arc<Context>,
        request_context: Arc<RwLock<RequestContext>>,
    ) -> DynamicTool
    where
        Context: Clone + Send + Sync + 'static,
    {
        let schema_json = serde_json::to_value(&schema)
            .unwrap_or(serde_json::Value::Object(serde_json::Map::new()));
        Self::build(name, schema_json, toolset, context, request_context)
    }

    fn build<Context>(
        name: String,
        mut schema: serde_json::Value,
        toolset: Arc<dyn AiToolSet<Context> + Send + Sync>,
        context: Arc<Context>,
        request_context: Arc<RwLock<RequestContext>>,
    ) -> DynamicTool
    where
        Context: Clone + Send + Sync + 'static,
    {
        normalize_request_schema(&mut schema);
        let tool_name = name.clone();
        DynamicTool::new(
            name,
            String::new(),
            schema,
            move |_tool_ctx, args: serde_json::Value| {
                let toolset = toolset.clone();
                let context = context.clone();
                let request_context = request_context.clone();
                let tool_name = tool_name.clone();
                Box::pin(async move {
                    let ctx = (*context).clone();
                    let req_ctx = request_context
                        .read()
                        .expect("request_context lock poisoned")
                        .clone();
                    match toolset.try_tool_call(ctx, req_ctx, &tool_name, &args).await {
                        Ok(Ok(value)) => Ok(ToolOutput::json(value)),
                        Ok(Err(e)) => {
                            tracing::error!(error = ?e.internal_error, "tool error");
                            Err(ToolExecutionError::other(e.description))
                        }
                        Err(e) => Err(ToolExecutionError::other(e.to_string())),
                    }
                })
            },
        )
    }
}

/// Deserialization failures are invalid model-supplied arguments.
fn invalid_args(e: serde_json::Error) -> ToolExecutionError {
    ToolExecutionError::invalid_args(e.to_string())
}
