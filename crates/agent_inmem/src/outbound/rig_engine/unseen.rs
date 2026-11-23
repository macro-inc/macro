//! What a turn of a session nobody watches ([`ReplyDelivery::Unseen`], a
//! routine draft) is given: a short prompt for working out of sight, and code
//! mode's three tools with nothing to present, in place of a conversation's
//! guidance, review cards, user tools and tool catalog.
//!
//! [`ReplyDelivery::Unseen`]: crate::domain::engine::ReplyDelivery::Unseen

use super::turn_code_tools::TurnCodeTools;
use agent_code_mode::domain::CodeModeKind;
use ai_toolset::{RequestContext, SearchableTool, ToolCallFuture, ToolInfo, ToolSet, ToolSetError};

use crate::domain::mcp::CODE_MODE_MCP_TOOLS;

/// The shared system block: who the agent is, out of sight, and how code mode
/// works, with no conversation to write for.
pub(super) const PROMPT: &str = include_str!("unseen.md");

/// Where [`PROMPT`]'s code-mode section starts; a dialect turn replaces it.
const CODE_MODE_SECTION: &str = "# Code Mode\n";

/// Phrases before the code-mode section that name a TypeScript SDK call,
/// and their dialect wording.
pub(super) const DIALECT_SWAPS: [(&str, &str); 1] = [(
    "(`macro.workspace`)",
    "(`tools.storage.post_items_soup_ast`)",
)];

/// [`PROMPT`] for a dialect turn ([`CodeModeKind::Dialect`]): the same
/// shared rules, with the dialect's code-mode section and every SDK call
/// swapped for its operation. A test fails when a swapped phrase is gone.
pub(super) static DIALECT_PROMPT: std::sync::LazyLock<String> = std::sync::LazyLock::new(|| {
    let head = PROMPT
        .find(CODE_MODE_SECTION)
        .map_or(PROMPT, |start| &PROMPT[..start]);
    let head = DIALECT_SWAPS
        .iter()
        .fold(head.to_owned(), |text, (from, to)| text.replace(from, to));
    format!("{head}{}", include_str!("unseen_dialect.md"))
});

/// The shared prompt of an unseen turn of `kind`.
pub(super) fn prompt(kind: CodeModeKind) -> &'static str {
    match kind {
        CodeModeKind::TypeScript => PROMPT,
        CodeModeKind::Dialect => DIALECT_PROMPT.as_str(),
    }
}

const EXECUTE_CODE: &str = "mcp__macro_internal__ExecuteCode";

/// Code mode's tools out of a session's MCP servers, and nothing else. In
/// a TypeScript turn, `ExecuteCode` goes out without its reviews, views and
/// the PresentView schema: nobody would see what they present. A dialect
/// turn's goes out as listed.
pub(super) struct CodeModeOnly {
    tools: TurnCodeTools,
    execute_code: Option<String>,
}

impl CodeModeOnly {
    pub(super) fn new(tools: TurnCodeTools, kind: CodeModeKind) -> Self {
        Self {
            tools,
            execute_code: match kind {
                CodeModeKind::TypeScript => {
                    Some(agent_code_mode::inbound::toolset::unseen_execute_code_description())
                }
                CodeModeKind::Dialect => None,
            },
        }
    }
}

impl<Context: Send + Sync + 'static> ToolSet<Context> for CodeModeOnly {
    fn dispatch_tool_call<'a>(
        &'a self,
        context: Context,
        request_context: RequestContext,
        tool_name: &'a str,
        json: &'a serde_json::Value,
    ) -> ToolCallFuture<'a> {
        if !CODE_MODE_MCP_TOOLS.contains(&tool_name) {
            return Box::pin(std::future::ready(Err(ToolSetError::NotFound(
                tool_name.to_owned(),
            ))));
        }
        self.tools
            .dispatch_tool_call(context, request_context, tool_name, json)
    }

    fn request_schemas(&self) -> Option<Vec<ai_toolset::RequestSchema>> {
        None
    }

    /// The code tools, advertised by the caller as eager tools.
    fn searchable_catalog(&self) -> Vec<SearchableTool> {
        ToolSet::<Context>::searchable_catalog(&self.tools)
            .into_iter()
            .filter(|tool| CODE_MODE_MCP_TOOLS.contains(&tool.name.as_str()))
            .map(|tool| SearchableTool {
                description: match &self.execute_code {
                    Some(unseen) if tool.name == EXECUTE_CODE => unseen.clone(),
                    _ => tool.description,
                },
                ..tool
            })
            .collect()
    }

    fn routing_description<'a>(&'a self, tool_name: &'a str) -> Option<ToolInfo> {
        ToolSet::<Context>::routing_description(&self.tools, tool_name)
    }
}
