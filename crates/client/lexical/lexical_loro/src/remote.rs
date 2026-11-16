use super::*;
use crate::index::Slot;
use lexical_model::{NodeTarget, Utf16Offset};
use serde_json::Value;
#[derive(Clone)]
pub(crate) struct PendingBatch {
    pub diffs: Vec<OwnedDiff>,
    /// A diff's path was longer than any tree within the nesting cap can produce; its
    /// path was not retained (copying every such path is quadratic in depth).
    pub too_deep: bool,
}
/// Two path entries per stored level (a map and its children list) plus the root and
/// own-field containers: a longer path cannot belong to a tree within the stored cap.
const MAX_EVENT_PATH: usize = 2 * crate::schema::MAX_STORED_DEPTH + 16;
#[derive(Clone)]
pub(crate) struct OwnedDiff {
    target: ContainerID,
    path: Vec<(ContainerID, loro::Index)>,
    text: Option<Vec<loro::TextDelta>>,
    children_replaced: bool,
    text_replaced: bool,
}
impl PendingBatch {
    /// Whether a diff changed a container a projected node owns, directly or below it.
    pub fn touches_projection(&self, index: &crate::index::NodeIndex) -> bool {
        self.too_deep
            || self.diffs.iter().any(|diff| {
                index.owner.contains_key(&diff.target)
                    || diff.path.iter().any(|(id, _)| index.owner.contains_key(id))
            })
    }
    pub fn from_event(event: loro::event::DiffEvent<'_>) -> Self {
        let too_deep = event
            .events
            .iter()
            .any(|event| event.path.len() > MAX_EVENT_PATH);
        if too_deep {
            return Self {
                diffs: Vec::new(),
                too_deep,
            };
        }
        let diffs=event.events.into_iter().map(|event| {
            let children_replaced=matches!(&event.diff,loro::event::Diff::Map(map) if map.updated.contains_key("children"));
            let text_replaced=matches!(&event.diff,loro::event::Diff::Map(map) if map.updated.contains_key("text"));
            let text=match event.diff {loro::event::Diff::Text(delta)=>Some(delta),_=>None};
            OwnedDiff{target:event.target.clone(),path:event.path.to_vec(),text,children_replaced,text_replaced}
        }).collect();
        Self { diffs, too_deep }
    }
}
/// Raw remote changes and their native creation identities, retained until binding succeeds.
pub struct RemoteChanges {
    /// Ordered core model edits.
    pub changes: Vec<NodeChange>,
    /// Existing nodes whose own Loro maps the import changed, even when the change
    /// canonicalizes away (a stored null replacing an unset field).
    pub touched: Vec<NodeKey>,
    pending: Vec<(LocalNode, LoroMap)>,
    search_text_updates: Vec<(NodeKey, ContainerID)>,
    observed_remote: bool,
    /// Incremental work performed.
    pub stats: ProjectionStats,
}
struct Building<'a> {
    doc: &'a LoroDoc,
    state: &'a EditorState,
    fields: OrderedSet<NodeKey>,
    built: OrderedSet<ContainerID>,
    reused: OrderedSet<NodeKey>,
    removed: OrderedSet<NodeKey>,
    creates: Vec<NodeChange>,
    lists: Vec<(NodeTarget, Vec<NodeTarget>)>,
    pending: Vec<(LocalNode, LoroMap)>,
    stats: ProjectionStats,
}
fn path(doc: &LoroDoc, id: &ContainerID) -> Vec<(u8, String, usize)> {
    doc.get_path_to_container(id)
        .unwrap_or_default()
        .into_iter()
        .map(|(_, index)| match index {
            loro::Index::Seq(n) => (1, String::new(), n),
            loro::Index::Key(k) => (0, k.to_string(), 0),
            loro::Index::Node(n) => (2, n.to_string(), 0),
        })
        .collect()
}
// Compare against FINAL remote topology: the model still has the old topology here.
// C-LIST-INDENT-RESTRUCTURE-ON-MISMATCH-01 remains open: counting is not a
// claim to implement Source's restructuring when stored depth is inconsistent.
fn derived_indent_mismatch(
    doc: &LoroDoc,
    map: &LoroMap,
    incoming: &SerializedNode,
    policy: &dyn SyncPolicy,
) -> Result<bool> {
    let Some(Value::Number(stored)) = incoming.get("indent") else {
        return Ok(false);
    };
    let path = doc
        .get_path_to_container(&map.id())
        .ok_or_else(|| diverged("derived indent node has no stored path"))?;
    let mut depth = 0_u64;
    for (id, _) in path {
        if id == map.id() {
            continue;
        }
        if let Some(Container::Map(ancestor)) = doc.get_container(id)
            && let Some(value) = ancestor.get("type")
            && let Value::String(kind) = schema::read_value(&value)?
            && policy.indent_is_tree_depth(&kind)
        {
            depth += 1;
        }
    }
    Ok(stored.as_u64() != Some(depth))
}

impl LoroProjection {
    /// Import a transport update with an explicit origin, then project all buffered batches.
    pub fn remote(
        &mut self,
        doc: &LoroDoc,
        state: &EditorState,
        bytes: &[u8],
    ) -> Result<(loro::ImportStatus, RemoteChanges)> {
        let status = doc.import_with(bytes, "from-loro")?;
        let changes = self.take_remote(doc, state)?;
        Ok((status, changes))
    }
    /// Resolve buffered native events against the final document state; consume only on success.
    #[tracing::instrument(name = "doc.projection.remote", skip_all, err)]
    pub fn take_remote(&mut self, doc: &LoroDoc, state: &EditorState) -> Result<RemoteChanges> {
        let batches = self
            .events
            .lock()
            .map_err(|_| diverged("event buffer poisoned"))?
            .clone();
        let count = batches.len();
        let mut parents = OrderedSet::default();
        let mut fields = OrderedSet::default();
        let mut replaced_text = OrderedSet::default();
        let mut text: OrderedMap<NodeKey, Vec<Vec<loro::TextDelta>>> = OrderedMap::default();
        if batches.iter().any(|batch| batch.too_deep) {
            return Err(lexical_model::Error::NestingTooDeep {
                limit: lexical_model::MAX_NODE_DEPTH,
            }
            .into());
        }
        for batch in &batches {
            for diff in &batch.diffs {
                let Some((key, slot)) = self.index.owner.get(&diff.target).copied() else {
                    // Filtered wrappers and newly inserted own-field containers
                    // are not indexed. Their saved path still identifies the
                    // existing list/field whose synced value can have changed.
                    if let Some((key, slot)) = diff
                        .path
                        .iter()
                        .rev()
                        .find_map(|(id, _)| self.index.owner.get(id).copied())
                    {
                        if slot == Slot::Children {
                            parents.insert(key);
                        } else {
                            fields.insert(key);
                        }
                    }
                    continue;
                };
                match slot {
                    Slot::Children => {
                        parents.insert(key);
                    }
                    Slot::Text => {
                        if let Some(delta) = &diff.text {
                            text.entry(key).or_default().push(delta.clone());
                        } else {
                            fields.insert(key);
                        }
                    }
                    Slot::Node => {
                        fields.insert(key);
                        if diff.text_replaced {
                            replaced_text.insert(key);
                        }
                        if diff.children_replaced {
                            parents.insert(key);
                        }
                    }
                    _ => {
                        fields.insert(key);
                    }
                }
            }
        }
        // Every Loro-driven import (remote or history) revisits each node whose
        // model holds a storage-null key absent over a stored null, as Source's
        // whole-tree reconcile does; local commits never come here. Each is
        // visited once.
        // Cleared only once the batch projects successfully (below): a diverged
        // projection keeps them for the recovery path.
        let visited_pending: Vec<NodeKey> = if count > 0 {
            self.pending_nulls.iter().copied().collect()
        } else {
            Vec::new()
        };
        for key in &visited_pending {
            if state.view().is_attached(*key) && self.index.nodes.contains_key(key) {
                fields.insert(*key);
            }
        }
        let mut hidden = Vec::new();
        for key in &fields {
            let map = self.index.map(doc, *key)?;
            if map.is_deleted() {
                continue;
            }
            let incoming = schema::own_map(&map, self.policy)?;
            if self.policy.is_dropped_json(&incoming) || self.policy.is_transparent_json(&incoming)
            {
                hidden.push(*key);
                if let Some(path) = doc.get_path_to_container(&map.id()) {
                    for (id, _) in path.iter().rev().skip(1) {
                        if let Some((parent, Slot::Node)) = self.index.owner.get(id) {
                            parents.insert(*parent);
                            break;
                        }
                    }
                }
            }
        }
        for key in hidden {
            fields.swap_remove(&key);
            text.swap_remove(&key);
        }
        let mut building = Building {
            doc,
            state,
            fields,
            built: OrderedSet::default(),
            reused: OrderedSet::default(),
            removed: OrderedSet::default(),
            creates: Vec::new(),
            lists: Vec::new(),
            pending: Vec::new(),
            stats: ProjectionStats::default(),
        };
        let mut parents = parents.into_iter().collect::<Vec<_>>();
        parents.sort_by_key(|key| {
            self.container_of(*key)
                .map(|id| path(doc, id))
                .unwrap_or_default()
        });
        for key in parents {
            let map = self.index.map(doc, key)?;
            if map.is_deleted() || !self.is_projected(doc, &map)? {
                continue;
            }
            let mut depth = 0usize;
            let mut node = key;
            while let Some(parent) = state.view().parent(node) {
                depth += 1;
                node = parent;
            }
            self.build_children(&mut building, NodeTarget::Key(key), &map, depth)?;
        }
        // After building, so keys a remote move re-bound to a new map count as touched.
        let touched: Vec<NodeKey> = building.fields.iter().copied().collect();
        // Source's collab reconcile compares every node's stored own JSON, `$` included, on
        // each Loro-driven update, so blocks whose stored search text this peer wrote are
        // imported too, whether or not this update changed them.
        let authored = self
            .search_text
            .as_ref()
            .map(|search| search.authored_keys(&self.index))
            .unwrap_or_default();
        // Slot replacements now become visible to subsequent event classification.
        let mut ordered_fields = building.fields.iter().copied().collect::<Vec<_>>();
        for key in &authored {
            if !building.fields.contains(key) {
                ordered_fields.push(*key);
            }
        }
        ordered_fields.sort_by_key(|key| {
            self.container_of(*key)
                .map(|id| path(doc, id))
                .unwrap_or_default()
        });
        let mut splices = Vec::new();
        let mut text_after: FxHashMap<NodeKey, String> = FxHashMap::default();
        let mut ordered_text = text.into_iter().collect::<Vec<_>>();
        ordered_text.sort_by_key(|(key, _)| {
            self.container_of(*key)
                .map(|id| path(doc, id))
                .unwrap_or_default()
        });
        for (key, batches) in ordered_text {
            if replaced_text.contains(&key)
                || building.reused.contains(&key)
                || !state.view().is_text(key)
            {
                continue;
            }
            let map = self.index.map(doc, key)?;
            if map.is_deleted() || !self.is_projected(doc, &map)? {
                continue;
            }
            let mut current = state.view().text_data(key)?.text.as_str().to_owned();
            for delta in batches {
                apply_delta(key, &mut current, &delta, &mut splices)?;
            }
            let expected = map
                .get("text")
                .as_ref()
                .map(schema::read_value)
                .transpose()?
                .and_then(|v| v.as_str().map(str::to_owned));
            if expected.as_deref() != Some(current.as_str()) {
                return Err(diverged(format!("text delta result differs at {key}")));
            }
            building.stats.nodes_visited += 1;
            text_after.insert(key, current);
        }
        let mut updates = Vec::new();
        let mut search_text_updates = Vec::new();
        for key in ordered_fields {
            if !state.view().is_attached(key) {
                continue;
            }
            let map = self.index.map(doc, key)?;
            if map.is_deleted() || !self.is_projected(doc, &map)? {
                continue;
            }
            building.stats.nodes_visited += 1;
            let parent = self
                .index
                .synced_parent_map(doc, state.view(), key, self.policy)?;
            let mut incoming =
                comparison::stored_own_normalized(&map, parent.as_ref(), self.policy)?;
            let mut current = comparison::model_own(state.view(), key, self.policy)?;
            // Compare against the locally authored storage value until an actual
            // incoming own update imports it. This also detects a history
            // deletion when the ordinary editor slot was already absent.
            if let Some(search) = &self.search_text {
                search.apply_expected(key, &self.index, &mut current);
            }
            if let Some(text) = text_after.get(&key) {
                current.insert("text".into(), Value::String(text.clone()));
            }
            let kind = incoming
                .get("type")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_owned();
            if current.get("type") != incoming.get("type") {
                return Err(diverged(format!("remote type changed at {key}")));
            }
            let derived_indent = self.policy.indent_is_tree_depth(&kind);
            if derived_indent && derived_indent_mismatch(doc, &map, &incoming, self.policy)? {
                building.stats.derived_indent_mismatches += 1;
            }
            let mut compare = comparison::loro_own(&map, parent.as_ref(), self.policy)?;
            self.tolerate_model_drift(key, &mut current, &compare);
            for field in self.policy.ignore_in_remote_compare(&kind, &incoming) {
                compare.remove(*field);
                current.remove(*field);
            }
            // Strict, as Source's reconcile: a model absent against a stored null
            // differs, so the null is imported.
            if current != compare
                || authored.contains(&key)
                || comparison::raw_paragraph_changed(state.view(), key, &incoming, self.policy)?
            {
                if state.view().is_text(key) {
                    let before = text_after
                        .get(&key)
                        .map(String::as_str)
                        .unwrap_or(state.view().text_data(key)?.text.as_str());
                    if let Some(after) = incoming.get("text").and_then(Value::as_str)
                        && before != after
                    {
                        minimal_splice(key, before, after, &mut splices)?;
                    }
                }
                let retained = if key == NodeKey::ROOT {
                    self.policy.retained_live_root_state()
                } else {
                    &[]
                };
                let stored_state = incoming.get("$").and_then(Value::as_object);
                let stored_slots: Vec<_> = retained
                    .iter()
                    .map(|&name| {
                        (
                            name,
                            stored_state.and_then(|state| state.get(name)).cloned(),
                        )
                    })
                    .collect();
                for field in self.policy.keep_local_on_remote(&kind) {
                    match state.view().export_json(key)?.get(*field) {
                        Some(value) => {
                            incoming.insert((*field).into(), value.clone());
                        }
                        None => {
                            incoming.remove(*field);
                        }
                    }
                }
                if derived_indent {
                    // Preserve the prior slot's absence/null exactly as keep-local did.
                    // A number carries RAW padding, never the exported depth getter.
                    let local = state.view().export_json(key)?;
                    match local.get("indent") {
                        Some(Value::Number(_)) => {
                            incoming.insert(
                                "indent".into(),
                                state.view().element_data(key)?.indent.into(),
                            );
                        }
                        Some(value) => {
                            incoming.insert("indent".into(), value.clone());
                        }
                        None => {
                            incoming.remove("indent");
                        }
                    }
                }
                if let Some(Value::Object(local)) = state.view().export_json(key)?.get("$") {
                    for name in self.policy.local_state_keys() {
                        if let Some(value) = local.get(*name) {
                            let entry = incoming
                                .entry("$")
                                .or_insert_with(|| Value::Object(SerializedNode::new()));
                            let data = entry.as_object_mut().ok_or_else(|| schema_error("$"))?;
                            data.insert((*name).into(), value.clone());
                        }
                    }
                }
                let change = if retained.is_empty() {
                    NodeChange::Update {
                        node: NodeTarget::Key(key),
                        json: incoming,
                    }
                } else {
                    // The retained keys describe the real stored slots before local overlays.
                    for (name, value) in stored_slots {
                        if let Some(value) = value {
                            let entry = incoming
                                .entry("$")
                                .or_insert_with(|| Value::Object(SerializedNode::new()));
                            let values = entry.as_object_mut().ok_or_else(|| schema_error("$"))?;
                            values.insert(name.to_owned(), value);
                        } else if let Some(values) =
                            incoming.get_mut("$").and_then(Value::as_object_mut)
                        {
                            values.shift_remove(name);
                        }
                    }
                    NodeChange::UpdateRootRetainingState {
                        json: incoming,
                        retain: retained,
                    }
                };
                if self.search_text.is_some() {
                    search_text_updates.push((key, map.id()));
                }
                updates.push(change);
            }
            self.index.bind(key, &map, self.policy)?;
        }
        // A policy-filtered map can remain live in Loro after its model node
        // disappears. Retire that binding while retaining visible descendants
        // moved through a newly transparent wrapper.
        for key in building.removed {
            if let Some(slots) = self.index.nodes.get(&key) {
                let projected = match doc.get_container(slots.map.clone()) {
                    Some(Container::Map(map)) if !map.is_deleted() => {
                        self.is_projected(doc, &map)?
                    }
                    _ => false,
                };
                if !projected {
                    self.index.unbind(key);
                }
            }
        }
        let mut changes = building.creates;
        changes.extend(
            building
                .lists
                .into_iter()
                .map(|(parent, children)| NodeChange::Children { parent, children }),
        );
        changes.extend(splices);
        changes.extend(updates);
        self.events
            .lock()
            .map_err(|_| diverged("event buffer poisoned"))?
            .drain(..count);
        // The batch projected: each visited pending node takes its stored null.
        for key in &visited_pending {
            self.pending_nulls.shift_remove(key);
        }
        Ok(RemoteChanges {
            changes,
            touched,
            pending: building.pending,
            search_text_updates,
            observed_remote: count > 0,
            stats: building.stats,
        })
    }
    fn is_projected(&self, doc: &LoroDoc, map: &LoroMap) -> Result<bool> {
        let own = schema::own_map(map, self.policy)?;
        if self.policy.is_dropped_json(&own) || self.policy.is_transparent_json(&own) {
            return Ok(false);
        }
        let path = doc
            .get_path_to_container(&map.id())
            .ok_or_else(|| diverged("projected node map has no path"))?;
        for (id, _) in path {
            if let Some(Container::Map(ancestor)) = doc.get_container(id)
                && ancestor.get("type").is_some()
                && self
                    .policy
                    .is_dropped_json(&schema::own_map(&ancestor, self.policy)?)
            {
                return Ok(false);
            }
        }
        Ok(true)
    }
    /// `depth` is the parent's depth below the root; children sit one deeper.
    fn build_children(
        &mut self,
        b: &mut Building<'_>,
        parent: NodeTarget,
        map: &LoroMap,
        depth: usize,
    ) -> Result<()> {
        if !b.built.insert(map.id()) {
            return Ok(());
        }
        if let NodeTarget::Key(key) = parent
            && !b.state.view().is_element(key)
        {
            return Ok(());
        }
        // Newly created leaf nodes have no child slot. Existing elements whose
        // slot was deleted still need an empty Children change to detach old children.
        if matches!(parent, NodeTarget::Local(_)) && schema::children(map)?.is_none() {
            return Ok(());
        }
        let index = b.lists.len();
        b.lists.push((parent, Vec::new()));
        let mut result = Vec::new();
        let children = projected_children(map, self.policy)?;
        if !children.is_empty() && depth >= lexical_model::MAX_NODE_DEPTH {
            return Err(lexical_model::Error::NestingTooDeep {
                limit: lexical_model::MAX_NODE_DEPTH,
            }
            .into());
        }
        for child in children {
            result.push(self.resolve(b, &child, map, depth + 1)?);
        }
        if let NodeTarget::Key(key) = parent {
            let old = synced_children(b.state.view(), key, self.policy);
            for child in old {
                if !result.contains(&NodeTarget::Key(child)) {
                    b.removed.insert(child);
                    for (desc, _) in b.state.view().descendants(child) {
                        b.removed.insert(desc);
                    }
                }
            }
        }
        let entry = b
            .lists
            .get_mut(index)
            .ok_or_else(|| diverged("remote child queue"))?;
        entry.1 = result;
        Ok(())
    }
    /// `depth` is the depth below the root of the node `map` becomes.
    fn resolve(
        &mut self,
        b: &mut Building<'_>,
        map: &LoroMap,
        parent: &LoroMap,
        depth: usize,
    ) -> Result<NodeTarget> {
        if let Some((key, Slot::Node)) = self.index.owner.get(&map.id()).copied() {
            return Ok(NodeTarget::Key(key));
        }
        let mut incoming = comparison::stored_own_normalized(map, Some(parent), self.policy)?;
        let id = incoming
            .get("$")
            .and_then(Value::as_object)
            .and_then(|s| s.get("id"))
            .and_then(Value::as_str);
        let reuse = id
            .and_then(|id| self.index.ids.get(id))
            .copied()
            .filter(|key| {
                b.state.view().is_attached(*key)
                    && b.state.view().type_name(*key).ok()
                        == incoming.get("type").and_then(Value::as_str)
                    && self
                        .container_of(*key)
                        .and_then(|id| b.doc.get_container(id.clone()))
                        .is_none_or(|c| c.is_deleted())
            });
        if let Some(key) = reuse {
            self.index.bind(key, map, self.policy)?;
            b.reused.insert(key);
            b.fields.insert(key);
            b.stats.nodes_visited += 1;
            self.build_children(b, NodeTarget::Key(key), map, depth)?;
            return Ok(NodeTarget::Key(key));
        }
        let local = LocalNode(
            u32::try_from(b.pending.len()).map_err(|_| diverged("too many remote nodes"))?,
        );
        // Preserve the structural kind for forward-compatible unknown node imports.
        if schema::children(map)?.is_some() {
            incoming.insert("children".into(), Value::Array(vec![]));
        }
        if incoming
            .get("type")
            .and_then(Value::as_str)
            .is_some_and(|kind| self.policy.indent_is_tree_depth(kind))
        {
            if derived_indent_mismatch(b.doc, map, &incoming, self.policy)? {
                b.stats.derived_indent_mismatches += 1;
            }
            if incoming.get("indent").is_some_and(Value::is_number) {
                // Element constructors start with the framework's raw default.
                // Tree attachment supplies virtual depth; missing/null stay untouched.
                incoming.insert(
                    "indent".into(),
                    lexical_model::ElementData::default().indent.into(),
                );
            }
        }
        b.creates.push(NodeChange::Create {
            local,
            json: incoming,
        });
        b.pending.push((local, map.clone()));
        b.stats.nodes_visited += 1;
        self.build_children(b, NodeTarget::Local(local), map, depth)?;
        Ok(NodeTarget::Local(local))
    }
    /// Bind every core-created key to its native map, validating all pairs before mutation.
    pub fn bind_created(
        &mut self,
        changes: RemoteChanges,
        created: &[(LocalNode, NodeKey)],
    ) -> Result<()> {
        let mut seen = OrderedSet::default();
        let mut pairs = Vec::new();
        for (local, map) in changes.pending {
            let matches = created
                .iter()
                .filter(|(id, _)| *id == local)
                .collect::<Vec<_>>();
            let [(.., key)] = matches.as_slice() else {
                return Err(diverged(format!(
                    "missing or duplicate remote creation {}",
                    local.0
                )));
            };
            if !seen.insert(*key) {
                return Err(diverged("duplicate remote key"));
            }
            pairs.push((*key, map));
        }
        for (key, map) in pairs {
            self.index.bind(key, &map, self.policy)?;
        }
        if let Some(search_text) = &mut self.search_text {
            search_text.accept_remote(
                changes.search_text_updates,
                &self.index,
                changes.observed_remote,
            );
        }
        Ok(())
    }
}
fn utf16_at(text: &str, unicode: usize) -> Result<u32> {
    if unicode > text.chars().count() {
        return Err(diverged("text delta exceeds editor text"));
    }
    u32::try_from(
        text.chars()
            .take(unicode)
            .map(char::len_utf16)
            .sum::<usize>(),
    )
    .map_err(|_| diverged("text offset overflow"))
}
fn byte_at(text: &str, unicode: usize) -> Result<usize> {
    if unicode == text.chars().count() {
        return Ok(text.len());
    }
    text.char_indices()
        .nth(unicode)
        .map(|(i, _)| i)
        .ok_or_else(|| diverged("text delta exceeds editor text"))
}
fn apply_delta(
    key: NodeKey,
    text: &mut String,
    delta: &[loro::TextDelta],
    out: &mut Vec<NodeChange>,
) -> Result<()> {
    let mut pos = 0usize;
    for op in delta {
        match op {
            loro::TextDelta::Retain { retain, .. } => {
                pos = pos
                    .checked_add(*retain)
                    .ok_or_else(|| diverged("text delta overflow"))?;
                utf16_at(text, pos)?;
            }
            loro::TextDelta::Insert { insert, .. } => {
                let offset = utf16_at(text, pos)?;
                let byte = byte_at(text, pos)?;
                text.insert_str(byte, insert);
                out.push(NodeChange::SpliceText {
                    node: NodeTarget::Key(key),
                    range: Utf16Offset(offset)..Utf16Offset(offset),
                    insert: insert.clone(),
                });
                pos += insert.chars().count();
            }
            loro::TextDelta::Delete { delete } => {
                let end = pos
                    .checked_add(*delete)
                    .ok_or_else(|| diverged("text delta overflow"))?;
                let start16 = utf16_at(text, pos)?;
                let end16 = utf16_at(text, end)?;
                let start = byte_at(text, pos)?;
                let end = byte_at(text, end)?;
                text.replace_range(start..end, "");
                out.push(NodeChange::SpliceText {
                    node: NodeTarget::Key(key),
                    range: Utf16Offset(start16)..Utf16Offset(end16),
                    insert: String::new(),
                });
            }
        }
    }
    Ok(())
}
fn minimal_splice(
    key: NodeKey,
    before: &str,
    after: &str,
    out: &mut Vec<NodeChange>,
) -> Result<()> {
    let a = before.chars().collect::<Vec<_>>();
    let b = after.chars().collect::<Vec<_>>();
    let prefix = a.iter().zip(&b).take_while(|(a, b)| a == b).count();
    let suffix = a
        .iter()
        .skip(prefix)
        .rev()
        .zip(b.iter().skip(prefix).rev())
        .take_while(|(a, b)| a == b)
        .count();
    out.push(NodeChange::SpliceText {
        node: NodeTarget::Key(key),
        range: Utf16Offset(utf16_at(before, prefix)?)
            ..Utf16Offset(utf16_at(before, a.len() - suffix)?),
        insert: b
            .iter()
            .skip(prefix)
            .take(b.len() - prefix - suffix)
            .collect(),
    });
    Ok(())
}

#[cfg(test)]
mod test;

#[cfg(test)]
mod indent_test;
