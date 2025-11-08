use crate::tool::types::{AsyncTool, Tool, ToolResult};
use async_trait::async_trait;
use schemars::JsonSchema;
use serde::Serialize;
use serde::de::Deserialize;

use super::JsonAsyncTool;
use super::object::{ToolObject, ValidationError};
use super::tool::SyncToolObject;
use super::util::validate_tool_schema;

type AsyncToolTraitObject<Sc, Rc> =
    Box<dyn AsyncTool<Sc, Rc, Output = serde_json::Value> + Send + Sync>;
type AsyncDeserializer<Sc, Rc> = Box<
    dyn Fn(&serde_json::Value) -> Result<AsyncToolTraitObject<Sc, Rc>, serde_json::Error>
        + Send
        + Sync,
>;

pub type AsyncToolObject<Context, RequestContext> =
    ToolObject<AsyncDeserializer<Context, RequestContext>>;

impl<Sc, Rc> ToolObject<AsyncDeserializer<Sc, Rc>> {
    pub fn try_deserialize(
        &self,
        data: &serde_json::Value,
    ) -> Result<AsyncToolTraitObject<Sc, Rc>, serde_json::Error> {
        let deserializer = &self.deserializer;
        deserializer(data)
    }
}

impl<Sc, Rc> ToolObject<AsyncDeserializer<Sc, Rc>> {
    pub fn try_from_tool<T, O>() -> Result<Self, ValidationError>
    where
        T: JsonSchema
            + AsyncTool<Sc, Rc, Output = O>
            + for<'de> Deserialize<'de>
            + 'static
            + Send
            + Sync,
        O: Serialize + JsonSchema + 'static,
        Rc: Send + Sync + 'static,
        Sc: Send + Sync + 'static,
    {
        let input_schema = generate_tool_input_schema!(&T);

        let (name, description) = validate_tool_schema(&input_schema)?;

        let input_schema_json =
            serde_json::to_value(input_schema).map_err(ValidationError::JsonSerialization)?;

        let deserializer = Box::new(|data: &serde_json::Value| {
            serde_json::from_value::<T>(data.clone()).map(|tool| {
                Box::new(JsonAsyncTool::from_boxed(Box::new(tool))) as AsyncToolTraitObject<Sc, Rc>
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

impl<Sc, Rc> From<SyncToolObject<Sc, Rc>> for AsyncToolObject<Sc, Rc>
where
    Sc: Send + Sync + 'static,
    Rc: Send + Sync + 'static,
{
    fn from(value: SyncToolObject<Sc, Rc>) -> Self {
        let async_deserializer = Box::new(move |json: &serde_json::Value| {
            (value.deserializer)(json).map(|trait_obj| {
                Box::new(AsyncToolWrapper(trait_obj)) as AsyncToolTraitObject<Sc, Rc>
            })
        });

        Self {
            description: value.description,
            input_schema: value.input_schema,
            name: value.name,
            deserializer: async_deserializer,
            output_schema: value.output_schema,
        }
    }
}

pub struct AsyncToolWrapper<Sc, Rc, O>(pub Box<dyn Tool<Sc, Rc, Output = O> + Send + Sync>);

#[async_trait]
impl<Sc, Rc, O> AsyncTool<Sc, Rc> for AsyncToolWrapper<Sc, Rc, O>
where
    Rc: Send + Sync + 'static,
    Sc: Send + Sync + 'static,
    O: Serialize + 'static,
{
    type Output = O;
    async fn call(&self, service_context: Sc, request_context: Rc) -> ToolResult<O> {
        Tool::call(&*self.0, service_context, request_context)
    }
}
