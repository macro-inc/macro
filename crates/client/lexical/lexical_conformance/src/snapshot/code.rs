//! D6 comparison projection; allocation, dirty and normalized observations stay exact.
use super::*;
use crate::replay::integer;

pub(super) fn project_json(value: &Value) -> Result<Value> {
    let mut value = value.clone();
    project_node(&mut value["root"])?;
    Ok(value)
}
fn project_node(node: &mut Value) -> Result<()> {
    let code = node["type"] == "code";
    let Some(children) = node.get_mut("children") else {
        return Ok(());
    };
    let children = children
        .as_array_mut()
        .ok_or_else(|| fail("code projection children"))?;
    for child in children.iter_mut() {
        project_node(child)?;
    }
    if !code {
        return Ok(());
    }
    let mut projected: Vec<Value> = Vec::new();
    for mut child in std::mem::take(children) {
        match child["type"].as_str() {
            Some("code-highlight") => {
                let fields = child
                    .as_object_mut()
                    .ok_or_else(|| fail("code highlight object"))?;
                fields.insert("type".into(), json!("text"));
                fields.remove("highlightType");
            }
            Some("text" | "tab" | "linebreak") => {}
            _ => return Err(fail("unsupported codeHighlight descendant")),
        }
        if child["type"] == "text" {
            let mut attributes = child.clone();
            attributes
                .as_object_mut()
                .ok_or_else(|| fail("code text object"))?
                .remove("text");
            if let Some(previous) = projected
                .last_mut()
                .filter(|previous| previous["type"] == "text")
            {
                let mut previous_attributes = previous.clone();
                previous_attributes
                    .as_object_mut()
                    .ok_or_else(|| fail("code text object"))?
                    .remove("text");
                if previous_attributes == attributes {
                    let mut text = string(&previous["text"])?.to_owned();
                    text.push_str(string(&child["text"])?);
                    previous["text"] = json!(text);
                    continue;
                }
            }
        }
        projected.push(child);
    }
    *children = projected;
    Ok(())
}
fn units(node: &Value) -> Result<u64> {
    match node["type"].as_str() {
        Some("text" | "code-highlight" | "tab") => {
            Ok(string(&node["text"])?.encode_utf16().count() as u64)
        }
        Some("linebreak") => Ok(1),
        _ => Err(fail("unsupported codeHighlight position")),
    }
}
fn project_point(point: &mut Value, json: &Value, state: &EditorState) -> Result<()> {
    if point.as_object().is_none_or(|fields| {
        fields.len() != 4
            || !["key", "path", "offset", "type"]
                .iter()
                .all(|field| fields.contains_key(*field))
    }) {
        return Err(fail("code selection point field set"));
    }
    let path: Vec<usize> = point["path"]
        .as_array()
        .ok_or_else(|| fail("code selection path"))?
        .iter()
        .map(|value| usize::try_from(integer(value)?).map_err(|_| fail("code selection index")))
        .collect::<Result<_>>()?;
    let mut node = &json["root"];
    let mut code_path = Vec::new();
    for depth in 0..=path.len() {
        if node["type"] == "code" {
            let children = node["children"]
                .as_array()
                .ok_or_else(|| fail("code children"))?;
            let offset = integer(&point["offset"])?;
            let boundary = if depth == path.len() {
                if point["type"] != "element" {
                    return Err(fail("code container point kind"));
                }
                usize::try_from(offset).map_err(|_| fail("code boundary"))?
            } else {
                if depth + 1 != path.len() || point["type"] != "text" {
                    return Err(fail("unsupported nested code selection"));
                }
                let index = path[depth];
                let child = children
                    .get(index)
                    .ok_or_else(|| fail("code child index"))?;
                if offset > units(child)? {
                    return Err(fail("code text offset"));
                }
                index
            };
            if boundary > children.len() {
                return Err(fail("code boundary offset"));
            }
            let prefix = children[..boundary]
                .iter()
                .try_fold(0u64, |sum, node| units(node).map(|length| sum + length))?;
            let absolute = if depth == path.len() {
                prefix
            } else {
                prefix + offset
            };
            let mut key = NodeKey::ROOT;
            for index in &code_path {
                key = state
                    .view()
                    .children(key)
                    .nth(*index)
                    .ok_or_else(|| fail("model code path"))?;
            }
            let point_key = if depth == path.len() {
                key
            } else {
                state
                    .view()
                    .children(key)
                    .nth(boundary)
                    .ok_or_else(|| fail("code selection key layout"))?
            };
            if point["key"] != point_key.to_string() {
                return Err(fail("code selection key/path mismatch"));
            }
            *point =
                json!({"key":key.to_string(),"path":code_path,"offset":absolute,"type":"code"});
            return Ok(());
        }
        if let Some(index) = path.get(depth) {
            node = node["children"]
                .get(*index)
                .ok_or_else(|| fail("selection node path"))?;
            code_path.push(*index);
        }
    }
    Ok(())
}
pub(super) fn project_selection(
    value: &mut Value,
    json: &Value,
    state: &EditorState,
) -> Result<()> {
    if value["type"] == "range" {
        project_point(&mut value["anchor"], json, state)?;
        project_point(&mut value["focus"], json, state)?;
    }
    Ok(())
}

#[cfg(test)]
mod test;
