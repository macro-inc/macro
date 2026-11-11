//! Raw record fields, including records retained after collection.
use crate::replay::{Result, fail, key_value, undefined};
use lexical_model::*;
use serde_json::{Value, json};

pub(super) fn get(node: NodeRef<'_>, receiver: &Value, name: &str) -> Result<Value> {
    let key = node.key();
    match name {
        "__parent" => Ok(node.parent().map_or(Value::Null, key_value)),
        "__prev" => Ok(node.prev().map_or(Value::Null, key_value)),
        "__next" => Ok(node.next().map_or(Value::Null, key_value)),
        "__key" => Ok(key_value(key)),
        "__cachedText" if key == NodeKey::ROOT => Ok(json!(node.foreign_raw_root_cached_text())),
        "__first" => Ok(element(node)?.first_child().map_or(Value::Null, key_value)),
        "__last" => Ok(element(node)?.last_child().map_or(Value::Null, key_value)),
        "__size" => Ok(json!(element(node)?.children_size())),
        "__indent" => Ok(json!(element(node)?.indent)),
        "__dir" => Ok(serde_json::to_value(element(node)?.direction)?),
        "__textFormat" => Ok(json!(element(node)?.text_format.bits())),
        "__textStyle" => Ok(json!(element(node)?.text_style)),
        "__detail" => Ok(json!(text(node)?.detail.bits())),
        "__mode" => Ok(json!(match text(node)?.mode {
            TextMode::Normal => 0,
            TextMode::Token => 1,
            TextMode::Segmented => 2,
        })),
        "__state" => Ok(if node.node_state().is_some() {
            json!({"$nodeState":receiver})
        } else {
            undefined()
        }),
        "__target" | "__rel" | "__title" => {
            let link = node
                .get::<lexical_rich_nodes::link::LinkNode>()
                .ok_or(Error::NodeTypeMismatch(key))?;
            Ok(json!(match name {
                "__target" => &link.target,
                "__rel" => &link.rel,
                _ => &link.title,
            }))
        }
        "__url" => Ok(json!(
            node.get::<lexical_rich_nodes::link::LinkNode>()
                .ok_or_else(|| fail("link"))?
                .url
        )),
        "__type" => Ok(json!(node.type_name())),
        "__text" => Ok(json!(text(node)?.text.as_str())),
        "__format" => Ok(json!(match node.base() {
            BaseData::Text(data) => data.format.bits(),
            BaseData::Element(data) => data.format.bits(),
            _ => return Err(fail("node has no format field")),
        })),
        "__style" => Ok(json!(match node.base() {
            BaseData::Text(data) => &data.style,
            BaseData::Element(data) => &data.style,
            _ => return Err(fail("node has no style field")),
        })),
        _ => Err(fail(format!("unmapped node property {name}"))),
    }
}

fn element(node: NodeRef<'_>) -> Result<&ElementData> {
    match node.base() {
        BaseData::Element(data) => Ok(data),
        _ => Err(Error::NotAnElement(node.key()).into()),
    }
}

fn text(node: NodeRef<'_>) -> Result<&TextData> {
    match node.base() {
        BaseData::Text(data) => Ok(data),
        _ => Err(Error::NotAText(node.key()).into()),
    }
}

#[cfg(test)]
mod test;
