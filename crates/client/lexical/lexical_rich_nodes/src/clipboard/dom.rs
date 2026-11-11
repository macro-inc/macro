//! Construct host-converted DOM drafts without using stored list import semantics.
use super::*;
use crate::list::ListNode;

/// Construct converted DOM nodes through the configured factories.
/// Unlike stored JSON, ListNode DOM conversion invokes its replacement factory.
pub fn generate_nodes_from_dom_drafts(
    tx: &mut Transaction<'_>,
    nodes: &[SerializedNode],
) -> Result<Vec<NodeKey>, Error> {
    nodes.iter().map(|json| import_dom_node(tx, json)).collect()
}

fn import_dom_node(tx: &mut Transaction<'_>, json: &SerializedNode) -> Result<NodeKey, Error> {
    let name = json
        .get("type")
        .and_then(Value::as_str)
        .ok_or(Error::Invariant("node type missing"))?;
    let kind = tx
        .view()
        .registered_node_kind(name)
        .ok_or_else(|| Error::UnknownSerializedType(name.to_owned()))?;
    let key = if name == ListNode::TYPE {
        let key = tx.create(ListNode::import_json(json)?)?.key();
        tx.update_from_json(key, json)?;
        key
    } else {
        tx.import_node_shallow(json)?
    };
    if tx.kind(key) != Some(kind) {
        return Err(Error::Invariant("DOM import changed registered node kind"));
    }
    if kind == NodeKind::Element
        && let Some(children) = json.get("children").and_then(Value::as_array)
    {
        for child in children {
            let child = child.as_object().ok_or(Error::NodePayloadNotObject)?;
            let child = import_dom_node(tx, child)?;
            tx.append(key, &[child])?;
        }
    }
    Ok(key)
}
