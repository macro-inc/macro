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

use lazy_regex::{regex_captures, regex_is_match};

use super::{HarnessReader, SubagentInput, ToolFrame, generic};
use crate::domain::model::{SubagentResult, ToolName};

/// Reader for Hermes's conventions.
pub struct Hermes;

impl HarnessReader for Hermes {
    fn announces(&self, name: &str) -> bool {
        regex_is_match!(r"(?i)hermes", name)
    }

    /// The title is the only name there is; strip the goal off it so the
    /// call reads as the tool it is.
    fn reported_tool_name(&self, frame: &ToolFrame<'_>) -> Option<ToolName> {
        is_delegation_title(frame.title?).then(|| ToolName::native("delegate_task"))
    }

    fn is_subagent(&self, name: &ToolName, frame: &ToolFrame<'_>) -> bool {
        name.display() == "delegate_task" || generic::is_subagent(name, frame)
    }

    fn subagent_input(&self, frame: &ToolFrame<'_>) -> SubagentInput {
        let mut input = generic::subagent_input(frame);
        let title = frame.title.unwrap_or_default();
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

    fn subagent_result(&self, frame: &ToolFrame<'_>) -> Option<SubagentResult> {
        let mut result = generic::subagent_result(frame)?;
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
