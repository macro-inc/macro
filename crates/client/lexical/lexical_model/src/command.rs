//! Plain-data model commands and static listener indexing.
use crate::*;
use std::{any::Any, fmt, marker::PhantomData, sync::Arc};
/// Model command translated from view input or emitted by another plugin.
#[derive(Clone, PartialEq, Debug)]
pub enum Command {
    /// Upstream InsertText command.
    InsertText(String),
    /// Upstream DeleteCharacter command.
    DeleteCharacter {
        /// Edit direction.
        direction: EditDirection,
        /// Host movement answer.
        target: ModifyTarget,
    },
    /// Upstream DeleteWord command.
    DeleteWord {
        /// Edit direction.
        direction: EditDirection,
        /// Host movement answer.
        target: ModifyTarget,
        /// Character fallback movement answer.
        character_target: ModifyTarget,
    },
    /// Upstream DeleteLine command.
    DeleteLine {
        /// Edit direction.
        direction: EditDirection,
        /// Host movement answer.
        target: ModifyTarget,
        /// Character fallback movement answer.
        character_target: ModifyTarget,
    },
    /// Upstream RemoveText command.
    RemoveText,
    /// Upstream InsertParagraph command.
    InsertParagraph,
    /// Upstream InsertLineBreak command.
    InsertLineBreak {
        /// Select the start after insertion.
        select_start: bool,
    },
    /// Upstream InsertTab command.
    InsertTab,
    /// Upstream IndentContent command.
    IndentContent,
    /// Upstream OutdentContent command.
    OutdentContent,
    /// Upstream FormatText command.
    FormatText(TextFormatType),
    /// Upstream FormatElement command.
    FormatElement(ElementFormat),
    /// Upstream SelectAll command.
    SelectAll(Option<KeyEvent>),
    /// Upstream SelectionChange command.
    SelectionChange,
    /// Upstream Click command; pointer geometry stays in the view.
    Click,
    /// Upstream InsertClipboardNodes command.
    InsertClipboardNodes {
        /// Detached nodes to insert.
        nodes: Vec<NodeKey>,
        /// Selection slot to insert at.
        selection: SelectionSlot,
    },
    /// Upstream KeyDown command.
    KeyDown(KeyEvent),
    /// Upstream Key command.
    Key {
        /// Keyboard command subtype.
        command: KeyCommand,
        /// Optional host keyboard facts.
        event: Option<KeyEvent>,
    },
    /// Upstream Paste command.
    Paste(ClipboardPayload),
    /// Upstream ClearEditor command.
    ClearEditor,
    /// Upstream ClearHistory command.
    ClearHistory,
    /// Upstream Undo command.
    Undo,
    /// Upstream Redo command.
    Redo,
    /// Upstream Extension command.
    Extension(ExtensionCommand),
}
/// Keyboard command subtype.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub enum KeyCommand {
    /// Enter key action.
    Enter,
    /// Backspace key action.
    Backspace,
    /// Delete key action.
    Delete,
    /// Tab key action.
    Tab,
    /// Escape key action.
    Escape,
    /// Space key action.
    Space,
    /// ArrowUp key action.
    ArrowUp,
    /// ArrowDown key action.
    ArrowDown,
    /// ArrowLeft key action.
    ArrowLeft,
    /// ArrowRight key action.
    ArrowRight,
    /// MoveToStart key action.
    MoveToStart,
    /// MoveToEnd key action.
    MoveToEnd,
    /// Modifier key action.
    Modifier,
}
/// Keyboard facts read by model handlers.
#[derive(Clone, PartialEq, Eq, Debug, Default)]
pub struct KeyEvent {
    /// Logical key.
    pub key: Arc<str>,
    /// Physical key code.
    pub code: Arc<str>,
    /// Keyboard shift flag.
    pub shift: bool,
    /// Keyboard alt flag.
    pub alt: bool,
    /// Keyboard ctrl flag.
    pub ctrl: bool,
    /// Keyboard meta flag.
    pub meta: bool,
    /// Keyboard repeat flag.
    pub repeat: bool,
    /// Keyboard is_composing flag.
    pub is_composing: bool,
}
/// Clipboard data already read by the host.
#[derive(Clone, PartialEq, Debug, Default)]
pub struct ClipboardPayload {
    /// MIME entries in source order.
    pub data: crate::collections::IndexMap<String, String>,
    /// Host has file attachments.
    pub has_files: bool,
    /// Host-imported HTML nodes.
    pub html_nodes: Option<Vec<SerializedNode>>,
}
impl ClipboardPayload {
    /// Read one MIME entry.
    pub fn get(&self, mime: &str) -> Option<&str> {
        self.data.get(mime).map(String::as_str)
    }
}
/// Type-erased command identity, compared by its static address.
pub trait AnyCommandKey: fmt::Debug + Send + Sync + 'static {
    /// Address of the concrete key.
    fn identity(&self) -> usize;
}
/// Static identity of an application command.
pub struct CommandKey<Payload: Clone + fmt::Debug + Send + Sync + 'static> {
    name: &'static str,
    payload: PhantomData<fn() -> Payload>,
}
impl<Payload: Clone + fmt::Debug + Send + Sync + 'static> CommandKey<Payload> {
    /// Define a static command key.
    pub const fn new(name: &'static str) -> Self {
        Self {
            name,
            payload: PhantomData,
        }
    }
    /// Human-readable diagnostic name.
    pub fn name(&self) -> &'static str {
        self.name
    }
}
impl<Payload: Clone + fmt::Debug + Send + Sync + 'static> fmt::Debug for CommandKey<Payload> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_tuple("CommandKey").field(&self.name).finish()
    }
}
impl<Payload: Clone + fmt::Debug + Send + Sync + 'static> AnyCommandKey for CommandKey<Payload> {
    fn identity(&self) -> usize {
        std::ptr::from_ref(self) as usize
    }
}
/// A static key and an immutable, type-erased payload.
#[derive(Clone, Debug)]
pub struct ExtensionCommand {
    key: &'static dyn AnyCommandKey,
    payload: Arc<dyn Any + Send + Sync>,
}
impl PartialEq for ExtensionCommand {
    fn eq(&self, other: &Self) -> bool {
        self.key.identity() == other.key.identity() && Arc::ptr_eq(&self.payload, &other.payload)
    }
}
impl ExtensionCommand {
    /// Pair a static key with its typed payload.
    pub fn new<Payload: Clone + fmt::Debug + Send + Sync + 'static>(
        key: &'static CommandKey<Payload>,
        payload: Payload,
    ) -> Self {
        Self {
            key,
            payload: Arc::new(payload),
        }
    }
    /// Read the payload only for the same static key.
    pub fn payload<Payload: Clone + fmt::Debug + Send + Sync + 'static>(
        &self,
        key: &'static CommandKey<Payload>,
    ) -> Option<&Payload> {
        if self.key.identity() != key.identity() {
            return None;
        }
        self.payload.downcast_ref()
    }
}
/// Discriminant used to index listener lists.
#[derive(Clone, Copy, Debug)]
pub enum CommandKind {
    /// InsertText listener list.
    InsertText,
    /// DeleteCharacter listener list.
    DeleteCharacter,
    /// DeleteWord listener list.
    DeleteWord,
    /// DeleteLine listener list.
    DeleteLine,
    /// RemoveText listener list.
    RemoveText,
    /// InsertParagraph listener list.
    InsertParagraph,
    /// InsertLineBreak listener list.
    InsertLineBreak,
    /// InsertTab listener list.
    InsertTab,
    /// IndentContent listener list.
    IndentContent,
    /// OutdentContent listener list.
    OutdentContent,
    /// FormatText listener list.
    FormatText,
    /// FormatElement listener list.
    FormatElement,
    /// SelectAll listener list.
    SelectAll,
    /// SelectionChange listener list.
    SelectionChange,
    /// Click listener list.
    Click,
    /// InsertClipboardNodes listener list.
    InsertClipboardNodes,
    /// KeyDown listener list.
    KeyDown,
    /// Key listener list.
    Key(KeyCommand),
    /// Paste listener list.
    Paste,
    /// ClearEditor listener list.
    ClearEditor,
    /// ClearHistory listener list.
    ClearHistory,
    /// Undo listener list.
    Undo,
    /// Redo listener list.
    Redo,
    /// Extension listener list.
    Extension(&'static dyn AnyCommandKey),
}
impl PartialEq for CommandKind {
    fn eq(&self, other: &Self) -> bool {
        match (self, other) {
            (Self::Key(a), Self::Key(b)) => a == b,
            (Self::Extension(a), Self::Extension(b)) => a.identity() == b.identity(),
            _ => std::mem::discriminant(self) == std::mem::discriminant(other),
        }
    }
}
impl Eq for CommandKind {}
impl std::hash::Hash for CommandKind {
    fn hash<Hasher: std::hash::Hasher>(&self, state: &mut Hasher) {
        std::mem::discriminant(self).hash(state);
        match self {
            Self::Key(key) => key.hash(state),
            Self::Extension(key) => key.identity().hash(state),
            _ => {}
        }
    }
}
impl Command {
    /// Listener-list discriminant.
    pub fn kind(&self) -> CommandKind {
        match self {
            Self::InsertText(..) => CommandKind::InsertText,
            Self::DeleteCharacter { .. } => CommandKind::DeleteCharacter,
            Self::DeleteWord { .. } => CommandKind::DeleteWord,
            Self::DeleteLine { .. } => CommandKind::DeleteLine,
            Self::RemoveText => CommandKind::RemoveText,
            Self::InsertParagraph => CommandKind::InsertParagraph,
            Self::InsertLineBreak { .. } => CommandKind::InsertLineBreak,
            Self::InsertTab => CommandKind::InsertTab,
            Self::IndentContent => CommandKind::IndentContent,
            Self::OutdentContent => CommandKind::OutdentContent,
            Self::FormatText(..) => CommandKind::FormatText,
            Self::FormatElement(..) => CommandKind::FormatElement,
            Self::SelectAll(..) => CommandKind::SelectAll,
            Self::SelectionChange => CommandKind::SelectionChange,
            Self::Click => CommandKind::Click,
            Self::InsertClipboardNodes { .. } => CommandKind::InsertClipboardNodes,
            Self::KeyDown(..) => CommandKind::KeyDown,
            Self::Key { command, .. } => CommandKind::Key(*command),
            Self::Paste(..) => CommandKind::Paste,
            Self::ClearEditor => CommandKind::ClearEditor,
            Self::ClearHistory => CommandKind::ClearHistory,
            Self::Undo => CommandKind::Undo,
            Self::Redo => CommandKind::Redo,
            Self::Extension(command) => CommandKind::Extension(command.key),
        }
    }
}

#[cfg(test)]
mod test;
