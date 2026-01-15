use crate::AsyncTool;
use schemars::JsonSchema;
use serde::Serialize;
use serde::de::Deserialize;

use super::JsonAsyncTool;
use super::object::{ToolObject, ValidationError};
use super::util::validate_tool_schema;

type AsyncToolTraitObject<Context> =
    Box<dyn AsyncTool<Context, Output = serde_json::Value> + Send + Sync>;

type AsyncDeserializer<Context> = Box<
    dyn Fn(&serde_json::Value) -> Result<AsyncToolTraitObject<Context>, serde_json::Error>
        + Send
        + Sync,
>;

/// Type alias for a [`ToolObject`] configured for asynchronous tools.
pub type AsyncToolObject<Context> = ToolObject<AsyncDeserializer<Context>>;

impl<Context> ToolObject<AsyncDeserializer<Context>> {
    /// Attempts to deserialize JSON input into a callable async tool instance.
    pub fn try_deserialize(
        &self,
        data: &serde_json::Value,
    ) -> Result<AsyncToolTraitObject<Context>, serde_json::Error> {
        let deserializer = &self.deserializer;
        deserializer(data)
    }
}

impl<Context> ToolObject<AsyncDeserializer<Context>> {
    /// Creates a new [`AsyncToolObject`] from an async tool type.
    ///
    /// The tool type must implement [`AsyncTool`], [`JsonSchema`], and [`Deserialize`].
    /// Returns an error if schema validation fails.
    pub fn try_from_tool<T, O>() -> Result<Self, ValidationError>
    where
        T: JsonSchema
            + AsyncTool<Context, Output = O>
            + for<'de> Deserialize<'de>
            + 'static
            + Send
            + Sync,
        O: Serialize + JsonSchema + 'static,
        Context: Send + Sync + 'static,
    {
        let input_schema = generate_tool_input_schema!(&T);

        let (name, description) = validate_tool_schema(&input_schema)?;

        let input_schema_json =
            serde_json::to_value(input_schema).map_err(ValidationError::JsonSerialization)?;

        let deserializer = Box::new(|data: &serde_json::Value| {
            serde_json::from_value::<T>(data.clone()).map(|tool| {
                Box::new(JsonAsyncTool::from_boxed(Box::new(tool))) as AsyncToolTraitObject<Context>
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
