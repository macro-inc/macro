//! Tool calls: opening a part for one and patching it as updates arrive.

use std::path::PathBuf;

use crate::domain::error::FoldError;
use crate::domain::harness::{
    self, HarnessReader, command_from_raw_input, file_edit_from_raw_input, mcp,
};
use crate::domain::model::{
    AnsiText, FileDiff, MessagePart, ToolDetail, ToolName, ToolUseId, UserToolOutcome,
};
use agent_client_protocol::schema::v1::{
    Content, Meta, ToolCall, ToolCallContent, ToolCallLocation, ToolCallUpdate, ToolKind,
};

use super::convert::{content_block_text, tool_kind_name, tool_status};
use super::state::{Changed, FoldState, ToolPath};
use super::subagent::{patch_subagent_detail, subagent_detail};

impl FoldState {
    /// Handle a `tool_call`: add a new tool part.
    pub(super) fn open_tool_call(&mut self, call: ToolCall) -> Option<Changed> {
        let id = ToolUseId(call.tool_call_id.0.to_string());
        let reader = self.reader();
        let name = harness::tool_name(reader, call.meta.as_ref(), &call.title);

        // Macro's tools and subagents are chosen by name and never
        // recategorized: the kind ACP gives them is `other` (or `think`), and
        // what a reader wants is the tool's own shape, which only the name -
        // and the harness's conventions - tell us how to read.
        let detail = if let Some(tool) = reader.macro_tool(&name) {
            macro_detail(
                reader,
                tool,
                call.raw_input.as_ref(),
                call.raw_output.as_ref(),
            )
        } else if reader.is_subagent(&name, call.kind, call.meta.as_ref()) {
            // Content text is only an answer once the call has finished;
            // while it streams, Claude Code echoes the brief there.
            let finished = tool_status(call.status).is_finished();
            subagent_detail(
                reader,
                call.meta.as_ref(),
                &call.title,
                call.raw_input.as_ref(),
                call.raw_output.as_ref(),
                generic_output(&call.content)
                    .as_deref()
                    .filter(|_| finished),
            )
        } else {
            tool_detail(
                reader,
                call.kind,
                call.raw_input.as_ref(),
                &call.content,
                &call.locations,
                call.meta.as_ref(),
            )
        };
        let tool = MessagePart::ToolUse {
            id: id.clone(),
            name,
            status: tool_status(call.status),
            detail,
        };

        // A repeated open for the same id patches in place rather than
        // duplicating the row. A subagent's children were pushed by their own
        // frames, which a re-announcement of the parent does not carry, so
        // they are kept.
        if let Some(at) = self.tool_positions.get(&id).cloned() {
            let message = at.message;
            if let Some(existing @ MessagePart::ToolUse { .. }) = self.part_at_mut(&at) {
                let mut tool = tool;
                if let (Some(kept), Some(children)) = (existing.children_mut(), tool.children_mut())
                {
                    children.append(kept);
                }
                *existing = tool;
            }
            return Some(Changed::updated(message));
        }

        // A call the harness attributes to a subagent nests under it.
        let (changed, at) = match self.parent_path(reader, call.meta.as_ref(), &id) {
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

        let fields = update.fields;

        if let Some(new_status) = fields.status {
            *status = tool_status(new_status);
        }
        // A harness-supplied name outranks any ACP title, so a title alone
        // only fills a name nothing better has set.
        if let Some(found) =
            reader.harness_tool_name(update.meta.as_ref(), fields.title.as_deref().unwrap_or(""))
        {
            *name = found;
        } else if let Some(title) = fields.title.as_deref()
            && name.is_empty()
        {
            *name = title.parse().unwrap_or_else(|never| match never {});
        }

        match detail {
            ToolDetail::Macro { .. } | ToolDetail::UserTool { .. } => patch_macro_detail(
                reader,
                name,
                detail,
                fields.raw_input.as_ref(),
                fields.raw_output.as_ref(),
            ),
            ToolDetail::Subagent { .. } => {
                let finished = status.is_finished();
                patch_subagent_detail(
                    reader,
                    detail,
                    update.meta.as_ref(),
                    fields.title.as_deref(),
                    fields.raw_input.as_ref(),
                    fields.raw_output.as_ref(),
                    fields
                        .content
                        .as_deref()
                        .and_then(generic_output)
                        .as_deref()
                        .filter(|_| finished),
                );
            }
            _ => patch_detail(
                reader,
                detail,
                fields.raw_input.as_ref(),
                fields.content.as_deref(),
                fields.locations.as_deref(),
                update.meta.as_ref(),
            ),
        }

        Some(Changed::updated(message))
    }
}

/// Build a [`ToolDetail`] from a tool call's opening frame.
pub(super) fn tool_detail(
    reader: &dyn HarnessReader,
    kind: ToolKind,
    raw_input: Option<&serde_json::Value>,
    content: &[ToolCallContent],
    locations: &[ToolCallLocation],
    meta: Option<&Meta>,
) -> ToolDetail {
    match kind {
        ToolKind::Execute => ToolDetail::Terminal {
            command: command_from_raw_input(raw_input),
            output: reader.terminal_output(meta).map(AnsiText),
            exit_code: reader.terminal_exit_code(meta),
        },
        ToolKind::Edit => ToolDetail::Edit {
            diffs: edit_diffs(content, raw_input),
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
            output: generic_output(content),
        },
        ToolKind::Fetch => ToolDetail::Fetch {
            output: generic_output(content),
        },
        ToolKind::Think => ToolDetail::Think {
            output: generic_output(content),
        },
        other => ToolDetail::Other {
            kind: tool_kind_name(other).to_owned(),
            output: generic_output(content),
            input: raw_input.cloned(),
        },
    }
}

/// Build the detail for a Macro tool from its opening frame.
///
/// A user tool starts [`UserToolOutcome::Pending`] whether or not the frame
/// carried output: the backend's `"PendingUserExecution"` reads as pending
/// too, and a frame with nothing yet is a call still being made.
pub(super) fn macro_detail(
    reader: &dyn HarnessReader,
    tool: &str,
    raw_input: Option<&serde_json::Value>,
    raw_output: Option<&serde_json::Value>,
) -> ToolDetail {
    let input = raw_input.cloned().unwrap_or(serde_json::Value::Null);
    let unwrapped = raw_output.map(|raw| reader.unwrap_tool_output(raw));
    if mcp::is_user_tool(tool) {
        return ToolDetail::UserTool {
            input,
            outcome: match unwrapped {
                None => UserToolOutcome::Pending,
                Some((_, Some(error))) => UserToolOutcome::Failed { message: error },
                Some((value, None)) => mcp::user_tool_outcome(tool, &value),
            },
        };
    }
    let (output, error) = match unwrapped {
        None => (None, None),
        Some((value, error)) => (Some(value), error),
    };
    ToolDetail::Macro {
        input,
        output,
        error,
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
    raw_input: Option<&serde_json::Value>,
    raw_output: Option<&serde_json::Value>,
) {
    let tool = reader.macro_tool(name).unwrap_or_else(|| name.display());
    match detail {
        ToolDetail::Macro {
            input,
            output,
            error,
        } => {
            if let Some(found) = raw_input {
                *input = found.clone();
            }
            if let Some(raw) = raw_output {
                let (value, failure) = reader.unwrap_tool_output(raw);
                *output = Some(value);
                *error = failure;
            }
        }
        ToolDetail::UserTool { input, outcome } => {
            if let Some(found) = raw_input {
                *input = found.clone();
            }
            if let Some(raw) = raw_output {
                *outcome = match reader.unwrap_tool_output(raw) {
                    (_, Some(error)) => UserToolOutcome::Failed { message: error },
                    (value, None) => mcp::user_tool_outcome(tool, &value),
                };
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
    raw_input: Option<&serde_json::Value>,
    content: Option<&[ToolCallContent]>,
    locations: Option<&[ToolCallLocation]>,
    meta: Option<&Meta>,
) {
    match detail {
        ToolDetail::Terminal {
            command,
            output,
            exit_code,
        } => {
            if let Some(found) = command_from_raw_input(raw_input) {
                *command = Some(found);
            }
            // Each update carries the output accumulated so far, so replace.
            if let Some(found) = reader.terminal_output(meta) {
                *output = Some(AnsiText(found));
            }
            if let Some(found) = reader.terminal_exit_code(meta) {
                *exit_code = Some(found);
            }
        }
        ToolDetail::Edit { diffs: existing } => {
            if let Some(content) = content {
                let found = diffs(content);
                if !found.is_empty() {
                    *existing = found;
                }
            }
            // A call that never reports a diff block (Claude Code's `Write`)
            // may still deliver its raw input on a later update.
            if existing.is_empty()
                && let Some(found) = synthesized_edit_diff(raw_input)
            {
                *existing = vec![found];
            }
        }
        ToolDetail::Read { paths } | ToolDetail::Delete { paths } | ToolDetail::Move { paths } => {
            if let Some(found) = locations.map(location_paths)
                && !found.is_empty()
            {
                *paths = found;
            }
        }
        ToolDetail::Search { paths, output } => {
            if let Some(found) = locations.map(location_paths)
                && !found.is_empty()
            {
                *paths = found;
            }
            if let Some(found) = content.and_then(generic_output) {
                *output = Some(found);
            }
        }
        ToolDetail::Fetch { output } | ToolDetail::Think { output } => {
            if let Some(found) = content.and_then(generic_output) {
                *output = Some(found);
            }
        }
        ToolDetail::Other { input, output, .. } => {
            if let Some(found) = raw_input {
                *input = Some(found.clone());
            }
            if let Some(found) = content.and_then(generic_output) {
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

/// The text among a tool call's content blocks - e.g. search matches or a
/// fetched page's text - joined in order.
///
/// `None` when none of the blocks carry text, same as an empty result: there
/// is nothing useful to distinguish "reported nothing" from "reported an
/// empty string."
pub(super) fn generic_output(content: &[ToolCallContent]) -> Option<String> {
    let text = content
        .iter()
        .filter_map(|block| match block {
            ToolCallContent::Content(Content {
                content: block_content,
                ..
            }) => content_block_text(block_content.clone()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("");
    (!text.is_empty()).then_some(text)
}
