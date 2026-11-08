//! Errors at model and configuration boundaries.
use crate::{NodeKey, Utf16Offset};

/// A failed model operation; the editor remains unchanged when an update fails.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// A development read peer attempted a guarded model write.
    #[cfg(feature = "foreign-nodes")]
    #[error("Cannot use method in read-only mode.")]
    ForeignReadOnly,
    /// A runtime state key was not registered on this editor.
    #[cfg(feature = "foreign-nodes")]
    #[error("unknown foreign state {key}")]
    UnknownForeignState {
        /// Unregistered state name.
        key: std::sync::Arc<str>,
    },
    /// An update belongs to another editor or predates a later publication.
    #[cfg(feature = "foreign-nodes")]
    #[error("stale suspended update")]
    StaleSuspendedUpdate,
    /// input cannot be batched.
    #[error("input cannot be batched")]
    InputNotBatchable,
    /// view selection supplied to headless editor.
    #[error("view selection supplied to headless editor")]
    ViewSelectionInHeadless,
    /// remote create cannot include children.
    #[error("remote create cannot include children")]
    RemoteChildrenInCreate,
    /// remote child list contains a duplicate.
    #[error("remote child list contains a duplicate")]
    DuplicateRemoteChild,
    /// invalid remote text range.
    #[error("invalid remote text range")]
    InvalidRemoteTextRange,
    /// Local target was not created earlier in this input.
    #[error("unknown remote local node {0:?}")]
    UnknownLocalNode(crate::LocalNode),
    /// One remote local id was allocated twice.
    #[error("duplicate remote local node {0:?}")]
    DuplicateLocalNode(crate::LocalNode),
    /// Initial-state follow-up failed.
    #[error("initial follow-up failed: {0}")]
    InitialFollowUpFailed(std::sync::Arc<Error>),
    /// A required extension was not installed.
    #[error("unknown extension state {type_name}")]
    UnknownExtensionState {
        /// Concrete state type.
        type_name: &'static str,
    },
    /// Post-commit hooks did not reach a fixpoint.
    #[error("One or more update listeners are endlessly enqueueing more updates")]
    EndlessFollowUps,
    /// Invalid explicit caret offset.
    #[error("invalid text offset {offset:?} for size {size:?} at {key}")]
    InvalidTextOffset {
        /// Requested position.
        offset: Utf16Offset,
        /// Available text length.
        size: Utf16Offset,
        /// Origin key.
        key: NodeKey,
    },
    /// A text point names a non-text node.
    #[error("caret text point {key} has node type {type_name}")]
    CaretFromPointNotText {
        /// Actual type.
        type_name: String,
        /// Origin key.
        key: NodeKey,
    },
    /// An element point names a non-element node.
    #[error("caret element point {key} has node type {type_name}")]
    CaretFromPointNotElement {
        /// Actual type.
        type_name: String,
        /// Origin key.
        key: NodeKey,
    },
    /// caret directions do not match.
    #[error("caret directions do not match")]
    CaretDirectionMismatch,
    /// caret origins have no common ancestor.
    #[error("caret origins have no common ancestor")]
    NoCommonAncestor,
    /// caret splice underflow.
    #[error("caret splice underflow")]
    CaretSpliceUnderflow,
    /// caret selection was lost.
    #[error("caret selection was lost")]
    RemoveTextSelectionLost,
    /// unknown selection slot.
    #[error("unknown selection slot")]
    UnknownSelectionSlot,
    /// no selection.
    #[error("no selection")]
    NoSelection,
    /// expected range selection.
    #[error("expected range selection")]
    NoRangeSelection,
    /// expected node selection.
    #[error("expected node selection")]
    NoNodeSelection,
    /// point type does not match node kind.
    #[error("point type does not match node kind")]
    PointTypeMismatch,
    /// layout is required for this movement.
    #[error("layout is required for this movement")]
    LayoutRequired,

    /// A document must have a root node at its top level.
    #[error("serialized editor state must contain a root node")]
    ExpectedSerializedRoot,
    /// A JSON node names an unregistered type.
    #[error("parseEditorState: type \"{0}\" + not found")]
    UnknownSerializedType(String),
    /// A transform keeps writing without reaching a fixpoint.
    #[error(
        "One or more transforms are endlessly triggering additional transforms. May have encountered infinite recursion caused by transforms not having loose enough preconditions and/or postconditions."
    )]
    InfiniteTransforms,
    /// A range endpoint disappeared during the update.
    #[error(
        "updateEditor: selection has been lost because the previously selected nodes have been removed and selection wasn't moved to another node. Ensure selection changes after removing/replacing a selected node."
    )]
    SelectionLost,
    /// Selection transforms found a missing text endpoint.
    #[error("Point.getNode: node not found")]
    PointNodeNotFound(NodeKey),
    /// A static flag probe disagrees with an actual instance.
    #[error("type table flags differ for {0}: set FLAGS_PER_INSTANCE")]
    TypeFlagsMismatch(&'static str),

    /// A table selection requires registered table behavior.
    #[error("unsupported selection without table hooks")]
    UnsupportedSelection,
    /// The root has no top-level ancestor.
    #[error("root is not a top-level element")]
    RootNotTopLevel,
    /// A root child has an invalid kind.
    #[error("root children must be elements or decorators")]
    RootChildNotBlock,
    /// Key numbering cannot reset while nodes remain.
    #[error("cannot reset keys while nodes remain")]
    KeyResetWithNodes,
    /// A key is absent in this snapshot.
    #[error("node {0} was not found")]
    NodeNotFound(NodeKey),
    /// An offset exceeds the text length.
    #[error("UTF-16 offset {0:?} is out of range")]
    Utf16OffsetOutOfRange(Utf16Offset),
    /// Rust strings cannot represent half a surrogate pair.
    #[error("UTF-16 offset {0:?} splits a surrogate pair")]
    Utf16OffsetSplitsSurrogatePair(Utf16Offset),
    /// The editor exhausted its key space.
    #[error("node key space exhausted")]
    KeySpaceExhausted,
    /// Node {0} is not an element.
    #[error("node {0} is not an element")]
    NotAnElement(NodeKey),
    /// Node {0} is not text.
    #[error("node {0} is not text")]
    NotAText(NodeKey),
    /// Node {0} has no parent.
    #[error("node {0} has no parent")]
    NoParent(NodeKey),
    /// Node {0} has no child.
    #[error("node {0} has no child")]
    NoChild(NodeKey),
    /// Node {0} has no mutable ancestor projection.
    #[error("node {0} has no mutable ancestor projection")]
    NoMutableUpcast(NodeKey),
    /// Node {0} has the wrong type.
    #[error("node {0} has the wrong type")]
    NodeTypeMismatch(NodeKey),
    /// Node type {0} has no default constructor.
    #[error("node type {0} has no default constructor")]
    NoDefault(&'static str),
    /// Unregistered node type {0}.
    #[error("unregistered node type {0}")]
    UnregisteredNodeType(String),
    /// Unregistered node type {0}.
    #[error("unregistered node type {0}")]
    UnregisteredNodeOnCreate(&'static str),
    /// Model invariant.
    #[error("{0}")]
    Invariant(&'static str),
    /// An invariant diagnostic containing runtime context.
    #[error("{0}")]
    InvariantMessage(String),
    /// Node payload must serialize as an object.
    #[error("node payload must serialize as an object")]
    NodePayloadNotObject,
    /// Base fields do not match the registered kind.
    #[error("base fields do not match the registered kind")]
    BaseKindMismatch,
    /// Cannot remove the root.
    #[error("cannot remove the root")]
    RemoveRoot,
    /// Cannot replace the root.
    #[error("cannot replace the root")]
    ReplaceRoot,
    /// Cannot insert before the root.
    #[error("cannot insert before the root")]
    InsertBeforeRoot,
    /// Cannot insert after the root.
    #[error("cannot insert after the root")]
    InsertAfterRoot,
    /// Only element or decorator nodes can be inserted into the root.
    #[error("only element or decorator nodes can be inserted into the root")]
    RootSpliceNonBlock,
    /// Cannot append a node to itself or its descendant.
    #[error("cannot append a node to itself or its descendant")]
    AppendSelf,
    /// Splice is outside the child range.
    #[error("splice is outside the child range")]
    SpliceOutOfRange,
    /// Including children requires two elements.
    #[error("including children requires two elements")]
    IncludeChildrenRequiresElements,
    /// Range endpoints must be siblings in document order.
    #[error("range endpoints must be siblings in document order")]
    InsertRangeAfterOrder,
    /// Cannot split the root.
    #[error("cannot split the root")]
    SplitRoot,
    /// Split ancestors must be elements.
    #[error("split ancestors must be elements")]
    RootChildrenMustBeElements,
    /// Cannot set tab text content.
    #[error("cannot set tab text content")]
    TabSetTextContent,
    /// Cannot splice tab text.
    #[error("cannot splice tab text")]
    TabSpliceText,
    /// Cannot change tab detail.
    #[error("cannot change tab detail")]
    TabSetDetail,
    /// Cannot change tab mode.
    #[error("cannot change tab mode")]
    TabSetMode,
    /// Text merge requires adjacent siblings.
    #[error("text merge requires adjacent siblings")]
    MergeWithNonSibling,
    /// State belongs to another registry.
    #[error("state belongs to another registry")]
    ForeignEditorState,
    /// Cannot install an empty editor state.
    #[error("cannot install an empty editor state")]
    SetEmptyEditorState,
    /// Cannot write after installing an editor state.
    #[error("cannot write after installing an editor state")]
    WriteAfterSetEditorState,
    /// State key collision.
    #[error("state key collision: {key}")]
    StateKeyCollision {
        /// Conflicting name.
        key: &'static str,
    },
    /// Json error.
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
}

/// Invalid editor configuration.
#[derive(Debug, thiserror::Error)]
pub enum BuildError {
    /// A runtime node declaration names a state config the builder did not register.
    #[cfg(feature = "foreign-nodes")]
    #[error("unknown foreign state {key}")]
    UnknownForeignState {
        /// Unregistered state name.
        key: &'static str,
    },
    /// Runtime parent is missing, cyclic, or has another storage kind.
    #[cfg(feature = "foreign-nodes")]
    #[error("unknown or incompatible foreign parent {parent} for {type_name}")]
    UnknownForeignParent {
        /// Runtime type being registered.
        type_name: &'static str,
        /// Parent type name.
        parent: &'static str,
    },
    /// Command behavior was installed more than once.
    #[error("plugin {name} registered twice")]
    DuplicatePlugin {
        /// Duplicate plugin diagnostic name.
        name: &'static str,
    },
    /// One state type was installed twice.
    #[error("extension state {type_name} registered twice")]
    DuplicateExtensionState {
        /// Concrete state type.
        type_name: &'static str,
    },
    /// A serialized name identifies multiple Rust types.
    #[error("node type {type_name} registered twice ({first}, {second})")]
    DuplicateNodeType {
        /// Duplicate name.
        type_name: &'static str,
        /// First class.
        first: &'static str,
        /// Second class.
        second: &'static str,
    },
    /// A terminal marker was registered.
    #[error("base marker {class_name} cannot be registered")]
    BaseMarkerRegistered {
        /// Marker class.
        class_name: &'static str,
    },
    /// Static flags cannot be determined.
    #[error("node type {type_name} has no flag probe")]
    NoFlagProbe {
        /// Missing probe's type.
        type_name: &'static str,
    },
    /// Replacement lacks original ancestry.
    #[error("{replacement} does not extend {original}")]
    ReplacementNotSubtype {
        /// Replacement name.
        replacement: &'static str,
        /// A name.
        original: &'static str,
    },
    /// A transform has no matching registered type.
    #[error("transform for unregistered node {type_name}")]
    TransformForUnregisteredType {
        /// Missing type.
        type_name: &'static str,
    },
    /// Conflicting state declarations.
    #[error("state key collision: {key}")]
    StateKeyCollision {
        /// Conflicting name.
        key: &'static str,
    },
    /// Too many registered node types.
    #[error("node type index exhausted")]
    TooManyNodeTypes,
    /// Initial state construction failed.
    #[error(transparent)]
    InitialState(#[from] Box<Error>),
}

impl Error {
    /// Preserve static or formatted upstream invariant diagnostics without leaking memory.
    pub fn invariant(message: impl Into<std::borrow::Cow<'static, str>>) -> Self {
        match message.into() {
            std::borrow::Cow::Borrowed(message) => Self::Invariant(message),
            std::borrow::Cow::Owned(message) => Self::InvariantMessage(message),
        }
    }
    /// Stable variant name for cross-boundary error classification.
    pub fn kind(&self) -> &'static str {
        match self {
            #[cfg(feature = "foreign-nodes")]
            Self::ForeignReadOnly => "ForeignReadOnly",
            #[cfg(feature = "foreign-nodes")]
            Self::StaleSuspendedUpdate => "StaleSuspendedUpdate",
            #[cfg(feature = "foreign-nodes")]
            Self::UnknownForeignState { .. } => "UnknownForeignState",
            Self::InputNotBatchable => "InputNotBatchable",
            Self::ViewSelectionInHeadless => "ViewSelectionInHeadless",
            Self::RemoteChildrenInCreate => "RemoteChildrenInCreate",
            Self::DuplicateRemoteChild => "DuplicateRemoteChild",
            Self::InvalidRemoteTextRange => "InvalidRemoteTextRange",
            Self::UnknownLocalNode(..) => "UnknownLocalNode",
            Self::DuplicateLocalNode(..) => "DuplicateLocalNode",
            Self::InitialFollowUpFailed(..) => "InitialFollowUpFailed",
            Self::UnknownExtensionState { .. } => "UnknownExtensionState",
            Self::EndlessFollowUps => "EndlessFollowUps",
            Self::InvalidTextOffset { .. } => "InvalidTextOffset",
            Self::CaretFromPointNotText { .. } => "CaretFromPointNotText",
            Self::CaretFromPointNotElement { .. } => "CaretFromPointNotElement",
            Self::CaretDirectionMismatch => "CaretDirectionMismatch",
            Self::NoCommonAncestor => "NoCommonAncestor",
            Self::CaretSpliceUnderflow => "CaretSpliceUnderflow",
            Self::RemoveTextSelectionLost => "RemoveTextSelectionLost",
            Self::UnknownSelectionSlot => "UnknownSelectionSlot",
            Self::NoSelection => "NoSelection",
            Self::NoRangeSelection => "NoRangeSelection",
            Self::NoNodeSelection => "NoNodeSelection",
            Self::PointTypeMismatch => "PointTypeMismatch",
            Self::LayoutRequired => "LayoutRequired",

            Self::ExpectedSerializedRoot => "ExpectedSerializedRoot",
            Self::UnknownSerializedType(..) => "UnknownSerializedType",
            Self::InfiniteTransforms => "InfiniteTransforms",
            Self::SelectionLost => "SelectionLost",
            Self::PointNodeNotFound(..) => "PointNodeNotFound",
            Self::TypeFlagsMismatch(..) => "TypeFlagsMismatch",
            Self::UnsupportedSelection => "UnsupportedSelection",
            Self::RootNotTopLevel => "RootNotTopLevel",
            Self::RootChildNotBlock => "RootChildNotBlock",
            Self::KeyResetWithNodes => "KeyResetWithNodes",
            Self::NodeNotFound(..) => "NodeNotFound",
            Self::Utf16OffsetOutOfRange(..) => "Utf16OffsetOutOfRange",
            Self::Utf16OffsetSplitsSurrogatePair(..) => "Utf16OffsetSplitsSurrogatePair",
            Self::KeySpaceExhausted => "KeySpaceExhausted",
            Self::NotAnElement(..) => "NotAnElement",
            Self::NotAText(..) => "NotAText",
            Self::NoParent(..) => "NoParent",
            Self::NoChild(..) => "NoChild",
            Self::NoMutableUpcast(..) => "NoMutableUpcast",
            Self::NodeTypeMismatch(..) => "NodeTypeMismatch",
            Self::NoDefault(..) => "NoDefault",
            Self::UnregisteredNodeType(..) => "UnregisteredNodeType",
            Self::UnregisteredNodeOnCreate(..) => "UnregisteredNodeOnCreate",
            Self::Invariant(..) | Self::InvariantMessage(..) => "Invariant",
            Self::NodePayloadNotObject => "NodePayloadNotObject",
            Self::BaseKindMismatch => "BaseKindMismatch",
            Self::RemoveRoot => "RemoveRoot",
            Self::ReplaceRoot => "ReplaceRoot",
            Self::InsertBeforeRoot => "InsertBeforeRoot",
            Self::InsertAfterRoot => "InsertAfterRoot",
            Self::RootSpliceNonBlock => "RootSpliceNonBlock",
            Self::AppendSelf => "AppendSelf",
            Self::SpliceOutOfRange => "SpliceOutOfRange",
            Self::IncludeChildrenRequiresElements => "IncludeChildrenRequiresElements",
            Self::InsertRangeAfterOrder => "InsertRangeAfterOrder",
            Self::SplitRoot => "SplitRoot",
            Self::RootChildrenMustBeElements => "RootChildrenMustBeElements",
            Self::TabSetTextContent => "TabSetTextContent",
            Self::TabSpliceText => "TabSpliceText",
            Self::TabSetDetail => "TabSetDetail",
            Self::TabSetMode => "TabSetMode",
            Self::MergeWithNonSibling => "MergeWithNonSibling",
            Self::ForeignEditorState => "ForeignEditorState",
            Self::SetEmptyEditorState => "SetEmptyEditorState",
            Self::WriteAfterSetEditorState => "WriteAfterSetEditorState",
            Self::StateKeyCollision { .. } => "StateKeyCollision",
            Self::Json(..) => "Json",
        }
    }
}
