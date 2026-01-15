use crate::AsyncToolSet;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// Schema information for a single tool, serializable for API responses.
#[derive(Serialize, Deserialize, Clone, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ToolSchema {
    /// The name of the tool.
    pub name: String,
    /// The JSON schema for the tool's input parameters.
    pub input_schema: serde_json::Value,
    /// The JSON schema for the tool's output.
    pub output_schema: serde_json::Value,
}

/// A collection of tool schemas, typically used for API responses.
#[derive(Serialize, Deserialize, Clone, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ToolSchemas {
    /// The list of tool schemas.
    pub schemas: Vec<ToolSchema>,
}

/// Trait for types that can generate tool schemas.
///
/// Implement this trait to provide schema information about available tools.
pub trait ToolSchemaGenerator {
    /// Generates the schemas for all tools in this generator.
    fn generate_schemas(&self) -> ToolSchemas;

    /// Merges this generator's schemas with another generator's schemas.
    fn merge(&self, generator: &dyn ToolSchemaGenerator) -> ToolSchemas {
        let mut schemas = self.generate_schemas();
        schemas
            .schemas
            .append(&mut generator.generate_schemas().schemas);
        schemas
    }
}

impl ToolSchemaGenerator for ToolSchemas {
    fn generate_schemas(&self) -> ToolSchemas {
        self.clone()
    }
}

impl<Context> ToolSchemaGenerator for AsyncToolSet<Context> {
    fn generate_schemas(&self) -> ToolSchemas {
        let schemas = self
            .tools
            .iter()
            .map(|(name, tool_object)| ToolSchema {
                name: name.clone(),
                input_schema: tool_object.input_schema.clone(),
                output_schema: tool_object.output_schema.clone(),
            })
            .collect();
        ToolSchemas { schemas }
    }
}
