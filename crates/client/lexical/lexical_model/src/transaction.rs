//! Atomic copy-on-write node and tree editing.
mod properties;
mod tree;
use crate::collections::{IndexMap, IndexSet};
use crate::node::{Links, NodeSlot};
use crate::*;
pub use properties::{ElementMut, TextMut};
use std::{
    ops::{Deref, DerefMut},
    sync::Arc,
};
/// Why an element participates in the next transform pass.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DirtyIntent {
    /// Its record was written.
    Intentional,
    /// A descendant was written; the ancestor record remains shared.
    AncestorOfDirty,
}
/// Pending state, published only by commit. Allocated keys are never rewound.
pub struct Transaction<'editor> {
    #[cfg(feature = "foreign-nodes")]
    pub(crate) foreign_update: Arc<()>,
    #[cfg(feature = "foreign-nodes")]
    pub(crate) foreign_native_calls: Arc<crate::foreign::native::NativeCalls>,
    #[cfg(feature = "foreign-nodes")]
    pub(crate) foreign_read_only: bool,
    #[cfg(feature = "foreign-nodes")]
    pub(crate) foreign_defer_publication: bool,
    #[cfg(feature = "foreign-nodes")]
    pub(crate) foreign_read_sources: Option<crate::state::NodeMap>,
    #[cfg(feature = "foreign-nodes")]
    pub(crate) foreign_read_origin: Option<crate::foreign::ReadOrigin>,
    #[cfg(feature = "foreign-nodes")]
    pub(crate) foreign_retired_records: crate::state::NodeMap,
    #[cfg(feature = "foreign-nodes")]
    pub(crate) foreign_previous_selection: Option<Selection>,
    #[cfg(feature = "foreign-nodes")]
    pub(crate) foreign_previous_selection_identity: Option<ForeignSelectionIdentity>,
    #[cfg(feature = "foreign-nodes")]
    pub(crate) native_projection: Option<crate::foreign::projection::NativeProjection>,
    pub(crate) extensions: crate::extension::Extensions,
    pub(crate) events: Vec<PluginEvent>,
    pub(crate) default_prevented: bool,
    pub(crate) editor: &'editor mut Editor,
    pub(crate) pending: EditorState,
    pub(crate) dirty_leaves: IndexSet<NodeKey>,
    pub(crate) dirty_elements: IndexMap<NodeKey, DirtyIntent>,
    pub(crate) composition_key: Option<NodeKey>,
    pub(crate) selection_context: Option<SelectionChangeContext>,
    pub(crate) sealed: bool,
    pub(crate) full_reconcile: bool,
    pub(crate) selection_dirty: bool,
    pub(crate) preceding: Option<Box<Commit>>,
    pub(crate) options: UpdateOptions,
    pub(crate) normalized: IndexSet<NodeKey>,
    pub(crate) nested: std::collections::VecDeque<(NestedUpdateFn, UpdateOptions)>,
    pub(crate) transform_iterations: u16,
    pub(crate) dirty_since_flush: bool,
    #[cfg(feature = "bench-counters")]
    pub(crate) work: WorkCounters,
    pub(crate) detached: Vec<Option<Selection>>,
    pub(crate) selection_replacements: u64,
    #[cfg(feature = "foreign-nodes")]
    pub(crate) foreign_selections: crate::foreign::selections::SelectionIdentities,
}
impl<'editor> Transaction<'editor> {
    pub(crate) fn new(editor: &'editor mut Editor) -> Self {
        let mut pending = editor.state.pending();
        if let Some(Selection::Range(range)) = &mut pending.selection {
            range.clear_direction_cache();
        }
        let composition_key = editor.composition_key;
        let options = UpdateOptions {
            tags: editor.carried_tags.clone(),
            ..UpdateOptions::default()
        };
        Self {
            #[cfg(feature = "foreign-nodes")]
            foreign_update: Arc::new(()),
            #[cfg(feature = "foreign-nodes")]
            foreign_native_calls: Arc::default(),
            #[cfg(feature = "foreign-nodes")]
            foreign_read_only: false,
            #[cfg(feature = "foreign-nodes")]
            foreign_defer_publication: false,
            #[cfg(feature = "foreign-nodes")]
            foreign_read_sources: None,
            #[cfg(feature = "foreign-nodes")]
            foreign_read_origin: None,
            #[cfg(feature = "foreign-nodes")]
            foreign_retired_records: Default::default(),
            #[cfg(feature = "foreign-nodes")]
            foreign_previous_selection: None,
            #[cfg(feature = "foreign-nodes")]
            foreign_previous_selection_identity: None,
            #[cfg(feature = "foreign-nodes")]
            native_projection: None,
            extensions: editor.extensions.clone(),
            events: vec![],
            default_prevented: false,
            editor,
            pending,
            dirty_leaves: IndexSet::default(),
            dirty_elements: IndexMap::default(),
            composition_key,
            selection_context: None,
            sealed: false,
            full_reconcile: false,
            selection_dirty: false,
            preceding: None,
            options,
            normalized: IndexSet::default(),
            nested: crate::pipeline::nested_queue(),
            transform_iterations: 0,
            dirty_since_flush: true,
            #[cfg(feature = "bench-counters")]
            work: WorkCounters::default(),
            detached: vec![],
            selection_replacements: 0,
            #[cfg(feature = "foreign-nodes")]
            foreign_selections: Default::default(),
        }
    }
    /// Number of active-selection object replacements within this transaction.
    /// Point edits preserve identity; node replacement clones the selection upstream.
    pub fn selection_replacements(&self) -> u64 {
        self.selection_replacements
    }
    /// Borrow the pending state, including uncommitted edits.
    pub fn view(&self) -> StateRef<'_> {
        let previous_selection = self.editor.state.selection();
        #[cfg(feature = "foreign-nodes")]
        let previous_selection = if self.foreign_read_only {
            self.foreign_previous_selection.as_ref()
        } else {
            previous_selection
        };
        StateRef {
            #[cfg(feature = "foreign-nodes")]
            foreign_selection_argument: None,
            #[cfg(feature = "foreign-nodes")]
            native_projection: self.native_projection.as_ref(),
            #[cfg(feature = "foreign-nodes")]
            foreign_projections: None,
            #[cfg(feature = "foreign-nodes")]
            foreign_native_calls: Some(&self.foreign_native_calls),
            #[cfg(feature = "foreign-nodes")]
            detached_selections: &self.detached,
            #[cfg(feature = "foreign-nodes")]
            foreign_selection_identities: Some(&self.foreign_selections),
            #[cfg(feature = "foreign-nodes")]
            foreign_previous_selection_identity: if self.foreign_read_only {
                self.foreign_previous_selection_identity.as_ref()
            } else {
                Some(&self.editor.state.foreign_selection_identity)
            },
            #[cfg(feature = "foreign-nodes")]
            source_records: self.foreign_read_sources.as_ref(),
            #[cfg(feature = "foreign-nodes")]
            retired_records: Some(&self.foreign_retired_records),
            #[cfg(feature = "foreign-nodes")]
            foreign_origin: if self.foreign_read_only {
                self.foreign_read_origin
                    .as_ref()
                    .map(crate::foreign::ReadOrigin::borrowed)
            } else {
                Some(crate::foreign::ReadOriginRef {
                    editor: &self.editor.suspend_owner,
                    update: &self.foreign_update,
                    lease: None,
                })
            },
            state: &self.pending,
            previous_selection,
            composition_key: self.composition_key,
        }
    }
    /// The state committed before this update began.
    pub fn committed_state(&self) -> &EditorState {
        &self.editor.state
    }
    pub(crate) fn remove_record(&mut self, key: NodeKey) {
        #[cfg(feature = "foreign-nodes")]
        if let Some(record) = self.pending.nodes.get(&key) {
            self.foreign_retired_records.insert(key, record.clone());
        }
        self.pending.remove_record(key);
    }
    #[cfg(feature = "foreign-nodes")]
    pub(crate) fn foreign_clone_source(
        &mut self,
        key: NodeKey,
    ) -> Result<Option<ForeignReadSnapshot>, Error> {
        let record = self
            .pending
            .nodes
            .get_mut(&key)
            .ok_or(Error::NodeNotFound(key))?;
        if Arc::strong_count(record) > 1
            && self
                .pending
                .registry
                .registered(record.type_index)
                .foreign
                .is_some()
        {
            return self.view().snapshot_for_foreign_read().map(Some);
        }
        Ok(None)
    }
    pub(crate) fn writable(&mut self, key: NodeKey) -> Result<&mut NodeSlot, Error> {
        self.mark_dirty(key)?;
        #[cfg(feature = "foreign-nodes")]
        let clone_source = self.foreign_clone_source(key)?;
        let slot = self
            .pending
            .nodes
            .get_mut(&key)
            .ok_or(Error::NodeNotFound(key))?;
        if Arc::strong_count(slot) > 1 {
            #[cfg(feature = "foreign-nodes")]
            let replacement = crate::foreign::payload::clone_payload(
                &self.pending.registry,
                slot.type_index,
                key,
                key,
                &slot.data,
                clone_source,
            );
            #[cfg(feature = "foreign-nodes")]
            ForeignReadOperation::check()?;
            #[cfg(not(feature = "foreign-nodes"))]
            let replacement = slot.data.after_clone();
            let state = if let Some(state) = &slot.state {
                let shared = self
                    .pending
                    .shared_state_configs
                    .for_type(slot.type_index)?;
                Some(Arc::new(state.clone_for_write(&shared)))
            } else {
                None
            };
            let record = Arc::make_mut(slot);
            record.state = state;
            if let Some(data) = replacement {
                record.data = data;
            }
        }
        Ok(Arc::make_mut(slot))
    }
    /// Whether node processing is required, before normalization or collection.
    pub fn has_dirty_nodes(&self) -> bool {
        !self.dirty_leaves.is_empty() || !self.dirty_elements.is_empty()
    }
    /// Mark a record and its ancestors without cloning ancestor records.
    /// s2: ID-02, ID-03
    pub fn mark_dirty(&mut self, key: impl Into<NodeKey>) -> Result<(), Error> {
        self.guard_write()?;
        self.dirty_since_flush = true;
        let key = key.into();
        let kind = self.kind(key).ok_or(Error::NodeNotFound(key))?;
        if kind == NodeKind::Element {
            self.dirty_elements.insert(key, DirtyIntent::Intentional);
        } else {
            self.dirty_leaves.insert(key);
        }
        let mut ancestor = self.parent(key);
        while let Some(key) = ancestor {
            if self.dirty_elements.contains_key(&key) {
                break;
            }
            self.dirty_elements
                .insert(key, DirtyIntent::AncestorOfDirty);
            ancestor = self.parent(key);
        }
        #[cfg(feature = "foreign-nodes")]
        if self.clone_foreign_instance_for_write(key)? {
            return Ok(());
        }
        #[cfg(feature = "foreign-nodes")]
        let clone_source = self.foreign_clone_source(key)?;
        let slot = self
            .pending
            .nodes
            .get_mut(&key)
            .ok_or(Error::NodeNotFound(key))?;
        if Arc::strong_count(slot) > 1 {
            #[cfg(feature = "bench-counters")]
            {
                self.work.nodes_cloned += 1;
                self.work.bytes_allocated += std::mem::size_of::<NodeSlot>() as u64;
            }
            #[cfg(feature = "foreign-nodes")]
            let normalized = crate::foreign::payload::clone_payload(
                &self.pending.registry,
                slot.type_index,
                key,
                key,
                &slot.data,
                clone_source,
            );
            #[cfg(feature = "foreign-nodes")]
            ForeignReadOperation::check()?;
            #[cfg(not(feature = "foreign-nodes"))]
            let normalized = slot.data.after_clone();
            let state = if let Some(state) = &slot.state {
                let shared = self
                    .pending
                    .shared_state_configs
                    .for_type(slot.type_index)?;
                Some(Arc::new(state.clone_for_write(&shared)))
            } else {
                None
            };
            let record = Arc::make_mut(slot);
            record.state = state;
            if let Some(data) = normalized {
                record.data = data;
            }
        }
        Ok(())
    }
    /// Mark attached nodes of one exact type.
    pub fn mark_type_dirty<Node: NodeType>(&mut self) -> Result<(), Error> {
        for key in self.nodes_of_type::<Node>() {
            self.mark_dirty(key)?;
        }
        Ok(())
    }
    /// Whether a leaf has been marked dirty.
    pub fn is_dirty_leaf(&self, key: impl Into<NodeKey>) -> bool {
        self.dirty_leaves.contains(&key.into())
    }
    /// Whether an element has been marked dirty.
    pub fn is_dirty_element(&self, key: impl Into<NodeKey>) -> bool {
        self.dirty_elements.contains_key(&key.into())
    }
    /// Whether writing this record requires no snapshot clone.
    pub fn is_writable(&self, key: impl Into<NodeKey>) -> bool {
        {
            let key = key.into();
            self.pending.nodes.get(&key).is_some_and(|slot| {
                Arc::strong_count(slot) == 1
                    && self
                        .editor
                        .state
                        .nodes
                        .get(&key)
                        .is_none_or(|previous| !Arc::ptr_eq(previous, slot))
            })
        }
    }
    /// Mutably project a payload, cloning user data only on its first payload write.
    /// s2: ID-02, ID-04
    pub fn get_mut<Node: NodeType>(
        &mut self,
        key: impl Into<NodeKey>,
    ) -> Result<NodeMut<'_, Node>, Error> {
        let key = key.into();
        #[cfg(feature = "foreign-nodes")]
        if self
            .native_projection
            .as_ref()
            .is_some_and(|frame| frame.key == key)
        {
            self.writable(key)?;
            let payload = self
                .pending
                .nodes
                .get(&key)
                .ok_or(Error::NodeNotFound(key))?
                .data
                .as_any()
                .downcast_ref::<crate::foreign::projection::ForeignPayload>()
                .ok_or(Error::NodeTypeMismatch(key))?;
            let frame = self
                .native_projection
                .as_mut()
                .ok_or(Error::Invariant("native scope"))?;
            frame.refresh(payload);
            return frame.get_mut::<Node>().map(NodeMut);
        }
        let index = self.type_index(key).ok_or(Error::NodeNotFound(key))?;
        if self.get::<Node>(key).is_none() {
            return Err(Error::NodeTypeMismatch(key));
        }
        let project = self.pending.registry.vtable(index).project_mut;
        let slot = self.writable(key)?;
        if Arc::get_mut(&mut slot.data).is_none() {
            slot.data = slot.data.clone_arc();
        }
        let data = Arc::get_mut(&mut slot.data).ok_or(Error::Invariant("payload still shared"))?;
        let node = project(data.as_any_mut(), std::any::TypeId::of::<Node>())
            .and_then(|data| data.downcast_mut::<Node>())
            .ok_or(Error::NoMutableUpcast(key))?;
        Ok(NodeMut(node))
    }
    /// Update a typed payload in place.
    pub fn update_node<Node: NodeType>(
        &mut self,
        key: impl Into<NodeKey>,
        f: impl FnOnce(&mut Node),
    ) -> Result<(), Error> {
        f(&mut *self.get_mut::<Node>(key)?);
        Ok(())
    }
    /// Create a detached node, applying its direct registered replacement.
    pub fn create<Node: NodeType>(&mut self, node: Node) -> Result<Id<Node>, Error> {
        self.guard_write()?;
        let original = self.create_exact(node)?;
        let index = self
            .type_index(original)
            .ok_or(Error::NodeNotFound(original.key()))?;
        if let Some(replacement) = self.pending.registry.registered(index).replaced_by {
            let slot = self
                .view()
                .slot(original.key())
                .ok_or(Error::NodeNotFound(original.key()))?;
            let data = self
                .pending
                .registry
                .replacements
                .get(&index)
                .ok_or(Error::Invariant("missing replacement"))?
                .replace(slot.data.as_any())?;
            // The original allocation is burned, exactly as $applyNodeReplacement does.
            self.remove_record(original.key());
            self.dirty_leaves.shift_remove(&original.key());
            self.dirty_elements.shift_remove(&original.key());
            let base = (self.pending.registry.vtable(replacement).initial_base)(data.as_any())?;
            let key = self.insert_record(replacement, data, base)?;
            return Ok(Id::new_unchecked(key));
        }
        Ok(original)
    }
    /// Create without applying a replacement.
    pub fn create_exact<Node: NodeType>(&mut self, node: Node) -> Result<Id<Node>, Error> {
        self.guard_write()?;
        let index = self
            .pending
            .registry
            .index_of::<Node>()
            .ok_or(Error::UnregisteredNodeOnCreate(Node::TYPE))?;
        let base = (self.pending.registry.vtable(index).initial_base)(&node)?;
        Ok(Id::new_unchecked(self.insert_record(
            index,
            Arc::new(node),
            base,
        )?))
    }
    /// Create with explicit framework fields.
    pub fn create_with<Node: NodeType>(
        &mut self,
        node: Node,
        base: BaseData,
    ) -> Result<Id<Node>, Error> {
        self.guard_write()?;
        let index = self
            .pending
            .registry
            .index_of::<Node>()
            .ok_or(Error::UnregisteredNodeOnCreate(Node::TYPE))?;
        if base.kind() != self.pending.registry.registered(index).kind {
            return Err(Error::BaseKindMismatch);
        }
        Ok(Id::new_unchecked(self.insert_record(
            index,
            Arc::new(node),
            base,
        )?))
    }
    pub(crate) fn insert_record(
        &mut self,
        index: NodeTypeIndex,
        data: Arc<dyn crate::node::AnyNodeData>,
        base: BaseData,
    ) -> Result<NodeKey, Error> {
        if self.pending.registry.registered(index).type_name == Root::TYPE {
            return Err(Error::Invariant("root already exists"));
        }
        self.guard_write()?;
        let key = self.editor.keys.next()?;
        if matches!(base, BaseData::Decorator) {
            self.pending.opaque_text_count += 1;
        }
        self.pending.nodes.insert(
            key,
            Arc::new(NodeSlot {
                #[cfg(feature = "foreign-nodes")]
                foreign_identity: Default::default(),
                #[cfg(feature = "foreign-nodes")]
                foreign_instance: Default::default(),
                #[cfg(feature = "foreign-nodes")]
                foreign_instance_write: None,
                #[cfg(feature = "foreign-nodes")]
                foreign_root_cache: None,
                key,
                type_index: index,
                links: Links::default(),
                base,
                state: None,
                data,
            }),
        );
        self.pending.max_key = self.pending.max_key.max(key);
        self.mark_dirty(key)?;
        Ok(key)
    }
    /// Create ordinary text through its configured replacement.
    pub fn create_text(&mut self, text: &str) -> Result<Id<Text>, Error> {
        let key = self.create(Text::default())?;
        self.text(key)?.set_text_content(text)?;
        Ok(key)
    }
    /// Create a registered type's final replacement from its default constructor.
    pub fn create_resolved<Node: NodeType>(&mut self) -> Result<NodeKey, Error> {
        self.guard_write()?;
        let index = self
            .pending
            .registry
            .index_of::<Node>()
            .ok_or(Error::UnregisteredNodeOnCreate(Node::TYPE))?;
        let index = self
            .pending
            .registry
            .resolve_replacements(index)
            .ok_or(Error::Invariant("invalid type index"))?;
        #[cfg(feature = "foreign-nodes")]
        if self.pending.registry.vtable(index).foreign.is_some() {
            return Err(Error::NoDefault(
                self.pending.registry.registered(index).type_name,
            ));
        }
        let create = self.pending.registry.vtable(index).default_create;
        create(self)
    }
    /// Copy payload and properties into a detached node with no children.
    /// s2: ID-05, ID-06
    pub fn copy_node(
        &mut self,
        key: impl Into<NodeKey>,
        skip_reset: bool,
    ) -> Result<NodeKey, Error> {
        self.guard_write()?;
        let key = key.into();
        let original = self
            .view()
            .slot(key)
            .ok_or(Error::NodeNotFound(key))?
            .clone();
        #[cfg(feature = "foreign-nodes")]
        let foreign = self
            .pending
            .registry
            .registered(original.type_index)
            .foreign
            .is_some()
            || original.foreign_instance.get().is_some();
        #[cfg(not(feature = "foreign-nodes"))]
        let foreign = false;
        #[cfg(feature = "foreign-nodes")]
        let clone_source = if foreign {
            Some(self.view().snapshot_for_foreign_read()?)
        } else {
            None
        };
        let data = if foreign {
            original.data.clone()
        } else {
            original
                .data
                .after_clone()
                .unwrap_or_else(|| original.data.clone())
        };
        #[cfg(feature = "foreign-nodes")]
        let mut base = original.base.clone();
        #[cfg(not(feature = "foreign-nodes"))]
        let mut base = original.base;
        if let BaseData::Element(data) = &mut base {
            data.first = None;
            data.last = None;
            data.size = 0;
        }
        let copy = self.insert_record(original.type_index, data, base)?;
        #[cfg(feature = "foreign-nodes")]
        let instance_copy = if original.foreign_instance.get().is_some() {
            let source = clone_source
                .as_ref()
                .ok_or(Error::Invariant("foreign copy source"))?
                .clone();
            let base = self
                .pending
                .nodes
                .get(&copy)
                .ok_or(Error::NodeNotFound(copy))?
                .base
                .clone();
            match self.clone_foreign_instance_for_copy(&original, source, copy, base) {
                Ok(copied) => copied,
                Err(error) => {
                    self.remove_record(copy);
                    return Err(error);
                }
            }
        } else {
            false
        };
        #[cfg(feature = "foreign-nodes")]
        if foreign
            && !instance_copy
            && let Some(data) = crate::foreign::payload::clone_payload(
                &self.pending.registry,
                original.type_index,
                copy,
                key,
                &original.data,
                clone_source,
            )
        {
            self.writable(copy)?.data = data;
        }
        let mut state = original.state;
        if !skip_reset && let Some(state) = &mut state {
            Arc::make_mut(state).reset_copy();
        }
        self.writable(copy)?.state = state;
        if !skip_reset {
            self.reset_on_copy(copy, key)?;
        }
        Ok(copy)
    }
    /// Store a state value, including explicit writes equal to its default.
    /// s2: NS-05, NS-06
    pub fn set_state<ValueType: StateValue>(
        &mut self,
        key: impl Into<NodeKey>,
        state_key: &'static StateKey<ValueType>,
        value: ValueType,
    ) -> Result<(), Error> {
        self.guard_write()?;
        let key = key.into();
        self.guard_write()?;
        self.get_state(key, state_key)?;
        let index = self.type_index(key).ok_or(Error::NodeNotFound(key))?;
        self.pending.shared_state_configs.learn(index, state_key)?;
        let slot = self.writable(key)?;
        let state = slot
            .state
            .get_or_insert_with(|| Arc::new(NodeState::default()));
        Arc::make_mut(state).set(state_key, value)
    }
    /// Derive a state value from the current one.
    /// s2: NS-05
    pub fn update_state<ValueType: StateValue>(
        &mut self,
        key: impl Into<NodeKey>,
        state_key: &'static StateKey<ValueType>,
        update: impl FnOnce(&ValueType) -> ValueType,
    ) -> Result<(), Error> {
        self.guard_write()?;
        let key = key.into();
        let previous = self.get_state(key, state_key)?;
        let next = update(&previous);
        if state_key.is_equal(&previous, &next) {
            return Ok(());
        }
        self.set_state(key, state_key, next)
    }
    /// Update state, framework fields and payload through their virtual setters.
    pub fn update_from_json(
        &mut self,
        key: impl Into<NodeKey>,
        json: &SerializedNode,
    ) -> Result<(), Error> {
        self.guard_write()?;
        let key = key.into();
        #[cfg(feature = "foreign-nodes")]
        if let Some(result) = crate::foreign::dispatch::update_override(self, key, json) {
            return result;
        }
        self.update_from_json_with(key, json, JsonImport::FULL)
    }
    /// Apply only the import components a custom node accepts.
    pub fn update_from_json_with(
        &mut self,
        key: impl Into<NodeKey>,
        json: &SerializedNode,
        import: JsonImport,
    ) -> Result<(), Error> {
        self.import_fields(key.into(), json, import, false)
    }
    /// Apply values already validated by a remote peer without running virtual setters.
    pub fn apply_remote_fields(
        &mut self,
        key: impl Into<NodeKey>,
        json: &SerializedNode,
    ) -> Result<(), Error> {
        self.import_fields(key.into(), json, JsonImport::FULL, true)
    }
    fn import_fields(
        &mut self,
        key: NodeKey,
        json: &SerializedNode,
        import: JsonImport,
        raw: bool,
    ) -> Result<(), Error> {
        self.guard_write()?;
        let index = self.type_index(key).ok_or(Error::NodeNotFound(key))?;
        let layout = self.pending.registry.registered(index).state_layout.clone();
        #[cfg(feature = "foreign-nodes")]
        let layout = self.pending.registry.foreign_states.layout(&layout);
        let opaque = self
            .view()
            .slot(key)
            .is_some_and(|slot| crate::opaque::raw(slot.data.as_ref()).is_some());
        let existing = self.view().slot(key).and_then(|slot| slot.state.clone());
        let mut filtered = json.clone();
        match import.state {
            StateImportFilter::All => {}
            StateImportFilter::Only(names) => {
                if let Some(serde_json::Value::Object(values)) = filtered.get_mut("$") {
                    values.retain(|name, _| names.contains(&name.as_str()));
                }
                for entry in &layout.entries {
                    if entry.flat && !names.contains(&entry.key.name()) {
                        filtered.shift_remove(entry.key.name());
                    }
                }
            }
            StateImportFilter::None => {
                filtered.shift_remove("$");
                for entry in &layout.entries {
                    if entry.flat {
                        filtered.shift_remove(entry.key.name());
                    }
                }
            }
        }
        let shared = self.pending.shared_state_configs.for_type(index)?;
        let state = NodeState::import(&filtered, &layout, existing.as_deref(), Some(&shared));
        self.writable(key)?.state = state.map(Arc::new);
        if import.base_fields {
            let number = |name: &str| {
                json.get(name)
                    .and_then(serde_json::Value::as_u64)
                    .and_then(|n| u32::try_from(n).ok())
                    .unwrap_or_default()
            };
            match self.kind(key) {
                Some(NodeKind::Text) => {
                    let text = json
                        .get("text")
                        .and_then(serde_json::Value::as_str)
                        .unwrap_or_default();
                    let format_type = json.get("format").and_then(serde_json::Value::as_str);
                    let parsed_format =
                        format_type.and_then(|value| value.parse::<TextFormatType>().ok());
                    let format = parsed_format.map_or_else(
                        || TextFormat::from_bits_retain(number("format")),
                        TextFormatType::flag,
                    );
                    let detail = TextDetail::from_bits_retain(number("detail"));
                    let mode = json
                        .get("mode")
                        .map(|value| {
                            serde_json::from_value(value.clone()).or_else(|error| {
                                if opaque {
                                    Ok(Default::default())
                                } else {
                                    Err(error)
                                }
                            })
                        })
                        .transpose()?
                        .unwrap_or_default();
                    let style = json
                        .get("style")
                        .and_then(serde_json::Value::as_str)
                        .unwrap_or_default();
                    if raw {
                        let BaseData::Text(data) = &mut self.writable(key)?.base else {
                            return Err(Error::NotAText(key));
                        };
                        *data = TextData {
                            text: TextBuffer::new(text),
                            format,
                            detail,
                            mode,
                            style: Arc::from(style),
                            ..TextData::default()
                        };
                    } else {
                        self.text(key)?
                            .set_text_content(text)?
                            .set_format(format)?
                            .set_detail(detail)?
                            .set_mode(mode)?
                            .set_style(style)?;
                    }
                    let BaseData::Text(data) = &mut self.writable(key)?.base else {
                        return Err(Error::NotAText(key));
                    };
                    data.absent =
                        AbsentKeys::from_json(json, &["text", "format", "detail", "mode", "style"]);
                    if format_type.is_some() && parsed_format.is_none() {
                        data.absent.insert(AbsentKeys::FORMAT);
                    }
                }
                Some(NodeKind::Element) => {
                    let format = json
                        .get("format")
                        .and_then(serde_json::Value::as_str)
                        .and_then(|value| value.parse::<ElementFormat>().ok())
                        .unwrap_or_default();
                    let direction = json
                        .get("direction")
                        .map(|value| {
                            serde_json::from_value(value.clone())
                                .or_else(|error| if opaque { Ok(None) } else { Err(error) })
                        })
                        .transpose()?
                        .flatten();
                    let indent = number("indent");
                    let text_format = TextFormat::from_bits_retain(number("textFormat"));
                    let text_style = json
                        .get("textStyle")
                        .and_then(serde_json::Value::as_str)
                        .unwrap_or_default();
                    self.element(key)?.set_format(format)?;
                    if raw {
                        self.set_indent_base(key, indent)?;
                    } else {
                        self.set_indent(key, indent)?;
                    }
                    self.element(key)?
                        .set_direction(direction)?
                        .set_text_format(text_format)?
                        .set_text_style(text_style)?;
                    let BaseData::Element(data) = &mut self.writable(key)?.base else {
                        return Err(Error::NotAnElement(key));
                    };
                    data.absent = AbsentKeys::from_json(json, &["indent", "direction"]);
                }
                _ => {}
            }
        }
        if import.own_fields {
            let update = self.pending.registry.vtable(index).update;
            #[cfg(feature = "foreign-nodes")]
            let own_json = {
                let mut own = json.clone();
                if self.pending.registry.registered(index).foreign.is_some() {
                    for entry in &layout.entries {
                        if entry.flat {
                            own.shift_remove(entry.key.name());
                        }
                    }
                }
                own
            };
            #[cfg(feature = "foreign-nodes")]
            let json = &own_json;
            let slot = self.writable(key)?;
            if Arc::get_mut(&mut slot.data).is_none() {
                slot.data = slot.data.clone_arc();
            }
            update(
                Arc::get_mut(&mut slot.data)
                    .ok_or(Error::Invariant("payload shared"))?
                    .as_any_mut(),
                json,
            )?;
            if crate::opaque::raw(
                self.view()
                    .slot(key)
                    .ok_or(Error::NodeNotFound(key))?
                    .data
                    .as_ref(),
            )
            .is_some()
            {
                let baseline = self.view().export_framework_json(key)?;
                let slot = self.writable(key)?;
                let data =
                    Arc::get_mut(&mut slot.data).ok_or(Error::Invariant("payload shared"))?;
                crate::opaque::set_baseline(data, baseline);
            }
        }
        Ok(())
    }
    /// Import a node and recursively append its serialized children.
    pub fn import_node(&mut self, json: &SerializedNode) -> Result<NodeKey, Error> {
        self.guard_write()?;
        let name = json
            .get("type")
            .and_then(serde_json::Value::as_str)
            .ok_or(Error::Invariant("node type missing"))?;
        let index = self.pending.registry.import_index(name, json)?;
        let key = (self.pending.registry.vtable(index).import)(self, json)?;
        if self.kind(key) == Some(NodeKind::Element)
            && let Some(children) = json.get("children").and_then(serde_json::Value::as_array)
        {
            for child in children {
                let child = child.as_object().ok_or(Error::NodePayloadNotObject)?;
                let child = self.import_node(child)?;
                self.append(key, &[child])?;
            }
        }
        Ok(key)
    }
    /// Replace the active selection.
    pub fn set_selection(&mut self, selection: Option<Selection>) -> Result<(), Error> {
        self.guard_write()?;
        self.selection_dirty = selection.is_some();
        let selection = selection.map(|mut selection| {
            if let Selection::Range(range) = &mut selection {
                range.invalidate_changed_direction();
            }
            selection.set_dirty(true);
            selection
        });
        self.dirty_since_flush = true;
        self.pending.selection = selection;
        Ok(())
    }
    /// Install a new selection object and expose its identity replacement.
    pub fn replace_selection(&mut self, selection: Option<Selection>) -> Result<(), Error> {
        self.guard_write()?;
        #[cfg(feature = "foreign-nodes")]
        self.retire_foreign_selection();
        self.selection_replacements += 1;
        self.set_selection(selection)
    }
    /// Current composition node, staged with this transaction.
    /// s2: TX-06
    pub fn composition_key(&self) -> Option<NodeKey> {
        self.composition_key
    }
    /// Set composition ownership and mark both old and new nodes dirty.
    pub fn set_composition_key(&mut self, key: Option<NodeKey>) -> Result<(), Error> {
        self.guard_write()?;
        if let Some(key) = key {
            self.node_or_err(key)?;
        }
        if let Some(previous) = self.composition_key {
            self.mark_dirty(previous)?;
        }
        if let Some(key) = key {
            self.mark_dirty(key)?;
        }
        self.composition_key = key;
        Ok(())
    }
    /// Immutable platform information selected at editor construction.
    pub fn view_host(&self) -> ViewHost {
        self.editor.view_host
    }
    /// Store a detached selection unaffected by tree adjustments.
    pub fn detach_selection(&mut self, selection: Selection) -> SelectionSlot {
        let id = DetachedSelectionId(self.detached.len());
        self.detached.push(Some(selection));
        #[cfg(feature = "foreign-nodes")]
        self.foreign_selections.detached.push(Default::default());
        SelectionSlot::Detached(id)
    }
}
impl Read for Transaction<'_> {
    fn view(&self) -> StateRef<'_> {
        self.view()
    }
}
/// Mutable projected user payload.
pub struct NodeMut<'tx, Node: NodeType>(&'tx mut Node);
impl<Node: NodeType> Deref for NodeMut<'_, Node> {
    type Target = Node;
    fn deref(&self) -> &Node {
        self.0
    }
}
impl<Node: NodeType> DerefMut for NodeMut<'_, Node> {
    fn deref_mut(&mut self) -> &mut Node {
        self.0
    }
}
