use super::*;
use serde_json::Value;
/// Application exclusions and comparison policy; projection has no application dependencies.
pub trait SyncPolicy: Send + Sync + 'static {
    /// Source own-undefined properties stored as Loro null instead of omitted JSON.
    fn own_undefined_fields(&self, _node_type: &str) -> &[String] {
        &[]
    }
    /// Drop the node and its entire subtree.
    fn is_dropped(&self, view: StateRef<'_>, key: NodeKey) -> bool;
    /// Replace this local wrapper with its synced descendants.
    fn is_transparent(&self, view: StateRef<'_>, key: NodeKey) -> bool;
    /// The same drop rule for persisted JSON.
    fn is_dropped_json(&self, node: &SerializedNode) -> bool;
    /// The same transparent-wrapper rule for persisted JSON.
    fn is_transparent_json(&self, node: &SerializedNode) -> bool;
    /// Canonical editor serialization for application-specific transport aliases.
    /// The default preserves every field; this never changes the Loro document.
    fn canonicalize_node_json(&self, _node: &mut SerializedNode) {}
    /// NodeState keys never written or deleted and masked on read.
    fn local_state_keys(&self) -> &'static [&'static str];
    /// Fields which alone do not trigger remote reconciliation.
    fn ignore_in_remote_compare(
        &self,
        node_type: &str,
        json: &SerializedNode,
    ) -> &'static [&'static str];
    /// Fields preserved from the editor when a remote update is applied.
    fn keep_local_on_remote(&self, node_type: &str) -> &'static [&'static str];
}
/// Unfiltered policy for portable editors and compatibility tests.
pub struct PlainPolicy;
impl SyncPolicy for PlainPolicy {
    fn is_dropped(&self, _: StateRef<'_>, _: NodeKey) -> bool {
        false
    }
    fn is_transparent(&self, _: StateRef<'_>, _: NodeKey) -> bool {
        false
    }
    fn is_dropped_json(&self, _: &SerializedNode) -> bool {
        false
    }
    fn is_transparent_json(&self, _: &SerializedNode) -> bool {
        false
    }
    fn local_state_keys(&self) -> &'static [&'static str] {
        &[]
    }
    fn ignore_in_remote_compare(&self, _: &str, _: &SerializedNode) -> &'static [&'static str] {
        &[]
    }
    fn keep_local_on_remote(&self, _: &str) -> &'static [&'static str] {
        &[]
    }
}
pub(crate) fn mask_local(json: &mut SerializedNode, policy: &dyn SyncPolicy) {
    policy.canonicalize_node_json(json);
    if let Some(Value::Object(state)) = json.get_mut("$") {
        for key in policy.local_state_keys() {
            state.remove(*key);
        }
        if state.is_empty() {
            json.remove("$");
        }
    }
}
pub(crate) fn own(
    view: StateRef<'_>,
    key: NodeKey,
    policy: &dyn SyncPolicy,
) -> Result<SerializedNode> {
    let mut json = view.export_json(key)?;
    json.remove("children");
    if let Some(ty) = json.get("type").and_then(Value::as_str) {
        for name in policy.own_undefined_fields(ty) {
            json.entry(name.clone()).or_insert(Value::Null);
        }
    }
    json.values_mut().for_each(schema::normalize_numbers);
    mask_local(&mut json, policy);
    Ok(json)
}
pub(crate) fn synced_children(
    view: StateRef<'_>,
    key: NodeKey,
    policy: &dyn SyncPolicy,
) -> Vec<NodeKey> {
    let mut result = Vec::new();
    for child in view.children(key) {
        if policy.is_dropped(view, child) {
            continue;
        }
        if policy.is_transparent(view, child) {
            result.extend(synced_children(view, child, policy))
        } else {
            result.push(child)
        }
    }
    result
}
pub(crate) fn synced_node(
    view: StateRef<'_>,
    key: NodeKey,
    policy: &dyn SyncPolicy,
) -> Result<SerializedNode> {
    let mut json = own(view, key, policy)?;
    if view.is_element(key) {
        json.insert(
            "children".into(),
            Value::Array(
                synced_children(view, key, policy)
                    .into_iter()
                    .map(|k| synced_node(view, k, policy).map(Value::Object))
                    .collect::<Result<_>>()?,
            ),
        );
    }
    Ok(json)
}
/// Export the editor's synced view, retaining application-defined shared state.
pub fn synced_json(state: &EditorState, policy: &dyn SyncPolicy) -> Result<SerializedEditorState> {
    Ok(SerializedEditorState {
        root: synced_node(state.view(), NodeKey::ROOT, policy)?,
    })
}
pub(crate) fn synced_owner(
    view: StateRef<'_>,
    mut key: NodeKey,
    policy: &dyn SyncPolicy,
) -> Option<NodeKey> {
    let mut node = Some(key);
    while let Some(k) = node {
        if policy.is_dropped(view, k) {
            return None;
        }
        node = view.parent(k);
    }
    while policy.is_transparent(view, key) {
        key = view.parent(key)?;
    }
    Some(key)
}
