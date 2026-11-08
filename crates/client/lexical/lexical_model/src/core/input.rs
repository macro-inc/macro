//! Host inputs and plain-data remote edits; deliberately no wire derives.
use crate::*;
use std::{ops::Range, sync::Arc};
/// Runtime policy, with every field supplied by the host.
#[derive(Clone, Debug)]
pub struct CoreConfig {
    /// Optional local snapshot history.
    pub history: Option<HistoryConfig>,
    /// Whether selection effects should update a view.
    pub editable: bool,
    /// Requested diff groups.
    pub diff: DiffOptions,
    /// Whether to compare cached root text for effects.
    pub track_text_content: bool,
}
/// Explicit composition ownership.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Composition {
    /// No active composition.
    Idle,
    /// Composing in a text node.
    Composing {
        /// Text key.
        key: NodeKey,
    },
}
/// One model input or an explicitly batched set of inputs.
#[derive(Clone, PartialEq, Debug)]
pub enum Input {
    /// Host already changed the displayed text.
    TextFromView {
        /// Text origin.
        key: NodeKey,
        /// Displayed content.
        text: String,
        /// Optional anchor in that text.
        anchor: Option<Utf16Offset>,
        /// Optional focus in that text.
        focus: Option<Utf16Offset>,
        /// Composition termination.
        composition_end: bool,
        /// Optional composition data reported by the host.
        composition_data: Option<String>,
        /// Resolved view selection.
        selection: ViewSelection,
    },
    /// Model command, with lazy view-selection installation.
    Command {
        /// Requested command.
        command: Command,
        /// Resolved view selection.
        selection: ViewSelection,
    },
    /// Keydown plus the view-computed default mapping.
    KeyDown {
        /// Keyboard facts.
        event: KeyEvent,
        /// Default command when KeyDown is unhandled.
        routed: Option<Command>,
        /// Default key mapping prevents browser behavior.
        routed_prevent_default: bool,
        /// Resolved view selection.
        selection: ViewSelection,
    },
    /// Rebuild selection and optionally apply selectionchange policy.
    SelectionFromView {
        /// Resolved view selection.
        selection: ViewSelection,
        /// Additional selectionchange facts.
        change: Option<SelectionChangeContext>,
    },
    /// Model half of beforeinput/input insertion.
    InsertTextEvent {
        /// Event phase.
        phase: TextEventPhase,
        /// Input data.
        data: Option<String>,
        /// Plain clipboard transfer text.
        data_transfer_text: Option<String>,
        /// Host-only DOM facts.
        facts: InsertTextFacts,
        /// Last logical key.
        last_key: Option<Arc<str>>,
        /// Resolved view selection.
        selection: ViewSelection,
    },
    /// Start or end composition.
    Composition {
        /// Composition facts.
        event: CompositionEvent,
        /// Resolved view selection.
        selection: ViewSelection,
    },
    /// Apply already projected remote edits.
    ApplyRemote {
        /// Ordered changes.
        changes: Vec<NodeChange>,
        /// Tags and transform policy.
        options: UpdateOptions,
    },
    /// Offer undo to plugins, then local history.
    Undo,
    /// Offer redo to plugins, then local history.
    Redo,
    /// Parse and install a serialized state.
    SetState {
        /// Serialized tree.
        state: SerializedEditorState,
        /// Installation tags.
        tags: TagSet,
    },
    /// One transaction, flushing between elements; state replacement and nesting are forbidden.
    Batch(Vec<Input>),
}
/// Explicit host composition data.
#[derive(Clone, PartialEq, Debug)]
pub enum CompositionEvent {
    /// Start composition at the current range anchor.
    Start {
        /// Host data.
        data: String,
    },
    /// End composition, reporting its final displayed text.
    End {
        /// Text origin.
        key: NodeKey,
        /// Displayed text.
        text: String,
        /// Host anchor.
        anchor: Option<Utf16Offset>,
        /// Host focus.
        focus: Option<Utf16Offset>,
        /// Host composition data.
        data: String,
    },
}
/// Identifier local to one remote input.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub struct LocalNode(pub u32);
/// Existing key or a local created earlier in the input.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub enum NodeTarget {
    /// Existing key.
    Key(NodeKey),
    /// Batch-local creation.
    Local(LocalNode),
}
/// Raw remote tree update, with explicit ordering and no replacement/coercion hooks.
#[derive(Clone, PartialEq, Debug)]
pub enum NodeChange {
    /// Create an exact registered type without children.
    Create {
        /// Unique local id.
        local: LocalNode,
        /// Full node fields.
        json: SerializedNode,
    },
    /// Replace the complete child order.
    Children {
        /// Container.
        parent: NodeTarget,
        /// Children in order.
        children: Vec<NodeTarget>,
    },
    /// Replace raw fields, without virtual setters.
    Update {
        /// Target node.
        node: NodeTarget,
        /// Full new fields.
        json: SerializedNode,
    },
    /// Splice text by UTF-16 positions.
    SpliceText {
        /// Target text.
        node: NodeTarget,
        /// Deleted span.
        range: Range<Utf16Offset>,
        /// Inserted text.
        insert: String,
    },
    /// Remove while preserving the empty parent.
    Remove {
        /// Target node.
        node: NodeTarget,
    },
}
/// Which text insertion event is being processed.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum TextEventPhase {
    /// Before the browser edits its text.
    BeforeInput,
    /// Browser input event.
    Input,
}
/// Host-only DOM facts used by the insertion predicate.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
pub struct InsertTextFacts {
    /// Input without a matching recent beforeinput.
    pub dangling_input: bool,
    /// DOM anchor is not the backing text node.
    pub dom_anchor_not_backing_text: bool,
    /// Browser target range disagrees with its selection.
    pub target_range_mismatch: bool,
}
impl Input {
    pub(super) fn selection(&self) -> Option<&ViewSelection> {
        match self {
            Self::TextFromView { selection, .. }
            | Self::Command { selection, .. }
            | Self::KeyDown { selection, .. }
            | Self::SelectionFromView { selection, .. }
            | Self::InsertTextEvent { selection, .. }
            | Self::Composition { selection, .. } => Some(selection),
            _ => None,
        }
    }
    pub(super) fn batchable(&self) -> bool {
        !matches!(
            self,
            Self::Undo
                | Self::Redo
                | Self::SetState { .. }
                | Self::Batch(_)
                | Self::Command {
                    command: Command::Undo | Command::Redo,
                    ..
                }
        )
    }
}
