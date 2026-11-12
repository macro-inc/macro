//! The removed `Subagent` tool, kept so saved chats that called it still render.
use ai_toolset::schema::PhantomTool;
use schemars::JsonSchema;
use serde::Serialize;

#[derive(Debug, Clone, Serialize, JsonSchema)]
#[schemars(title = "Subagent")]
pub struct Subagent {
    pub task: String,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
pub struct SubagentResponse {
    pub result: String,
}

pub fn subagent() -> PhantomTool<Subagent, SubagentResponse> {
    PhantomTool::new("Subagent")
}
