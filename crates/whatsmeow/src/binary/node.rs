// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Ported from whatsmeow binary/node.go (MPL-2.0, Copyright (c) Tulir Asokan)

use std::collections::BTreeMap;
use std::fmt;

use super::decoder::BinaryDecoder;
use super::encoder::BinaryEncoder;
use super::errors::{DecodeError, EncodeError};
use crate::types::Jid;

/// The attributes of an XML element ([`Node`]).
///
/// Go uses an unordered map; a sorted map keeps encoding deterministic, which
/// WhatsApp doesn't care about either way.
pub type Attrs = BTreeMap<String, AttributeValue>;

/// The value of one attribute. Go stores `any` here; on the wire every value is
/// either a string or a JID, so numbers and booleans become strings when they
/// are put in (as Go's encoder formats them).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum AttributeValue {
    /// A string value.
    String(String),
    /// A JID value.
    Jid(Jid),
}

impl AttributeValue {
    /// Whether Go's encoder would skip the value (it skips `""` and `nil`).
    pub(super) fn is_empty_string(&self) -> bool {
        matches!(self, AttributeValue::String(value) if value.is_empty())
    }
}

impl fmt::Display for AttributeValue {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            AttributeValue::String(value) => formatter.write_str(value),
            AttributeValue::Jid(jid) => jid.fmt(formatter),
        }
    }
}

impl From<String> for AttributeValue {
    fn from(value: String) -> Self {
        AttributeValue::String(value)
    }
}

impl From<&str> for AttributeValue {
    fn from(value: &str) -> Self {
        AttributeValue::String(value.to_owned())
    }
}

impl From<Jid> for AttributeValue {
    fn from(value: Jid) -> Self {
        AttributeValue::Jid(value)
    }
}

impl From<&Jid> for AttributeValue {
    fn from(value: &Jid) -> Self {
        AttributeValue::Jid(value.clone())
    }
}

impl From<i64> for AttributeValue {
    fn from(value: i64) -> Self {
        AttributeValue::String(value.to_string())
    }
}

impl From<u64> for AttributeValue {
    fn from(value: u64) -> Self {
        AttributeValue::String(value.to_string())
    }
}

impl From<i32> for AttributeValue {
    fn from(value: i32) -> Self {
        AttributeValue::String(value.to_string())
    }
}

impl From<u32> for AttributeValue {
    fn from(value: u32) -> Self {
        AttributeValue::String(value.to_string())
    }
}

impl From<bool> for AttributeValue {
    fn from(value: bool) -> Self {
        AttributeValue::String(value.to_string())
    }
}

/// The content inside an element. Go stores `any`: a list of nodes, a byte
/// array, or (from the decoder) a string or JID token.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum NodeContent {
    /// Child elements.
    Nodes(Vec<Node>),
    /// Binary data.
    Bytes(Vec<u8>),
    /// A string, encoded like an attribute value.
    String(String),
    /// A JID, encoded like an attribute value.
    Jid(Jid),
}

/// An XML element.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Node {
    /// The tag of the element.
    pub tag: String,
    /// The attributes of the element.
    pub attrs: Attrs,
    /// The content inside the element.
    pub content: Option<NodeContent>,
}

static EMPTY_NODE: Node = Node {
    tag: String::new(),
    attrs: BTreeMap::new(),
    content: None,
};

impl Node {
    /// The content of the node as a list of nodes. If the content is not a
    /// list of nodes, this is empty.
    pub fn get_children(&self) -> &[Node] {
        match &self.content {
            Some(NodeContent::Nodes(children)) => children,
            _ => &[],
        }
    }

    /// The same list as [`Node::get_children`], filtered by tag.
    pub fn get_children_by_tag<'node>(
        &'node self,
        tag: &'node str,
    ) -> impl Iterator<Item = &'node Node> {
        self.get_children()
            .iter()
            .filter(move |child| child.tag == tag)
    }

    /// Finds the first child with the given tag. Each provided tag recurses
    /// in, so this is useful for getting a specific nested element.
    pub fn get_optional_child_by_tag(&self, tags: &[&str]) -> Option<&Node> {
        let mut node = self;
        for tag in tags {
            node = node.get_children().iter().find(|child| child.tag == *tag)?;
        }
        Some(node)
    }

    /// Like [`Node::get_optional_child_by_tag`], but returns an empty node
    /// when there's no match, as Go returns the zero `Node`.
    pub fn get_child_by_tag(&self, tags: &[&str]) -> &Node {
        self.get_optional_child_by_tag(tags).unwrap_or(&EMPTY_NODE)
    }
}

/// Encodes an XML element into WhatsApp's binary XML representation, with the
/// leading flags byte (0, meaning uncompressed).
///
/// Go panics on values it can't encode; the port returns them as errors.
pub fn marshal(node: &Node) -> Result<Vec<u8>, EncodeError> {
    let mut encoder = BinaryEncoder::new();
    encoder.write_node(node)?;
    Ok(encoder.get_data())
}

/// Decodes WhatsApp's binary XML representation (without the flags byte; see
/// [`super::unpack`]) into a node.
pub fn unmarshal(data: &[u8]) -> Result<Node, DecodeError> {
    let mut decoder = BinaryDecoder::new(data);
    let node = decoder.read_node()?;
    let leftover = decoder.remaining();
    if leftover != 0 {
        return Err(DecodeError::LeftoverBytes(leftover));
    }
    Ok(node)
}
