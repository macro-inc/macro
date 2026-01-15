use crate::Tool;
use schemars::JsonSchema;
use serde::Serialize;
use serde::de::Deserialize;

use super::json_tool::JsonTool;
use super::object::{ToolObject, ValidationError};
use super::util::validate_tool_schema;

type ToolTraitObject<Sc, Rc> = Box<dyn Tool<Sc, Rc, Output = serde_json::Value> + Send + Sync>;

type Deserializer<Sc, Rc> = Box<
    dyn Fn(&serde_json::Value) -> Result<ToolTraitObject<Sc, Rc>, serde_json::Error> + Send + Sync,
>;

/// Type alias for a [`ToolObject`] configured for synchronous tools.
pub type SyncToolObject<Context, RequestContext> =
    ToolObject<Deserializer<Context, RequestContext>>;

impl<Sc, Rc> ToolObject<Deserializer<Sc, Rc>> {
    /// Attempts to deserialize JSON input into a callable tool instance.
    pub fn try_deserialize(
        &self,
        data: &serde_json::Value,
    ) -> Result<ToolTraitObject<Sc, Rc>, serde_json::Error> {
        let deserializer = &self.deserializer;
        deserializer(data)
    }

    /// Creates a new [`SyncToolObject`] from a tool type.
    ///
    /// The tool type must implement [`Tool`], [`JsonSchema`], and [`Deserialize`].
    /// Returns an error if schema validation fails.
    pub fn try_from_tool<T>() -> Result<Self, ValidationError>
    where
        T: JsonSchema + Tool<Sc, Rc> + Send + Sync + for<'de> Deserialize<'de> + 'static,
        T::Output: Serialize + JsonSchema + 'static,
        Sc: 'static,
        Rc: 'static,
    {
        let schema = generate_tool_input_schema!(&T);

        let (name, description) = validate_tool_schema(&schema)?;

        let json_schema =
            serde_json::to_value(schema.clone()).map_err(ValidationError::JsonSerialization)?;

        let deserializer = Box::new(|data: &serde_json::Value| {
            serde_json::from_value::<T>(data.clone()).map(|tool| {
                Box::new(JsonTool::from_boxed(Box::new(tool))) as ToolTraitObject<Sc, Rc>
            })
        });

        let output_schema = generate_tool_output_schema!(&T::Output);

        let output_json_schema =
            serde_json::to_value(output_schema).map_err(ValidationError::JsonSerialization)?;

        Ok(Self {
            name,
            input_schema: json_schema,
            description,
            deserializer,
            output_schema: output_json_schema,
        })
    }
}
