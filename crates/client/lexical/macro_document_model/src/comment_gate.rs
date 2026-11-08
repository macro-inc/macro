//! Comment-only changes through the lexical-service export registry.
use crate::{Result, nodes::CommentNode};
use lexical_model::*;
use serde_json::Value;

fn without_identity(node: &mut Value) {
    if let Some(state) = node.get_mut("$").and_then(Value::as_object_mut) {
        for name in ["id", "peerId", "sharedPeerIds", "local"] {
            state.remove(name);
        }
        if state.is_empty()
            && let Some(object) = node.as_object_mut()
        {
            object.remove("$");
        }
    }
    if let Some(children) = node.get_mut("children").and_then(Value::as_array_mut) {
        children.iter_mut().for_each(without_identity);
    }
}

/// Normalize identity and comment wrappers using the service's exact class registry.
/// Other mark classes and non-identity state remain content.
pub fn content_without_comments(state: &SerializedEditorState) -> Result<Value> {
    normalize(state, crate::export_builder())
}
/// Normalize with explicit constructor entropy and time while retaining the service registry.
pub fn content_without_comments_with_context(
    state: &SerializedEditorState,
    context: &crate::DocumentContext,
) -> Result<Value> {
    normalize(
        state,
        crate::export_builder()
            .extension_state(context.clock.clone())
            .extension_state(context.random.clone())
            .extension_state(context.host.clone()),
    )
}
fn normalize(state: &SerializedEditorState, builder: EditorBuilder) -> Result<Value> {
    let mut raw = serde_json::to_value(state)?;
    without_identity(&mut raw["root"]);
    let mut editor = builder.build()?;
    let parsed = editor.parse_editor_state(&serde_json::from_value(raw)?)?;
    for (key, _) in parsed.view().descendants(NodeKey::ROOT) {
        if parsed.view().is::<CommentNode>(key) {
            parsed.view().export_json(key)?;
        }
        if let Some(node) = parsed.view().get::<crate::nodes::ContactMentionNode>(key) {
            node.validate_text_content()?;
        }
    }
    editor.set_editor_state(parsed, TagSet::default())?;
    editor.update(|tx| {
        let order = lexical_rich_nodes::utils::dfs(tx.view(), None, None);
        for record in order {
            if tx.is::<CommentNode>(record.node) {
                lexical_rich_nodes::mark::unwrap_mark_node(tx, record.node)?;
            } else if tx.is_text(record.node) {
                tx.mark_dirty(record.node)?;
            }
        }
        Ok(())
    })?;
    Ok(serde_json::to_value(editor.state().to_json()?)?)
}

/// Return whether the states differ only in comments and their identity fields.
/// Invalid imports return an error so a permission adapter can refuse the change.
pub fn is_comment_only_change(
    before: &SerializedEditorState,
    after: &SerializedEditorState,
) -> Result<bool> {
    Ok(content_without_comments(before)? == content_without_comments(after)?)
}

/// Compare the raw root objects supplied by the synchronization gate.
pub fn is_comment_only_root_change(before_root: &Value, after_root: &Value) -> Result<bool> {
    is_comment_only_change(
        &serde_json::from_value(serde_json::json!({"root":before_root}))?,
        &serde_json::from_value(serde_json::json!({"root":after_root}))?,
    )
}
