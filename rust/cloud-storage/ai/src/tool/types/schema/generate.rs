use crate::tool::AsyncToolSet;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Serialize, Deserialize, Clone, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ToolSchema {
    pub name: String,
    pub input_schema: serde_json::Value,
    pub output_schema: serde_json::Value,
}

#[derive(Serialize, Deserialize, Clone, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ToolSchemas {
    pub schemas: Vec<ToolSchema>,
}

pub trait ToolSchemaGenerator {
    fn generate_schemas(&self) -> ToolSchemas;
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

impl<C, R> ToolSchemaGenerator for AsyncToolSet<C, R> {
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
