//! Tool calls: opening a part for one and patching it as updates arrive.

use std::path::PathBuf;

use crate::domain::error::FoldError;
use crate::domain::harness::{
    self, HarnessReader, ToolFrame, ToolShape, command_from_raw_input, file_edit_from_raw_input,
};
use crate::domain::model::{
    AnsiText, FileDiff, MessagePart, ToolDetail, ToolName, ToolUseId, UserToolOutcome,
};
use agent_client_protocol::schema::v1::{
    ToolCall, ToolCallContent, ToolCallLocation, ToolCallUpdate, ToolKind,
};

use super::convert::tool_kind_name;
use super::state::{Changed, FoldState, ToolPath};
use super::subagent::{patch_subagent_detail, subagent_detail};

impl FoldState {
    /// Handle a `tool_call`: add a new tool part.
    pub(super) fn open_tool_call(&mut self, call: ToolCall) -> Option<Changed> {
        let id = ToolUseId(call.tool_call_id.0.to_string());
        let reader = self.reader();
        let frame = ToolFrame::of_call(&call);
        let name = harness::tool_name(reader, &frame);

        // Whose shape the call is in is decided here, once; a patch finds the
        // detail it opened with and reads into that.
        let detail = match harness::tool_shape(reader, &name, &frame) {
            ToolShape::Harness => tool_detail(reader, &frame),
            ToolShape::Macro(_) => macro_detail(reader, &frame),
            ToolShape::UserTool(tool) => user_tool_detail(reader, tool, &frame),
            ToolShape::Subagent => subagent_detail(reader, &name, &frame),
        };
        let tool = MessagePart::ToolUse {
            id: id.clone(),
            name,
            status: call.status.into(),
            detail,
        };

        // A repeated open for the same id patches in place rather than
        // duplicating the row. A subagent's children were pushed by their own
        // frames, which a re-announcement of the parent does not carry, so
        // they are kept - unless the re-announcement carries the child's
        // whole transcript itself, which is then the newer copy.
        if let Some(at) = self.tool_positions.get(&id).cloned() {
            let message = at.message;
            if let Some(existing @ MessagePart::ToolUse { .. }) = self.part_at_mut(&at) {
                let mut tool = tool;
                if let (Some(kept), Some(children)) = (existing.children_mut(), tool.children_mut())
                    && children.is_empty()
                {
                    children.append(kept);
                }
                *existing = tool;
            }
            return Some(Changed::updated(message));
        }

        // A call the harness attributes to a subagent nests under it.
        let (changed, at) = match self.parent_path(reader, &frame, &id) {
            Some(parent) => self.push_child_part(&parent, tool)?,
            None => {
                let (changed, position) = self.push_agent_part(tool)?;
                (
                    changed,
                    ToolPath {
                        message: changed.message,
                        path: vec![position],
                    },
                )
            }
        };
        self.tool_positions.insert(id, at);
        Some(changed)
    }

    /// Handle a `tool_call_update`: patch an existing tool part.
    ///
    /// Only fields the update actually carries are written, since
    /// `ToolCallUpdateFields` is entirely optional and a typical call is
    /// patched several times - the recordings average about four updates per
    /// call.
    pub(super) fn patch_tool_call(&mut self, update: ToolCallUpdate) -> Option<Changed> {
        let id = ToolUseId(update.tool_call_id.0.to_string());
        let reader = self.reader();

        let Some(at) = self.tool_positions.get(&id).cloned() else {
            self.warn(FoldError::PatchBeforeOpen { tool_call: id });
            return None;
        };
        let message = at.message;
        let Some(MessagePart::ToolUse {
            name,
            status,
            detail,
            ..
        }) = self.part_at_mut(&at)
        else {
            return None;
        };

        let frame = ToolFrame::of_update(&update);
        if let Some(new_status) = frame.status {
            *status = new_status;
        }
        // Readers see the status the call is in once this update lands, so
        // "has it finished" is answered the same on a patch that carries a
        // status and on one that follows it.
        let frame = frame.with_status(*status);

        // A harness-supplied name outranks any ACP title, so a title alone
        // only fills a name nothing better has set.
        if let Some(found) = reader.reported_tool_name(&frame) {
            *name = found;
        } else if let Some(title) = frame.title
            && name.is_empty()
        {
            *name = title.parse().unwrap_or_else(|never| match never {});
        }

        match detail {
            ToolDetail::Macro { .. } | ToolDetail::UserTool { .. } => {
                patch_macro_detail(reader, name, detail, &frame);
            }
            ToolDetail::Subagent { .. } => patch_subagent_detail(reader, name, detail, &frame),
            _ => patch_detail(reader, detail, &frame),
        }

        Some(Changed::updated(message))
    }
}

/// Build a [`ToolDetail`] from a tool call's opening frame.
pub(super) fn tool_detail(reader: &dyn HarnessReader, frame: &ToolFrame<'_>) -> ToolDetail {
    let content = frame.content.unwrap_or_default();
    let locations = frame.locations.unwrap_or_default();
    match frame.kind.unwrap_or_default() {
        ToolKind::Execute => ToolDetail::Terminal {
            command: command_from_raw_input(frame.raw_input),
            output: reader.terminal_output(frame).map(AnsiText),
            exit_code: reader.terminal_exit_code(frame),
        },
        ToolKind::Edit => ToolDetail::Edit {
            diffs: edit_diffs(content, frame.raw_input),
        },
        ToolKind::Read => ToolDetail::Read {
            paths: location_paths(locations),
        },
        ToolKind::Delete => ToolDetail::Delete {
            paths: location_paths(locations),
        },
        ToolKind::Move => ToolDetail::Move {
            paths: location_paths(locations),
        },
        ToolKind::Search => ToolDetail::Search {
            paths: location_paths(locations),
            output: frame.content_text(),
        },
        ToolKind::Fetch => ToolDetail::Fetch {
            output: frame.content_text(),
        },
        ToolKind::Think => ToolDetail::Think {
            output: frame.content_text(),
        },
        other => ToolDetail::Other {
            kind: tool_kind_name(other).to_owned(),
            output: frame.content_text(),
            input: frame.raw_input.cloned(),
        },
    }
}

/// Build the detail for a Macro tool from its opening frame: its input as
/// given, its output out of the harness's wrapper.
pub(super) fn macro_detail(reader: &dyn HarnessReader, frame: &ToolFrame<'_>) -> ToolDetail {
    let (output, error) = match frame.raw_output.map(|raw| reader.unwrap_tool_output(raw)) {
        None => (None, None),
        Some((value, error)) => (Some(value), error),
    };
    ToolDetail::Macro {
        input: frame.raw_input.cloned().unwrap_or(serde_json::Value::Null),
        output,
        error,
    }
}

/// Build the detail for a Macro user tool from its opening frame.
///
/// A user tool starts [`UserToolOutcome::Pending`] whether or not the frame
/// carried output: the backend's `"PendingUserExecution"` reads as pending
/// too, and a frame with nothing yet is a call still being made.
pub(super) fn user_tool_detail(
    reader: &dyn HarnessReader,
    tool: &str,
    frame: &ToolFrame<'_>,
) -> ToolDetail {
    ToolDetail::UserTool {
        input: frame.raw_input.cloned().unwrap_or(serde_json::Value::Null),
        outcome: frame.raw_output.map_or(UserToolOutcome::Pending, |raw| {
            harness::user_tool_outcome(reader, tool, raw)
        }),
    }
}

/// Write an update's raw input and output into a Macro tool's detail.
///
/// Both replace rather than merge: a harness sends the arguments whole each
/// time, and so does the session API that later records what the user did
/// with a user tool.
pub(super) fn patch_macro_detail(
    reader: &dyn HarnessReader,
    name: &ToolName,
    detail: &mut ToolDetail,
    frame: &ToolFrame<'_>,
) {
    match detail {
        ToolDetail::Macro {
            input,
            output,
            error,
        } => {
            if let Some(found) = frame.raw_input {
                *input = found.clone();
            }
            if let Some(raw) = frame.raw_output {
                let (value, failure) = reader.unwrap_tool_output(raw);
                *output = Some(value);
                *error = failure;
            }
        }
        ToolDetail::UserTool { input, outcome } => {
            if let Some(found) = frame.raw_input {
                *input = found.clone();
            }
            if let Some(raw) = frame.raw_output {
                // The detail says this is a user tool, so the name's short
                // form is the tool's: `SendEmail` whether the harness wrote it
                // bare or as `mcp__macro__SendEmail`.
                *outcome = harness::user_tool_outcome(reader, name.display(), raw);
            }
        }
        _ => {}
    }
}

/// Write an update's fields into an existing detail, leaving what it does not
/// carry untouched.
pub(super) fn patch_detail(
    reader: &dyn HarnessReader,
    detail: &mut ToolDetail,
    frame: &ToolFrame<'_>,
) {
    match detail {
        ToolDetail::Terminal {
            command,
            output,
            exit_code,
        } => {
            if let Some(found) = command_from_raw_input(frame.raw_input) {
                *command = Some(found);
            }
            // Each update carries the output accumulated so far, so replace.
            if let Some(found) = reader.terminal_output(frame) {
                *output = Some(AnsiText(found));
            }
            if let Some(found) = reader.terminal_exit_code(frame) {
                *exit_code = Some(found);
            }
        }
        ToolDetail::Edit { diffs: existing } => {
            if let Some(content) = frame.content {
                let found = diffs(content);
                if !found.is_empty() {
                    *existing = found;
                }
            }
            // A call that never reports a diff block (Claude Code's `Write`)
            // may still deliver its raw input on a later update.
            if existing.is_empty()
                && let Some(found) = synthesized_edit_diff(frame.raw_input)
            {
                *existing = vec![found];
            }
        }
        ToolDetail::Read { paths } | ToolDetail::Delete { paths } | ToolDetail::Move { paths } => {
            if let Some(found) = frame.locations.map(location_paths)
                && !found.is_empty()
            {
                *paths = found;
            }
        }
        ToolDetail::Search { paths, output } => {
            if let Some(found) = frame.locations.map(location_paths)
                && !found.is_empty()
            {
                *paths = found;
            }
            if let Some(found) = frame.content_text() {
                *output = Some(found);
            }
        }
        ToolDetail::Fetch { output } | ToolDetail::Think { output } => {
            if let Some(found) = frame.content_text() {
                *output = Some(found);
            }
        }
        ToolDetail::Other { input, output, .. } => {
            if let Some(found) = frame.raw_input {
                *input = Some(found.clone());
            }
            if let Some(found) = frame.content_text() {
                *output = Some(found);
            }
        }
        // Patched by `patch_macro_detail` / `patch_subagent_detail`, which
        // have the name and the harness's result shapes to hand.
        ToolDetail::Macro { .. } | ToolDetail::UserTool { .. } | ToolDetail::Subagent { .. } => {}
    }
}

/// An edit call's diffs: the reported diff blocks, or — for calls that never
/// report one, like Claude Code's `Write` — a whole-file diff synthesized
/// from the raw input.
pub(super) fn edit_diffs(
    content: &[ToolCallContent],
    raw_input: Option<&serde_json::Value>,
) -> Vec<FileDiff> {
    let found = diffs(content);
    if !found.is_empty() {
        return found;
    }
    synthesized_edit_diff(raw_input).into_iter().collect()
}

/// A whole-file diff from `{filePath, content}` raw input. The prior contents
/// are not on the wire, so the file reads as new.
pub(super) fn synthesized_edit_diff(raw_input: Option<&serde_json::Value>) -> Option<FileDiff> {
    let (path, content) = file_edit_from_raw_input(raw_input)?;
    Some(FileDiff {
        path: path.into(),
        old_text: None,
        new_text: content,
    })
}

/// The diffs among a tool call's content blocks.
pub(super) fn diffs(content: &[ToolCallContent]) -> Vec<FileDiff> {
    content
        .iter()
        .filter_map(|block| match block {
            ToolCallContent::Diff(diff) => Some(FileDiff {
                path: diff.path.clone(),
                old_text: diff.old_text.clone(),
                new_text: diff.new_text.clone(),
            }),
            _ => None,
        })
        .collect()
}

/// The paths among a tool call's reported locations.
///
/// The one source this fold trusts for "what path did this call touch" -
/// `locations` is ACP's own field, meant for exactly this, unlike `rawInput`,
/// whose keys are a harness's own convention with no fixed shape to read.
pub(super) fn location_paths(locations: &[ToolCallLocation]) -> Vec<PathBuf> {
    locations
        .iter()
        .map(|location| location.path.clone())
        .collect()
}
