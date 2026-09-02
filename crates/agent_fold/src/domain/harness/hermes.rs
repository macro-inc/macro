//! Nous Research's Hermes agent (`agentInfo.name = "hermes-agent"`).
//!
//! Writes no `_meta` on tool frames (only `_meta.hermes.*` on session-info
//! and replayed message chunks). Its delegation tool is `delegate_task`,
//! which its ACP adapter reports as kind `execute` - not `think` - with no
//! `rawInput` and no `rawOutput`; everything is in the title and the content
//! text:
//!
//! - title: `delegate: <goal…>`, `delegate batch (N tasks)`, or
//!   `delegate task`
//! - opening content: `Delegating task:\n<goal>`
//! - completion content: the dispatch JSON, a `Delegation results: …` block,
//!   or `Delegation failed: <error>`
//!
//! The subagent's own calls are not streamed to the parent.

use agent_client_protocol::schema::v1::{Meta, ToolKind};
use lazy_regex::{regex_captures, regex_is_match};
use serde_json::Value;

use super::{HarnessReader, SubagentInput, generic};
use crate::domain::model::{SubagentResult, ToolName};

/// Reader for Hermes's conventions.
pub struct Hermes;

impl HarnessReader for Hermes {
    /// The title is the only name there is; strip the goal off it so the
    /// call reads as the tool it is.
    fn harness_tool_name(&self, _meta: Option<&Meta>, title: &str) -> Option<ToolName> {
        is_delegation_title(title).then(|| ToolName::native("delegate_task"))
    }

    fn is_subagent(&self, name: &ToolName, kind: ToolKind, _meta: Option<&Meta>) -> bool {
        name.display() == "delegate_task" || generic::is_subagent(name, kind)
    }

    fn subagent_input(&self, raw_input: Option<&Value>, title: &str) -> SubagentInput {
        let mut input = generic::subagent_input(raw_input);
        if input.prompt.is_none()
            && let Some((_, goal)) = regex_captures!(r"^delegate:\s*(.+)$", title)
        {
            input.prompt = Some(goal.to_owned());
        }
        if input.description.is_none() && is_delegation_title(title) {
            input.description = Some(title.to_owned());
        }
        input
    }

    fn subagent_result(
        &self,
        _meta: Option<&Meta>,
        _raw_input: Option<&Value>,
        raw_output: Option<&Value>,
        content_text: Option<&str>,
    ) -> Option<SubagentResult> {
        let mut result = generic::subagent_result(raw_output, content_text)?;
        if let Some(text) = result.text.as_deref()
            && let Some((_, error)) = regex_captures!(r"^Delegation failed:\s*(.+)$", text)
        {
            result.error = Some(error.to_owned());
            result.text = None;
        }
        Some(result)
    }
}

fn is_delegation_title(title: &str) -> bool {
    regex_is_match!(r"^delegate(:| batch \(\d+ tasks?\)| task$)", title)
}
