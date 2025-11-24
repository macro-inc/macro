use axum::{Router, http::StatusCode, response::Json, routing::get};
use serde::Serialize;
use utoipa::ToSchema;

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ToolSchemasResponse {
    pub schemas: Vec<ToolSchema>,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ToolSchema {
    pub name: String,
    pub input_schema: serde_json::Value,
    pub output_schema: serde_json::Value,
}

pub fn tool_schemas() -> ToolSchemasResponse {
    ToolSchemasResponse {
        schemas: ai_tools::all_tools()
            .toolset
            .tools
            .iter()
            .map(|(name, tool_object)| ToolSchema {
                name: name.clone(),
                input_schema: tool_object.input_schema.clone(),
                output_schema: tool_object.output_schema.clone(),
            })
            .collect(),
    }
}

/// Get all available tool schemas as JSON Schema definitions
#[utoipa::path(
    get,
    path = "/tools/schemas",
    responses(
        (status = 200, description = "Tool schemas retrieved successfully", body = ToolSchemasResponse),
        (status = 500, description = "Internal server error")
    ),
    tag = "tools"
)]

pub async fn get_tool_schemas() -> Result<Json<ToolSchemasResponse>, StatusCode> {
    let schemas = tool_schemas();
    Ok(Json(schemas))
}

pub fn router() -> Router {
    Router::new().route("/schemas", get(get_tool_schemas))
}
