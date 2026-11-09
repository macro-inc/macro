//! Immutable, structurally shared editor snapshots.
use crate::node::NodeSlot;
use crate::*;
use rustc_hash::FxHasher;
use std::{
    hash::BuildHasherDefault,
    sync::{Arc, OnceLock},
};
pub(crate) type NodeMap = imbl::GenericHashMap<
    NodeKey,
    Arc<NodeSlot>,
    BuildHasherDefault<FxHasher>,
    imbl::shared_ptr::ArcK,
>;
/// An immutable snapshot; cloning shares the persistent node map and node records.
/// s2: UPD-02
pub struct EditorState {
    #[cfg(feature = "foreign-nodes")]
    pub(crate) foreign_instances: Arc<crate::foreign::instances::ForeignInstances>,
    pub(crate) shared_state_configs: Arc<crate::node_state::SharedStateConfigs>,
    #[cfg(feature = "foreign-nodes")]
    pub(crate) foreign_selection_identity: ForeignSelectionIdentity,
    pub(crate) registry: Arc<Registry>,
    pub(crate) nodes: NodeMap,
    pub(crate) selection: Option<Selection>,
    pub(crate) root_text: Arc<OnceLock<Arc<str>>>,
    pub(crate) max_key: NodeKey,
    // Opaque text hooks can inspect arbitrary model state. Their presence rules
    // out proving root-text equality from the changed text record alone.
    pub(crate) opaque_text_count: usize,
}
impl Clone for EditorState {
    fn clone(&self) -> Self {
        Self {
            #[cfg(feature = "foreign-nodes")]
            foreign_instances: self.foreign_instances.clone(),
            shared_state_configs: self.shared_state_configs.clone(),
            #[cfg(feature = "foreign-nodes")]
            foreign_selection_identity: self.foreign_selection_identity.clone(),
            registry: self.registry.clone(),
            nodes: self.nodes.clone(),
            #[cfg(feature = "foreign-nodes")]
            selection: self
                .selection
                .as_ref()
                .map(Selection::snapshot_for_foreign_read),
            #[cfg(not(feature = "foreign-nodes"))]
            selection: self.selection.clone(),
            root_text: self.root_text.clone(),
            max_key: self.max_key,
            opaque_text_count: self.opaque_text_count,
        }
    }
}
impl EditorState {
    pub(crate) fn empty(registry: Arc<Registry>) -> Result<Self, Error> {
        let index = registry
            .index_of::<Root>()
            .ok_or(Error::UnregisteredNodeOnCreate("root"))?;
        let mut nodes = NodeMap::default();
        nodes.insert(
            NodeKey::ROOT,
            Arc::new(NodeSlot {
                #[cfg(feature = "foreign-nodes")]
                foreign_identity: Default::default(),
                #[cfg(feature = "foreign-nodes")]
                foreign_instance: Default::default(),
                #[cfg(feature = "foreign-nodes")]
                foreign_instance_write: None,
                #[cfg(feature = "foreign-nodes")]
                foreign_root_cache: None,
                key: NodeKey::ROOT,
                type_index: index,
                links: Default::default(),
                base: BaseData::Element(Default::default()),
                data: Arc::new(Root::default()),
                state: None,
            }),
        );
        Ok(Self {
            #[cfg(feature = "foreign-nodes")]
            foreign_instances: Arc::new(crate::foreign::instances::ForeignInstances::for_owner(
                Arc::new(()),
            )),
            shared_state_configs: Default::default(),
            #[cfg(feature = "foreign-nodes")]
            foreign_selection_identity: Default::default(),
            registry,
            nodes,
            selection: None,
            root_text: Arc::new(OnceLock::new()),
            max_key: NodeKey::ROOT,
            opaque_text_count: 0,
        })
    }
    pub(crate) fn pending(&self) -> Self {
        Self {
            root_text: Arc::new(OnceLock::new()),
            selection: self.selection.clone(),
            ..self.clone()
        }
    }
    pub(crate) fn remove_record(&mut self, key: NodeKey) {
        if let Some(slot) = self.nodes.remove(&key)
            && matches!(slot.base, BaseData::Decorator)
        {
            self.opaque_text_count -= 1;
        }
    }
    /// Borrow this snapshot.
    pub fn view(&self) -> StateRef<'_> {
        StateRef {
            #[cfg(feature = "foreign-nodes")]
            foreign_update_facts: None,
            #[cfg(feature = "foreign-nodes")]
            foreign_selection_argument: None,
            #[cfg(feature = "foreign-nodes")]
            native_projection: None,
            #[cfg(feature = "foreign-nodes")]
            foreign_projections: None,
            #[cfg(feature = "foreign-nodes")]
            foreign_native_calls: None,
            #[cfg(feature = "foreign-nodes")]
            detached_selections: &[],
            #[cfg(feature = "foreign-nodes")]
            foreign_selection_identities: None,
            #[cfg(feature = "foreign-nodes")]
            foreign_previous_selection_identity: Some(&self.foreign_selection_identity),
            #[cfg(feature = "foreign-nodes")]
            source_records: None,
            #[cfg(feature = "foreign-nodes")]
            retired_records: None,
            #[cfg(feature = "foreign-nodes")]
            foreign_origin: None,
            state: self,
            previous_selection: self.selection.as_ref(),
            composition_key: None,
        }
    }
    /// The committed selection.
    pub fn selection(&self) -> Option<&Selection> {
        self.selection.as_ref()
    }
    /// Whether only the root exists and there is no selection.
    pub fn is_empty_state(&self) -> bool {
        self.nodes.len() == 1 && self.selection.is_none()
    }
    /// Share the nodes with a different selection.
    pub fn with_selection(&self, selection: Option<Selection>) -> Self {
        Self {
            #[cfg(feature = "foreign-nodes")]
            foreign_selection_identity: Default::default(),
            selection,
            ..self.clone()
        }
    }
    /// Cached root text, shared only by snapshots with identical nodes.
    /// s2: NODE-08
    pub fn root_text_content(&self) -> Arc<str> {
        self.view().cached_root_text_content()
    }
    /// Whether both values share the same persistent map.
    pub fn same_snapshot(&self, other: &Self) -> bool {
        self.nodes.ptr_eq(&other.nodes)
    }
    /// Number of stored records, including detached nodes.
    pub fn node_count(&self) -> usize {
        self.nodes.len()
    }
    /// Largest allocated key in the snapshot.
    pub fn max_key(&self) -> NodeKey {
        self.max_key
    }
}
impl Read for EditorState {
    fn view(&self) -> StateRef<'_> {
        self.view()
    }
}

impl std::fmt::Debug for EditorState {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("EditorState")
            .field("node_count", &self.node_count())
            .field("selection", &self.selection)
            .finish_non_exhaustive()
    }
}
