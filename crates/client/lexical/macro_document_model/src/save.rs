//! Legacy document-download serialization, distinct from the live sync projection.
use lexical_model::*;
use serde_json::Value;

/// Match getSaveState: regenerate top-level search text, lift drafts and drop UI nodes.
/// Capture search text before clearing custom-code children, matching the legacy save order.
pub fn saved_state(state: &EditorState) -> crate::Result<Value> {
    let mut serialized = serde_json::to_value(state.to_json()?)?;
    if let Some(children) = serialized
        .get_mut("root")
        .and_then(|root| root.get_mut("children"))
        .and_then(Value::as_array_mut)
    {
        let mut search_text = std::collections::BTreeMap::new();
        for (child, key) in children.iter().zip(state.view().children(NodeKey::ROOT)) {
            if !state.view().is_element(key) {
                continue;
            }
            if let Some(id) = child
                .get("$")
                .and_then(|fields| fields.get("id"))
                .and_then(Value::as_str)
                .filter(|id| !id.is_empty())
            {
                search_text.insert(id.to_owned(), state.view().text_content(key).into_owned());
            }
        }
        for child in children {
            let Some(fields) = child.get_mut("$").and_then(Value::as_object_mut) else {
                continue;
            };
            let text = fields
                .get("id")
                .and_then(Value::as_str)
                .and_then(|id| search_text.get(id));
            if let Some(text) = text {
                fields.insert("searchText".into(), Value::String(text.clone()));
            }
        }
    }
    if let Some(root) = serialized.get_mut("root") {
        let root_value = std::mem::take(root);
        let mut cleaned = clean(root_value);
        *root = cleaned
            .pop()
            .ok_or(lexical_model::Error::Invariant("saved root"))?;
    }
    Ok(serialized)
}
fn clean(mut node: Value) -> Vec<Value> {
    let kind = node
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned();
    if matches!(kind.as_str(), "completion" | "inline-search") {
        return vec![];
    }
    if let Some(children) = node.get_mut("children").and_then(Value::as_array_mut) {
        let previous = std::mem::take(children);
        *children = previous.into_iter().flat_map(clean).collect();
    }
    if kind == "comment-mark" && node.get("isDraft") == Some(&Value::Bool(true)) {
        return node
            .get_mut("children")
            .and_then(Value::as_array_mut)
            .map(std::mem::take)
            .unwrap_or_default();
    }
    if kind == "custom-code"
        && let Some(children) = node.get_mut("children")
    {
        *children = Value::Array(vec![]);
    }
    vec![node]
}
