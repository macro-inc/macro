//! Framework-owned node fields.
use crate::*;
use std::{any::Any, fmt, sync::Arc};
/// The framework kind of a node.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
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
/// Framework fields, separate from a node's user data.
#[derive(Clone, PartialEq, Debug)]
pub enum BaseData {
    /// Container fields.
    Element(ElementData),
    /// Text fields.
    Text(TextData),
    /// Opaque leaf.
    Decorator,
    /// Line break.
    LineBreak,
}
impl BaseData {
    /// The matching kind.
    pub fn kind(&self) -> NodeKind {
        match self {
            Self::Element(_) => NodeKind::Element,
            Self::Text(_) => NodeKind::Text,
            Self::Decorator => NodeKind::Decorator,
            Self::LineBreak => NodeKind::LineBreak,
        }
    }
}
/// Container fields; structural links are changed only by transactions.
#[derive(Clone, PartialEq, Debug, Default)]
/// s2: EL-01
pub struct ElementData {
    pub(crate) absent: AbsentKeys,
    pub(crate) first: Option<NodeKey>,
    pub(crate) last: Option<NodeKey>,
    pub(crate) size: u32,
    /// Block alignment.
    pub format: ElementFormat,
    /// Element CSS text.
    pub style: Arc<str>,
    /// Indentation level.
    pub indent: u32,
    /// Explicit direction.
    pub direction: Option<TextDirection>,
    /// Default child text format.
    pub text_format: TextFormat,
    /// Default child text style.
    pub text_style: Arc<str>,
}
impl ElementData {
    /// First direct child.
    pub fn first_child(&self) -> Option<NodeKey> {
        self.first
    }
    /// Last direct child.
    pub fn last_child(&self) -> Option<NodeKey> {
        self.last
    }
    /// Number of direct children.
    pub fn children_size(&self) -> u32 {
        self.size
    }
    /// Whether there are no children.
    pub fn is_empty(&self) -> bool {
        self.size == 0
    }
}
/// Text fields stored independently of a subclass's payload.
#[derive(Clone, PartialEq, Debug, Default)]
/// s2: TX-01
pub struct TextData {
    pub(crate) absent: AbsentKeys,
    /// Text and cached length.
    pub text: TextBuffer,
    /// Formatting bits.
    pub format: TextFormat,
    /// Inline CSS.
    pub style: Arc<str>,
    /// Editing mode.
    pub mode: TextMode,
    /// Normalization details.
    pub detail: TextDetail,
}
impl TextData {
    /// Plain text with default formatting.
    pub fn new(text: impl Into<String>) -> Self {
        Self {
            text: TextBuffer::new(text),
            ..Self::default()
        }
    }
    /// Whether this is an indivisible token.
    pub fn is_token(&self) -> bool {
        self.mode == TextMode::Token
    }
    /// Whether this edits by segments.
    pub fn is_segmented(&self) -> bool {
        self.mode == TextMode::Segmented
    }
    /// Whether direction detection is disabled.
    pub fn is_directionless(&self) -> bool {
        self.detail.contains(TextDetail::DIRECTIONLESS)
    }
    /// Whether normalization must preserve this node.
    pub fn is_unmergeable(&self) -> bool {
        self.detail.contains(TextDetail::UNMERGEABLE)
    }
    /// Whether a format bit is set.
    pub fn has_format(&self, kind: TextFormatType) -> bool {
        self.format.has(kind)
    }
    /// Formatting after toggling one kind.
    pub fn format_flags(&self, kind: TextFormatType, align: Option<TextFormat>) -> TextFormat {
        self.format.toggled(kind, align)
    }
}
#[derive(Clone, Copy, Debug, Default)]
pub(crate) struct Links {
    pub parent: Option<NodeKey>,
    pub prev: Option<NodeKey>,
    pub next: Option<NodeKey>,
}
#[derive(Clone)]
pub(crate) struct NodeSlot {
    pub key: NodeKey,
    pub type_index: NodeTypeIndex,
    pub links: Links,
    pub base: BaseData,
    pub state: Option<Arc<NodeState>>,
    pub data: Arc<dyn AnyNodeData>,
}
pub(crate) trait AnyNodeData: Any + fmt::Debug + Send + Sync {
    fn as_any(&self) -> &dyn Any;
    fn as_any_mut(&mut self) -> &mut dyn Any;
    fn clone_arc(&self) -> Arc<dyn AnyNodeData>;
    fn after_clone(&self) -> Option<Arc<dyn AnyNodeData>>;
    fn to_json(&self) -> Result<SerializedNode, Error>;
    fn dyn_eq(&self, other: &dyn AnyNodeData) -> bool;
}
impl<Node: NodeType> AnyNodeData for Node {
    fn dyn_eq(&self, other: &dyn AnyNodeData) -> bool {
        other
            .as_any()
            .downcast_ref::<Node>()
            .is_some_and(|other| self == other)
    }
    fn as_any(&self) -> &dyn Any {
        self
    }
    fn as_any_mut(&mut self) -> &mut dyn Any {
        self
    }
    fn clone_arc(&self) -> Arc<dyn AnyNodeData> {
        Arc::new(self.clone())
    }
    fn after_clone(&self) -> Option<Arc<dyn AnyNodeData>> {
        NodeType::after_clone(self).map(|n| Arc::new(n) as Arc<dyn AnyNodeData>)
    }
    fn to_json(&self) -> Result<SerializedNode, Error> {
        match serde_json::to_value(self)? {
            serde_json::Value::Object(object) => Ok(object),
            _ => Err(Error::NodePayloadNotObject),
        }
    }
}

bitflags::bitflags! {
    #[derive(Clone,Copy,Debug,Default,PartialEq,Eq)]
    pub(crate) struct AbsentKeys:u8 {
        const INDENT=1;const DIRECTION=2;const FORMAT=4;const DETAIL=8;const MODE=16;const STYLE=32;const TEXT=64;
    }
}
impl AbsentKeys {
    pub(crate) fn contains_field(self, field: &str) -> bool {
        self.contains(Self::field(field))
    }
    pub(crate) fn from_json(json: &SerializedNode, names: &[&str]) -> Self {
        let mut absent = Self::empty();
        for name in names {
            if !json.contains_key(*name) {
                absent.insert(Self::field(name));
            }
        }
        absent
    }
    pub(crate) fn field(name: &str) -> Self {
        match name {
            "indent" => Self::INDENT,
            "direction" => Self::DIRECTION,
            "format" => Self::FORMAT,
            "detail" => Self::DETAIL,
            "mode" => Self::MODE,
            "style" => Self::STYLE,
            "text" => Self::TEXT,
            _ => Self::empty(),
        }
    }
    pub(crate) fn omit(self, json: &mut SerializedNode) {
        for name in [
            "indent",
            "direction",
            "format",
            "detail",
            "mode",
            "style",
            "text",
        ] {
            if self.contains(Self::field(name)) {
                json.shift_remove(name);
            }
        }
    }
}
