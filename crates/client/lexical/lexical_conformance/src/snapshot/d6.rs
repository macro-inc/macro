//! S4 §1.7 / D6: Prism's highlight records are view-only identities.
use super::*;
use std::collections::HashSet;

/// Project one code block into plain text runs and absolute code positions.
/// Tabs, breaks, text attributes, language, root, tags and typing attributes
/// remain observable. Highlight allocation and normalization are view work.
pub(super) fn d6_collapse_code_highlight(
    replay: &mut Replayer,
    expected: &Value,
    state: &EditorState,
    commit: Option<&Commit>,
) -> Result<()> {
    let view = state.view();
    let blocks = view.children_keys(NodeKey::ROOT)?;
    let [code_key] = blocks.as_slice() else {
        return Err(fail("D6 requires exactly one code block"));
    };
    let raw_json = serde_json::to_value(state.to_json()?)?;
    for json in [&expected["json"], &raw_json] {
        let children = json["root"]["children"]
            .as_array()
            .ok_or_else(|| fail("D6 root children"))?;
        if children.len() != 1 || children[0]["type"] != "code" {
            return Err(fail("D6 cannot project non-code content"));
        }
        for child in children[0]["children"]
            .as_array()
            .ok_or_else(|| fail("D6 code children"))?
        {
            if !matches!(
                child["type"].as_str(),
                Some("text" | "code-highlight" | "tab" | "linebreak")
            ) {
                return Err(fail("D6 cannot project nested code content"));
            }
        }
    }
    let oracle_code = replay
        .bindings
        .keys()?
        .iter()
        .find_map(|(raw, key)| (*key == *code_key).then_some(raw.clone()))
        .ok_or_else(|| fail("D6 code identity must be recorded"))?;
    let oracle_keys = expected["nodeMapKeys"]
        .as_array()
        .ok_or_else(|| fail("D6 nodeMapKeys"))?
        .iter()
        .map(|key| string(key).map(str::to_owned))
        .collect::<Result<HashSet<_>>>()?;
    let oracle_leaf_count = expected["json"]["root"]["children"][0]["children"]
        .as_array()
        .ok_or_else(|| fail("D6 code children"))?
        .len();
    if oracle_keys.len() != oracle_leaf_count + 2
        || expected["nodeMapKeys"].as_array().map(Vec::len) != Some(oracle_keys.len())
        || !oracle_keys.contains("root")
        || !oracle_keys.contains(&oracle_code)
    {
        return Err(fail("D6 node map must contain every raw JSON record once"));
    }
    let non_body = expected["nodeMapKeys"]
        .as_array()
        .ok_or_else(|| fail("D6 keys"))?
        .iter()
        .filter(|value| *value == "root" || *value == &oracle_code)
        .cloned()
        .collect::<Vec<_>>();
    if non_body != vec![json!("root"), json!(oracle_code)] {
        return Err(fail("D6 root/code map order"));
    }
    for raw in &oracle_keys {
        if raw != "root"
            && raw != &oracle_code
            && !raw
                .parse::<u32>()
                .is_ok_and(|key| key > 0 && key.to_string() == *raw)
        {
            return Err(fail("D6 noncanonical body key"));
        }
    }
    replay.d6_model_leaves = view.children(*code_key).collect();
    replay
        .d6_model_body
        .extend(replay.d6_model_leaves.iter().copied());
    if let Some(commit) = commit {
        for key in keys(&commit.prev) {
            if commit.prev.view().parent(key) == Some(*code_key) {
                replay.d6_model_body.insert(key);
            }
        }
    }
    replay.d6_oracle_max_key = oracle_keys
        .iter()
        .filter_map(|raw| raw.parse::<u32>().ok())
        .fold(replay.d6_oracle_max_key, u32::max);
    if keys(state).len() != replay.d6_model_leaves.len() + 2 {
        return Err(fail("D6 model node map contains extra records"));
    }
    // Syntax highlighting can replace plain runs between snapshots. Retain
    // surviving handle bindings; drop only removed highlight-body aliases.
    let retained = replay
        .bindings
        .keys()?
        .into_iter()
        .filter_map(|(raw, key)| {
            (key == NodeKey::ROOT || key == *code_key || oracle_keys.contains(raw.as_str()))
                .then_some(raw)
        })
        .collect();
    replay.bindings.retain_keys(&retained)?;
    let expected_json = code::project_json(&expected["json"])?;
    let actual_json = code::project_json(&raw_json)?;
    replay
        .compare(&expected_json, &actual_json)
        .map_err(|e| fail(format!("D6 JSON: {e}")))?;
    if to_js_json_string(&expected_json) != to_js_json_string(&actual_json) {
        return Err(fail("D6 JSON property order mismatch"));
    }
    let mut expected_selection = expected["selection"].clone();
    if expected_selection["type"] == "range" {
        for role in ["anchor", "focus"] {
            let point = &mut expected_selection[role];
            let raw = raw_key(&point["key"])?;
            if !oracle_keys.contains(&raw) {
                return Err(fail("D6 selection key absent from node map"));
            }
            let path = point["path"]
                .as_array()
                .ok_or_else(|| fail("D6 selection path"))?;
            let key = if path.len() == 1 && path[0] == 0 {
                if raw != oracle_code {
                    return Err(fail("D6 code selection identity"));
                }
                *code_key
            } else if path.len() == 2 && path[0] == 0 {
                if raw == "root" || raw == oracle_code {
                    return Err(fail("D6 body selection identity"));
                }
                view.children(*code_key)
                    .nth(
                        usize::try_from(crate::replay::integer(&path[1])?)
                            .map_err(|_| fail("D6 selection index"))?,
                    )
                    .ok_or_else(|| fail("D6 selection child"))?
            } else {
                return Err(fail("D6 selection outside code"));
            };
            if replay.bindings.key(&raw)?.is_some_and(|bound| bound != key) {
                return Err(fail("D6 known selection key/path mismatch"));
            }
            point["key"] = json!(key.to_string());
        }
    } else if !expected_selection.is_null() {
        return Err(fail("D6 unsupported selection kind"));
    }
    let mut actual_selection = selection(state)?;
    code::project_selection(&mut expected_selection, &expected["json"], state)?;
    code::project_selection(&mut actual_selection, &raw_json, state)?;
    replay
        .compare(&expected_selection, &actual_selection)
        .map_err(|e| fail(format!("D6 selection: {e}")))?;
    replay.compare(&expected["text"], &json!(state.root_text_content()))?;
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
        let leaves = expected["dirty"]["leaves"]
            .as_array()
            .ok_or_else(|| fail("D6 dirty leaves"))?;
        let normalized = expected["normalized"]
            .as_array()
            .ok_or_else(|| fail("D6 normalized"))?;
        // This scoped topology contains only root, code and code-body leaves.
        // Validate every identity before collapsing body bookkeeping to code.
        let body_identity = |value: &Value| -> Result<String> {
            let raw = if value.is_number() {
                let binding = format!("$h:{value}");
                let handle = replay
                    .bindings
                    .handle(&binding)?
                    .ok_or_else(|| fail("D6 missing body handle"))?;
                let key = crate::replay::node_key(&handle)?;
                if !replay.d6_model_body.contains(&key) {
                    return Err(fail("D6 body handle is not code content"));
                }
                replay
                    .d6_handle_keys
                    .get(&binding)
                    .cloned()
                    .ok_or_else(|| fail("D6 missing body handle provenance"))?
            } else {
                raw_key(value)?
            };
            if raw == "root"
                || raw == oracle_code
                || !raw.parse::<u32>().is_ok_and(|key| {
                    key > 0 && key <= replay.d6_oracle_max_key && key.to_string() == raw
                })
            {
                return Err(fail("D6 invalid body identity"));
            }
            Ok(raw)
        };
        for values in [leaves, normalized] {
            let mut seen = HashSet::new();
            for value in values {
                let raw = body_identity(value)?;
                if !seen.insert(raw) {
                    return Err(fail("D6 duplicate body identity"));
                }
            }
        }
        if commit
            .changes
            .dirty_leaves
            .iter()
            .chain(&commit.normalized)
            .any(|key| !replay.d6_model_body.contains(key))
        {
            return Err(fail("D6 unproven model body bookkeeping"));
        }
        if commit
            .normalized
            .iter()
            .any(|key| *key == NodeKey::ROOT || *key == *code_key)
        {
            return Err(fail("D6 normalized element"));
        }
        let elements = expected["dirty"]["elements"]
            .as_array()
            .ok_or_else(|| fail("D6 dirty elements"))?;
        if commit
            .changes
            .dirty_elements
            .keys()
            .any(|key| *key != NodeKey::ROOT && *key != *code_key)
        {
            return Err(fail("D6 model dirty non-code element"));
        }
        let mut expected_elements = Vec::new();
        for entry in elements {
            if entry.as_array().is_none_or(|entry| entry.len() != 2) {
                return Err(fail("D6 dirty element shape"));
            }
            let key = expected_key(replay, &entry[0])?;
            let intent = entry[1].as_bool().ok_or_else(|| fail("D6 dirty intent"))?;
            if key != "root" && key != code_key.to_string() {
                return Err(fail("D6 dirty non-code element"));
            }
            if expected_elements
                .iter()
                .any(|(existing, _)| existing == &key)
            {
                return Err(fail("D6 duplicate element identity"));
            }
            if key == code_key.to_string() && !intent {
                return Err(fail("D6 Prism code write must be intentional"));
            }
            expected_elements.push((key, intent));
        }
        let expected_root = expected_elements
            .iter()
            .find(|(key, _)| key == "root")
            .map(|(_, intent)| *intent);
        let actual_root = commit
            .changes
            .dirty_elements
            .get(&NodeKey::ROOT)
            .map(|intent| *intent == DirtyIntent::Intentional);
        replay.compare(&json!(expected_root), &json!(actual_root))?;
        let expected_body_dirty = !leaves.is_empty()
            || expected_elements
                .iter()
                .any(|(key, _)| key == &code_key.to_string());
        let actual_body_dirty = !commit.changes.dirty_leaves.is_empty()
            || commit.changes.dirty_elements.contains_key(code_key);
        replay.compare(&json!(expected_body_dirty), &json!(actual_body_dirty))?;
    }
    Ok(())
}

#[cfg(test)]
mod test;

fn raw_key(value: &Value) -> Result<String> {
    if let Some(raw) = value.as_str() {
        return Ok(raw.to_owned());
    }
    let fields = value.as_object().ok_or_else(|| fail("D6 raw key"))?;
    if fields.len() != 2 || fields.get("$key").and_then(Value::as_u64).is_none() {
        return Err(fail("D6 key object shape"));
    }
    Ok(string(&value["raw"])?.to_owned())
}
