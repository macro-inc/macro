use super::generate::{ToolSchema, ToolSchemaGenerator, ToolSchemas};
use schemars::{JsonSchema, schema_for};
use std::fmt::Debug;
use std::marker::PhantomData;

/// A tool that is not sent to AI but may be called by ai (built in tools)
/// Generate schemas for these tools for the frontend
#[derive(Clone, Debug)]
pub struct PhantomTool<I: Clone + Debug, O: Clone + Debug> {
    i: PhantomData<I>,
    o: PhantomData<O>,
    pub name: &'static str,
}

impl<I: Clone + Debug, O: Clone + Debug> PhantomTool<I, O> {
    pub fn new(name: &'static str) -> Self {
        PhantomTool {
            i: PhantomData,
            o: PhantomData,
            name,
        }
    }
}

impl PhantomTool<(), ()> {
    pub fn builder(name: &'static str) -> Self {
        PhantomTool {
            i: PhantomData,
            o: PhantomData,
            name,
        }
    }
}

impl<O: Clone + Debug> PhantomTool<(), O> {
    pub fn with_input_schema<I>(self) -> PhantomTool<I, O>
    where
        I: JsonSchema + Clone + Debug,
    {
        PhantomTool {
            i: PhantomData,
            o: PhantomData,
            name: self.name,
        }
    }
}

impl<I: Clone + Debug> PhantomTool<I, ()> {
    pub fn with_output_schema<O>(self) -> PhantomTool<I, O>
    where
        O: Clone + Debug + JsonSchema,
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
