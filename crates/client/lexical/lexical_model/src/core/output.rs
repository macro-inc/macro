//! Published transitions and host effects.
use crate::*;
use smallvec::SmallVec;
use std::sync::Arc;
/// The observable result of one input.
#[derive(Clone, Debug)]
pub struct Output {
    /// Selection installed before the input runs, after view boundary resolution.
    /// Outer None means no input selection was installed; inner None clears it.
    pub installed_selection: Option<Option<Selection>>,
    /// Published commits, flattened oldest first.
    pub commits: SmallVec<[Commit; 1]>,
    /// Patch from the first previous to the last next snapshot.
    pub diff: Diff,
    /// Ordered host actions.
    pub effects: Vec<Effect>,
    /// Whether a command listener handled the input.
    pub handled: Handled,
}
/// An explicit effect for a host; the model performs no IO.
#[derive(Clone, PartialEq, Debug)]
pub enum Effect {
    /// Synchronize selection and typing attributes.
    SetViewSelection {
        /// Resolved selection to install.
        selection: ViewSelection,
        /// Range typing format, or empty.
        format: TextFormat,
        /// Range typing CSS, or empty.
        style: Arc<str>,
    },
    /// Scroll the focus into view.
    ScrollIntoView(NodeKey),
    /// Decorators were created, updated or removed.
    DecoratorsChanged(Vec<NodeKey>),
    /// Stack availability notification.
    HistoryState(HistoryAvailability),
    /// Root text changed and tracking is enabled.
    TextContentChanged,
    /// Non-range selection changed.
    SelectionChange,
    /// Prevent the browser's default action.
    PreventDefault,
    /// Host must schedule removal of an empty composition node.
    ScheduleRemoveEmptyText {
        /// Empty text node.
        key: NodeKey,
        /// Host delay in milliseconds.
        delay_ms: u32,
    },
    /// Actual keys allocated for remote local ids.
    RemoteNodesCreated(Vec<(LocalNode, NodeKey)>),
    /// Typed event emitted by a plugin.
    PluginEvent(PluginEvent),
    /// Report a failed follow-up without undoing earlier commits.
    FollowUpFailed {
        /// Failing plugin or pipeline.
        plugin: &'static str,
        /// Stable error variant.
        kind: &'static str,
        /// Diagnostic message.
        message: Arc<str>,
    },
}
/// An input failed; an earlier set_editor_state commit may already have published.
#[derive(Debug, thiserror::Error)]
#[error("{error}")]
pub struct ApplyError {
    /// Input error.
    pub error: Error,
    /// Published early commits the host must still render/project.
    pub committed: Box<SmallVec<[Commit; 1]>>,
}
pub(super) fn flatten(commit: &Commit) -> SmallVec<[Commit; 1]> {
    commit
        .chain()
        .map(|entry| {
            let mut c = entry.clone();
            c.preceding = None;
            c.following.clear();
            c
        })
        .collect()
}
/// Resolve a committed model selection into host-facing points.
pub fn view_selection(selection: Option<&Selection>) -> ViewSelection {
    match selection {
        None => ViewSelection::None,
        Some(Selection::Range(range)) => ViewSelection::Range {
            anchor: range.anchor,
            focus: range.focus,
            resolution_dirty: false,
        },
        Some(Selection::Node(nodes)) => ViewSelection::Node(nodes.keys().collect()),
        Some(Selection::Table(table)) => ViewSelection::Table {
            table: table.table,
            anchor_cell: table.anchor.key(),
            focus_cell: table.focus.key(),
        },
    }
}
