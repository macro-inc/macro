use super::*;
#[cfg(test)]
mod test;
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Slot {
    Node,
    State,
    Text,
    Children,
    Ids,
    Field,
}
#[derive(Clone)]
pub(crate) struct NodeSlots {
    pub map: ContainerID,
    pub state: Option<ContainerID>,
    pub ids: Option<ContainerID>,
    pub text: Option<ContainerID>,
    pub children: Option<ContainerID>,
    pub plain_composite: bool,
    pub id: Option<String>,
}
#[derive(Default)]
pub(crate) struct NodeIndex {
    pub nodes: OrderedMap<NodeKey, NodeSlots>,
    pub owner: FxHashMap<ContainerID, (NodeKey, Slot)>,
    pub ids: FxHashMap<String, NodeKey>,
    /// Later live claimants of an id already in `ids`, promoted when the claimant unbinds.
    duplicate_ids: FxHashMap<String, Vec<NodeKey>>,
    owned: FxHashMap<NodeKey, Vec<ContainerID>>,
}
impl NodeIndex {
    pub fn bind(&mut self, key: NodeKey, map: &LoroMap, policy: &dyn SyncPolicy) -> Result<()> {
        schema::validate_slots(map, policy)?;
        let children = schema::children(map)?.map(|list| list.id());
        let text = match map.get("text") {
            Some(ValueOrContainer::Container(Container::Text(t))) => Some(t.id()),
            _ => None,
        };
        let id = map
            .get("$")
            .as_ref()
            .map(schema::validated_state_id)
            .transpose()?
            .flatten();
        // A refresh that keeps the id keeps its place among the id's claimants.
        let same_id = self.nodes.get(&key).is_some_and(|old| old.id == id);
        if same_id {
            self.release_containers(key);
        } else {
            self.unbind(key);
        }
        self.owner.insert(map.id(), (key, Slot::Node));
        self.owned.insert(key, vec![map.id()]);
        let mut plain_composite = false;
        map.for_each(|field, value| {
            plain_composite |= schema::field_has_plain_composites(field, &value, policy);
            if let ValueOrContainer::Container(container) = value {
                let slot = match field {
                    "$" => Slot::State,
                    "text" => Slot::Text,
                    "children" => Slot::Children,
                    "ids" => Slot::Ids,
                    _ => Slot::Field,
                };
                self.index_field(key, slot, container);
            }
        });
        if !same_id && let Some(id) = &id {
            let claimant = *self.ids.entry(id.clone()).or_insert(key);
            if claimant != key {
                self.duplicate_ids.entry(id.clone()).or_default().push(key);
            }
        }
        self.nodes.insert(
            key,
            NodeSlots {
                map: map.id(),
                state: schema::slot_id(map, "$"),
                ids: schema::slot_id(map, "ids"),
                text,
                children,
                plain_composite,
                id,
            },
        );
        Ok(())
    }
    fn index_field(&mut self, key: NodeKey, slot: Slot, container: Container) {
        self.owner.insert(container.id(), (key, slot));
        self.owned.entry(key).or_default().push(container.id());
        if slot == Slot::Children {
            return;
        }
        match container {
            Container::Map(map) => map.for_each(|_, value| {
                if let ValueOrContainer::Container(c) = value {
                    self.index_field(key, Slot::Field, c)
                }
            }),
            Container::List(list) => list.for_each(|value| {
                if let ValueOrContainer::Container(c) = value {
                    self.index_field(key, Slot::Field, c)
                }
            }),
            _ => {}
        }
    }
    pub fn unbind(&mut self, key: NodeKey) {
        if let Some(old) = self.release_containers(key)
            && let Some(id) = old.id
        {
            let duplicates = self.duplicate_ids.get_mut(&id);
            if self.ids.get(&id) == Some(&key) {
                match duplicates.and_then(|keys| (!keys.is_empty()).then(|| keys.remove(0))) {
                    Some(survivor) => {
                        self.ids.insert(id.clone(), survivor);
                    }
                    None => {
                        self.ids.remove(&id);
                    }
                }
            } else if let Some(keys) = duplicates {
                keys.retain(|claimant| *claimant != key);
            }
            if self.duplicate_ids.get(&id).is_some_and(Vec::is_empty) {
                self.duplicate_ids.remove(&id);
            }
        }
    }
    /// Drop `key`'s slots and container ownership, leaving its id claim untouched.
    fn release_containers(&mut self, key: NodeKey) -> Option<NodeSlots> {
        let old = self.nodes.swap_remove(&key)?;
        if let Some(ids) = self.owned.remove(&key) {
            for id in ids {
                self.owner.remove(&id);
            }
        }
        Some(old)
    }
    /// The indexed map of `key`'s synced parent, for parent-dependent stored normalization.
    pub fn synced_parent_map(
        &self,
        doc: &LoroDoc,
        view: StateRef<'_>,
        key: NodeKey,
        policy: &dyn SyncPolicy,
    ) -> Result<Option<LoroMap>> {
        let Some(parent) = view
            .parent(key)
            .and_then(|parent| synced_owner(view, parent, policy))
        else {
            return Ok(None);
        };
        if !self.nodes.contains_key(&parent) {
            return Ok(None);
        }
        self.map(doc, parent).map(Some)
    }
    pub fn map(&self, doc: &LoroDoc, key: NodeKey) -> Result<LoroMap> {
        let id = self
            .nodes
            .get(&key)
            .ok_or_else(|| diverged(format!("unindexed editor key {key}")))?
            .map
            .clone();
        match doc.get_container(id) {
            Some(Container::Map(map)) => Ok(map),
            _ => Err(diverged(format!("missing map for {key}"))),
        }
    }
    pub fn bind_tree(
        &mut self,
        view: StateRef<'_>,
        key: NodeKey,
        map: &LoroMap,
        policy: &dyn SyncPolicy,
    ) -> Result<()> {
        self.bind(key, map, policy)?;
        let keys = synced_children(view, key, policy);
        let maps = projected_children(map, policy)?;
        if keys.len() != maps.len() {
            return Err(diverged(format!("child count at {key}")));
        }
        for (key, map) in keys.into_iter().zip(maps) {
            self.bind_tree(view, key, &map, policy)?;
        }
        Ok(())
    }
}
pub(crate) fn projected_children(map: &LoroMap, policy: &dyn SyncPolicy) -> Result<Vec<LoroMap>> {
    lifted_children(map, policy, 0)
}
/// `wrappers` counts the transparent wrappers lifted so far; nesting them past the stored
/// cap fails instead of recursing further.
fn lifted_children(
    map: &LoroMap,
    policy: &dyn SyncPolicy,
    wrappers: usize,
) -> Result<Vec<LoroMap>> {
    if wrappers > crate::schema::MAX_STORED_DEPTH {
        return Err(lexical_model::Error::NestingTooDeep {
            limit: lexical_model::MAX_NODE_DEPTH,
        }
        .into());
    }
    let mut result = Vec::new();
    if let Some(list) = schema::children(map)? {
        for i in 0..list.len() {
            let child = schema::map_at(list.get(i), "children item")?;
            let json = schema::own_map(&child, policy)?;
            if policy.is_dropped_json(&json) {
                continue;
            }
            if policy.is_transparent_json(&json) {
                result.extend(lifted_children(&child, policy, wrappers + 1)?);
            } else {
                result.push(child);
            }
        }
    }
    Ok(result)
}
/// Counts from one stored-drift scan, for the caller's span.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct StoredDriftScan {
    /// Nodes whose type declares normalized fields and were reread.
    pub rescanned: usize,
    /// Nodes left pending a normalized rewrite.
    pub drifted: usize,
}
/// Reconstruct the synced editor JSON, validating native children containers and JSON values.
pub fn reconstruct_state(doc: &LoroDoc, policy: &dyn SyncPolicy) -> Result<SerializedEditorState> {
    Ok(SerializedEditorState {
        root: schema::read_node(&doc.get_map("root"), policy)?,
    })
}
/// Initial read with evidence that persisted transparent wrappers were lifted.
pub struct InitialEditorState {
    /// Policy-filtered editor state.
    pub state: SerializedEditorState,
    /// A persisted wrapper was lifted while reading; ordinary reads never mutate it.
    pub has_transparent_wrappers: bool,
}
/// Reconstruct initialization data and report persisted transparent wrappers in one walk.
pub fn reconstruct_initial_state(
    doc: &LoroDoc,
    policy: &dyn SyncPolicy,
) -> Result<InitialEditorState> {
    let mut has_transparent_wrappers = false;
    let root = schema::read_node_for_init(
        &doc.get_map("root"),
        None,
        policy,
        &mut has_transparent_wrappers,
    )?;
    Ok(InitialEditorState {
        state: SerializedEditorState { root },
        has_transparent_wrappers,
    })
}
/// Construct a deterministic document; set its explicit peer before any operations.
pub fn new_doc(peer: loro::PeerID) -> Result<LoroDoc> {
    let doc = LoroDoc::new();
    doc.set_peer_id(peer)?;
    doc.set_record_timestamp(false);
    Ok(doc)
}
/// Fork with a caller-owned explicit peer before any operations on the fork.
pub fn fork_doc(doc: &LoroDoc, peer: loro::PeerID) -> Result<LoroDoc> {
    let fork = doc.fork();
    fork.set_peer_id(peer)?;
    fork.set_record_timestamp(false);
    Ok(fork)
}
impl LoroProjection {
    /// Initialize an empty doc from a portable editor; application golden seeding is external.
    pub fn initialize(
        doc: &LoroDoc,
        state: &EditorState,
        policy: &'static dyn SyncPolicy,
        now: loro::Timestamp,
    ) -> Result<Self> {
        let root = doc.get_map("root");
        if !root.is_empty() {
            return Err(schema_error("initialize requires empty root"));
        }
        doc.set_record_timestamp(false);
        schema::initialize_map(
            &root,
            &storage_node(state.view(), NodeKey::ROOT, policy)?,
            schema::MapSchema::Node,
        )?;
        doc.commit_with(
            loro::CommitOptions::new()
                .origin(LOCAL_ORIGIN)
                .timestamp(now),
        );
        Self::attach(doc, state, policy)
    }
    /// Validate the initial synced tree, build indexes once and subscribe to native events.
    pub fn attach(
        doc: &LoroDoc,
        state: &EditorState,
        policy: &'static dyn SyncPolicy,
    ) -> Result<Self> {
        doc.set_record_timestamp(false);
        let expected = comparison::model(state, policy)?;
        let actual = comparison::loro(doc, policy)?;
        let mut pending_nulls = Vec::new();
        if !comparison::stored_matches_collecting(
            state.view(),
            NodeKey::ROOT,
            policy,
            &expected.root,
            &actual.root,
            &mut pending_nulls,
        ) {
            return Err(diverged("attach synced JSON differs"));
        }
        let mut index = NodeIndex::default();
        index.bind_tree(state.view(), NodeKey::ROOT, &doc.get_map("root"), policy)?;
        let events = Arc::new(Mutex::new(Vec::new()));
        let buffer = events.clone();
        let subscription = doc.subscribe_root(Arc::new(move |event| {
            if event.triggered_by == loro::EventTriggerKind::Local
                && matches!(event.origin, LOCAL_ORIGIN | FIXUP_ORIGIN)
            {
                return;
            }
            // Poison is reported on drain; never silently discard a callback batch.
            let mut batches = match buffer.lock() {
                Ok(guard) => guard,
                Err(poisoned) => poisoned.into_inner(),
            };
            batches.push(remote::PendingBatch::from_event(event));
        }));
        let mut child_index = crate::child_index::ChildIndex::default();
        for key in index.nodes.keys().copied() {
            child_index.remember(state.view(), key, &index.map(doc, key)?, &index, policy)?;
        }
        let mut projection = Self {
            own_exports: Default::default(),
            search_text: policy.writes_root_search_text().then(Default::default),
            pending_nulls: pending_nulls.into_iter().collect(),
            child_index,
            indexed_state: state.clone(),
            indexed_vv: doc.oplog_vv(),
            indexed_frontiers: doc.state_frontiers(),
            stored_drift: OrderedSet::default(),
            local_state_pending: OrderedSet::default(),
            model_drift: OrderedMap::default(),
            #[cfg(feature = "test-faults")]
            fail_after_writes: None,
            policy,
            index,
            events,
            _subscription: subscription,
        };
        // Rebuilt at every attach and resync, so a rebuild never loses a pending write.
        let keys: Vec<NodeKey> = projection.index.nodes.keys().copied().collect();
        projection.note_local_state_for(doc, state, keys)?;
        Ok(projection)
    }
    /// Track nodes among `keys` whose model value of a local_state_keys field differs from
    /// storage, for the next ordinary local projection to write.
    pub(crate) fn note_local_state_for(
        &mut self,
        doc: &LoroDoc,
        state: &EditorState,
        keys: impl IntoIterator<Item = NodeKey>,
    ) -> Result<()> {
        let local_keys = self.policy.local_state_keys();
        if local_keys.is_empty() || self.policy.local_state_update_tag().is_none() {
            return Ok(());
        }
        let view = state.view();
        for key in keys {
            if !view.is_attached(key) || !self.index.nodes.contains_key(&key) {
                self.local_state_pending.shift_remove(&key);
                continue;
            }
            let map = self.index.map(doc, key)?;
            let model = view.export_json(key)?;
            let differs = local_keys.iter().try_fold(false, |differs, name| {
                Ok::<_, ProjectionError>(
                    differs
                        || crate::local::model_local_state(&model, name)
                            != crate::local::stored_local_state(&map, name)?,
                )
            })?;
            if differs {
                self.local_state_pending.insert(key);
            } else {
                self.local_state_pending.shift_remove(&key);
            }
        }
        Ok(())
    }
    /// Fail the next projection after `writes` own-field writes have reached Loro.
    #[cfg(feature = "test-faults")]
    pub fn fail_after_writes(&mut self, writes: usize) {
        self.fail_after_writes = Some(writes);
    }
    /// Record every synced node whose stored own fields differ from Source's import
    /// normalization, so the next local projection rewrites them. A full scan, run at attach.
    pub fn note_stored_drift(
        &mut self,
        doc: &LoroDoc,
        state: &EditorState,
    ) -> Result<StoredDriftScan> {
        let keys: Vec<NodeKey> = self.index.nodes.keys().copied().collect();
        // A load runs no editor transform, so attach records no remote-update default.
        self.scan_stored_drift(doc, state, keys, false)
    }
    /// Re-check `keys` after Loro changed them (remote import, undo or redo), including the
    /// remote-update defaults the import's transforms left in the model.
    pub fn note_stored_drift_for(
        &mut self,
        doc: &LoroDoc,
        state: &EditorState,
        keys: impl IntoIterator<Item = NodeKey>,
    ) -> Result<StoredDriftScan> {
        self.scan_stored_drift(doc, state, keys, true)
    }
    fn scan_stored_drift(
        &mut self,
        doc: &LoroDoc,
        state: &EditorState,
        keys: impl IntoIterator<Item = NodeKey>,
        remote: bool,
    ) -> Result<StoredDriftScan> {
        let view = state.view();
        let mut scan = StoredDriftScan::default();
        for key in keys {
            if !view.is_attached(key) || !self.index.nodes.contains_key(&key) {
                self.stored_drift.shift_remove(&key);
                self.model_drift.shift_remove(&key);
                continue;
            }
            if self
                .policy
                .stored_normalized_fields(view.type_name(key)?)
                .is_empty()
            {
                continue;
            }
            scan.rescanned += 1;
            let map = self.index.map(doc, key)?;
            let parent = self.index.synced_parent_map(doc, view, key, self.policy)?;
            if remote {
                self.note_model_drift(view, key, &map, parent.as_ref())?;
            }
            if crate::local::stored_drift(&map, parent.as_ref(), self.policy)?.is_empty() {
                self.stored_drift.shift_remove(&key);
            } else {
                scan.drifted += 1;
                self.stored_drift.insert(key);
            }
        }
        Ok(scan)
    }
    /// Record the remote-update defaults the model holds where the stored map is unset.
    fn note_model_drift(
        &mut self,
        view: StateRef<'_>,
        key: NodeKey,
        map: &LoroMap,
        parent: Option<&LoroMap>,
    ) -> Result<()> {
        let defaults = self.policy.remote_update_defaults(view.type_name(key)?);
        let mut fields = OrderedSet::default();
        if !defaults.is_empty() {
            let stored = comparison::stored_own_normalized(map, parent, self.policy)?;
            let model = comparison::model_own(view, key, self.policy)?;
            for &(field, default) in defaults {
                let node_type = view.type_name(key)?;
                if !self
                    .policy
                    .stored_normalized_fields(node_type)
                    .contains(&field)
                {
                    return Err(diverged(format!(
                        "remote-update default {node_type}.{field} is not a stored-normalized field"
                    )));
                }
                if stored.get(field).is_none()
                    && model.get(field).and_then(serde_json::Value::as_str) == Some(default)
                {
                    fields.insert(field);
                }
            }
        }
        if fields.is_empty() {
            self.model_drift.shift_remove(&key);
        } else {
            self.model_drift.insert(key, fields);
        }
        Ok(())
    }
    /// Drop each drifted field from the model's own JSON where the stored node lacks it, so
    /// strict checks accept exactly the pending model-drift pairs.
    pub(crate) fn tolerate_model_drift(
        &self,
        key: NodeKey,
        model: &mut SerializedNode,
        stored: &SerializedNode,
    ) {
        if let Some(fields) = self.model_drift.get(&key) {
            for field in fields {
                if stored.get(*field).is_none() {
                    model.remove(*field);
                }
            }
        }
    }
    /// `tolerate_model_drift` over aligned model and stored trees.
    fn tolerate_model_drift_tree(
        &self,
        view: StateRef<'_>,
        key: NodeKey,
        model: &mut SerializedNode,
        stored: &SerializedNode,
    ) {
        self.tolerate_model_drift(key, model, stored);
        let children = synced_children(view, key, self.policy);
        if let (Some(serde_json::Value::Array(models)), Some(serde_json::Value::Array(storeds))) =
            (model.get_mut("children"), stored.get("children"))
            && models.len() == children.len()
            && storeds.len() == children.len()
        {
            for ((child, model), stored) in children.iter().zip(models).zip(storeds) {
                if let (Some(model), Some(stored)) = (model.as_object_mut(), stored.as_object()) {
                    self.tolerate_model_drift_tree(view, *child, model, stored);
                }
            }
        }
    }
    /// Native node-map container for undo bookkeeping and presence diagnostics.
    pub fn container_of(&self, key: NodeKey) -> Option<&ContainerID> {
        self.index.nodes.get(&key).map(|s| &s.map)
    }
    /// Check the complete synced tree and every indexed container's current position.
    pub fn check(
        &self,
        doc: &LoroDoc,
        state: &EditorState,
    ) -> std::result::Result<(), Inconsistency> {
        let editor = comparison::model(state, self.policy).map(|mut state_json| {
            if let Some(search_text) = &self.search_text {
                search_text.apply_expected_tree(
                    state.view(),
                    NodeKey::ROOT,
                    self.policy,
                    &self.index,
                    &mut state_json.root,
                );
            }
            state_json.root
        });
        let actual = comparison::loro(doc, self.policy).map(|s| s.root);
        let editor = match (editor, &actual) {
            (Ok(mut editor), Ok(actual)) if !self.model_drift.is_empty() => {
                self.tolerate_model_drift_tree(state.view(), NodeKey::ROOT, &mut editor, actual);
                Ok(editor)
            }
            (editor, _) => editor,
        };
        let editor = editor.map(serde_json::Value::Object);
        let actual = actual.map(serde_json::Value::Object);
        match (editor, actual) {
            (Ok(serde_json::Value::Object(editor)), Ok(serde_json::Value::Object(actual)))
                if comparison::stored_matches(
                    state.view(),
                    NodeKey::ROOT,
                    self.policy,
                    &editor,
                    &actual,
                ) => {}
            (editor, actual) => {
                return Err(Inconsistency {
                    path: "root".into(),
                    editor: editor.unwrap_or(serde_json::Value::Null).into(),
                    doc: actual.unwrap_or(serde_json::Value::Null).into(),
                });
            }
        }
        self.check_nodes(
            doc,
            state,
            &self.index.nodes.keys().copied().collect::<Vec<_>>(),
        )
    }
    /// Check touched nodes and their synced ancestors without exporting the whole editor.
    pub fn check_nodes(
        &self,
        doc: &LoroDoc,
        state: &EditorState,
        keys: &[NodeKey],
    ) -> std::result::Result<(), Inconsistency> {
        let view = state.view();
        let mut checked = OrderedSet::default();
        for key in keys {
            let mut current = Some(*key);
            while let Some(key) = current {
                if !checked.insert(key) {
                    break;
                }
                current = view.parent(key);
                if !view.is_attached(key) || synced_owner(view, key, self.policy) != Some(key) {
                    continue;
                }
                let expected = comparison::model_own(view, key, self.policy).map(|mut own| {
                    if let Some(search_text) = &self.search_text {
                        search_text.apply_expected(key, &self.index, &mut own);
                    }
                    own
                });
                let actual = self.index.map(doc, key).and_then(|map| {
                    if map.is_deleted() {
                        return Err(diverged("indexed map deleted"));
                    }
                    let slots = self
                        .index
                        .nodes
                        .get(&key)
                        .ok_or_else(|| diverged("missing index"))?;
                    if slots.state != schema::slot_id(&map, "$")
                        || slots.text != schema::slot_id(&map, "text")
                        || slots.children != schema::slot_id(&map, "children")
                        || slots.ids != schema::slot_id(&map, "ids")
                    {
                        return Err(diverged("cached slot identity changed"));
                    }
                    let parent = self.index.synced_parent_map(doc, view, key, self.policy)?;
                    let json = comparison::loro_own(&map, parent.as_ref(), self.policy)?;
                    let expected_children = synced_children(view, key, self.policy);
                    let maps = projected_children(&map, self.policy)?;
                    if expected_children.len() != maps.len()
                        || expected_children
                            .iter()
                            .zip(maps)
                            .any(|(child, map)| self.container_of(*child) != Some(&map.id()))
                    {
                        return Err(diverged("indexed child position"));
                    }
                    Ok(json)
                });
                let expected = match (expected, &actual) {
                    (Ok(mut expected), Ok(actual)) => {
                        self.tolerate_model_drift(key, &mut expected, actual);
                        Ok(expected)
                    }
                    (expected, _) => expected,
                };
                if !matches!(
                    (&expected, &actual),
                    (Ok(expected), Ok(actual)) if comparison::stored_matches(view, key, self.policy, expected, actual)
                ) || expected.is_err()
                    || actual.is_err()
                {
                    return Err(Inconsistency {
                        path: key.to_string(),
                        editor: expected
                            .map(serde_json::Value::Object)
                            .unwrap_or(serde_json::Value::Null)
                            .into(),
                        doc: actual
                            .map(serde_json::Value::Object)
                            .unwrap_or(serde_json::Value::Null)
                            .into(),
                    });
                }
            }
        }
        Ok(())
    }
}
