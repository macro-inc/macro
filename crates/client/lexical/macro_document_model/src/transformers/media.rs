//! Image and video markdown preserve the source's distinct import coercions.
use super::*;
use crate::nodes::*;
use lexical_markdown::{Error, Result};
use lexical_model::*;
use lexical_rich_nodes::list::{ListItemNode, ListNode};
use serde_json::{Map, Value, json};
pub(super) fn export(cx: &mut ExportCx<'_>, node: NodeKey, name: &str) -> Result<Option<String>> {
    let ty = if name == "I_VIDEO" { "video" } else { "image" };
    if name == "VIDEO_LINK" || cx.state().node(node).map(|n| n.type_name()) != Some(ty) {
        return Ok(None);
    }
    let data = cx.state().export_node(node)?;
    if data.get("srcType").and_then(Value::as_str) == Some("local")
        || !data.get("url").is_some_and(js_truthy)
    {
        return Ok(None);
    }
    if name == "IMAGE" {
        return Ok(Some(format!(
            "![{}]({})",
            data.get("alt").and_then(Value::as_str).unwrap_or(""),
            data.get("url").and_then(Value::as_str).unwrap_or("")
        )));
    }
    if name == "I_IMAGE_CONSTRAINED"
        && ["constrainedWidth", "constrainedHeight"]
            .iter()
            .all(|key| data.get(*key).is_none_or(Value::is_null))
    {
        return Ok(None);
    }
    let keys = if ty == "image" {
        &[
            "url",
            "alt",
            "srcType",
            "id",
            "width",
            "height",
            "scale",
            "constrainedWidth",
            "constrainedHeight",
        ][..]
    } else {
        &[
            "url",
            "srcType",
            "id",
            "width",
            "height",
            "scale",
            "controls",
            "constrainedWidth",
            "constrainedHeight",
        ][..]
    };
    let data: Map<String, Value> = keys
        .iter()
        .filter_map(|key| data.get(*key).cloned().map(|v| ((*key).into(), v)))
        .collect();
    let tag = if ty == "image" { "m-image" } else { "m-video" };
    Ok(Some(format!(
        "<{tag}>{}</{tag}>",
        to_js_json_string(&Value::Object(data))
    )))
}
pub(super) fn replace(
    tx: &mut Transaction<'_>,
    parent: NodeKey,
    m: &Match,
    is_import: bool,
    name: &str,
) -> Result<ReplaceResult> {
    let imported=match name {
        "IMAGE"=>Ok(tx.create(ImageNode::import_json(json!({"srcType":"url","url":m.get(2).unwrap_or(""),"alt":m.get(1).unwrap_or(""),"width":0,"height":0,"id":""}).as_object().ok_or(Error::InvalidArgument("image object"))?)?)?.key()),
        "VIDEO_LINK"=>{
            let url=m.get(2).or(m.get(5)).unwrap_or("");
            Ok(tx.create(VideoNode::import_json(json!({"srcType":"url","url":url,"width":0,"height":0,"id":"","controls":true,"scale":1}).as_object().ok_or(Error::InvalidArgument("video object"))?)?)?.key())
        }
        _=>from_envelope(tx,m,name),
    };
    let node = match imported {
        Ok(node) => node,
        Err(_) => {
            let p = tx.create(Paragraph {})?;
            let unknown = envelope::unknown(
                tx,
                if name == "I_VIDEO" {
                    "Unknown Video"
                } else {
                    "Unknown Image"
                },
            )?;
            tx.append(p, &[unknown])?;
            tx.replace(parent, p, false)?;
            return Ok(ReplaceResult::Handled);
        }
    };
    if name == "I_VIDEO" {
        tx.append(parent, &[node])?;
    } else if !(is_import && append_to_list(tx, parent, node, m)?) {
        tx.replace(parent, node, false)?;
    }
    Ok(ReplaceResult::Handled)
}
fn from_envelope(tx: &mut Transaction<'_>, m: &Match, name: &str) -> Result<NodeKey> {
    let input: Value =
        serde_json::from_str(m.get(1).unwrap_or("")).map_err(lexical_model::Error::from)?;
    let input = input
        .as_object()
        .ok_or(Error::InvalidArgument("media object"))?;
    if !input.get("url").is_some_and(js_truthy)
        || (name == "I_VIDEO" && !input.get("url").is_some_and(Value::is_string))
    {
        return Err(Error::InvalidArgument("missing media URL"));
    }
    let mut data = Map::new();
    data.insert("url".into(), input["url"].clone());
    for (key, default) in [
        ("srcType", json!("url")),
        ("id", json!("")),
        ("width", json!(0)),
        ("height", json!(0)),
        ("scale", json!(1)),
    ] {
        let value = input
            .get(key)
            .filter(|v| js_truthy(v))
            .cloned()
            .unwrap_or(default.clone());
        let value = if name == "I_VIDEO" {
            match key {
                "srcType" | "id" => Value::String(js_string(&value)),
                _ => {
                    let number = js_to_number(&value);
                    if number == 0.0 || number.is_nan() {
                        default
                    } else {
                        js_number(number)
                    }
                }
            }
        } else {
            value
        };
        data.insert(key.into(), value);
    }
    for key in ["constrainedWidth", "constrainedHeight"] {
        if let Some(value) = input.get(key).filter(|v| !v.is_null()) {
            if name == "I_VIDEO" {
                let number = js_to_number(value);
                if number != 0.0 && !number.is_nan() {
                    data.insert(key.into(), js_number(number));
                }
            } else {
                data.insert(key.into(), value.clone());
            }
        }
    }
    if name == "I_VIDEO" {
        data.insert(
            "controls".into(),
            input
                .get("controls")
                .filter(|v| v.is_boolean())
                .cloned()
                .unwrap_or(json!(true)),
        );
        Ok(tx.create(VideoNode::import_json(&data)?)?.key())
    } else {
        data.insert(
            "alt".into(),
            input
                .get("alt")
                .filter(|v| js_truthy(v))
                .cloned()
                .unwrap_or(json!("")),
        );
        Ok(tx.create(ImageNode::import_json(&data)?)?.key())
    }
}
fn append_to_list(
    tx: &mut Transaction<'_>,
    paragraph: NodeKey,
    image: NodeKey,
    m: &Match,
) -> Result<bool> {
    let line = &m.input;
    let indent = line.len() - line.trim_start_matches(is_js_whitespace).len();
    if indent == 0 || line.find(m.full().trim_start_matches(is_js_whitespace)) != Some(indent) {
        return Ok(false);
    }
    let Some(list) = tx
        .view()
        .prev_sibling(paragraph)
        .filter(|k| tx.view().is::<ListNode>(*k))
    else {
        return Ok(false);
    };
    let mut last = tx.view().last_child(list);
    while let Some(child) = last.and_then(|key| tx.view().last_child(key)) {
        last = Some(child);
    }
    let item = last
        .and_then(|key| tx.find_matching_parent(key, |state, key| state.is::<ListItemNode>(key)))
        .or_else(|| tx.view().last_child(list));
    let Some(item) = item.filter(|key| tx.view().is::<ListItemNode>(*key)) else {
        return Ok(false);
    };
    tx.append(item, &[image])?;
    tx.remove(paragraph, false)?;
    Ok(true)
}
