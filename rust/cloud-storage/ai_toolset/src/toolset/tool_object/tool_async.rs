use super::object::{ToolObject, ValidationError};
use super::util::validate_tool_schema;
use crate::{AsyncTool, RequestContext, ServiceContext, ToolCallError, ToolResult};
use async_trait::async_trait;
use axum::extract::FromRef;
use schemars::JsonSchema;
use serde::Serialize;
use serde::de::Deserialize;

/// Internal trait for callable tools that work directly with `ToolSetContext`.
///
/// This trait abstracts over the context extraction, allowing tools with different
/// `ToolContext` types to be stored together in a single toolset.
#[async_trait]
pub trait ToolSetCallable<ToolSetContext>: Send + Sync {
    /// Execute the tool with the given toolset context and request context.
    async fn call(
        &self,
        context: ToolSetContext,
        request_context: RequestContext,
    ) -> ToolResult<serde_json::Value>;
}

/// Adapter that wraps an `AsyncTool<ToolContext>` to work with `ToolSetContext`.
///
/// This adapter extracts the specific `ToolContext` from `ToolSetContext` using
/// `FromRef` before calling the underlying tool.
struct ToolContextAdapter<ToolSetContext, ToolContext, T>
where
    ToolContext: FromRef<ToolSetContext>,
{
    tool: T,
    _phantom: std::marker::PhantomData<fn(ToolSetContext) -> ToolContext>,
}

impl<ToolSetContext, ToolContext, T> ToolContextAdapter<ToolSetContext, ToolContext, T>
where
    ToolContext: FromRef<ToolSetContext>,
{
    fn new(tool: T) -> Self {
        Self {
            tool,
            _phantom: std::marker::PhantomData,
        }
    }
}

#[async_trait]
impl<ToolSetContext, ToolContext, T> ToolSetCallable<ToolSetContext>
    for ToolContextAdapter<ToolSetContext, ToolContext, T>
where
    ToolSetContext: Send + Sync,
    ToolContext: FromRef<ToolSetContext> + Send + Sync,
    T: AsyncTool<ToolContext> + Send + Sync,
    T::Output: Serialize,
{
    async fn call(
        &self,
        context: ToolSetContext,
        request_context: RequestContext,
    ) -> ToolResult<serde_json::Value> {
        let tool_context = ToolContext::from_ref(&context);
        self.tool
            .call(ServiceContext(tool_context), request_context)
            .await
            .and_then(|out| {
                serde_json::to_value(out).map_err(|err| ToolCallError {
                    description: "An internal error occurred".to_string(),
                    internal_error: anyhow::Error::from(err),
                })
            })
    }
}

/// Trait object type for tools callable with `ToolSetContext`.
type AsyncToolTraitObject<ToolSetContext> = Box<dyn ToolSetCallable<ToolSetContext> + Send + Sync>;

/// Deserializer function type that creates a callable tool from JSON.
type AsyncDeserializer<ToolSetContext> = Box<
    dyn Fn(&serde_json::Value) -> Result<AsyncToolTraitObject<ToolSetContext>, serde_json::Error>
        + Send
        + Sync,
>;

/// Type alias for a `ToolObject` configured for asynchronous tools.
///
/// This tool object can hold tools with different `ToolContext` types, as long as
/// each `ToolContext` can be extracted from `ToolSetContext` via `FromRef`.
pub type AsyncToolObject<ToolSetContext> = ToolObject<AsyncDeserializer<ToolSetContext>>;

impl<ToolSetContext> ToolObject<AsyncDeserializer<ToolSetContext>> {
    /// Attempts to deserialize JSON input into a callable async tool instance.
    pub fn try_deserialize(
        &self,
        data: &serde_json::Value,
    ) -> Result<AsyncToolTraitObject<ToolSetContext>, serde_json::Error> {
        let deserializer = &self.deserializer;
        deserializer(data)
    }
}

impl<ToolSetContext> ToolObject<AsyncDeserializer<ToolSetContext>>
where
    ToolSetContext: Send + Sync + 'static,
{
    /// Creates a new `AsyncToolObject` from an async tool type.
    ///
    /// The tool type must implement `AsyncTool` with a context that can be extracted
    /// from `ToolSetContext` using `FromRef`. The context extraction is captured at
    /// creation time, allowing tools with different `ToolContext` types to coexist
    /// in the same toolset.
    pub fn try_from_tool<T, ToolContext, O>() -> Result<Self, ValidationError>
    where
        ToolContext: FromRef<ToolSetContext> + Send + Sync + 'static,
        T: JsonSchema
            + AsyncTool<ToolContext, Output = O>
            + for<'de> Deserialize<'de>
            + 'static
            + Send
            + Sync,
        O: Serialize + JsonSchema + 'static,
    {
        let input_schema = generate_tool_input_schema!(&T);
        let (name, description) = validate_tool_schema(&input_schema)?;
        let input_schema_json =
            serde_json::to_value(input_schema).map_err(ValidationError::JsonSerialization)?;

        let deserializer = Box::new(|data: &serde_json::Value| {
            serde_json::from_value::<T>(data.clone()).map(|tool| {
                Box::new(ToolContextAdapter::<ToolSetContext, ToolContext, T>::new(
                    tool,
                )) as AsyncToolTraitObject<ToolSetContext>
            })
        });

        let output_schema = generate_tool_output_schema!(&O);
        let output_schema_json =
            serde_json::to_value(&output_schema).map_err(ValidationError::JsonSerialization)?;

        Ok(Self {
            name,
            input_schema: input_schema_json,
            output_schema: output_schema_json,
            description,
            deserializer,
        })
    }
}
