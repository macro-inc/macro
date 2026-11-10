//! Typed native definitions; remote scaffolding validates the mirror against Rust.
use crate::*;

/// Native KeyParts; fields retain their domain meaning.
#[uniffi::remote(Record)]
pub struct KeyParts {
    /// Counter generation.
    pub generation: u32,
    /// Allocation index; zero denotes the root.
    pub index: u32,
}

/// Native Point; fields retain their domain meaning.
#[uniffi::remote(Enum)]
pub enum Point {
    /// Text code-unit position.
    Text {
        /// Text node key.
        key: NodeKey,
        /// UTF-16 position.
        offset: Utf16Offset,
    },
    /// Child boundary.
    Element {
        /// Container key.
        key: NodeKey,
        /// Child position.
        offset: ChildIndex,
    },
}

/// Native ViewSelection; fields retain their domain meaning.
#[uniffi::remote(Enum)]
pub enum ViewSelection {
    /// Preserve the model selection.
    KeepModel,
    /// Clear the selection.
    None,
    /// Resolved range endpoints.
    Range {
        /// Anchor point.
        anchor: Point,
        /// Focus point.
        focus: Point,
        /// DOM resolution moved a point.
        resolution_dirty: bool,
    },
    /// Whole selected nodes.
    Node(Vec<NodeKey>),
    /// Selected table cells.
    Table {
        /// Table key.
        table: NodeKey,
        /// First cell.
        anchor_cell: NodeKey,
        /// Last cell.
        focus_cell: NodeKey,
    },
}

/// Owned native MarkedSelectionFormat for foreign callers.
#[derive(Clone, Debug, uniffi::Record)]
pub struct FfiMarkedSelectionFormat {
    /// Typing format.
    pub format: TextFormat,
    /// Typing CSS.
    pub style: String,
    /// Anchor key.
    pub key: NodeKey,
    /// Anchor offset.
    pub offset: u32,
}
uniffi::custom_type!(MarkedSelectionFormat,FfiMarkedSelectionFormat,{remote,lower:|v|FfiMarkedSelectionFormat{format:v.format,style:v.style.to_string(),key:v.key,offset:v.offset},try_lift:|v|Ok(MarkedSelectionFormat{format:v.format,style:v.style.into(),key:v.key,offset:v.offset})});

/// Native ModifyTarget; fields retain their domain meaning.
#[uniffi::remote(Enum)]
pub enum ModifyTarget {
    /// A view exists but did not provide the required movement endpoints.
    RequireView,
    /// Layout is unavailable; only structural movement runs.
    NoView,
    /// Points returned by the view.
    View {
        /// Host anchor.
        anchor: Point,
        /// Host focus.
        focus: Point,
        /// Resolution adjusted the DOM position.
        resolution_dirty: bool,
        /// Host range is reversed.
        is_backward_in_dom: bool,
    },
    /// Explicit model-only Unicode segmentation, independent of host layout.
    ModelSegmentation,
}

/// Native TextFormatType; fields retain their domain meaning.
#[uniffi::remote(Enum)]
pub enum TextFormatType {
    /// Bold formatting.
    Bold,
    /// Italic formatting.
    Italic,
    /// Strikethrough formatting.
    Strikethrough,
    /// Underline formatting.
    Underline,
    /// Code formatting.
    Code,
    /// Subscript formatting.
    Subscript,
    /// Superscript formatting.
    Superscript,
    /// Highlight formatting.
    Highlight,
    /// Lowercase formatting.
    Lowercase,
    /// Uppercase formatting.
    Uppercase,
    /// Capitalize formatting.
    Capitalize,
}

/// Native TextMode; fields retain their domain meaning.
#[uniffi::remote(Enum)]
pub enum TextMode {
    /// Normal.
    Normal,
    /// Token.
    Token,
    /// Segmented.
    Segmented,
}

/// Public native alignment names; raw model numbers render as the empty alignment.
#[derive(Clone, Copy, Debug, PartialEq, Eq, uniffi::Enum)]
pub enum FfiElementFormat {
    /// Unset.
    Unset,
    /// Left.
    Left,
    /// Start.
    Start,
    /// Center.
    Center,
    /// Right.
    Right,
    /// End.
    End,
    /// Justify.
    Justify,
}

impl From<ElementFormat> for FfiElementFormat {
    fn from(value: ElementFormat) -> Self {
        match value {
            ElementFormat::Unset | ElementFormat::Raw(_) => Self::Unset,
            ElementFormat::Left => Self::Left,
            ElementFormat::Start => Self::Start,
            ElementFormat::Center => Self::Center,
            ElementFormat::Right => Self::Right,
            ElementFormat::End => Self::End,
            ElementFormat::Justify => Self::Justify,
        }
    }
}
impl From<FfiElementFormat> for ElementFormat {
    fn from(value: FfiElementFormat) -> Self {
        match value {
            FfiElementFormat::Unset => Self::Unset,
            FfiElementFormat::Left => Self::Left,
            FfiElementFormat::Start => Self::Start,
            FfiElementFormat::Center => Self::Center,
            FfiElementFormat::Right => Self::Right,
            FfiElementFormat::End => Self::End,
            FfiElementFormat::Justify => Self::Justify,
        }
    }
}
uniffi::custom_type!(ElementFormat,FfiElementFormat,{remote,lower:|value|value.into(),try_lift:|value|Ok(value.into())});

/// Native TextDirection; fields retain their domain meaning.
#[uniffi::remote(Enum)]
pub enum TextDirection {
    /// Ltr.
    Ltr,
    /// Rtl.
    Rtl,
}

/// Native EditDirection; fields retain their domain meaning.
#[uniffi::remote(Enum)]
pub enum EditDirection {
    /// Toward the start.
    Backward,
    /// Toward the end.
    Forward,
}

/// Owned native patch; render policies remain private to the fact consumer.
#[derive(Clone, uniffi::Record)]
pub struct Diff {
    /// Node key generation.
    pub generation: u32,
    /// Chain includes a full map comparison.
    pub full_reconcile: bool,
    /// Host already displays this node's text.
    pub view_text_matches: Option<NodeKey>,
    /// Ordered operations.
    pub ops: Vec<DiffOp>,
    /// Decorators whose current facts must be consumed, including metadata-only changes.
    pub decorator_keys: Vec<NodeKey>,
}
/// Native DiffOp; fields retain their domain meaning.
#[uniffi::remote(Enum)]
pub enum DiffOp {
    /// Remove a node; a subtree root has no removed parent.
    Remove {
        /// Removed key.
        key: NodeKey,
        /// Host must detach this subtree.
        subtree_root: bool,
    },
    /// Create an element before its descendants.
    CreateElement {
        /// Created key.
        key: NodeKey,
        /// Registered type index.
        type_index: NodeTypeIndex,
        /// Element base fields.
        base: ElementProps,
        /// Own exported properties.
        props: SerializedNode,
    },
    /// Create a text node.
    CreateText {
        /// Created key.
        key: NodeKey,
        /// Registered type index.
        type_index: NodeTypeIndex,
        /// Text content.
        text: String,
        /// Text base fields.
        base: TextProps,
        /// Own exported properties.
        props: SerializedNode,
    },
    /// Create a decorator.
    CreateDecorator {
        /// Created key.
        key: NodeKey,
        /// Registered type index.
        type_index: NodeTypeIndex,
        /// Own exported properties.
        props: SerializedNode,
    },
    /// Create a line break.
    CreateLineBreak {
        /// Created key.
        key: NodeKey,
        /// Registered type index.
        type_index: NodeTypeIndex,
    },
    /// Replace a container's child order (host performs keyed moves).
    Children {
        /// Container key.
        parent: NodeKey,
        /// Complete new child order.
        children: Vec<NodeKey>,
    },
    /// Change text content.
    Text {
        /// Text node.
        key: NodeKey,
        /// New content.
        text: String,
    },
    /// Replace text base fields.
    TextProps {
        /// Text node.
        key: NodeKey,
        /// New fields.
        props: TextProps,
    },
    /// Replace element base fields.
    ElementProps {
        /// Element node.
        key: NodeKey,
        /// New fields.
        props: ElementProps,
    },
    /// Replace user-defined node properties.
    NodeProps {
        /// Node key.
        key: NodeKey,
        /// New properties.
        props: SerializedNode,
    },
    /// Replace NodeState for consumers that request it.
    State {
        /// Node key.
        key: NodeKey,
        /// Exported state fields, or no state.
        state: Option<SerializedNode>,
    },
    /// Set the consuming view's full-width decorator lifetime.
    SetDecoratorRevision {
        /// Generation-aware node identity.
        key: NodeKey,
        /// Exact unsigned 64-bit revision.
        revision: u64,
    },
}

/// Owned native TextProps for foreign callers.
#[derive(Clone, Debug, uniffi::Record)]
pub struct FfiTextProps {
    /// Format bits.
    pub format: TextFormat,
    /// Text editing mode.
    pub mode: TextMode,
    /// Text detail bits.
    pub detail: TextDetail,
    /// Inline CSS.
    pub style: String,
}
uniffi::custom_type!(TextProps,FfiTextProps,{remote,lower:|v|FfiTextProps{format:v.format,mode:v.mode,detail:v.detail,style:v.style.to_string()},try_lift:|v|Ok(TextProps{format:v.format,mode:v.mode,detail:v.detail,style:v.style.into()})});

/// Owned native ElementProps for foreign callers.
#[derive(Clone, Debug, uniffi::Record)]
pub struct FfiElementProps {
    /// Block alignment.
    pub format: ElementFormat,
    /// Virtual indentation.
    pub indent: u32,
    /// Explicit direction.
    pub direction: Option<TextDirection>,
    /// Default text format.
    pub text_format: TextFormat,
    /// Element CSS.
    pub style: String,
    /// Default text CSS.
    pub text_style: String,
}
uniffi::custom_type!(ElementProps,FfiElementProps,{remote,lower:|v|FfiElementProps{format:v.format,indent:v.indent,direction:v.direction,text_format:v.text_format,style:v.style.to_string(),text_style:v.text_style.to_string()},try_lift:|v|Ok(ElementProps{format:v.format,indent:v.indent,direction:v.direction,text_format:v.text_format,style:v.style.into(),text_style:v.text_style.into()})});

/// Native HistoryAvailability; fields retain their domain meaning.
#[uniffi::remote(Record)]
pub struct HistoryAvailability {
    /// Undo has an entry.
    pub can_undo: bool,
    /// Redo has an entry.
    pub can_redo: bool,
}

/// Native ViewOs; fields retain their domain meaning.
#[uniffi::remote(Enum)]
pub enum ViewOs {
    /// Desktop Apple platform.
    Apple,
    /// iOS platform.
    Ios,
    /// Android platform.
    Android,
    /// Other platform.
    Other,
}

/// Native CompositionEvent; fields retain their domain meaning.
#[uniffi::remote(Enum)]
pub enum CompositionEvent {
    /// Clear native composition ownership without committing displayed text.
    Clear,
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

/// Owned native KeyEvent for foreign callers.
#[derive(Clone, Debug, uniffi::Record)]
pub struct FfiKeyEvent {
    /// Logical key.
    pub key: String,
    /// Physical key code.
    pub code: String,
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
uniffi::custom_type!(KeyEvent,FfiKeyEvent,{remote,lower:|v|FfiKeyEvent{key:v.key.to_string(),code:v.code.to_string(),shift:v.shift,alt:v.alt,ctrl:v.ctrl,meta:v.meta,repeat:v.repeat,is_composing:v.is_composing},try_lift:|v|Ok(KeyEvent{key:v.key.into(),code:v.code.into(),shift:v.shift,alt:v.alt,ctrl:v.ctrl,meta:v.meta,repeat:v.repeat,is_composing:v.is_composing})});

/// Native KeyCommand; fields retain their domain meaning.
#[uniffi::remote(Enum)]
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

/// Native framework node kind.
#[uniffi::remote(Enum)]
pub enum NodeKind {
    /// A container.
    Element,
    /// UTF-16-addressable text.
    Text,
    /// An opaque leaf with virtual text content.
    Decorator,
    /// A line break.
    LineBreak,
}

/// Saved native range, including collapsed typing attributes.
#[derive(Clone, Debug, uniffi::Record)]
pub struct FfiRangeSelection {
    /// Anchor position.
    pub anchor: Point,
    /// Focus position.
    pub focus: Point,
    /// Typing format.
    pub format: TextFormat,
    /// Typing style.
    pub style: String,
}
uniffi::custom_type!(RangeSelection, FfiRangeSelection, { remote,
    lower: |v| FfiRangeSelection { anchor:v.anchor, focus:v.focus, format:v.format, style:v.style.to_string() },
    try_lift: |v| {
        let mut range = RangeSelection::new(v.anchor, v.focus);
        range.format = v.format;
        range.style = v.style.into();
        Ok(range)
    }
});
/// Native selection-change facts supplied by the view.
#[uniffi::remote(Record)]
pub struct SelectionChangeContext {
    /// Whether native endpoints share a node.
    pub dom_range_same_node: bool,
    /// Recently marked typing attributes.
    pub marked: Option<MarkedSelectionFormat>,
    /// Native anchor offset.
    pub dom_anchor_offset: u32,
    /// Native focus offset.
    pub dom_focus_offset: u32,
    /// Saved range before a native deletion.
    pub post_delete_restore: Option<RangeSelection>,
    /// Whether the view observed a triple click.
    pub triple_click: bool,
}

/// A native-first UTF-16 splice; full TextFromView remains explicit resynchronization.
#[uniffi::remote(Record)]
pub struct ViewTextDelta {
    /// Changed text node, including generation.
    pub key: NodeKey,
    /// UTF-16 start position.
    pub offset: Utf16Offset,
    /// UTF-16 code units to remove.
    pub deleted: Utf16Offset,
    /// Inserted Unicode text.
    pub inserted: String,
    /// Native anchor after the edit.
    pub anchor: Option<Utf16Offset>,
    /// Native focus after the edit.
    pub focus: Option<Utf16Offset>,
    /// Whether this finishes composition.
    pub composition_end: bool,
    /// Final composition data when supplied.
    pub composition_data: Option<String>,
    /// Host-resolved selection.
    pub selection: ViewSelection,
}
