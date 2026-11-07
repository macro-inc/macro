//! Complete observable snapshot comparison.
use crate::replay::{Replayer, Result, fail, string};
use lexical_model::*;
use serde_json::{Value, json};
pub(crate) fn keys(state: &EditorState) -> Vec<NodeKey> {
    (0..=state.max_key().index())
        .map(|index| {
            NodeKey::from_parts(KeyParts {
                generation: state.max_key().generation(),
                index,
            })
        })
        .filter(|key| state.view().contains(*key))
        .collect()
}
fn path(view: StateRef<'_>, mut key: NodeKey) -> Vec<u32> {
    let mut path = Vec::new();
    while let Some(parent) = view.parent(key) {
        if let Some(index) = view.index_within_parent(key) {
            path.push(index.0);
        }
        key = parent;
    }
    path.reverse();
    path
}
fn point(view: StateRef<'_>, point: Point) -> Value {
    json!({"key":point.key().to_string(),"path":path(view,point.key()),"offset":point.offset(),"type":point.point_type().to_string()})
}
pub(crate) fn selection(state: &EditorState) -> Result<Value> {
    let view = state.view();
    Ok(match state.selection() {
        None => Value::Null,
        Some(Selection::Range(range)) => {
            json!({"type":"range","anchor":point(view,range.anchor),"focus":point(view,range.focus),"format":range.format.bits(),"style":range.style,"isBackward":range.is_backward(view)?})
        }
        Some(Selection::Node(nodes)) => {
            json!({"type":"node","keys":nodes.keys().map(|key|key.to_string()).collect::<Vec<_>>(),"paths":nodes.keys().map(|key|path(view,key)).collect::<Vec<_>>()})
        }
        Some(Selection::Table(table)) => {
            json!({"type":"table","tableKey":table.table.to_string(),"anchorCellKey":table.anchor.key().to_string(),"focusCellKey":table.focus.key().to_string()})
        }
    })
}
fn expected_key(replay: &mut Replayer, value: &Value) -> Result<String> {
    if value.is_number() {
        let handle = replay
            .handles
            .get(&format!("$h:{value}"))
            .ok_or_else(|| fail(format!("unknown dirty handle {value}")))?;
        return Ok(crate::replay::node_key(handle)?.to_string());
    }
    let raw = if value.get("$key").is_some() {
        string(&value["raw"])?
    } else {
        string(value)?
    };
    if let Some(key) = replay.keys.get(raw) {
        return Ok(key.to_string());
    }
    // Removed temporary nodes have no public handle or node-map entry. Their
    // numeric identity remains observable in dirty sets. Resolve only an actual
    // allocation in the fixture's shared namespace, preserving the bijection.
    if let (Ok(index), Some(last)) = (raw.parse::<u32>(), replay.key_counter.last_allocated())
        && index > 0
        && index <= last.index()
    {
        let key = NodeKey::from_parts(KeyParts {
            generation: last.generation(),
            index,
        });
        replay.bind_key(raw, key)?;
        return Ok(key.to_string());
    }
    Err(fail(format!("unknown snapshot key {raw}")))
}
fn canonical_selection(replay: &mut Replayer, value: &mut Value) -> Result<()> {
    if let Some(object) = value.as_object_mut() {
        for (key, child) in object {
            if ["key", "tableKey", "anchorCellKey", "focusCellKey"].contains(&key.as_str()) {
                *child = Value::String(expected_key(replay, child)?);
            } else if key == "keys" {
                for item in child.as_array_mut().ok_or_else(|| fail("expected keys"))? {
                    *item = Value::String(expected_key(replay, item)?);
                }
            } else {
                canonical_selection(replay, child)?;
            }
        }
    }
    Ok(())
}
pub(crate) fn compare(
    replay: &mut Replayer,
    expected: &Value,
    state: &EditorState,
    commit: Option<&Commit>,
) -> Result<()> {
    for key in expected
        .as_object()
        .ok_or_else(|| fail("missing snapshot object"))?
        .keys()
    {
        if ![
            "json",
            "selection",
            "text",
            "nodeMapKeys",
            "tags",
            "dirty",
            "normalized",
            "markdown",
            "history",
        ]
        .contains(&key.as_str())
        {
            return Err(fail(format!("unsupported snapshot observable: {key}")));
        }
    }
    let required = if commit.is_some() {
        vec![
            "json",
            "selection",
            "text",
            "nodeMapKeys",
            "tags",
            "dirty",
            "normalized",
        ]
    } else {
        vec!["json", "selection", "text", "nodeMapKeys"]
    };
    if expected.as_object().is_none_or(|object| {
        object.len() != required.len() || required.iter().any(|key| !object.contains_key(*key))
    }) {
        return Err(fail("snapshot field set mismatch"));
    }
    if commit.is_some()
        && expected["dirty"].as_object().is_none_or(|object| {
            object.len() != 2 || !object.contains_key("leaves") || !object.contains_key("elements")
        })
    {
        return Err(fail("dirty field set mismatch"));
    }
    let actual_keys = keys(state);
    let expected_keys = expected["nodeMapKeys"]
        .as_array()
        .ok_or_else(|| fail("missing nodeMapKeys"))?;
    if expected_keys.len() != actual_keys.len() {
        return Err(fail(format!(
            "nodeMapKeys count: {} != {}",
            expected_keys.len(),
            actual_keys.len()
        )));
    }
    for (expected, actual) in expected_keys.iter().zip(&actual_keys) {
        replay.bind_key(string(expected)?, *actual)?;
    }
    let actual_json = serde_json::to_value(state.to_json()?)?;
    replay
        .compare(&expected["json"], &actual_json)
        .map_err(|e| fail(format!("snapshot JSON: {e}")))?;
    if to_js_json_string(&expected["json"]) != to_js_json_string(&actual_json) {
        return Err(fail(format!(
            "snapshot JSON property order mismatch: {} != {}",
            expected["json"], actual_json
        )));
    }
    let mut expected_selection = expected["selection"].clone();
    canonical_selection(replay, &mut expected_selection)?;
    replay
        .compare(&expected_selection, &selection(state)?)
        .map_err(|e| fail(format!("snapshot selection: {e}")))?;
    replay
        .compare(&expected["text"], &json!(state.root_text_content()))
        .map_err(|e| fail(format!("snapshot text: {e}")))?;
    if let Some(commit) = commit {
        replay.compare(
            &expected["tags"],
            &json!(
                commit
                    .tags
                    .iter()
                    .map(ToString::to_string)
                    .collect::<Vec<_>>()
            ),
        )?;
        let expected_normalized = expected["normalized"]
            .as_array()
            .ok_or_else(|| fail("normalized array"))?;
        if expected_normalized.len() != commit.normalized.len() {
            return Err(fail("normalized count mismatch"));
        }
        for (expected, actual) in expected_normalized.iter().zip(commit.normalized.iter()) {
            if expected.is_string() {
                replay.bind_key(string(expected)?, *actual)?;
            }
        }
        let normalized = expected["normalized"]
            .as_array()
            .ok_or_else(|| fail("missing normalized"))?
            .iter()
            .map(|v| expected_key(replay, v))
            .collect::<Result<Vec<_>>>()?;
        replay.compare(
            &json!(normalized),
            &json!(
                commit
                    .normalized
                    .iter()
                    .map(ToString::to_string)
                    .collect::<Vec<_>>()
            ),
        )?;
        let mut leaves = expected["dirty"]["leaves"]
            .as_array()
            .ok_or_else(|| fail("missing dirty leaves"))?
            .iter()
            .map(|v| expected_key(replay, v))
            .collect::<Result<Vec<_>>>()?;
        leaves.sort();
        let mut actual_leaves = commit
            .changes
            .dirty_leaves
            .iter()
            .map(ToString::to_string)
            .collect::<Vec<_>>();
        actual_leaves.sort();
        replay
            .compare(&json!(leaves), &json!(actual_leaves))
            .map_err(|e| fail(format!("dirty leaves: {e}")))?;
        let mut elements = expected["dirty"]["elements"]
            .as_array()
            .ok_or_else(|| fail("missing dirty elements"))?
            .iter()
            .map(|v| {
                Ok((
                    expected_key(replay, &v[0])?,
                    v[1].as_bool().ok_or_else(|| fail("dirty intent"))?,
                ))
            })
            .collect::<Result<Vec<_>>>()?;
        elements.sort();
        let mut actual_elements = commit
            .changes
            .dirty_elements
            .iter()
            .map(|(key, intent)| (key.to_string(), *intent == DirtyIntent::Intentional))
            .collect::<Vec<_>>();
        actual_elements.sort();
        replay
            .compare(&json!(elements), &json!(actual_elements))
            .map_err(|e| {
                fail(format!(
                    "dirty elements: {e}; expected {elements:?}, actual {actual_elements:?}"
                ))
            })?;
    }
    for extra in ["markdown", "history"] {
        if expected.get(extra).is_some() {
            return Err(fail(format!("unmapped snapshot observable: {extra}")));
        }
    }
    Ok(())
}
