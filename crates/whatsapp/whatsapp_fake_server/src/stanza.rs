//! Small helpers for building and reading binary XML nodes.

use whatsmeow::binary::{AttributeValue, Attrs, Node, NodeContent};
use whatsmeow::types::{Jid, parse_jid};

/// A node with attributes and optional content.
pub(crate) fn node(
    tag: &str,
    attrs: Vec<(&str, AttributeValue)>,
    content: Option<NodeContent>,
) -> Node {
    Node {
        tag: tag.to_owned(),
        attrs: attrs
            .into_iter()
            .map(|(key, value)| (key.to_owned(), value))
            .collect::<Attrs>(),
        content,
    }
}

/// Content of child nodes.
pub(crate) fn children(nodes: Vec<Node>) -> Option<NodeContent> {
    Some(NodeContent::Nodes(nodes))
}

/// Content of bytes.
pub(crate) fn bytes(data: impl Into<Vec<u8>>) -> Option<NodeContent> {
    Some(NodeContent::Bytes(data.into()))
}

/// A string attribute value.
pub(crate) fn text(value: impl Into<String>) -> AttributeValue {
    AttributeValue::String(value.into())
}

/// A JID attribute value.
pub(crate) fn jid(value: &Jid) -> AttributeValue {
    AttributeValue::Jid(value.clone())
}

/// A string attribute, or empty.
pub(crate) fn attr_string(node: &Node, key: &str) -> String {
    match node.attrs.get(key) {
        Some(AttributeValue::String(value)) => value.clone(),
        Some(AttributeValue::Jid(jid)) => jid.to_string(),
        None => String::new(),
    }
}

/// A JID attribute, parsing strings too.
pub(crate) fn attr_jid(node: &Node, key: &str) -> Option<Jid> {
    match node.attrs.get(key)? {
        AttributeValue::Jid(jid) => Some(jid.clone()),
        AttributeValue::String(value) => parse_jid(value).ok(),
    }
}

/// The node's bytes content.
pub(crate) fn content_bytes(node: &Node) -> Option<&[u8]> {
    match &node.content {
        Some(NodeContent::Bytes(data)) => Some(data),
        _ => None,
    }
}

/// The bytes content of the named child.
pub(crate) fn child_bytes<'node>(node: &'node Node, tag: &str) -> Option<&'node [u8]> {
    content_bytes(node.get_optional_child_by_tag(&[tag])?)
}

/// The current Unix time in seconds, as an attribute value.
pub(crate) fn now() -> AttributeValue {
    let seconds = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs())
        .unwrap_or_default();
    AttributeValue::String(seconds.to_string())
}

/// A random message or stanza ID in WhatsApp's style.
pub(crate) fn random_id() -> String {
    let random: [u8; 8] = rand::random();
    let mut id = String::from("3EB0");
    for byte in random {
        id.push_str(&format!("{byte:02X}"));
    }
    id
}
