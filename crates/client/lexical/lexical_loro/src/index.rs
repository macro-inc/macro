use super::*;
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
    owned: FxHashMap<NodeKey, Vec<ContainerID>>,
}
impl NodeIndex {
    pub fn bind(&mut self, key: NodeKey, map: &LoroMap, policy: &dyn SyncPolicy) -> Result<()> {
        schema::validate_slots(map)?;
        let children = schema::children(map)?.map(|list| list.id());
        let text = match map.get("text") {
            Some(ValueOrContainer::Container(Container::Text(t))) => Some(t.id()),
            _ => None,
        };
        let state = map.get("$").as_ref().map(schema::read_value).transpose()?;
        let id = state
            .as_ref()
            .and_then(serde_json::Value::as_object)
            .and_then(|v| v.get("id"))
            .and_then(serde_json::Value::as_str)
            .map(str::to_owned);
        self.unbind(key);
        self.owner.insert(map.id(), (key, Slot::Node));
        self.owned.insert(key, vec![map.id()]);
        map.for_each(|field, value| {
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
        if let Some(id) = &id {
            self.ids.entry(id.clone()).or_insert(key);
        }
        self.nodes.insert(
            key,
            NodeSlots {
                map: map.id(),
                state: schema::slot_id(map, "$"),
                ids: schema::slot_id(map, "ids"),
                text,
                children,
                plain_composite: schema::has_plain_composites(map, policy),
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
        if let Some(old) = self.nodes.swap_remove(&key) {
            if let Some(id) = old.id
                && self.ids.get(&id) == Some(&key)
            {
                self.ids.remove(&id);
            }
            if let Some(ids) = self.owned.remove(&key) {
                for id in ids {
                    self.owner.remove(&id);
                }
            }
        }
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
    let mut result = Vec::new();
    if let Some(list) = schema::children(map)? {
        for i in 0..list.len() {
            let child = schema::map_at(list.get(i), "children item")?;
            let json = schema::own_map(&child)?;
            if policy.is_dropped_json(&json) {
                continue;
            }
            if policy.is_transparent_json(&json) {
                result.extend(projected_children(&child, policy)?);
            } else {
                result.push(child);
            }
        }
    }
    Ok(result)
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
    let root =
        schema::read_node_for_init(&doc.get_map("root"), policy, &mut has_transparent_wrappers)?;
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
            &synced_json(state, policy)?.root,
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
        let expected = synced_json(state, policy)?;
        let actual = reconstruct_state(doc, policy)?;
        if expected != actual {
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
        Ok(Self {
            policy,
            index,
            events,
            _subscription: subscription,
        })
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
        let editor = synced_json(state, self.policy).map(|s| serde_json::Value::Object(s.root));
        let actual = reconstruct_state(doc, self.policy).map(|s| serde_json::Value::Object(s.root));
        match (editor, actual) {
            (Ok(editor), Ok(actual)) if editor == actual => {}
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
                let expected = own(view, key, self.policy);
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
                    let mut json = schema::own_map(&map)?;
                    mask_local(&mut json, self.policy);
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
                if expected.as_ref().ok() != actual.as_ref().ok()
                    || expected.is_err()
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
