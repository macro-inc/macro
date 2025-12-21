use super::generate::{ToolSchema, ToolSchemaGenerator, ToolSchemas};
use schemars::{JsonSchema, schema_for};
use std::marker::PhantomData;

/// A tool that is not sent to AI but may be called by ai (built in tools)
/// Generate schemas for these tools for the frontend
pub struct PhantomTool<I, O> {
    i: PhantomData<I>,
    o: PhantomData<O>,
    pub name: String,
}

impl PhantomTool<(), ()> {
    pub fn new(name: String) -> Self {
        PhantomTool {
            i: PhantomData,
            o: PhantomData,
            name,
        }
    }
}

impl<O> PhantomTool<(), O> {
    pub fn with_input_schema<I>(self) -> PhantomTool<I, O>
    where
        I: JsonSchema,
    {
        PhantomTool {
            i: PhantomData,
            o: PhantomData,
            name: self.name,
        }
    }
}

impl<I> PhantomTool<I, ()> {
    pub fn with_output_schema<O>(self) -> PhantomTool<I, O>
    where
        O: JsonSchema,
    {
        PhantomTool {
            i: PhantomData,
            o: PhantomData,
            name: self.name,
        }
    }
}

impl<I, O> ToolSchemaGenerator for PhantomTool<I, O>
where
    I: JsonSchema,
    O: JsonSchema,
{
    fn generate_schemas(&self) -> ToolSchemas {
        let input_schema = schema_for!(I);
        let output_schema = schema_for!(O);
        let input_schema_json = serde_json::to_value(&input_schema).expect("input schema");
        let output_schema_json = serde_json::to_value(&output_schema).expect("input schema");
        ToolSchemas {
            schemas: vec![ToolSchema {
                name: self.name.clone(),
                input_schema: input_schema_json,
                output_schema: output_schema_json,
            }],
        }
    }
}
