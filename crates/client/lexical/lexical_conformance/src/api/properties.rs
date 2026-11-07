use crate::replay::*;
use lexical_model::*;
use serde_json::{Value, json};
pub(crate) fn get(
    r: &mut Replayer,
    tx: &mut Transaction<'_>,
    receiver: &Value,
    name: &str,
) -> Result<Value> {
    if let Some(point) = receiver.get("$point") {
        let slot = r.selections[integer(&point["selection"])? as usize];
        let p = if point["role"] == "anchor" {
            tx.anchor_at(slot)?
        } else {
            tx.focus_at(slot)?
        };
        return match name {
            "key" => Ok(json!({"$nodeKey":key_wire(p.key())})),
            "type" => Ok(json!(p.point_type().to_string())),
            "offset" => Ok(json!(p.offset())),
            _ => Err(fail(format!("unmapped point property {name}"))),
        };
    }
    if receiver.get("$selection").is_some() {
        let id = integer(&receiver["$selection"])?;
        return match name {
            "anchor" | "focus" => Ok(json!({"$point":{"selection":id,"role":name}})),
            "format" => Ok(json!(tx.range_at(r.selections[id as usize])?.format.bits())),
            "style" => Ok(json!(tx.range_at(r.selections[id as usize])?.style)),
            "dirty" => Ok(json!(
                tx.selection_at(r.selections[id as usize])?
                    .is_some_and(Selection::is_dirty)
            )),
            _ => Err(fail(format!("unmapped selection property {name}"))),
        };
    }
    if receiver.get("$snapshot").is_some() && name == "_nodeMap" {
        let state = r.saved_states[integer(&receiver["$snapshot"])? as usize].clone();
        let mut pairs = Vec::new();
        for key in crate::snapshot::keys(&state) {
            pairs.push(json!([{"$nodeKey":key_wire(key)}, r.node(state.view(), key)?]));
        }
        return Ok(json!({"$map":pairs}));
    }
    if name == "then" && (receiver.get("$editor").is_some() || receiver.get("$snapshot").is_some())
    {
        return Ok(undefined());
    }
    if name == "length" {
        if let Some(array) = receiver.as_array() {
            return Ok(json!(array.len()));
        }
        if let Some(text) = receiver.as_str() {
            return Ok(json!(text.encode_utf16().count()));
        }
    }
    if name == "size" {
        if let Some(map) = receiver.get("$map").and_then(Value::as_array) {
            return Ok(json!(map.len()));
        }
        if let Some(set) = receiver.get("$set").and_then(Value::as_array) {
            return Ok(json!(set.len()));
        }
    }
    if receiver.get("$node").is_some() {
        let key = node_key(receiver)?;
        let state = r.captured_state(receiver);
        let view = state
            .as_ref()
            .filter(|s| s.view().contains(key))
            .map(EditorState::view)
            .unwrap_or(tx.view());
        let node = view.node_or_err(key)?;
        return match name {
            "__key" => Ok(json!({"$nodeKey":key_wire(key)})),
            "__tag" => Ok(json!(if let Some(heading) =
                view.get::<lexical_rich_nodes::heading::HeadingNode>(key)
            {
                serde_json::to_value(heading.tag)?
            } else {
                view.export_json(key)?
                    .get("tag")
                    .cloned()
                    .unwrap_or_else(undefined)
            })),
            "__classes" => Ok(serde_json::to_value(
                &view
                    .get_or_err::<macro_document_model::nodes::ClassedBlockNode>(key)?
                    .classes,
            )?),
            "__headerState" => Ok(serde_json::to_value(
                view.get_or_err::<lexical_rich_nodes::table::TableCellNode>(key)?
                    .header_state,
            )?),
            "__url" => Ok(json!(
                view.get::<lexical_rich_nodes::link::LinkNode>(key)
                    .ok_or_else(|| fail("link"))?
                    .url
            )),
            "__type" => Ok(json!(node.type_name())),
            "__text" => Ok(json!(view.text_data(key)?.text.as_str())),
            "__format" => Ok(json!(view.text_data(key)?.format.bits())),
            "__style" => Ok(json!(view.text_data(key)?.style)),
            _ => Err(fail(format!("unmapped node property {name}"))),
        };
    }
    if let Some(array) = receiver.as_array()
        && let Ok(index) = name.parse::<usize>()
    {
        return Ok(array.get(index).cloned().unwrap_or_else(undefined));
    }
    if receiver
        .as_object()
        .is_some_and(|object| object.keys().all(|key| key == "$" || !key.starts_with('$')))
        || receiver.is_array()
    {
        return Ok(receiver.get(name).cloned().unwrap_or_else(undefined));
    }
    Err(fail(format!("unmapped property {name}")))
}
