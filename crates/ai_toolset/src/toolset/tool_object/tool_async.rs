use super::object::{SchemaRegistrar, ToolObject};
use crate::schema::{ValidatedSchema, ValidationError, generate_validated_input_schema};
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
    #[tracing::instrument(err, skip_all)]
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
pub(crate) type AsyncToolTraitObject<ToolSetContext> =
    Box<dyn ToolSetCallable<ToolSetContext> + Send + Sync>;

/// Adapter that wraps a `ToolSetCallable<SubContext>` to work with `ParentContext`.
///
/// This enables toolset nesting: tools from a subtoolset with a narrower context
/// can be widened to work with a parent toolset's broader context.
struct SubContextAdapter<ParentContext, SubContext>
where
    SubContext: FromRef<ParentContext>,
{
    callable: Box<dyn ToolSetCallable<SubContext> + Send + Sync>,
    _phantom: std::marker::PhantomData<fn(&ParentContext) -> SubContext>,
}

#[async_trait]
impl<ParentContext, SubContext> ToolSetCallable<ParentContext>
    for SubContextAdapter<ParentContext, SubContext>
where
    ParentContext: Send + Sync,
    SubContext: FromRef<ParentContext> + Send + Sync,
{
    #[tracing::instrument(err, skip_all)]
    async fn call(
        &self,
        context: ParentContext,
        request_context: RequestContext,
    ) -> ToolResult<serde_json::Value> {
        let sub_context = SubContext::from_ref(&context);
        self.callable.call(sub_context, request_context).await
    }
}

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
    #[tracing::instrument(err, skip(self))]
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
        let ValidatedSchema {
            name,
            description,
            schema: input_schema,
        } = generate_validated_input_schema::<T>()?;
        let input_schema_json =
            serde_json::to_value(input_schema).map_err(ValidationError::JsonSerialization)?;
        let serde_json::Value::Object(input_schema_json) = input_schema_json else {
            return Err(ValidationError::ExpectedObject);
        };

        let deserializer = Box::new(|data: &serde_json::Value| {
            serde_json::from_value::<T>(data.clone()).map(|tool| {
                Box::new(ToolContextAdapter::<ToolSetContext, ToolContext, T>::new(
                    tool,
                )) as AsyncToolTraitObject<ToolSetContext>
            })
        });

        let schema_registrar: SchemaRegistrar =
            Box::new(|generator: &mut schemars::SchemaGenerator| {
                generator.subschema_for::<T>();
                generator.subschema_for::<O>();
                (T::schema_name().into_owned(), O::schema_name().into_owned())
            });

        Ok(Self {
            name,
            input_schema: input_schema_json,
            description,
            deserializer,
            schema_registrar,
        })
    }

    /// Widens this tool object to work with a broader parent context.
    ///
    /// This enables toolset composition: a tool originally created for `SubContext`
    /// can be transformed to work with `ParentContext`, as long as `SubContext`
    /// can be derived from `ParentContext` via `FromRef`.
    ///
    /// # Type Parameters
    ///
    /// - `ParentContext`: The broader context type to widen to
    ///
    /// # Example
    ///
    /// ```
    /// use ai_toolset::{AsyncTool, RequestContext, ServiceContext, ToolResult};
    /// use ai_toolset::tool_object::AsyncToolObject;
    /// use axum_macros::FromRef;
    /// use schemars::JsonSchema;
    /// use serde::{Deserialize, Serialize};
    /// use std::sync::Arc;
    ///
    /// // Narrower context
    /// #[derive(Clone)]
    /// struct SubContext {
    ///     api: Arc<String>,
    /// }
    ///
    /// // Broader parent context
    /// #[derive(Clone, FromRef)]
    /// struct ParentContext {
    ///     sub: SubContext,
    ///     other: Arc<String>,
    /// }
    ///
    /// // A tool that works with SubContext
    /// #[derive(JsonSchema, Deserialize)]
    /// #[schemars(title = "MyTool", description = "Example tool")]
    /// struct MyTool { input: String }
    ///
    /// #[async_trait::async_trait]
    /// impl AsyncTool<SubContext> for MyTool {
    ///     type Output = serde_json::Value;
    ///     async fn call(&self, _ctx: ServiceContext<SubContext>, _req: RequestContext) -> ToolResult<Self::Output> {
    ///         Ok(serde_json::json!({"input": self.input}))
    ///     }
    /// }
    ///
    /// // Create tool for SubContext
    /// let tool: AsyncToolObject<SubContext> =
    ///     AsyncToolObject::try_from_tool::<MyTool, SubContext, _>().unwrap();
    ///
    /// // Widen to work with ParentContext
    /// let widened: AsyncToolObject<ParentContext> = tool.widen::<ParentContext>();
    ///
    /// assert_eq!(widened.name, "MyTool");
    /// ```
    pub fn widen<ParentContext>(self) -> AsyncToolObject<ParentContext>
    where
        ParentContext: Send + Sync + 'static,
        ToolSetContext: FromRef<ParentContext> + Send + Sync + 'static,
    {
        let old_deserializer = self.deserializer;

        let new_deserializer: AsyncDeserializer<ParentContext> =
            Box::new(move |data: &serde_json::Value| {
                old_deserializer(data).map(|callable| {
                    Box::new(SubContextAdapter {
                        callable,
                        _phantom: std::marker::PhantomData::<fn(&ParentContext) -> ToolSetContext>,
                    }) as AsyncToolTraitObject<ParentContext>
                })
            });

        ToolObject {
            name: self.name,
            input_schema: self.input_schema,
            description: self.description,
            deserializer: new_deserializer,
            schema_registrar: self.schema_registrar,
        }
    }
}
