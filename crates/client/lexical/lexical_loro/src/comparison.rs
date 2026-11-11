//! Source export semantics for comparison only; storage serialization never calls this module.
use super::*;
use serde_json::Value;

/// Explicit application metadata for canonical projected comparisons, not construction authority.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum ComparisonKind {
    /// Compare fields exactly as the ordinary writer/read policy emits them.
    #[default]
    Exact,
    /// Source paragraph export uses the first direct projected text child's format/style.
    Paragraph,
    /// A text base whose serialized format/style can supply that paragraph export.
    Text,
}

struct TextFields {
    format: Option<Value>,
    style: Option<Value>,
}
fn paragraph(node: &SerializedNode, policy: &dyn SyncPolicy) -> bool {
    node.get("type")
        .and_then(Value::as_str)
        .is_some_and(|ty| policy.comparison_kind(ty) == ComparisonKind::Paragraph)
}
fn apply(node: &mut SerializedNode, text: Option<TextFields>) {
    let Some(text) = text else {
        return;
    };
    for (key, value) in [("textFormat", text.format), ("textStyle", text.style)] {
        match value {
            Some(value) => {
                node.insert(key.to_owned(), value);
            }
            None => {
                node.remove(key);
            }
        }
    }
}
fn first_model_text(
    view: StateRef<'_>,
    parent: NodeKey,
    policy: &dyn SyncPolicy,
) -> Result<Option<TextFields>> {
    for key in view.children(parent) {
        if policy.is_dropped(view, key) {
            continue;
        }
        if policy.is_transparent(view, key) {
            if let Some(text) = first_model_text(view, key, policy)? {
                return Ok(Some(text));
            }
        } else if policy.comparison_kind(view.type_name(key)?) == ComparisonKind::Text {
            let (format, style) = view.text_data(key)?.json_format_style();
            return Ok(Some(TextFields {
                format: format.map(|format| Value::from(format.bits())),
                style: style.map(|style| Value::String(style.to_owned())),
            }));
        }
    }
    Ok(None)
}
fn first_loro_text(parent: &LoroMap, policy: &dyn SyncPolicy) -> Result<Option<TextFields>> {
    let Some(children) = schema::children(parent)? else {
        return Ok(None);
    };
    for index in 0..children.len() {
        let child = schema::map_at(children.get(index), "comparison child")?;
        let mut own = schema::own_map(&child, policy)?;
        if policy.is_dropped_json(&own) {
            continue;
        }
        if policy.is_transparent_json(&own) {
            if let Some(text) = first_loro_text(&child, policy)? {
                return Ok(Some(text));
            }
        } else if own
            .get("type")
            .and_then(Value::as_str)
            .is_some_and(|ty| policy.comparison_kind(ty) == ComparisonKind::Text)
        {
            return Ok(Some(TextFields {
                format: own.remove("format"),
                style: own.remove("style"),
            }));
        }
    }
    Ok(None)
}
/// The iterator is consulted only for an opted-in paragraph and stops at its first text.
pub(crate) fn model_own(
    view: StateRef<'_>,
    key: NodeKey,
    policy: &dyn SyncPolicy,
) -> Result<SerializedNode> {
    let mut own = crate::policy::stored_own(view, key, policy)?;
    if paragraph(&own, policy) {
        apply(&mut own, first_model_text(view, key, policy)?);
    }
    Ok(own)
}
pub(crate) fn loro_own(map: &LoroMap, policy: &dyn SyncPolicy) -> Result<SerializedNode> {
    let mut own = schema::own_map(map, policy)?;
    mask_local(&mut own, policy);
    if paragraph(&own, policy) {
        apply(&mut own, first_loro_text(map, policy)?);
    }
    Ok(own)
}
fn tree(node: &mut SerializedNode, policy: &dyn SyncPolicy) {
    let is_paragraph = paragraph(node, policy);
    let mut first = None;
    if let Some(Value::Array(children)) = node.get_mut("children") {
        for child in children {
            let Some(child) = child.as_object_mut() else {
                continue;
            };
            tree(child, policy);
            if is_paragraph
                && first.is_none()
                && child
                    .get("type")
                    .and_then(Value::as_str)
                    .is_some_and(|ty| policy.comparison_kind(ty) == ComparisonKind::Text)
            {
                first = Some(TextFields {
                    format: child.get("format").cloned(),
                    style: child.get("style").cloned(),
                });
            }
        }
    }
    if is_paragraph {
        apply(node, first);
    }
}
pub(crate) fn model(state: &EditorState, policy: &dyn SyncPolicy) -> Result<SerializedEditorState> {
    let mut value = SerializedEditorState {
        root: crate::policy::stored_node(state.view(), NodeKey::ROOT, policy)?,
    };
    tree(&mut value.root, policy);
    Ok(value)
}
pub(crate) fn loro(doc: &LoroDoc, policy: &dyn SyncPolicy) -> Result<SerializedEditorState> {
    let mut value = reconstruct_state(doc, policy)?;
    tree(&mut value.root, policy);
    Ok(value)
}

// Export-equivalent caches can still be explicit incoming state. Retain those
// real updates so writable reconciliation and later empty-paragraph typing
// inherit the actual source sequence rather than silently losing a wire change.
pub(crate) fn raw_paragraph_changed(
    view: StateRef<'_>,
    key: NodeKey,
    incoming: &SerializedNode,
    policy: &dyn SyncPolicy,
) -> Result<bool> {
    if !paragraph(incoming, policy) {
        return Ok(false);
    }
    let data = view.element_data(key)?;
    let format_matches = incoming
        .get("textFormat")
        .map_or(data.text_format.is_empty(), |format| {
            format == &Value::from(data.text_format.bits())
        });
    let style_matches = incoming
        .get("textStyle")
        .map_or(data.text_style.is_empty(), |style| {
            style.as_str() == Some(data.text_style.as_ref())
        });
    Ok(!format_matches || !style_matches)
}

#[cfg(test)]
mod test;
