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
    pub(crate) raw_indent_is_null: bool,
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
    /// Fields Source holds as a raw null (from a stored null); never also absent.
    pub(crate) null: NullKeys,
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
    /// Format and style emitted by the text base serializer: a value, Source's raw
    /// null, or an imported undefined field.
    pub fn json_format_style(&self) -> (JsonField<TextFormat>, JsonField<&str>) {
        (
            self.json_field(AbsentKeys::FORMAT, NullKeys::FORMAT, self.format),
            self.json_field(AbsentKeys::STYLE, NullKeys::STYLE, self.style.as_ref()),
        )
    }
    fn json_field<T>(&self, absent: AbsentKeys, null: NullKeys, value: T) -> JsonField<T> {
        if self.absent.contains(absent) {
            JsonField::Absent
        } else if self.null.contains(null) {
            JsonField::Null
        } else {
            JsonField::Value(value)
        }
    }
    /// An explicit write of these fields: they are no longer absent or null.
    pub(crate) fn set_explicit(&mut self, absent: AbsentKeys) {
        self.absent.remove(absent);
        self.null.remove(NullKeys::from_absent(absent));
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
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct Links {
    pub parent: Option<NodeKey>,
    pub prev: Option<NodeKey>,
    pub next: Option<NodeKey>,
}
pub(crate) struct NodeSlot {
    #[cfg(feature = "foreign-nodes")]
    pub foreign_instance: Arc<std::sync::OnceLock<ForeignInstance>>,
    #[cfg(feature = "foreign-nodes")]
    pub foreign_instance_write: Option<ForeignUpdateIdentity>,
    #[cfg(feature = "foreign-nodes")]
    pub foreign_root_cache: Option<crate::foreign::instances::ForeignRootCache>,
    #[cfg(feature = "foreign-nodes")]
    pub foreign_identity: crate::foreign::RecordIdentityMarker,
    pub key: NodeKey,
    pub type_index: NodeTypeIndex,
    pub links: Links,
    pub base: BaseData,
    pub state: Option<Arc<NodeState>>,
    pub data: Arc<dyn AnyNodeData>,
}
impl NodeSlot {
    /// Copy raw fields for an owned read while retaining hydration of the exact record.
    pub(crate) fn clone_fields(&self) -> Self {
        Self {
            #[cfg(feature = "foreign-nodes")]
            foreign_instance: self.foreign_instance.clone(),
            #[cfg(feature = "foreign-nodes")]
            foreign_instance_write: self.foreign_instance_write.clone(),
            #[cfg(feature = "foreign-nodes")]
            foreign_root_cache: self.foreign_root_cache.clone(),
            #[cfg(feature = "foreign-nodes")]
            foreign_identity: self.foreign_identity.clone(),
            key: self.key,
            type_index: self.type_index,
            links: self.links,
            base: self.base.clone(),
            state: self.state.clone(),
            data: self.data.clone(),
        }
    }
}
impl Clone for NodeSlot {
    fn clone(&self) -> Self {
        #[cfg(feature = "foreign-nodes")]
        {
            let mut copy = self.clone_fields();
            // A future hydration must not assign one JS instance to distinct
            // records after an unbound record was copied for a write.
            if self.foreign_instance.get().is_none() {
                copy.foreign_instance = Default::default();
            }
            copy
        }
        #[cfg(not(feature = "foreign-nodes"))]
        {
            self.clone_fields()
        }
    }
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
bitflags::bitflags! {
    /// Text fields Source stores raw as null (setFormat/setDetail/setStyle keep a
    /// non-string value, Lexical 0.45.0 :6831, :6848, :6862). Mode has no null
    /// state: TEXT_MODE_TO_TYPE[null] is undefined, which is absent.
    #[derive(Clone,Copy,Debug,Default,PartialEq,Eq)]
    pub(crate) struct NullKeys:u8 {
        const FORMAT=1;const DETAIL=2;const STYLE=4;
    }
}
impl NullKeys {
    pub(crate) fn from_absent(absent: AbsentKeys) -> Self {
        let mut null = Self::empty();
        for (from, to) in [
            (AbsentKeys::FORMAT, Self::FORMAT),
            (AbsentKeys::DETAIL, Self::DETAIL),
            (AbsentKeys::STYLE, Self::STYLE),
        ] {
            if absent.contains(from) {
                null.insert(to);
            }
        }
        null
    }
    /// The absent bits of the same fields.
    pub(crate) fn to_absent(self) -> AbsentKeys {
        let mut absent = AbsentKeys::empty();
        for (from, to) in [
            (Self::FORMAT, AbsentKeys::FORMAT),
            (Self::DETAIL, AbsentKeys::DETAIL),
            (Self::STYLE, AbsentKeys::STYLE),
        ] {
            if self.contains(from) {
                absent.insert(to);
            }
        }
        absent
    }
    /// Set every listed field that `json` holds as null.
    pub(crate) fn from_json(json: &SerializedNode) -> Self {
        let mut null = Self::empty();
        for (name, flag) in [
            ("format", Self::FORMAT),
            ("detail", Self::DETAIL),
            ("style", Self::STYLE),
        ] {
            if json.get(name).is_some_and(serde_json::Value::is_null) {
                null.insert(flag);
            }
        }
        null
    }
    /// Write each null field into an exported text node.
    pub(crate) fn write(self, json: &mut SerializedNode) {
        for (name, flag) in [
            ("format", Self::FORMAT),
            ("detail", Self::DETAIL),
            ("style", Self::STYLE),
        ] {
            if self.contains(flag) {
                json.insert(name.into(), serde_json::Value::Null);
            }
        }
    }
}
/// One exported text field: a value, a raw null, or an undefined (absent) key.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum JsonField<T> {
    /// The field's value.
    Value(T),
    /// Source holds null and exports it.
    Null,
    /// Undefined in Source; JSON omits it.
    Absent,
}

impl AbsentKeys {
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
