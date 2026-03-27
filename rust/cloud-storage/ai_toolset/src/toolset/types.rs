//! types
use super::tool_object::{AsyncToolObject, UserTool, ValidationError};
use crate::RequestContext;
use crate::{AsyncTool, ToolResult};
use axum::extract::FromRef;
use schemars::{JsonSchema, Schema};
use serde::Serialize;
use serde::de::Deserialize;
use std::collections::hash_map::HashMap;
use thiserror::Error;

/// Error type for failures when creating or adding tools to a toolset.
#[derive(Debug, Error)]
pub enum ToolSetCreationError {
    /// Schema validation failed for the tool.
    #[error("error validating schema")]
    Validation(ValidationError),
    /// A tool with the same name already exists in the toolset.
    #[error("two or more tools have the same name")]
    NameConflict(String),
}

/// Error type for failures when invoking tools from a toolset.
#[derive(Debug, Error)]
pub enum ToolSetError {
    /// Failed to deserialize the tool input (possibly an AI hallucination).
    #[error("error deserializing tool call (possible hallucination)")]
    Deserialization(serde_json::Error),
    /// The requested tool was not found in the toolset.
    #[error("tool not in toolset")]
    NotFound(String),
}

/// Type alias for a toolset containing asynchronous tools.
pub type AsyncToolSet<ToolSetContext> = ToolSet<AsyncToolObject<ToolSetContext>>;

/// Represents the schema information for a tool.
pub struct ToolSchema {
    /// The name of the tool.
    pub name: String,
    /// The JSON schema for the tool's input parameters.
    pub schema: Schema,
    /// The JSON schema for the tool's output.
    pub result_schema: Schema,
}

impl ToolSchema {
    /// Creates a new tool schema with the given name, input schema, and result schema.
    pub fn new(name: String, schema: Schema, result_schema: Schema) -> Self {
        Self {
            name,
            schema,
            result_schema,
        }
    }
}

/// A collection of tools that can be called by an AI model.
///
/// `ToolSet` manages a set of tools, allowing you to add tools, merge toolsets,
/// and invoke tools by name with JSON input.
#[derive(Default)]
pub struct ToolSet<T> {
    /// The tools in this toolset, keyed by name.
    /// This includes type-erased user tools
    pub tools: HashMap<String, T>,
    /// Non type-erased user tools
    pub user_tools: HashMap<String, T>,
}

impl<T> ToolSet<T> {
    /// Creates a new empty toolset.
    pub fn new() -> Self {
        Self {
            tools: HashMap::new(),
            user_tools: HashMap::new(),
        }
    }
}

impl<T> ToolSet<T> {
    /// Merges another toolset into this one.
    ///
    /// Returns an error if any tool names conflict between the two toolsets.
    pub fn add_toolset(mut self, toolset: ToolSet<T>) -> Self {
        for (name, _) in toolset.tools.iter() {
            if self.tools.contains_key(name) {
                panic!("{}", ToolSetCreationError::NameConflict(name.clone()));
            }
        }
        self.tools.extend(toolset.tools);
        self
    }
}

impl<ToolSetContext> AsyncToolSet<ToolSetContext>
where
    ToolSetContext: Sync + Send + 'static,
{
    /// Adds an asynchronous tool to this toolset.
    ///
    /// The tool type must implement [`AsyncTool`], [`JsonSchema`], and [`Deserialize`].
    /// The tool's context type (`ToolContext`) must be extractable from `ToolSetContext`
    /// using `FromRef`, providing a compile-time guarantee that the toolset context
    /// can be narrowed to the specific context required by each tool.
    ///
    /// Returns an error if schema validation fails or a tool with the same name exists.
    pub fn add_tool<T, ToolContext>(mut self) -> Self
    where
        ToolContext: Sync + Send + FromRef<ToolSetContext> + 'static,
        T: JsonSchema + AsyncTool<ToolContext> + for<'de> Deserialize<'de> + 'static + Send + Sync,
        T::Output: Serialize + JsonSchema + 'static,
    {
        let tool_object = AsyncToolObject::try_from_tool::<T, ToolContext, T::Output>()
            .expect("expect conversion to AsyncToolObject");
        if self.tools.contains_key(&tool_object.name) {
            panic!(
                "{}",
                ToolSetCreationError::NameConflict(tool_object.name.clone())
            );
        } else {
            self.tools.insert(tool_object.name.clone(), tool_object);
            self
        }
    }

    /// Adds a user tool to the toolset
    /// A user tool isn't executed automatically by default
    pub fn add_user_tool<T, ToolContext>(mut self) -> Self
    where
        ToolContext: Sync + Send + FromRef<ToolSetContext> + 'static,
        T: JsonSchema + AsyncTool<ToolContext> + for<'de> Deserialize<'de> + 'static + Send + Sync,
        T::Output: Serialize + JsonSchema + 'static,
    {
        let tool_object = AsyncToolObject::try_from_tool::<T, ToolContext, T::Output>()
            .expect("conversion to AsyncToolObject");
        if self.user_tools.contains_key(&tool_object.name) {
            panic!(
                "{}",
                ToolSetCreationError::NameConflict(tool_object.name.clone())
            );
        } else {
            self.user_tools
                .insert(tool_object.name.clone(), tool_object);
        }
        self.add_tool::<UserTool<T>, ToolContext>()
    }

    /// Attempts to call a tool by name with the given JSON input.
    ///
    /// The tool will automatically extract its specific context from the provided
    /// `ToolSetContext` using the `FromRef` implementation captured when the tool
    /// was added.
    ///
    /// Returns an error if the tool is not found or if deserialization fails.
    #[tracing::instrument(err, skip(self, context, request_context))]
    pub async fn try_tool_call(
        &self,
        context: ToolSetContext,
        request_context: RequestContext,
        tool_name: &str,
        json: &serde_json::Value,
    ) -> Result<ToolResult<serde_json::Value>, ToolSetError> {
        let tool = self
            .tools
            .get(tool_name)
            .ok_or_else(|| ToolSetError::NotFound(tool_name.to_owned()))
            .and_then(|tool| {
                tool.try_deserialize(json)
                    .map_err(ToolSetError::Deserialization)
            })?;
        Ok(tool.call(context, request_context).await)
    }

    /// this isn't called in the tool loop it's calle by the user-facing API
    #[tracing::instrument(err, skip(self, context, request_context))]
    pub async fn try_user_tool_call(
        &self,
        context: ToolSetContext,
        request_context: RequestContext,
        tool_name: &str,
        json: &serde_json::Value,
    ) -> Result<ToolResult<serde_json::Value>, ToolSetError> {
        let tool = self
            .user_tools
            .get(tool_name)
            .ok_or_else(|| ToolSetError::NotFound(tool_name.to_owned()))
            .and_then(|tool| {
                tool.try_deserialize(json)
                    .map_err(ToolSetError::Deserialization)
            })?;
        Ok(tool.call(context, request_context).await)
    }

    /// Merges a subtoolset with a narrower context into this toolset.
    ///
    /// The subtoolset's context type (`SubContext`) must be derivable from this
    /// toolset's context (`ToolSetContext`) via `FromRef`. Each tool from the
    /// subtoolset is widened to work with the parent context before being added.
    ///
    /// Returns an error if any tool names conflict between the two toolsets.
    ///
    /// # Example
    ///
    /// ```
    /// use ai_toolset::{AsyncTool, AsyncToolSet, RequestContext, ServiceContext, ToolResult};
    /// use axum_macros::FromRef;
    /// use schemars::JsonSchema;
    /// use serde::{Deserialize, Serialize};
    /// use std::sync::Arc;
    ///
    /// // Narrower context for a subset of tools
    /// #[derive(Clone)]
    /// struct SubContext {
    ///     sub_api: Arc<String>,
    /// }
    ///
    /// // Broader parent context that contains SubContext
    /// #[derive(Clone, FromRef)]
    /// struct ParentContext {
    ///     sub: SubContext,
    ///     other_api: Arc<String>,
    /// }
    ///
    /// // A tool that works with SubContext
    /// #[derive(JsonSchema, Deserialize)]
    /// #[schemars(title = "SubTool", description = "A tool using SubContext")]
    /// struct SubTool { value: String }
    ///
    /// #[async_trait::async_trait]
    /// impl AsyncTool<SubContext> for SubTool {
    ///     type Output = serde_json::Value;
    ///     async fn call(&self, ctx: ServiceContext<SubContext>, _req: RequestContext) -> ToolResult<Self::Output> {
    ///         Ok(serde_json::json!({"value": self.value, "api": *ctx.sub_api}))
    ///     }
    /// }
    ///
    /// // Build a subtoolset with the narrower context
    /// let sub_toolset = AsyncToolSet::<SubContext>::new()
    ///     .add_tool::<SubTool, SubContext>();
    ///
    /// // Merge into parent toolset - tools are automatically widened
    /// let parent_toolset = AsyncToolSet::<ParentContext>::new()
    ///     .add_subtoolset::<SubContext>(sub_toolset);
    ///
    /// assert!(parent_toolset.tools.contains_key("SubTool"));
    /// ```
    #[tracing::instrument(skip_all)]
    pub fn add_subtoolset<SubContext>(mut self, subtoolset: AsyncToolSet<SubContext>) -> Self
    where
        SubContext: FromRef<ToolSetContext> + Send + Sync + 'static,
    {
        for (name, tool) in subtoolset.tools {
            if self.tools.contains_key(&name) {
                panic!("{}", ToolSetCreationError::NameConflict(name));
            }
            let widened = tool.widen::<ToolSetContext>();
            self.tools.insert(name, widened);
        }
        self
    }
}
