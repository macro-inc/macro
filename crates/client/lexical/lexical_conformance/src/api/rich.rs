//! Explicit rich-node package dispatch; no package algorithms live in the interpreter.
use super::lexical::*;
use crate::replay::*;
use lexical_model::*;
use lexical_rich_nodes::link::*;
use serde_json::{Value, json};
fn attribute(value: &Value, name: &str) -> Result<Option<String>> {
    match value.get(name).filter(|v| v.get("$undef").is_none()) {
        None | Some(Value::Null) => Ok(None),
        Some(v) => Ok(Some(string(v)?.into())),
    }
}
fn attributes(value: &Value) -> Result<LinkAttributes> {
    Ok(LinkAttributes {
        rel: attribute(value, "rel")?,
        target: attribute(value, "target")?,
        title: attribute(value, "title")?,
    })
}
fn update(value: &Value, name: &str) -> Result<AttrUpdate> {
    match value.get(name).filter(|v| v.get("$undef").is_none()) {
        None => Ok(AttrUpdate::Unset),
        Some(Value::Null) => Ok(AttrUpdate::Null),
        Some(v) => Ok(AttrUpdate::Value(string(v)?.into())),
    }
}
pub(crate) fn call(
    r: &mut Replayer,
    tx: &mut Transaction<'_>,
    name: &str,
    a: &[Value],
) -> Result<Value> {
    match name {
        "@lexical/link.$createLinkNode" => {
            let attrs = attributes(a.get(1).unwrap_or(&Value::Null))?;
            let key =
                create_link_node(tx, a.first().and_then(Value::as_str).unwrap_or(""), attrs)?.key();
            r.node(tx.view(), key)
        }
        "@lexical/link.$isLinkNode" => Ok(json!(
            a.first()
                .filter(|v| v.get("$node").is_some())
                .map(node_key)
                .transpose()?
                .is_some_and(|key| tx.is::<LinkNode>(key))
        )),
        "@lexical/link.formatUrl" => Ok(json!(format_url(str_arg(a, 0)?))),
        "@lexical/link.$toggleLink" => {
            let first = a.first().ok_or_else(|| fail("URL"))?;
            let mut value = if first.is_object() {
                first.clone()
            } else {
                json!({})
            };
            if let Some(object) = a.get(1).and_then(Value::as_object) {
                value
                    .as_object_mut()
                    .ok_or_else(|| fail("attributes"))?
                    .extend(object.clone());
            }
            let url = if first.is_object() {
                first.get("url").unwrap_or(&Value::Null)
            } else {
                first
            };
            let attrs = ToggleLinkAttributes {
                rel: update(&value, "rel")?,
                target: update(&value, "target")?,
                title: update(&value, "title")?,
            };
            toggle_link(
                tx,
                if url.is_null() {
                    None
                } else {
                    Some(string(url)?)
                },
                attrs,
            )?;
            Ok(undefined())
        }
        _ => Err(fail(format!("unmapped API: {name}"))),
    }
}
pub(crate) fn link_method(
    view: StateRef<'_>,
    key: NodeKey,
    method: &str,
    _a: &[Value],
) -> Result<Option<Value>> {
    let node = view.get::<LinkNode>(key).ok_or_else(|| fail("link"))?;
    let value = match method {
        "getURL" => json!(node.url),
        "getRel" => json!(node.rel),
        "getTarget" => json!(node.target),
        "getTitle" => json!(node.title),
        "canInsertTextBefore" => json!(view.can_insert_text_before(key)),
        "canInsertTextAfter" => json!(view.can_insert_text_after(key)),
        _ => return Ok(None),
    };
    Ok(Some(value))
}
