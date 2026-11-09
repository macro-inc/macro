//! Owned render facts independent of public export callbacks and JS object fields.
use crate::*;
use std::{
    any::TypeId,
    sync::{Arc, Weak},
};

/// Non-owning namespace key for host registries; never retains an editor or state.
#[derive(Clone)]
pub struct ForeignWeakEditorIdentity(Weak<()>);
impl ForeignEditorIdentity {
    /// Compare namespaces without numeric-ID assumptions or editor retention.
    pub fn same_owner(&self, other: &Self) -> bool {
        Arc::ptr_eq(&self.0, &other.0)
    }
    /// Permit host namespace registries to prune entries after the last state releases them.
    pub fn downgrade(&self) -> ForeignWeakEditorIdentity {
        ForeignWeakEditorIdentity(Arc::downgrade(&self.0))
    }
}
impl ForeignWeakEditorIdentity {
    /// Recover the namespace only while some editor, state or instance retains it.
    pub fn upgrade(&self) -> Option<ForeignEditorIdentity> {
        self.0.upgrade().map(super::pending::ForeignEditorIdentity)
    }
    /// Compare weak registry keys even after their owning namespace has expired.
    pub fn same_owner(&self, other: &Self) -> bool {
        self.0.ptr_eq(&other.0)
    }
}
/// Raw native render input; arbitrary JS properties stay in the instance slot.
pub struct ForeignRenderRecord {
    record: NodeRecord,
    identity: ForeignRecordIdentity,
    owner: ForeignEditorIdentity,
    native_type: Option<&'static str>,
    root_cached_text: Option<Arc<str>>,
}
impl ForeignRenderRecord {
    /// Exact captured source identity used by host record/version checks.
    pub fn identity(&self) -> &ForeignRecordIdentity {
        &self.identity
    }
    /// Publication owner, which may differ from a transferred instance's owner.
    pub fn owner(&self) -> &ForeignEditorIdentity {
        &self.owner
    }
    /// Original key and immutable framework record.
    pub fn record(&self) -> NodeRef<'_> {
        self.record.as_ref()
    }
    /// Scalar fields and structural element data, read without virtual dispatch.
    pub fn base(&self) -> &BaseData {
        &self.record.slot.base
    }
    /// Complete framework links, read without virtual dispatch.
    pub fn links(&self) -> ForeignCloneLinks {
        ForeignCloneLinks::from_slot(&self.record.slot)
    }
    /// Nearest concrete native registry entry, absent for kind-only runtime classes.
    pub fn native_type(&self) -> Option<&'static str> {
        self.native_type
    }
    /// Materialized RootNode cached text; absent for null caches and other nodes.
    pub fn root_cached_text(&self) -> Option<&str> {
        self.root_cached_text.as_deref()
    }
    /// Typed native projection; never executes exportJSON, custom getters or transforms.
    pub fn native<Node: NodeType>(&self) -> Option<&Node> {
        let slot = &self.record.slot;
        if let Some(payload) = slot
            .data
            .as_any()
            .downcast_ref::<super::projection::ForeignPayload>()
        {
            return (payload.table.project)(payload.native.as_any(), TypeId::of::<Node>())?
                .downcast_ref::<Node>();
        }
        self.record.as_ref().get::<Node>()
    }
}
impl ForeignReadSnapshot {
    /// Capture an ordered set of records for a separate typed host render batch.
    /// Missing keys reject; removed keys belong in the batch's separate removal list.
    pub fn render_records(
        &self,
        keys: impl IntoIterator<Item = NodeKey>,
    ) -> Result<Vec<ForeignRenderRecord>, Error> {
        keys.into_iter()
            .map(|key| {
                let node = self.view().node_or_err(key)?;
                let mut entry = self.state().registry.node(node.type_index());
                let native_type = loop {
                    match entry {
                        Some(current) if current.foreign.is_none() => {
                            break Some(current.type_name);
                        }
                        Some(current) => {
                            entry = current
                                .foreign
                                .as_ref()
                                .and_then(|definition| definition.extends)
                                .and_then(|name| self.state().registry.get(name));
                        }
                        None => break None,
                    }
                };
                Ok(ForeignRenderRecord {
                    record: node.capture_for_foreign_read(),
                    identity: self.record_identity(key)?,
                    owner: self.state().foreign_instances.owner.clone(),
                    native_type,
                    root_cached_text: if key == NodeKey::ROOT {
                        node.slot
                            .foreign_root_cache
                            .as_ref()
                            .and_then(|cache| cache.value.get().cloned())
                    } else {
                        None
                    },
                })
            })
            .collect()
    }
}

#[cfg(test)]
mod test;
