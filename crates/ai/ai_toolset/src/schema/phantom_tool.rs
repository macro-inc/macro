use super::frontend_typegen::{FrontendToolEntry, ToolSchemaGenerator};
use schemars::JsonSchema;
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
    fn register_schemas(
        &self,
        generator: &mut schemars::SchemaGenerator,
    ) -> Vec<FrontendToolEntry> {
        generator.subschema_for::<I>();
        generator.subschema_for::<O>();
        vec![FrontendToolEntry {
            name: self.name.to_owned(),
            input: I::schema_name().into_owned(),
            output: O::schema_name().into_owned(),
        }]
    }
}
