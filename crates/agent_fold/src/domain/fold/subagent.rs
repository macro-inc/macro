//! Delegated agents: building a subagent's detail, patching it, and nesting
//! the calls it made under it.

use serde_json::Value;

use crate::domain::error::FoldError;
use crate::domain::harness::HarnessReader;
use crate::domain::model::{MessagePart, ToolDetail, ToolUseId};
use agent_client_protocol::schema::v1::Meta;

use super::state::{Changed, FoldState, ToolPath};

impl FoldState {
    /// Where a call the harness attributes to a parent should go: into the
    /// parent's children, if the parent is a subagent this fold has seen.
    /// A parent it has not seen is warned about and the call lands at top
    /// level rather than being dropped.
    pub(super) fn parent_path(
        &mut self,
        reader: &dyn HarnessReader,
        meta: Option<&Meta>,
        child: &ToolUseId,
    ) -> Option<ToolPath> {
        let parent = reader.parent_tool_call(meta)?;
        let Some(path) = self.tool_positions.get(&parent).cloned() else {
            self.warn(FoldError::UnknownParent {
                tool_call: child.clone(),
                parent,
            });
            return None;
        };
        let is_subagent = self
            .part_at_mut(&path)
            .is_some_and(|part| part.children_mut().is_some());
        if is_subagent {
            return Some(path);
        }
        self.warn(FoldError::UnknownParent {
            tool_call: child.clone(),
            parent,
        });
        None
    }

    /// Add `part` under the subagent at `parent`, returning where it landed.
    /// `None` only if the path no longer resolves to a subagent, which
    /// [`Self::parent_path`] has just checked.
    pub(super) fn push_child_part(
        &mut self,
        parent: &ToolPath,
        part: MessagePart,
    ) -> Option<(Changed, ToolPath)> {
        let children = self.part_at_mut(parent)?.children_mut()?;
        let index = children.len();
        children.push(part);
        let mut path = parent.path.clone();
        path.push(index);
        Some((
            Changed::updated(parent.message),
            ToolPath {
                message: parent.message,
                path,
            },
        ))
    }
}

/// The detail for a subagent call, from its opening frame.
pub(super) fn subagent_detail(
    reader: &dyn HarnessReader,
    meta: Option<&Meta>,
    title: &str,
    raw_input: Option<&Value>,
    raw_output: Option<&Value>,
    content_text: Option<&str>,
) -> ToolDetail {
    let input = reader.subagent_input(raw_input, title);
    ToolDetail::Subagent {
        agent_type: input.agent_type,
        description: input.description,
        prompt: input.prompt,
        background: input.background.unwrap_or(false),
        children: Vec::new(),
        result: reader
            .subagent_result(meta, raw_input, raw_output, content_text)
            .map(Box::new),
    }
}

/// Write an update's fields into a subagent's detail: input fields the
/// update names, and whatever result it reports merged over what is held.
pub(super) fn patch_subagent_detail(
    reader: &dyn HarnessReader,
    detail: &mut ToolDetail,
    meta: Option<&Meta>,
    title: Option<&str>,
    raw_input: Option<&Value>,
    raw_output: Option<&Value>,
    content_text: Option<&str>,
) {
    let ToolDetail::Subagent {
        agent_type,
        description,
        prompt,
        background,
        result,
        ..
    } = detail
    else {
        return;
    };
    if raw_input.is_some() || title.is_some() {
        let input = reader.subagent_input(raw_input, title.unwrap_or_default());
        if input.agent_type.is_some() {
            *agent_type = input.agent_type;
        }
        if input.description.is_some() {
            *description = input.description;
        }
        if input.prompt.is_some() {
            *prompt = input.prompt;
        }
        if let Some(found) = input.background {
            *background = found;
        }
    }
    if let Some(reported) = reader.subagent_result(meta, raw_input, raw_output, content_text) {
        match result {
            Some(existing) => existing.merge(reported),
            None => *result = Some(Box::new(reported)),
        }
    }
}
