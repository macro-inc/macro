use super::generate::{ToolSchema, ToolSchemaGenerator, ToolSchemas};
use schemars::{JsonSchema, schema_for};
use std::fmt::Debug;
use std::marker::PhantomData;

/// A phantom tool for generating schemas without runtime tool instances.
///
/// This is useful for built-in tools that are not sent to the AI but may be
/// called by the AI. The schemas can be generated for frontend display or
/// documentation purposes.
#[derive(Clone, Debug)]
pub struct PhantomTool<I: Clone + Debug, O: Clone + Debug> {
    i: PhantomData<I>,
    o: PhantomData<O>,
    /// The name of the phantom tool.
    pub name: &'static str,
}

impl<I: Clone + Debug, O: Clone + Debug> PhantomTool<I, O> {
    /// Creates a new phantom tool with the given name.
    pub fn new(name: &'static str) -> Self {
        PhantomTool {
            i: PhantomData,
            o: PhantomData,
            name,
        }
    }
}

impl<I, O> ToolSchemaGenerator for PhantomTool<I, O>
where
    I: JsonSchema + Clone + Debug,
    O: JsonSchema + Clone + Debug,
{
    fn generate_schemas(&self) -> ToolSchemas {
        let input_schema = schema_for!(I);
        let output_schema = schema_for!(O);
        let input_schema_json = serde_json::to_value(&input_schema).expect("input schema");
        let output_schema_json = serde_json::to_value(&output_schema).expect("output schema");
        ToolSchemas {
            schemas: vec![ToolSchema {
                name: self.name.to_owned(),
                input_schema: input_schema_json,
                output_schema: output_schema_json,
            }],
        }
    }
}
