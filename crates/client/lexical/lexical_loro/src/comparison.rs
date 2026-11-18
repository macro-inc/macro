//! Source export semantics for comparison only; storage serialization never calls this module.
use super::*;
use lexical_model::JsonField;
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
                format: match format {
                    JsonField::Value(format) => Some(Value::from(format.bits())),
                    JsonField::Null => Some(Value::Null),
                    JsonField::Absent => None,
                },
                style: match style {
                    JsonField::Value(style) => Some(Value::String(style.to_owned())),
                    JsonField::Null => Some(Value::Null),
                    JsonField::Absent => None,
                },
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
/// A stored node's masked own fields after Source's import normalization.
pub(crate) fn stored_own_normalized(
    map: &LoroMap,
    parent: Option<&LoroMap>,
    policy: &dyn SyncPolicy,
) -> Result<SerializedNode> {
    let mut own = schema::own_map(map, policy)?;
    mask_local(&mut own, policy);
    crate::policy::normalize_stored(&mut own, policy, || {
        parent
            .map(|parent| {
                let mut json = schema::own_map(parent, policy)?;
                mask_local(&mut json, policy);
                Ok(json)
            })
            .transpose()
    })?;
    Ok(own)
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
/// `parent` is the stored synced parent map, read only for parent-dependent normalization.
pub(crate) fn loro_own(
    map: &LoroMap,
    parent: Option<&LoroMap>,
    policy: &dyn SyncPolicy,
) -> Result<SerializedNode> {
    let mut own = stored_own_normalized(map, parent, policy)?;
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
/// Whether a stored node's own fields (and synced children) match the model's,
/// for the attach and consistency checks only. One direction: a STORED null in
/// one of the node's storage-null keys (policy::storage_null_keys, the table the
/// writer uses; Source's loroSyncState stores those undefined fields as null,
/// probes be8649fb, 1d9a47d4, 8672bafb) also matches a model key that is
/// absent. A model null against a stored absent key, and every other
/// difference, still diverges. Remote reconcile compares strictly instead.
pub(crate) fn stored_matches(
    view: StateRef<'_>,
    key: NodeKey,
    policy: &dyn SyncPolicy,
    model: &SerializedNode,
    stored: &SerializedNode,
) -> bool {
    stored_matches_collecting(view, key, policy, model, stored, &mut Vec::new())
}
/// stored_matches, also collecting every node whose model holds a storage-null
/// key absent while the store holds null: the nodes a Loro-driven import must
/// give that null.
pub(crate) fn stored_matches_collecting(
    view: StateRef<'_>,
    key: NodeKey,
    policy: &dyn SyncPolicy,
    model: &SerializedNode,
    stored: &SerializedNode,
    pending: &mut Vec<NodeKey>,
) -> bool {
    let encoded = crate::policy::storage_null_keys(view, key, policy);
    let children = synced_children(view, key, policy);
    let own = model
        .iter()
        .all(|(name, value)| match (name.as_str(), stored.get(name)) {
            ("children", Some(Value::Array(stored))) => match value {
                Value::Array(model) => {
                    model.len() == stored.len()
                        && model.len() == children.len()
                        && children.iter().zip(model.iter().zip(stored)).all(
                            |(child, (model, stored))| match (model.as_object(), stored.as_object())
                            {
                                (Some(model), Some(stored)) => stored_matches_collecting(
                                    view, *child, policy, model, stored, pending,
                                ),
                                _ => model == stored,
                            },
                        )
                }
                _ => false,
            },
            (_, Some(stored)) => value == stored,
            (_, None) => false,
        });
    let mut absent_null = false;
    let rest = stored.iter().all(|(name, value)| {
        if model.contains_key(name) {
            return true;
        }
        let encoded_null = value.is_null() && encoded.contains(&name.as_str());
        absent_null |= encoded_null;
        encoded_null
    });
    if absent_null {
        pending.push(key);
    }
    own && rest
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
