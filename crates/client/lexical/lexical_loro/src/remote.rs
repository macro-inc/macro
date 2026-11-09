use super::*;
use crate::index::Slot;
use lexical_model::{NodeTarget, Utf16Offset};
use serde_json::Value;
#[derive(Clone)]
pub(crate) struct PendingBatch {
    pub diffs: Vec<OwnedDiff>,
}
#[derive(Clone)]
pub(crate) struct OwnedDiff {
    target: ContainerID,
    path: Vec<(ContainerID, loro::Index)>,
    text: Option<Vec<loro::TextDelta>>,
    children_replaced: bool,
    text_replaced: bool,
}
impl PendingBatch {
    pub fn from_event(event: loro::event::DiffEvent<'_>) -> Self {
        let diffs=event.events.into_iter().map(|event| {
            let children_replaced=matches!(&event.diff,loro::event::Diff::Map(map) if map.updated.contains_key("children"));
            let text_replaced=matches!(&event.diff,loro::event::Diff::Map(map) if map.updated.contains_key("text"));
            let text=match event.diff {loro::event::Diff::Text(delta)=>Some(delta),_=>None};
            OwnedDiff{target:event.target.clone(),path:event.path.to_vec(),text,children_replaced,text_replaced}
        }).collect();
        Self { diffs }
    }
}
/// Raw remote changes and their native creation identities, retained until binding succeeds.
pub struct RemoteChanges {
    /// Ordered core model edits.
    pub changes: Vec<NodeChange>,
    pending: Vec<(LocalNode, LoroMap)>,
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
            self.build_children(&mut building, NodeTarget::Key(key), &map)?;
        }
        // Slot replacements now become visible to subsequent event classification.
        let mut ordered_fields = building.fields.iter().copied().collect::<Vec<_>>();
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
        for key in ordered_fields {
            if !state.view().is_attached(key) {
                continue;
            }
            let map = self.index.map(doc, key)?;
            if map.is_deleted() || !self.is_projected(doc, &map)? {
                continue;
            }
            building.stats.nodes_visited += 1;
            let mut incoming = schema::own_map(&map, self.policy)?;
            mask_local(&mut incoming, self.policy);
            let mut current = own(state.view(), key, self.policy)?;
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
            let mut compare = incoming.clone();
            for field in self.policy.ignore_in_remote_compare(&kind, &incoming) {
                compare.remove(*field);
                current.remove(*field);
            }
            if compare != current {
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
                updates.push(NodeChange::Update {
                    node: NodeTarget::Key(key),
                    json: incoming,
                });
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
        Ok(RemoteChanges {
            changes,
            pending: building.pending,
            stats: building.stats,
        })
    }
    fn is_projected(&self, doc: &LoroDoc, map: &LoroMap) -> Result<bool> {
        let own = schema::own_map(map, self.policy)?;
        if self.policy.is_dropped_json(&own) || self.policy.is_transparent_json(&own) {
            return Ok(false);
        }
        for (id, _) in doc.get_path_to_container(&map.id()).unwrap_or_default() {
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
    fn build_children(
        &mut self,
        b: &mut Building<'_>,
        parent: NodeTarget,
        map: &LoroMap,
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
        for child in projected_children(map, self.policy)? {
            result.push(self.resolve(b, &child)?);
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
    fn resolve(&mut self, b: &mut Building<'_>, map: &LoroMap) -> Result<NodeTarget> {
        if let Some((key, Slot::Node)) = self.index.owner.get(&map.id()).copied() {
            return Ok(NodeTarget::Key(key));
        }
        let mut incoming = schema::own_map(map, self.policy)?;
        mask_local(&mut incoming, self.policy);
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
            self.build_children(b, NodeTarget::Key(key), map)?;
            return Ok(NodeTarget::Key(key));
        }
        let local = LocalNode(
            u32::try_from(b.pending.len()).map_err(|_| diverged("too many remote nodes"))?,
        );
        // Preserve the structural kind for forward-compatible unknown node imports.
        if schema::children(map)?.is_some() {
            incoming.insert("children".into(), Value::Array(vec![]));
        }
        b.creates.push(NodeChange::Create {
            local,
            json: incoming,
        });
        b.pending.push((local, map.clone()));
        b.stats.nodes_visited += 1;
        self.build_children(b, NodeTarget::Local(local), map)?;
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
