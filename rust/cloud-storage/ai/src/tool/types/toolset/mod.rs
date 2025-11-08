pub mod tool_object;
pub mod types;

use crate::tool::types::{AsyncTool, Tool, ToolResult};
use async_openai::types::ChatCompletionTool;
use schemars::{JsonSchema, Schema};
use serde::Serialize;
use serde::de::Deserialize;
use std::collections::hash_map::HashMap;
use tool_object::{AsyncToolObject, SyncToolObject};
use types::*;

pub type SyncToolSet<Context, RequestContext> = ToolSet<SyncToolObject<Context, RequestContext>>;

pub type AsyncToolSet<Context, RequestContext> = ToolSet<AsyncToolObject<Context, RequestContext>>;

pub struct ToolSchema {
    pub name: String,
    pub schema: Schema,
    pub result_schema: Schema,
}

impl ToolSchema {
    pub fn new(name: String, schema: Schema, result_schema: Schema) -> Self {
        Self {
            name,
            schema,
            result_schema,
        }
    }
}

#[derive(Default)]
pub struct ToolSet<T> {
    pub tools: HashMap<String, T>,
}

impl<T> ToolSet<T> {
    pub fn new() -> Self {
        Self {
            tools: HashMap::new(),
        }
    }
}

impl<Sc, Rc> ToolSet<SyncToolObject<Sc, Rc>>
where
    Rc: Sync + Send + 'static,
    Sc: Sync + Send + 'static,
{
    pub fn add_tool<T>(mut self) -> Result<Self, ToolSetCreationError>
    where
        T: JsonSchema + Tool<Sc, Rc> + for<'de> Deserialize<'de> + 'static + Send + Sync,
        T::Output: Serialize + JsonSchema + 'static,
    {
        let tool_object =
            SyncToolObject::try_from_tool::<T>().map_err(ToolSetCreationError::Validation)?;
        if self.tools.contains_key(&tool_object.name) {
            Err(ToolSetCreationError::NameConflict(tool_object.name.clone()))
        } else {
            self.tools.insert(tool_object.name.clone(), tool_object);
            Ok(self)
        }
    }

    pub fn try_tool_call(
        &self,
        context: Sc,
        request_context: Rc,
        tool_name: &str,
        json: &serde_json::Value,
    ) -> Result<ToolResult<serde_json::Value>, ToolCallError> {
        let tool = self
            .tools
            .get(tool_name)
            .ok_or_else(|| ToolCallError::NotFound(tool_name.to_owned()))
            .and_then(|tool| {
                tool.try_deserialize(json)
                    .map_err(ToolCallError::Deserialization)
            })?;
        Ok(tool.call(context, request_context))
    }
}

impl<T> ToolSet<T> {
    pub fn add_toolset(mut self, toolset: ToolSet<T>) -> Result<Self, ToolSetCreationError> {
        for (name, _) in toolset.tools.iter() {
            if self.tools.contains_key(name) {
                return Err(ToolSetCreationError::NameConflict(name.clone()));
            }
        }
        self.tools.extend(toolset.tools);
        Ok(self)
    }
}

impl<Sc, Rc> SyncToolSet<Sc, Rc>
where
    Sc: Send + Sync + 'static,
    Rc: Send + Sync + 'static,
{
    pub fn into_async(self) -> AsyncToolSet<Sc, Rc> {
        AsyncToolSet {
            tools: self
                .tools
                .into_iter()
                .map(|(name, obj)| (name, AsyncToolObject::from(obj)))
                .collect(),
        }
    }
}

impl<Sc, Rc> AsyncToolSet<Sc, Rc>
where
    Rc: Sync + Send + 'static,
    Sc: Sync + Send + 'static,
{
    pub fn add_tool<T>(mut self) -> Result<Self, ToolSetCreationError>
    where
        T: JsonSchema + AsyncTool<Sc, Rc> + for<'de> Deserialize<'de> + 'static + Send + Sync,
        T::Output: Serialize + JsonSchema + 'static,
    {
        let tool_object = AsyncToolObject::try_from_tool::<T, T::Output>()
            .map_err(ToolSetCreationError::Validation)?;
        if self.tools.contains_key(&tool_object.name) {
            Err(ToolSetCreationError::NameConflict(tool_object.name.clone()))
        } else {
            self.tools.insert(tool_object.name.clone(), tool_object);
            Ok(self)
        }
    }

    pub async fn try_tool_call(
        &self,
        context: Sc,
        request_context: Rc,
        tool_name: &str,
        json: &serde_json::Value,
    ) -> Result<ToolResult<serde_json::Value>, ToolCallError> {
        let tool = self
            .tools
            .get(tool_name)
            .ok_or_else(|| ToolCallError::NotFound(tool_name.to_owned()))
            .and_then(|tool| {
                tool.try_deserialize(json)
                    .map_err(ToolCallError::Deserialization)
            })?;
        Ok(tool.call(context, request_context).await)
    }
}

impl<T> ToolSet<T>
where
    ChatCompletionTool: for<'a> From<&'a T>,
{
    pub fn openai_chatcompletion_toolset(&self) -> Vec<ChatCompletionTool> {
        self.tools.values().map(ChatCompletionTool::from).collect()
    }
}

impl<T> std::fmt::Debug for ToolSet<T> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let mut list = f.debug_list();
        list.entries(self.tools.keys());
        list.finish()
    }
}

impl<T: Clone> Clone for ToolSet<T> {
    fn clone(&self) -> Self {
        Self {
            tools: self.tools.clone(),
        }
    }
}
