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
    pub(crate) editor: &'editor mut Editor,
    pub(crate) pending: EditorState,
    pub(crate) dirty_leaves: IndexSet<NodeKey>,
    pub(crate) dirty_elements: IndexMap<NodeKey, DirtyIntent>,
    pub(crate) composition_key: Option<NodeKey>,
    pub(crate) detached: Vec<Option<Selection>>,
}
impl<'editor> Transaction<'editor> {
    pub(crate) fn new(editor: &'editor mut Editor) -> Self {
        let pending = editor.state.pending();
        let composition_key = editor.composition_key;
        Self {
            editor,
            pending,
            dirty_leaves: IndexSet::default(),
            dirty_elements: IndexMap::default(),
            composition_key,
            detached: vec![],
        }
    }
    /// Borrow the pending state, including uncommitted edits.
    pub fn view(&self) -> StateRef<'_> {
        StateRef {
            state: &self.pending,
            previous_selection: self.editor.state.selection(),
            composition_key: self.composition_key,
        }
    }
    /// The state committed before this update began.
    pub fn committed_state(&self) -> &EditorState {
        &self.editor.state
    }
    /// Publish this pending snapshot atomically.
    pub fn commit(self) -> Result<Commit, Error> {
        let previous = self.editor.state.clone();
        self.editor.composition_key = self.composition_key;
        if !self.dirty_leaves.is_empty()
            || !self.dirty_elements.is_empty()
            || self.pending.selection != previous.selection
        {
            self.editor.state = self.pending;
        }
        Ok(Commit {
            previous,
            current: self.editor.state.clone(),
        })
    }
    pub(crate) fn writable(&mut self, key: NodeKey) -> Result<&mut NodeSlot, Error> {
        self.mark_dirty(key)?;
        let slot = self
            .pending
            .nodes
            .get_mut(&key)
            .ok_or(Error::NodeNotFound(key))?;
        if Arc::strong_count(slot) > 1 {
            let replacement = slot.data.after_clone();
            let record = Arc::make_mut(slot);
            if let Some(data) = replacement {
                record.data = data;
            }
        }
        Ok(Arc::make_mut(slot))
    }
    /// Mark a record and its ancestors without cloning ancestor records.
    /// s2: ID-02, ID-03
    pub fn mark_dirty(&mut self, key: impl Into<NodeKey>) -> Result<(), Error> {
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
        let slot = self
            .pending
            .nodes
            .get_mut(&key)
            .ok_or(Error::NodeNotFound(key))?;
        if Arc::strong_count(slot) > 1 {
            let normalized = slot.data.after_clone();
            if let Some(data) = normalized {
                Arc::make_mut(slot).data = data;
            } else {
                Arc::make_mut(slot);
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
            self.pending.nodes.remove(&original.key());
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
        let key = self.editor.keys.next()?;
        self.pending.nodes.insert(
            key,
            Arc::new(NodeSlot {
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
        let data = (self.pending.registry.vtable(index).default_data)().ok_or(Error::NoDefault(
            self.pending.registry.registered(index).type_name,
        ))?;
        let base = (self.pending.registry.vtable(index).initial_base)(data.as_any())?;
        self.insert_record(index, data, base)
    }
    /// Copy payload and properties into a detached node with no children.
    /// s2: ID-05, ID-06
    pub fn copy_node(
        &mut self,
        key: impl Into<NodeKey>,
        skip_reset: bool,
    ) -> Result<NodeKey, Error> {
        let key = key.into();
        let original = self
            .view()
            .slot(key)
            .ok_or(Error::NodeNotFound(key))?
            .clone();
        let data = original
            .data
            .after_clone()
            .unwrap_or_else(|| original.data.clone());
        let mut base = original.base;
        if let BaseData::Element(data) = &mut base {
            data.first = None;
            data.last = None;
            data.size = 0;
        }
        let copy = self.insert_record(original.type_index, data, base)?;
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
        let key = key.into();
        self.get_state(key, state_key)?;
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
        let index = self.type_index(key).ok_or(Error::NodeNotFound(key))?;
        let existing = self.view().slot(key).and_then(|slot| slot.state.clone());
        let mut filtered = json.clone();
        match import.state {
            StateImportFilter::All => {}
            StateImportFilter::Only(names) => {
                if let Some(serde_json::Value::Object(values)) = filtered.get_mut("$") {
                    values.retain(|name, _| names.contains(&name.as_str()));
                }
                for entry in &self.pending.registry.registered(index).state_layout.entries {
                    if entry.flat && !names.contains(&entry.key.name()) {
                        filtered.shift_remove(entry.key.name());
                    }
                }
            }
            StateImportFilter::None => {
                filtered.shift_remove("$");
                for entry in &self.pending.registry.registered(index).state_layout.entries {
                    if entry.flat {
                        filtered.shift_remove(entry.key.name());
                    }
                }
            }
        }
        let state = NodeState::import(
            &filtered,
            &self.pending.registry.registered(index).state_layout,
            existing.as_deref(),
        );
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
                    let format = TextFormat::from_bits_retain(number("format"));
                    let detail = TextDetail::from_bits_retain(number("detail"));
                    let mode = json
                        .get("mode")
                        .map(|value| serde_json::from_value(value.clone()))
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
                }
                Some(NodeKind::Element) => {
                    let format = json
                        .get("format")
                        .map(|value| serde_json::from_value(value.clone()))
                        .transpose()?
                        .unwrap_or_default();
                    let direction = json
                        .get("direction")
                        .map(|value| serde_json::from_value(value.clone()))
                        .transpose()?
                        .flatten();
                    let indent = number("indent");
                    let text_format = TextFormat::from_bits_retain(number("textFormat"));
                    let text_style = json
                        .get("textStyle")
                        .and_then(serde_json::Value::as_str)
                        .unwrap_or_default();
                    if raw {
                        self.set_indent_base(key, indent)?;
                    } else {
                        self.set_indent(key, indent)?;
                    }
                    self.element(key)?
                        .set_format(format)?
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
        }
        Ok(())
    }
    /// Import a node and recursively append its serialized children.
    pub fn import_node(&mut self, json: &SerializedNode) -> Result<NodeKey, Error> {
        let name = json
            .get("type")
            .and_then(serde_json::Value::as_str)
            .ok_or(Error::Invariant("node type missing"))?;
        let index = self.pending.registry.get_or_err(name)?.index;
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
        self.pending.selection = selection;
        Ok(())
    }
    /// Current composition node, staged with this transaction.
    /// s2: TX-06
    pub fn composition_key(&self) -> Option<NodeKey> {
        self.composition_key
    }
    /// Set composition ownership and mark both old and new nodes dirty.
    pub fn set_composition_key(&mut self, key: Option<NodeKey>) -> Result<(), Error> {
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
    /// Borrow a selection by slot.
    pub fn selection_at(&self, slot: SelectionSlot) -> Option<&Selection> {
        match slot {
            SelectionSlot::Active => self.pending.selection.as_ref(),
            SelectionSlot::Detached(id) => self.detached.get(id.0).and_then(Option::as_ref),
        }
    }
    /// Borrow a range selection by slot.
    pub fn range_at(&self, slot: SelectionSlot) -> Option<&RangeSelection> {
        match self.selection_at(slot)? {
            Selection::Range(range) => Some(range),
            _ => None,
        }
    }
    /// Store a detached selection unaffected by tree adjustments.
    pub fn detach_selection(&mut self, selection: Selection) -> SelectionSlot {
        let id = DetachedSelectionId(self.detached.len());
        self.detached.push(Some(selection));
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
