//! Persisted container inference; plain composite values are deliberately retained on creation.
use super::*;
use loro::{LoroList, LoroMovableList, LoroText, LoroValue};
use serde_json::Value;
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum MapSchema {
    Node,
    Open,
}
#[derive(Clone, Copy, PartialEq, Eq)]
enum Kind {
    Map,
    List,
    Children,
    Text,
}
fn declared(schema: MapSchema, key: &str) -> Option<Kind> {
    if schema == MapSchema::Open {
        return None;
    }
    match key {
        "$" => Some(Kind::Map),
        "text" => Some(Kind::Text),
        "ids" => Some(Kind::List),
        "children" => Some(Kind::Children),
        _ => None,
    }
}
fn inferred(value: &Value) -> Option<Kind> {
    match value {
        Value::Object(_) => Some(Kind::Map),
        Value::Array(_) => Some(Kind::List),
        _ => None,
    }
}
fn shape(kind: Kind, value: &Value) -> bool {
    match kind {
        Kind::Text => value.is_string(),
        _ => value.is_object() || value.is_array(),
    }
}
pub(crate) fn normalize_numbers(value: &mut Value) {
    match value {
        Value::Number(number) => match to_loro(&Value::Number(number.clone())) {
            LoroValue::I64(integer) => *number = integer.into(),
            LoroValue::Double(float) => {
                if let Some(float) = serde_json::Number::from_f64(float) {
                    *number = float;
                }
            }
            _ => {}
        },
        Value::Object(map) => map.values_mut().for_each(normalize_numbers),
        Value::Array(array) => array.iter_mut().for_each(normalize_numbers),
        _ => {}
    }
}
pub(crate) fn to_loro(value: &Value) -> LoroValue {
    match value {
        Value::Null => LoroValue::Null,
        Value::Bool(v) => LoroValue::Bool(*v),
        Value::String(s) => LoroValue::String(s.as_str().into()),
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                LoroValue::I64(i)
            } else {
                let number = n.as_f64().unwrap_or_default();
                if number.fract() == 0.0 && number >= i64::MIN as f64 && number < -(i64::MIN as f64)
                {
                    LoroValue::I64(number as i64)
                } else {
                    LoroValue::Double(number)
                }
            }
        }
        Value::Array(a) => LoroValue::List(a.iter().map(to_loro).collect::<Vec<_>>().into()),
        Value::Object(o) => LoroValue::Map(
            o.iter()
                .map(|(k, v)| (k.clone(), to_loro(v)))
                .collect::<Vec<_>>()
                .into(),
        ),
    }
}
pub(crate) fn from_loro(value: &LoroValue) -> Result<Value> {
    Ok(match value {
        LoroValue::Null => Value::Null,
        LoroValue::Bool(v) => Value::Bool(*v),
        LoroValue::I64(n) => Value::Number((*n).into()),
        LoroValue::Double(n) => lexical_model::json::js_number(*n),
        LoroValue::String(s) => Value::String(s.to_string()),
        LoroValue::List(l) => Value::Array(l.iter().map(from_loro).collect::<Result<_>>()?),
        LoroValue::Map(m) => Value::Object(
            m.iter()
                .map(|(k, v)| Ok((k.clone(), from_loro(v)?)))
                .collect::<Result<_>>()?,
        ),
        _ => return Err(schema_error("non-JSON value")),
    })
}
pub(crate) fn read_value(value: &ValueOrContainer) -> Result<Value> {
    from_loro(&value.get_deep_value())
}
pub(crate) fn map_at(value: Option<ValueOrContainer>, path: &str) -> Result<LoroMap> {
    match value {
        Some(ValueOrContainer::Container(Container::Map(m))) => Ok(m),
        _ => Err(schema_error(path)),
    }
}
pub(crate) fn children(map: &LoroMap) -> Result<Option<LoroMovableList>> {
    match map.get("children") {
        None => Ok(None),
        Some(ValueOrContainer::Container(Container::MovableList(l))) => Ok(Some(l)),
        _ => Err(schema_error("children")),
    }
}
pub(crate) fn validate_slots(map: &LoroMap) -> Result<()> {
    if let Some(value) = map.get("$")
        && !matches!(
            value,
            ValueOrContainer::Container(Container::Map(_))
                | ValueOrContainer::Value(LoroValue::Map(_))
        )
    {
        return Err(schema_error("$"));
    }
    if let Some(value) = map.get("text")
        && !matches!(
            value,
            ValueOrContainer::Container(Container::Text(_))
                | ValueOrContainer::Value(LoroValue::String(_))
        )
    {
        return Err(schema_error("text"));
    }
    if let Some(value) = map.get("ids")
        && !matches!(
            value,
            ValueOrContainer::Container(Container::List(_))
                | ValueOrContainer::Value(LoroValue::List(_))
        )
    {
        return Err(schema_error("ids"));
    }
    children(map)?;
    Ok(())
}
pub(crate) fn slot_id(map: &LoroMap, key: &str) -> Option<ContainerID> {
    match map.get(key) {
        Some(ValueOrContainer::Container(c)) => Some(c.id()),
        _ => None,
    }
}
pub(crate) fn own_map(map: &LoroMap) -> Result<SerializedNode> {
    validate_slots(map)?;
    let mut result = SerializedNode::new();
    let mut error = None;
    map.for_each(|key, value| {
        if key != "children" {
            match read_value(&value) {
                Ok(value) => {
                    result.insert(key.to_owned(), value);
                }
                Err(err) => {
                    error = Some(err);
                }
            }
        }
    });
    if let Some(error) = error {
        return Err(error);
    }
    Ok(result)
}
pub(crate) fn open_map(map: &LoroMap) -> Result<SerializedNode> {
    let mut result = SerializedNode::new();
    let mut error = None;
    map.for_each(|key, value| match read_value(&value) {
        Ok(v) => {
            result.insert(key.to_string(), v);
        }
        Err(e) => error = Some(e),
    });
    if let Some(error) = error {
        return Err(error);
    }
    Ok(result)
}
pub(crate) fn read_node(map: &LoroMap, policy: &dyn SyncPolicy) -> Result<SerializedNode> {
    read_node_for_init(map, policy, &mut false)
}
pub(crate) fn read_node_for_init(
    map: &LoroMap,
    policy: &dyn SyncPolicy,
    transparent: &mut bool,
) -> Result<SerializedNode> {
    let mut node = own_map(map)?;
    mask_local(&mut node, policy);
    if let Some(list) = children(map)? {
        let mut result = Vec::new();
        for i in 0..list.len() {
            let child = map_at(list.get(i), "children item")?;
            let json = read_node_for_init(&child, policy, transparent)?;
            if policy.is_dropped_json(&json) {
                continue;
            }
            if policy.is_transparent_json(&json) {
                *transparent = true;
                if let Some(Value::Array(children)) = json.get("children") {
                    result.extend(children.iter().cloned())
                }
            } else {
                result.push(Value::Object(json));
            }
        }
        node.insert("children".into(), Value::Array(result));
    }
    Ok(node)
}
pub(crate) fn initialize_map(
    map: &LoroMap,
    json: &SerializedNode,
    schema: MapSchema,
) -> Result<()> {
    for (key, value) in json {
        if let Some(kind) = declared(schema, key).filter(|kind| shape(*kind, value)) {
            insert_field(map, key, value, kind)?;
        } else {
            map.insert(key, to_loro(value))?;
        }
    }
    Ok(())
}
fn object(value: &Value) -> SerializedNode {
    match value {
        Value::Object(o) => o.clone(),
        Value::Array(a) => a
            .iter()
            .enumerate()
            .map(|(i, v)| (i.to_string(), v.clone()))
            .collect(),
        _ => SerializedNode::new(),
    }
}
fn insert_field(map: &LoroMap, key: &str, value: &Value, kind: Kind) -> Result<()> {
    match kind {
        Kind::Map => {
            let m = map.insert_container(key, LoroMap::new())?;
            initialize_map(&m, &object(value), MapSchema::Open)?;
        }
        Kind::List => {
            let list = map.insert_container(key, LoroList::new())?;
            if let Some(array) = value.as_array() {
                for (i, v) in array.iter().enumerate() {
                    list.insert(i, to_loro(v))?;
                }
            }
        }
        Kind::Children => {
            let list = map.insert_container(key, LoroMovableList::new())?;
            if let Some(array) = value.as_array() {
                for (i, v) in array.iter().enumerate() {
                    let json = v.as_object().ok_or_else(|| schema_error("children item"))?;
                    let child = list.insert_container(i, LoroMap::new())?;
                    initialize_map(&child, json, MapSchema::Node)?;
                }
            }
        }
        Kind::Text => {
            let text = map.insert_container(key, LoroText::new())?;
            if let Some(s) = value.as_str() {
                text.insert(0, s)?;
            }
        }
    }
    Ok(())
}
/// Native Unicode edits mirror update's prefix/suffix fast path and refined diff fallback.
pub(crate) fn splice_text(
    text: &LoroText,
    old: &str,
    new: &str,
    stats: &mut ProjectionStats,
) -> Result<()> {
    if old == new {
        return Ok(());
    }
    let a: Vec<char> = old.chars().collect();
    let b: Vec<char> = new.chars().collect();
    let prefix = a.iter().zip(&b).take_while(|(a, b)| a == b).count();
    let suffix = a
        .iter()
        .skip(prefix)
        .rev()
        .zip(b.iter().skip(prefix).rev())
        .take_while(|(a, b)| a == b)
        .count();
    let removed = a.len() - prefix - suffix;
    let inserted = b.len() - prefix - suffix;
    if removed == 0 {
        let insert: String = b.iter().skip(prefix).take(inserted).collect();
        text.insert(prefix, &insert)?;
        stats.text_splices += 1;
    } else if inserted == 0 {
        text.delete(prefix, removed)?;
        stats.text_splices += 1;
    } else {
        text.update(
            new,
            loro::UpdateOptions {
                timeout_ms: None,
                use_refined_diff: true,
            },
        )?;
        stats.text_splices += 1;
    }
    stats.containers_written += 1;
    Ok(())
}
pub(crate) fn diff_map(
    map: &LoroMap,
    before: &SerializedNode,
    new: &SerializedNode,
    schema: MapSchema,
    stats: &mut ProjectionStats,
) -> Result<()> {
    for key in before.keys() {
        if key == "children" && schema == MapSchema::Node {
            continue;
        }
        if !new.contains_key(key) && map.get(key).is_some() {
            map.delete(key)?;
            stats.containers_written += 1;
        }
    }
    for (key, value) in new {
        if key == "children" && schema == MapSchema::Node {
            continue;
        }
        let slot = map.get(key);
        if key == "text"
            && schema == MapSchema::Node
            && let (Some(ValueOrContainer::Container(Container::Text(text))), Some(new_text)) =
                (&slot, value.as_str())
        {
            let old = before
                .get(key)
                .and_then(Value::as_str)
                .map(str::to_owned)
                .unwrap_or_else(|| text.to_string());
            if before.get(key) != Some(value) {
                splice_text(text, &old, new_text, stats)?;
            }

            continue;
        }
        let kind = declared(schema, key).or_else(|| inferred(value));
        if slot.is_none() {
            if let Some(kind) = kind {
                insert_field(map, key, value, kind)?;
            } else {
                map.insert(key, to_loro(value))?;
            }
            stats.containers_written += 1;
            continue;
        }
        if let Some(kind) = kind.filter(|kind| shape(*kind, value)) {
            match (kind, slot) {
                (Kind::Map, Some(ValueOrContainer::Container(Container::Map(m)))) => {
                    let old = before.get(key).map(object).unwrap_or_default();
                    diff_map(&m, &old, &object(value), MapSchema::Open, stats)?;
                }
                (Kind::List, Some(ValueOrContainer::Container(Container::List(l)))) => {
                    diff_list(
                        &l,
                        value.as_array().map_or(&[], Vec::as_slice),
                        key == "ids" && schema == MapSchema::Node,
                        stats,
                    )?;
                }
                (Kind::Text, Some(ValueOrContainer::Value(old))) => {
                    if from_loro(&old)? != *value {
                        map.insert(key, to_loro(value))?;
                        stats.containers_written += 1;
                    }
                }
                (_, _) => {
                    insert_field(map, key, value, kind)?;
                    stats.containers_written += 1;
                }
            }
        } else if slot.as_ref().map(read_value).transpose()?.as_ref() != Some(value) {
            map.insert(key, to_loro(value))?;
            stats.containers_written += 1;
        }
    }
    Ok(())
}
fn insert_list_item(list: &LoroList, index: usize, value: &Value) -> Result<()> {
    match inferred(value) {
        Some(Kind::Map) => {
            let map = list.insert_container(index, LoroMap::new())?;
            initialize_map(&map, &object(value), MapSchema::Open)?;
        }
        Some(Kind::List) => {
            let child = list.insert_container(index, LoroList::new())?;
            if let Some(array) = value.as_array() {
                for (i, v) in array.iter().enumerate() {
                    child.insert(i, to_loro(v))?;
                }
            }
        }
        _ => list.insert(index, to_loro(value))?,
    }
    Ok(())
}
fn diff_list(list: &LoroList, new: &[Value], ids: bool, stats: &mut ProjectionStats) -> Result<()> {
    if ids {
        let old = (0..list.len())
            .map(|i| {
                list.get(i)
                    .ok_or_else(|| schema_error("ids item"))
                    .and_then(|v| read_value(&v))
            })
            .collect::<Result<Vec<_>>>()?;
        // Port diffListWithIdSelector's live-index loop, including its null-id
        // guard for exhausted/empty strings. Do not infer positional identity.
        let mut offset = 0isize;
        let mut next = 0usize;
        let mut i = 0usize;
        while i < old.len() {
            let old_item = &old[i];
            let item = new.get(next);
            if item == Some(old_item) {
                next += 1;
                i += 1;
                continue;
            }
            let old_id = old_item.as_str().filter(|s| !s.is_empty());
            let new_id = item.and_then(Value::as_str).filter(|s| !s.is_empty());
            if old_id.is_none() || new_id.is_none() {
                i += 1;
                continue;
            }
            let index = (i as isize + offset) as usize;
            if new_id.is_some_and(|id| !old.iter().any(|v| v.as_str() == Some(id))) {
                list.insert(
                    index,
                    to_loro(item.ok_or_else(|| schema_error("ids item"))?),
                )?;
                offset += 1;
                next += 1;
            } else {
                list.delete(index, 1)?;
                offset -= 1;
                i += 1;
            }
            stats.containers_written += 1;
        }
        for value in new.iter().skip(next) {
            list.insert((i as isize + offset) as usize, to_loro(value))?;
            offset += 1;
            stats.containers_written += 1;
        }
        return Ok(());
    }
    let old_len = list.len();
    for (i, value) in new.iter().take(old_len).enumerate() {
        let old = list.get(i).ok_or_else(|| schema_error("list item"))?;
        match old {
            ValueOrContainer::Container(Container::Map(m)) => {
                let old = open_map(&m)?;
                // JavaScript treats arrays as object-like when an existing map
                // item is visited, so their indices become map keys.
                let next = match value {
                    Value::Object(map) => map.clone(),
                    Value::Array(values) => values
                        .iter()
                        .enumerate()
                        .map(|(i, value)| (i.to_string(), value.clone()))
                        .collect(),
                    _ => return Err(schema_error("map item")),
                };
                diff_map(&m, &old, &next, MapSchema::Open, stats)?;
            }
            ValueOrContainer::Container(Container::List(l)) => diff_list(
                &l,
                value.as_array().ok_or_else(|| schema_error("list item"))?,
                false,
                stats,
            )?,
            value_or_container => {
                if read_value(&value_or_container)? != *value {
                    list.delete(i, 1)?;
                    insert_list_item(list, i, value)?;
                    stats.containers_written += 1;
                }
            }
        }
    }
    if old_len > new.len() {
        list.delete(new.len(), old_len - new.len())?;
        stats.containers_written += 1;
    }
    for (i, value) in new.iter().enumerate().skip(old_len) {
        insert_list_item(list, i, value)?;
        stats.containers_written += 1;
    }
    Ok(())
}
// Compare fields owned by this editor while preserving newer-client additions.
pub(crate) fn owned_equal(current: &Value, before: Option<&Value>, after: &Value) -> bool {
    if let Value::Object(after) = after {
        let Some(current) = current.as_object() else {
            return false;
        };
        let before = before.and_then(Value::as_object);
        after.iter().all(|(key, value)| {
            current.get(key).is_some_and(|current| {
                owned_equal(current, before.and_then(|map| map.get(key)), value)
            })
        }) && before.is_none_or(|before| {
            before
                .keys()
                .all(|key| after.contains_key(key) || !current.contains_key(key))
        })
    } else {
        current == after
    }
}
pub(crate) fn has_plain_composites(map: &LoroMap, policy: &dyn SyncPolicy) -> bool {
    let mut result = false;
    map.for_each(|key, value| {
        if key == "$" {
            match &value {
                ValueOrContainer::Container(Container::Map(state)) => {
                    state.for_each(|name, value| {
                        if !policy.local_state_keys().contains(&name)
                            && matches!(
                                value,
                                ValueOrContainer::Value(LoroValue::Map(_) | LoroValue::List(_))
                            )
                        {
                            result = true;
                        }
                    })
                }
                ValueOrContainer::Value(LoroValue::Map(state)) => {
                    result |= state
                        .keys()
                        .any(|key| !policy.local_state_keys().contains(&key.as_str()));
                }
                _ => {}
            }
        } else if matches!(
            value,
            ValueOrContainer::Value(LoroValue::Map(_) | LoroValue::List(_))
        ) {
            result = true;
        }
    });
    result
}
