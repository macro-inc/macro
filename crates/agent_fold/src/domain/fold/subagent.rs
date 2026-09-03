//! Delegated agents: building a subagent's detail, patching it, and nesting
//! the calls it made under it.

use serde_json::Value;

use crate::domain::error::FoldError;
use crate::domain::harness::{HarnessReader, mcp};
use crate::domain::model::{MessagePart, SubagentResult, ToolDetail, ToolName, ToolUseId};
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

/// Which delegation tool a subagent call is: the harness's own (Claude
/// Code's `Agent`, Cursor's `task`), read by its reader, or Macro's
/// `Subagent`, whose response shape is Macro's whichever harness relayed it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Delegation {
    Harness,
    MacroSubagent,
}

impl Delegation {
    /// Whether `name` delegates at all under this harness, and if so how.
    /// Macro's `Subagent` is checked by name whichever harness calls it;
    /// everything else is the reader's call.
    pub(super) fn of(
        reader: &dyn HarnessReader,
        name: &ToolName,
        kind: agent_client_protocol::schema::v1::ToolKind,
        meta: Option<&Meta>,
    ) -> Option<Self> {
        if reader.macro_tool(name).is_some_and(mcp::is_subagent_tool) {
            Some(Self::MacroSubagent)
        } else if reader.is_subagent(name, kind, meta) {
            Some(Self::Harness)
        } else {
            None
        }
    }

    /// What the subagent reported on this frame.
    fn result(
        self,
        reader: &dyn HarnessReader,
        meta: Option<&Meta>,
        raw_input: Option<&Value>,
        raw_output: Option<&Value>,
        content_text: Option<&str>,
    ) -> Option<SubagentResult> {
        match self {
            Self::Harness => reader.subagent_result(meta, raw_input, raw_output, content_text),
            Self::MacroSubagent => macro_subagent_result(reader, raw_output),
        }
    }
}

/// Macro's `Subagent` tool's result: its `{ "result" }` response, out of
/// whatever envelope the harness wrapped it in (none for Macro's own agent,
/// MCP's for the rest), or the error the envelope reported.
fn macro_subagent_result(
    reader: &dyn HarnessReader,
    raw_output: Option<&Value>,
) -> Option<SubagentResult> {
    let (value, error) = reader.unwrap_tool_output(raw_output?);
    let result = SubagentResult {
        text: mcp::subagent_response_text(&value),
        error,
        ..SubagentResult::default()
    };
    (!result.is_empty()).then_some(result)
}

/// The fields of one frame a subagent's detail is read from. A `tool_call`
/// carries all of them; a `tool_call_update` only those it patches.
pub(super) struct SubagentFrame<'frame> {
    pub meta: Option<&'frame Meta>,
    pub title: Option<&'frame str>,
    pub raw_input: Option<&'frame Value>,
    pub raw_output: Option<&'frame Value>,
    /// The content blocks' text, only once the call has finished: while it
    /// streams, Claude Code echoes the brief there.
    pub content_text: Option<&'frame str>,
}

impl SubagentFrame<'_> {
    fn result(&self, reader: &dyn HarnessReader, delegation: Delegation) -> Option<SubagentResult> {
        delegation.result(
            reader,
            self.meta,
            self.raw_input,
            self.raw_output,
            self.content_text,
        )
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
    delegation: Delegation,
    name: &ToolName,
    frame: &SubagentFrame<'_>,
) -> ToolDetail {
    let input = reader.subagent_input(frame.raw_input, frame.title.unwrap_or_default());
    ToolDetail::Subagent {
        title: subagent_title(input.description.as_deref(), input.prompt.as_deref(), name),
        agent_type: input.agent_type,
        description: input.description,
        prompt: input.prompt,
        background: input.background.unwrap_or(false),
        children: reader.subagent_transcript(frame.raw_output),
        result: frame.result(reader, delegation).map(Box::new),
    }
}

/// Write an update's fields into a subagent's detail: input fields the
/// update names, whatever result it reports merged over what is held, and
/// the child's transcript when the harness delivers one whole.
pub(super) fn patch_subagent_detail(
    reader: &dyn HarnessReader,
    delegation: Delegation,
    name: &ToolName,
    detail: &mut ToolDetail,
    frame: &SubagentFrame<'_>,
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
    let transcript = reader.subagent_transcript(frame.raw_output);
    if !transcript.is_empty() {
        *children = transcript;
    }
    if frame.raw_input.is_some() || frame.title.is_some() {
        let input = reader.subagent_input(frame.raw_input, frame.title.unwrap_or_default());
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
    if let Some(reported) = frame.result(reader, delegation) {
        match result {
            Some(existing) => existing.merge(reported),
            None => *result = Some(Box::new(reported)),
        }
    }
}
