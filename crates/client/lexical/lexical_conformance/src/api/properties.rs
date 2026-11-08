use crate::replay::*;
use lexical_model::*;
use serde_json::{Value, json};
mod node;
pub(crate) fn get(
    r: &mut Replayer,
    tx: &mut Transaction<'_>,
    receiver: &Value,
    name: &str,
) -> Result<Value> {
    if let Some(point) = receiver.get("$point") {
        let slot = r.selections.slot(integer(&point["selection"])? as usize)?;
        let p = if point["role"] == "anchor" {
            tx.anchor_at(slot)?
        } else {
            tx.focus_at(slot)?
        };
        return match name {
            "key" => Ok(key_value(p.key())),
            "type" => Ok(json!(p.point_type().to_string())),
            "offset" => Ok(json!(p.offset())),
            _ => Err(fail(format!("unmapped point property {name}"))),
        };
    }
    if receiver.get("$selection").is_some() {
        let id = integer(&receiver["$selection"])?;
        return match name {
            "anchor" | "focus" => Ok(json!({"$point":{"selection":id,"role":name}})),
            "_cachedIsBackward" => Ok(json!(
                tx.range_at(r.selections.slot(id as usize)?)?
                    .cached_is_backward()
            )),
            "format" => Ok(json!(
                tx.range_at(r.selections.slot(id as usize)?)?.format.bits()
            )),
            "style" => Ok(json!(tx.range_at(r.selections.slot(id as usize)?)?.style)),
            "dirty" => Ok(json!(
                tx.selection_at(r.selections.slot(id as usize)?)?
                    .is_some_and(Selection::is_dirty)
            )),
            _ => Err(fail(format!("unmapped selection property {name}"))),
        };
    }
    if receiver.get("$snapshot").is_some() && name == "_nodeMap" {
        let state = r
            .saved_state(integer(&receiver["$snapshot"])? as usize)?
            .clone();
        let mut pairs = Vec::new();
        for key in crate::snapshot::keys(&state) {
            pairs.push(json!([key.to_string(), r.node(state.view(), key)?]));
        }
        return Ok(json!({"$map":pairs}));
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
        return with_captured_record(r, tx, receiver, |record| node::get(record, receiver, name));
    }

    if let Some(array) = receiver.as_array()
        && let Ok(index) = name.parse::<usize>()
    {
        return array.get(index).cloned().ok_or_else(|| fail("array index"));
    }
    receiver
        .get(name)
        .cloned()
        .ok_or_else(|| fail(format!("unmapped property {name}")))
}

/// Borrow only owned captures or the current transaction, with no binding guard.
pub(super) fn with_captured_record<T>(
    r: &Replayer,
    tx: &Transaction<'_>,
    receiver: &Value,
    read: impl FnOnce(NodeRef<'_>) -> Result<T>,
) -> Result<T> {
    let key = node_key(receiver)?;
    let version = integer(&receiver["ver"])?;
    if let Some(state) = r
        .bindings
        .state(&version)?
        .filter(|state| state.view().contains(key))
    {
        return read(state.view().node_or_err(key)?);
    }
    if let Some(record) = r.bindings.retired_record(version, key)? {
        return read(record.as_ref().as_ref());
    }
    if let Some(record) = tx.retired_record(key) {
        return read(record);
    }
    read(tx.node_or_err(key)?)
}
