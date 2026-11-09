//! Indexed exact captures are separate from semantic JS node identities.
use super::*;
use lexical_model::ForeignRecordIdentity;
use std::collections::HashMap;

type NodeIdentity = (u64, u32, u32, u32, u32, u32);
fn node_identity(node: compat::ForeignNodeRef) -> NodeIdentity {
    (
        node.version,
        node.key.generation,
        node.key.index,
        node.instance_owner_id,
        node.class_id,
        node.instance_id,
    )
}
#[derive(Clone, PartialEq, Eq, Hash)]
pub(super) struct CaptureKey {
    node: NodeIdentity,
    update: u32,
    access: u8,
    identity: ForeignRecordIdentity,
    root_cache: bool,
}
impl CaptureKey {
    pub fn new(
        reference: compat::ForeignRecordRef,
        identity: ForeignRecordIdentity,
        root_cache: bool,
    ) -> Self {
        Self {
            node: node_identity(reference.node),
            update: reference.update_id,
            access: reference.access as u8,
            identity,
            root_cache,
        }
    }
}
#[derive(Default)]
pub(super) struct CaptureIndex {
    exact: HashMap<CaptureKey, u64>,
    nodes: HashMap<NodeIdentity, usize>,
}
impl CaptureIndex {
    pub fn get(&self, key: &CaptureKey) -> Option<u64> {
        self.exact.get(key).copied()
    }
    pub fn contains_node(&self, node: compat::ForeignNodeRef) -> bool {
        self.nodes.contains_key(&node_identity(node))
    }
    pub fn insert(&mut self, key: CaptureKey, id: u64) {
        *self.nodes.entry(key.node).or_default() += 1;
        self.exact.insert(key, id);
    }
    pub fn retain(&mut self, captures: &HashMap<u64, records::Capture>) {
        self.exact.retain(|_, id| captures.contains_key(id));
        self.nodes.clear();
        for key in self.exact.keys() {
            *self.nodes.entry(key.node).or_default() += 1;
        }
    }
}
impl Host {
    pub(super) fn prune_capture_index(&mut self) {
        self.capture_index.retain(&self.captures);
    }
}
