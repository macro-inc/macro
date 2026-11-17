use super::*;
use serde_json::Value;
/// Application exclusions and comparison policy; projection has no application dependencies.
pub trait SyncPolicy: Send + Sync + 'static {
    /// Whether normal local writes derive Source's root search text.
    fn writes_root_search_text(&self) -> bool {
        false
    }
    /// Durable identity used by the application's root search serialization.
    fn root_search_text_id(&self, _view: StateRef<'_>, _key: NodeKey) -> Result<Option<String>> {
        Ok(None)
    }
    /// Source own-undefined properties stored as Loro null instead of omitted JSON.
    fn own_undefined_fields(&self, _node_type: &str) -> &[String] {
        &[]
    }
    /// Whether this application node may retain a literal null own text field.
    /// This does not authorize other value types or alter stored values.
    fn allows_null_text(&self, _node_type: &str) -> bool {
        false
    }
    /// Source export rule used only when comparing projected model and Loro values.
    /// This never changes writer fields, persisted data, or construction authority.
    fn comparison_kind(&self, _node_type: &str) -> ComparisonKind {
        ComparisonKind::Exact
    }
    /// Own fields whose stored Loro value Source's import normalizes for this node type
    /// (computed at export, cleared on import, or never imported). Exhaustive for
    /// `normalize_stored`: it must change no other field.
    fn stored_normalized_fields(&self, node_type: &str) -> &'static [&'static str];
    /// Own fields an editor transform defaults inside a remote reconcile when the stored value
    /// is unset, with that default; each field is one of `stored_normalized_fields`. Source never
    /// writes the default as a fixup: its next local whole-state sync writes it.
    fn remote_update_defaults(&self, _node_type: &str) -> &'static [(&'static str, &'static str)] {
        &[]
    }
    /// Source's import normalization of a stored node's own fields, applied to Loro reads
    /// only. `parent` reads the stored parent's own fields for rules that depend on them.
    fn normalize_stored(
        &self,
        _node: &mut SerializedNode,
        _parent: &mut dyn FnMut() -> Result<Option<SerializedNode>>,
    ) -> Result<()> {
        Ok(())
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
    /// Synced nested root state keys whose live values survive an incoming update.
    /// Their incoming storage slots still participate in strict projection checks.
    fn retained_live_root_state(&self) -> &'static [&'static str] {
        &[]
    }
    /// Per-peer derived NodeState keys. Masked on every read and comparison (and so derived
    /// by the receiver on remote create, update and open). When the policy declares
    /// local_state_update_tag they are persisted as the model's value, written lazily by the
    /// next ordinary local projection after a change, as Source's whole-state sync writes them
    /// after the update that set them; otherwise they are never written.
    fn local_state_keys(&self) -> &'static [&'static str];
    /// Tag of commits that change only per-peer derived state. Declaring it opts into
    /// persisting local_state_keys; a chain made only of these commits writes none of it, as
    /// Source does not sync such updates.
    fn local_state_update_tag(&self) -> Option<&'static str> {
        None
    }
    /// Fields which alone do not trigger remote reconciliation.
    fn ignore_in_remote_compare(
        &self,
        node_type: &str,
        json: &SerializedNode,
    ) -> &'static [&'static str];
    /// Whether numeric exported indent represents ancestor nesting, rather than raw padding.
    /// Remote projection retains raw local padding and leaves missing/null slots unchanged.
    fn indent_is_tree_depth(&self, _node_type: &str) -> bool {
        false
    }
    /// Fields preserved from the editor when a remote update is applied.
    fn keep_local_on_remote(&self, node_type: &str) -> &'static [&'static str];
}
/// Unfiltered policy for portable editors and compatibility tests.
pub struct PlainPolicy;
impl SyncPolicy for PlainPolicy {
    fn stored_normalized_fields(&self, _: &str) -> &'static [&'static str] {
        &[]
    }
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
    mask_local_state(json, policy);
}
/// Apply Source's import normalization to Loro-read own fields; `parent` is read lazily.
pub(crate) fn normalize_stored(
    json: &mut SerializedNode,
    policy: &dyn SyncPolicy,
    mut parent: impl FnMut() -> Result<Option<SerializedNode>>,
) -> Result<()> {
    let fields = match json.get("type").and_then(Value::as_str) {
        Some(ty) => policy.stored_normalized_fields(ty),
        None => return Ok(()),
    };
    if fields.is_empty() {
        return Ok(());
    }
    let undeclared = |json: &SerializedNode| {
        let mut rest = json.clone();
        fields.iter().for_each(|field| {
            rest.remove(*field);
        });
        rest
    };
    let before = undeclared(json);
    policy.normalize_stored(json, &mut parent)?;
    if undeclared(json) != before {
        return Err(schema_error("normalize_stored changed an undeclared field"));
    }
    Ok(())
}
pub(crate) fn mask_local_state(json: &mut SerializedNode, policy: &dyn SyncPolicy) {
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
    prepare_own(&mut json, policy);
    Ok(json)
}
pub(crate) fn stored_own(
    view: StateRef<'_>,
    key: NodeKey,
    policy: &dyn SyncPolicy,
) -> Result<SerializedNode> {
    let mut json = view.export_stored_json(key)?;
    prepare_own(&mut json, policy);
    Ok(json)
}
fn prepare_own(json: &mut SerializedNode, policy: &dyn SyncPolicy) {
    json.remove("children");
    json.values_mut().for_each(schema::normalize_numbers);
    mask_local(json, policy);
}
/// Encode source own-undefined fields only for persisted Loro node maps.
pub(crate) fn storage_fields(json: &mut SerializedNode, policy: &dyn SyncPolicy) {
    mask_local_state(json, policy);
    if let Some(ty) = json.get("type").and_then(Value::as_str) {
        for name in policy.own_undefined_fields(ty) {
            json.entry(name.clone()).or_insert(Value::Null);
        }
    }
}
/// The one table of keys a Loro writer stores as null for this node when its
/// value is undefined: the builtin text/Paragraph keys from lexical_model plus
/// the application's own-undefined fields. Source's loroSyncState stores those
/// undefined values as null on creation (probes be8649fb, 1d9a47d4, 8672bafb).
pub(crate) fn storage_null_keys<'policy>(
    view: StateRef<'_>,
    key: NodeKey,
    policy: &'policy dyn SyncPolicy,
) -> Vec<&'policy str> {
    let mut keys: Vec<&str> = view.storage_null_keys(key).to_vec();
    if let Ok(ty) = view.type_name(key) {
        for name in policy.own_undefined_fields(ty) {
            if !keys.contains(&name.as_str()) {
                keys.push(name.as_str());
            }
        }
    }
    keys
}
/// storage_null_keys for a serialized node without a model view: the builtin text
/// keys for the policy's text bases (ComparisonKind::Text), the builtin Paragraph
/// keys for a Paragraph, and the policy's own-undefined fields for its type.
fn storage_null_keys_json<'policy>(
    node_type: &str,
    policy: &'policy dyn SyncPolicy,
) -> Vec<&'policy str> {
    let mut keys: Vec<&str> = if policy.comparison_kind(node_type) == ComparisonKind::Text {
        lexical_model::TEXT_STORAGE_NULL_KEYS.to_vec()
    } else if node_type == <lexical_model::Paragraph as lexical_model::NodeType>::TYPE {
        lexical_model::PARAGRAPH_STORAGE_NULL_KEYS.to_vec()
    } else {
        Vec::new()
    };
    for name in policy.own_undefined_fields(node_type) {
        if !keys.contains(&name.as_str()) {
            keys.push(name.as_str());
        }
    }
    keys
}
/// A creator's exported node tree as a Source importer reads it back from Loro:
/// Source's loroSyncState stores a storage-null key (storage_null_keys) the export
/// left absent as null on creation (probes be8649fb, 1d9a47d4, 8672bafb), and every
/// read then applies the policy's stored normalization (normalize_stored), as this
/// crate's own Loro reads do. Present values the normalization does not own are
/// kept exactly.
///
/// This is the JSON form of that read for comparing a creator's export with an
/// importer (simulations, tests); product reads go through the projection, never
/// through this.
pub fn read_back_storage_nulls(node: &mut Value, policy: &dyn SyncPolicy) -> Result<()> {
    read_back_node(node, None, policy)
}
fn read_back_node(
    node: &mut Value,
    parent: Option<&SerializedNode>,
    policy: &dyn SyncPolicy,
) -> Result<()> {
    let Some(object) = node.as_object_mut() else {
        return Ok(());
    };
    let node_type = object
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned();
    for name in storage_null_keys_json(&node_type, policy) {
        object.entry(name).or_insert(Value::Null);
    }
    let mut children = object.remove("children");
    normalize_stored(object, policy, || Ok(parent.cloned()))?;
    if let Some(Value::Array(children)) = &mut children {
        let own = object.clone();
        for child in children {
            read_back_node(child, Some(&own), policy)?;
        }
    }
    if let Some(children) = children {
        object.insert("children".to_owned(), children);
    }
    Ok(())
}
/// Store null for every storage-null key the export left absent; returns them.
fn write_storage_nulls(
    view: StateRef<'_>,
    key: NodeKey,
    policy: &dyn SyncPolicy,
    json: &mut SerializedNode,
) -> Vec<String> {
    let mut inserted = Vec::new();
    for name in storage_null_keys(view, key, policy) {
        if !json.contains_key(name) {
            json.insert(name.to_owned(), Value::Null);
            inserted.push(name.to_owned());
        }
    }
    inserted
}
pub(crate) fn storage_own(
    view: StateRef<'_>,
    key: NodeKey,
    policy: &dyn SyncPolicy,
) -> Result<SerializedNode> {
    let mut json = stored_own(view, key, policy)?;
    write_storage_nulls(view, key, policy, &mut json);
    storage_fields(&mut json, policy);
    Ok(json)
}
/// Reuse owned capacities while running every export hook in ordinary order.
pub(crate) fn storage_own_reusing(
    view: StateRef<'_>,
    key: NodeKey,
    policy: &dyn SyncPolicy,
    buffer: lexical_model::JsonExportBuffer,
) -> Result<(lexical_model::JsonExportBuffer, Vec<String>)> {
    let mut buffer = view.export_stored_json_reusing(key, buffer)?;
    let json = buffer.json_mut();
    prepare_own(json, policy);
    let inserted = write_storage_nulls(view, key, policy, json);
    storage_fields(json, policy);
    Ok((buffer, inserted))
}
pub(crate) fn storage_tree(json: &mut SerializedNode, policy: &dyn SyncPolicy) {
    storage_fields(json, policy);
    if let Some(Value::Array(children)) = json.get_mut("children") {
        for child in children {
            if let Value::Object(node) = child {
                storage_tree(node, policy);
            }
        }
    }
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
    node_json(view, key, policy, NodeExport::Parsed)
}
pub(crate) fn storage_node(
    view: StateRef<'_>,
    key: NodeKey,
    policy: &dyn SyncPolicy,
) -> Result<SerializedNode> {
    node_json(view, key, policy, NodeExport::Storage)
}
pub(crate) fn stored_node(
    view: StateRef<'_>,
    key: NodeKey,
    policy: &dyn SyncPolicy,
) -> Result<SerializedNode> {
    node_json(view, key, policy, NodeExport::Stored)
}
#[derive(Clone, Copy)]
enum NodeExport {
    Parsed,
    Stored,
    Storage,
}
fn node_json(
    view: StateRef<'_>,
    key: NodeKey,
    policy: &dyn SyncPolicy,
    mode: NodeExport,
) -> Result<SerializedNode> {
    let mut json = match mode {
        NodeExport::Parsed => own(view, key, policy)?,
        NodeExport::Stored => stored_own(view, key, policy)?,
        NodeExport::Storage => storage_own(view, key, policy)?,
    };
    if view.is_element(key) {
        json.insert(
            "children".into(),
            Value::Array(
                synced_children(view, key, policy)
                    .into_iter()
                    .map(|k| node_json(view, k, policy, mode).map(Value::Object))
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
