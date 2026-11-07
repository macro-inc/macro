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
#[derive(Clone)]
/// s2: UPD-02
pub struct EditorState {
    pub(crate) registry: Arc<Registry>,
    pub(crate) nodes: NodeMap,
    pub(crate) selection: Option<Selection>,
    pub(crate) root_text: Arc<OnceLock<Arc<str>>>,
    pub(crate) max_key: NodeKey,
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
                key: NodeKey::ROOT,
                type_index: index,
                links: Default::default(),
                base: BaseData::Element(Default::default()),
                data: Arc::new(Root::default()),
                state: None,
            }),
        );
        Ok(Self {
            registry,
            nodes,
            selection: None,
            root_text: Arc::new(OnceLock::new()),
            max_key: NodeKey::ROOT,
        })
    }
    pub(crate) fn pending(&self) -> Self {
        Self {
            root_text: Arc::new(OnceLock::new()),
            ..self.clone()
        }
    }
    /// Borrow this snapshot.
    pub fn view(&self) -> StateRef<'_> {
        StateRef {
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
            selection,
            ..self.clone()
        }
    }
    /// Cached root text, shared only by snapshots with identical nodes.
    /// s2: NODE-08
    pub fn root_text_content(&self) -> Arc<str> {
        self.root_text
            .get_or_init(|| Arc::from(self.view().text_content(NodeKey::ROOT).as_ref()))
            .clone()
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
