//! **Attio MCP stand-in (synthetic records, ASSUMED output shape) — not
//! Attio.**
//!
//! An MCP server offering the five tools an import calls, over a fixed
//! synthetic workspace (`standin/workspace.json`: five companies, three
//! people, three deals, two members, five deal stages), in the same ASSUMED
//! shapes `outbound/client/wire.rs` decodes. `list-records` pages for real
//! by `limit` and `offset`. It proves the importer end to end against an
//! assumption, never against Attio itself.

use std::sync::Arc;

use rmcp::model::{
    CallToolRequestParams, CallToolResponse, CallToolResult, ContentBlock, ErrorData,
    Implementation, ListToolsResult, PaginatedRequestParams, ServerCapabilities, ServerConfig,
    Tool,
};
use rmcp::service::{RequestContext, RoleServer};
use serde::Deserialize;
use serde_json::{Map, Value, json};

use crate::domain::Object;

#[cfg(test)]
mod test;

/// What the stand-in calls itself everywhere it is seen.
pub const LABEL: &str = "Attio MCP stand-in (synthetic records, ASSUMED output shape) — not Attio";

/// The synthetic workspace served.
const WORKSPACE: &str = include_str!("standin/workspace.json");

/// REST's default page size, used when a call names no limit.
const DEFAULT_LIMIT: u32 = 500;

const WHOAMI: &str = "whoami";
const LIST_OBJECTS: &str = "list-objects";
const LIST_ATTRIBUTE_DEFINITIONS: &str = "list-attribute-definitions";
const LIST_WORKSPACE_MEMBERS: &str = "list-workspace-members";
const LIST_RECORDS: &str = "list-records";

/// The stand-in server. Deals are turned on and pages are as long as asked
/// unless set otherwise.
#[derive(Debug, Clone)]
pub struct AttioStandin {
    deals: bool,
    page_cap: Option<u32>,
}

impl Default for AttioStandin {
    fn default() -> Self {
        Self::new()
    }
}

impl AttioStandin {
    /// The synthetic workspace, deals turned on, pages uncapped.
    pub fn new() -> Self {
        Self {
            deals: true,
            page_cap: None,
        }
    }

    /// The workspace has not turned deals on: `list-objects` leaves them out
    /// and deals calls fail as an unknown object.
    pub fn without_deals(mut self) -> Self {
        self.deals = false;
        self
    }

    /// Serve at most `cap` records a page, whatever limit a call asks for.
    pub fn with_page_cap(mut self, cap: u32) -> Self {
        self.page_cap = Some(cap);
        self
    }

    fn object(&self, slug: &str) -> Option<Object> {
        match slug {
            "companies" => Some(Object::Companies),
            "people" => Some(Object::People),
            "deals" if self.deals => Some(Object::Deals),
            _ => None,
        }
    }

    fn answer(&self, tool: &str, arguments: Value) -> Result<CallToolResult, ErrorData> {
        let workspace: Value = serde_json::from_str(WORKSPACE).map_err(|_| {
            ErrorData::internal_error("the stand-in workspace does not parse", None)
        })?;

        let answer = match tool {
            WHOAMI => workspace["self"].clone(),
            LIST_OBJECTS => {
                let objects: Vec<Value> = workspace["objects"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter(|object| object["api_slug"] != "deals" || self.deals)
                    .cloned()
                    .collect();
                json!({ "data": objects })
            }
            LIST_WORKSPACE_MEMBERS => json!({ "data": workspace["members"] }),
            LIST_ATTRIBUTE_DEFINITIONS => {
                let Some(object) = object_argument(&arguments).and_then(|slug| self.object(slug))
                else {
                    return Ok(unknown_object());
                };
                json!({ "data": workspace["attributes"][object.slug()] })
            }
            LIST_RECORDS => {
                let Ok(page) = serde_json::from_value::<PageArguments>(arguments) else {
                    return Ok(CallToolResult::error(vec![ContentBlock::text(
                        "list-records takes object, limit and offset",
                    )]));
                };
                let Some(object) = self.object(&page.object) else {
                    return Ok(unknown_object());
                };
                let limit = match self.page_cap {
                    Some(cap) => page.limit.min(cap),
                    None => page.limit,
                };
                let records: Vec<Value> = workspace["records"][object.slug()]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .skip(usize::try_from(page.offset).unwrap_or(usize::MAX))
                    .take(usize::try_from(limit).unwrap_or(usize::MAX))
                    .cloned()
                    .collect();
                json!({ "data": records })
            }
            _ => {
                return Err(ErrorData::invalid_params(
                    format!("{LABEL} has no tool {tool}"),
                    None,
                ));
            }
        };
        Ok(CallToolResult::structured(answer))
    }
}

#[derive(Deserialize)]
struct PageArguments {
    object: String,
    #[serde(default = "default_limit")]
    limit: u32,
    #[serde(default)]
    offset: u32,
}

fn default_limit() -> u32 {
    DEFAULT_LIMIT
}

fn object_argument(arguments: &Value) -> Option<&str> {
    arguments.get("object").and_then(Value::as_str)
}

fn unknown_object() -> CallToolResult {
    CallToolResult::error(vec![ContentBlock::text(
        "Unknown or inactive object; use companies, people or an active deals object.",
    )])
}

fn tool(name: &'static str, does: &str, schema: Value) -> Tool {
    let schema = match schema {
        Value::Object(schema) => schema,
        _ => Map::new(),
    };
    Tool::new(name, format!("{LABEL}: {does}"), Arc::new(schema))
}

fn object_schema(extra: Value) -> Value {
    let mut properties = json!({
        "object": {"type": "string", "description": "companies, people or deals"}
    });
    if let (Some(properties), Value::Object(extra)) = (properties.as_object_mut(), extra) {
        properties.extend(extra);
    }
    json!({"type": "object", "properties": properties, "required": ["object"]})
}

impl rmcp::ServerHandler for AttioStandin {
    fn get_info(&self) -> ServerConfig {
        ServerConfig::new(ServerCapabilities::builder().enable_tools().build())
            .with_server_info(
                Implementation::new("attio-mcp-standin", env!("CARGO_PKG_VERSION"))
                    .with_title(LABEL),
            )
            .with_instructions(format!(
                "{LABEL}. Serves a fixed synthetic workspace for testing an importer; nothing here is real Attio data."
            ))
    }

    async fn list_tools(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> Result<ListToolsResult, ErrorData> {
        let empty = json!({"type": "object", "properties": {}});
        Ok(ListToolsResult::with_all_items(vec![
            tool(WHOAMI, "the workspace this connection reads", empty.clone()),
            tool(
                LIST_OBJECTS,
                "the workspace's active objects",
                empty.clone(),
            ),
            tool(
                LIST_ATTRIBUTE_DEFINITIONS,
                "an object's attributes, with status options",
                object_schema(json!({})),
            ),
            tool(LIST_WORKSPACE_MEMBERS, "the workspace's members", empty),
            tool(
                LIST_RECORDS,
                "one page of an object's records",
                object_schema(json!({
                    "limit": {"type": "integer", "minimum": 1},
                    "offset": {"type": "integer", "minimum": 0}
                })),
            ),
        ]))
    }

    async fn call_tool(
        &self,
        request: CallToolRequestParams,
        _context: RequestContext<RoleServer>,
    ) -> Result<CallToolResponse, ErrorData> {
        let arguments = Value::Object(request.arguments.unwrap_or_default());
        Ok(self.answer(&request.name, arguments)?.into())
    }
}
