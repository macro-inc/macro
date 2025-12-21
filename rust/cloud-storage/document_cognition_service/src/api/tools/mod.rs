use ai::tool::schema::ToolSchemas;
use axum::{Router, http::StatusCode, response::Json, routing::get};

/// Get all available tool schemas as JSON Schema definitions
#[utoipa::path(
    get,
    path = "/tools/schemas",
    responses(
        (status = 200, description = "Tool schemas retrieved successfully", body = ToolSchemas),
        (status = 500, description = "Internal server error")
    ),
    tag = "tools"
)]
pub async fn get_tool_schemas() -> Result<Json<ToolSchemas>, StatusCode> {
    let schemas = ai_tools::all_tool_schemas();
    Ok(Json(schemas))
}

pub fn router() -> Router {
    Router::new().route("/schemas", get(get_tool_schemas))
}
