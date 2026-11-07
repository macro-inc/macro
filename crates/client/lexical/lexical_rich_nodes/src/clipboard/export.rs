//! Selection export with text slicing, copy hooks and excluded-wrapper hoisting.
use super::*;
fn append(
    state: StateRef<'_>,
    node: NodeKey,
    selection: Option<&Selection>,
    output: &mut Vec<Value>,
) -> Result<bool, Error> {
    let mut include = selection.is_none() || state.is_selected(node, selection);
    let exclude =
        state.is_element(node) && state.exclude_from_copy(node, Some(CopyDestination::Html));
    let mut serialized = state.export_json(node)?;
    if state.is_text(node) {
        let text = if let Some(selection) = selection {
            crate::selection::slice_selected_text_node_content(state, selection, node)?
        } else {
            state.text_content(node).into_owned()
        };
        if text.is_empty() {
            include = false;
        }
        serialized.insert("text".to_owned(), Value::String(text));
    }
    let mut children = Vec::new();
    if state.is_element(node) {
        if !serialized.get("children").is_some_and(Value::is_array) {
            return Err(Error::Invariant("element exportJSON must include children"));
        }
        for child in state.children_keys(node)? {
            let included = append(state, child, selection, &mut children)?;
            if included
                && !include
                && state.extract_with_child(node, child, selection, CopyDestination::Clone)
            {
                include = true;
            }
        }
        serialized.insert("children".to_owned(), Value::Array(children.clone()));
    }
    if include && !exclude {
        output.push(Value::Object(serialized));
    } else {
        output.extend(children);
    }
    Ok(include)
}
/// Export the whole document or a selection, hoisting excluded wrappers.
pub fn generate_json_from_selected_nodes(
    state: StateRef<'_>,
    namespace: &str,
    selection: Option<&Selection>,
) -> Result<LexicalClipboardPayload, Error> {
    let mut nodes = Vec::new();
    for node in state.children_keys(NodeKey::ROOT)? {
        append(state, node, selection, &mut nodes)?;
    }
    Ok(LexicalClipboardPayload {
        namespace: namespace.to_owned(),
        nodes,
    })
}
/// Internal content is absent for null, collapsed or empty selections.
pub fn get_lexical_content(
    state: StateRef<'_>,
    namespace: &str,
    selection: Option<&Selection>,
) -> Result<Option<String>, Error> {
    let Some(selection) = selection else {
        return Ok(None);
    };
    if selection.is_collapsed() || selection.nodes(state)?.is_empty() {
        return Ok(None);
    }
    let payload = generate_json_from_selected_nodes(state, namespace, Some(selection))?;
    Ok(Some(to_js_json_string(&serde_json::to_value(payload)?)))
}
/// Default portable clipboard entries; HTML export is provided by the view.
pub fn get_clipboard_data_from_selection(
    state: StateRef<'_>,
    namespace: &str,
    selection: Option<&Selection>,
) -> Result<indexmap::IndexMap<&'static str, String>, Error> {
    let mut data = indexmap::IndexMap::from([(MIME_PLAIN, String::new())]);
    if let Some(selection) = selection {
        data.insert(MIME_PLAIN, selection.text_content(state)?);
    }
    if let Some(content) = get_lexical_content(state, namespace, selection)? {
        data.insert(MIME_LEXICAL, content);
    }
    Ok(data)
}
