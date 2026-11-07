//! Opt-in records for node types written by a newer collaborative peer.
use crate::*;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(transparent)]
struct Payload {
    raw: SerializedNode,
    #[serde(skip)]
    baseline: SerializedNode,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(transparent)]
pub(crate) struct OpaqueElement(Payload);
impl NodeType for OpaqueElement {
    const TYPE: &'static str = "__opaque_element";
    type Kind = ElementKind;
    impl_default_node!();
}
impl ElementNode for OpaqueElement {
    element_node_base!();
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(transparent)]
pub(crate) struct OpaqueText(Payload);
impl NodeType for OpaqueText {
    const TYPE: &'static str = "__opaque_text";
    type Kind = TextKind;
    impl_default_node!();
}
impl TextNode for OpaqueText {
    text_node_base!();
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(transparent)]
pub(crate) struct OpaqueDecorator(Payload);
impl NodeType for OpaqueDecorator {
    const TYPE: &'static str = "__opaque_decorator";
    type Kind = DecoratorKind;
    impl_default_node!();
}
impl DecoratorNode for OpaqueDecorator {
    decorator_node_base!();
}

pub(crate) fn raw(data: &dyn crate::node::AnyNodeData) -> Option<&SerializedNode> {
    let data = data.as_any();
    if let Some(node) = data.downcast_ref::<OpaqueElement>() {
        return Some(&node.0.raw);
    }
    if let Some(node) = data.downcast_ref::<OpaqueText>() {
        return Some(&node.0.raw);
    }
    data.downcast_ref::<OpaqueDecorator>()
        .map(|node| &node.0.raw)
}

impl Registry {
    pub(crate) fn import_index(
        &self,
        name: &str,
        json: &SerializedNode,
    ) -> Result<NodeTypeIndex, Error> {
        if let Some(node) = self.get(name) {
            return Ok(node.index);
        }
        if !self.opaque_unknown_types {
            return Err(Error::UnknownSerializedType(name.to_owned()));
        }
        let kind = if json.get("children").is_some_and(Value::is_array) {
            OpaqueElement::TYPE
        } else if json.get("text").is_some_and(Value::is_string) {
            OpaqueText::TYPE
        } else {
            OpaqueDecorator::TYPE
        };
        self.get(kind)
            .map(|node| node.index)
            .ok_or(Error::Invariant("opaque types not registered"))
    }
}

fn payload_mut(data: &mut dyn crate::node::AnyNodeData) -> Option<&mut Payload> {
    let data = data.as_any_mut();
    if data.is::<OpaqueElement>() {
        return data.downcast_mut::<OpaqueElement>().map(|node| &mut node.0);
    }
    if data.is::<OpaqueText>() {
        return data.downcast_mut::<OpaqueText>().map(|node| &mut node.0);
    }
    data.downcast_mut::<OpaqueDecorator>()
        .map(|node| &mut node.0)
}

pub(crate) fn set_baseline(data: &mut dyn crate::node::AnyNodeData, baseline: SerializedNode) {
    if let Some(payload) = payload_mut(data) {
        // Children live only in framework links, never recursively in each ancestor's payload.
        if payload.raw.contains_key("children") {
            payload.raw.insert("children".into(), Value::Array(vec![]));
        }
        payload.baseline = baseline;
    }
}

pub(crate) fn export(
    slot: &crate::node::NodeSlot,
    framework: &SerializedNode,
) -> Option<SerializedNode> {
    let data = slot.data.as_any();
    let payload = if let Some(node) = data.downcast_ref::<OpaqueElement>() {
        &node.0
    } else if let Some(node) = data.downcast_ref::<OpaqueText>() {
        &node.0
    } else {
        &data.downcast_ref::<OpaqueDecorator>()?.0
    };
    let mut json = payload.raw.clone();
    for key in payload.baseline.keys().chain(framework.keys()) {
        if key != "type" && key != "version" && payload.baseline.get(key) != framework.get(key) {
            match framework.get(key) {
                Some(value) => {
                    json.insert(key.clone(), value.clone());
                }
                None => {
                    json.shift_remove(key);
                }
            }
        }
    }
    Some(json)
}

#[cfg(test)]
mod test;
