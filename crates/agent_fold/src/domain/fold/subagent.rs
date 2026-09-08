//! Delegated agents: building a subagent's detail, patching it, and nesting
//! the calls it made under it.

use crate::domain::error::FoldError;
use crate::domain::harness::{self, HarnessReader, ToolFrame};
use crate::domain::model::{MessagePart, ToolDetail, ToolName, ToolUseId};

use super::state::{Changed, FoldState, ToolPath};

impl FoldState {
    /// Where a call the harness attributes to a parent should go: into the
    /// parent's children, if the parent is a subagent this fold has seen.
    /// A parent it has not seen is warned about and the call lands at top
    /// level rather than being dropped.
    pub(super) fn parent_path(
        &mut self,
        reader: &dyn HarnessReader,
        frame: &ToolFrame<'_>,
        child: &ToolUseId,
    ) -> Option<ToolPath> {
        let parent = reader.parent_tool_call(frame)?;
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

/// What to call a delegation: the harness's description, else the first
/// non-empty line of the brief, else the tool's own name. Decided here, once,
/// so every reader shows the same thing and none has to fall back itself.
fn subagent_title(description: Option<&str>, prompt: Option<&str>, name: &ToolName) -> String {
    description
        .map(str::trim)
        .filter(|description| !description.is_empty())
        .or_else(|| prompt?.lines().map(str::trim).find(|line| !line.is_empty()))
        .unwrap_or_else(|| name.display())
        .to_owned()
}

/// The detail for a subagent call, from its opening frame.
pub(super) fn subagent_detail(
    reader: &dyn HarnessReader,
    name: &ToolName,
    frame: &ToolFrame<'_>,
) -> ToolDetail {
    let input = reader.subagent_input(frame);
    ToolDetail::Subagent {
        title: subagent_title(input.description.as_deref(), input.prompt.as_deref(), name),
        agent_type: input.agent_type,
        description: input.description,
        prompt: input.prompt,
        background: input.background.unwrap_or(false),
        children: reader.subagent_transcript(frame),
        result: harness::subagent_result(reader, name, frame).map(Box::new),
    }
}

/// Write an update's fields into a subagent's detail: input fields the
/// update names, whatever result it reports merged over what is held, and
/// the child's transcript when the harness delivers one whole.
pub(super) fn patch_subagent_detail(
    reader: &dyn HarnessReader,
    name: &ToolName,
    detail: &mut ToolDetail,
    frame: &ToolFrame<'_>,
) {
    let ToolDetail::Subagent {
        title,
        agent_type,
        description,
        prompt,
        background,
        children,
        result,
    } = detail
    else {
        return;
    };
    let transcript = reader.subagent_transcript(frame);
    if !transcript.is_empty() {
        *children = transcript;
    }
    if frame.raw_input.is_some() || frame.title.is_some() {
        let input = reader.subagent_input(frame);
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
        *title = subagent_title(description.as_deref(), prompt.as_deref(), name);
    }
    if let Some(reported) = harness::subagent_result(reader, name, frame) {
        match result {
            Some(existing) => existing.merge(reported),
            None => *result = Some(Box::new(reported)),
        }
    }
}
