//! Borrowed records and ephemeral independent copies.
use super::*;

/// Borrowed framework record without exposing mutable links.
#[derive(Clone, Copy)]
pub struct NodeRef<'state> {
    pub(super) slot: &'state NodeSlot,
    pub(super) registry: &'state std::sync::Arc<Registry>,
}
/// An owned ephemeral record that cannot mutate a snapshot.
pub struct NodeRecord {
    pub(super) slot: NodeSlot,
    pub(super) registry: std::sync::Arc<Registry>,
}
impl NodeRecord {
    /// Borrow the copied framework fields and payload.
    pub fn as_ref(&self) -> NodeRef<'_> {
        NodeRef {
            slot: &self.slot,
            registry: &self.registry,
        }
    }
}
impl<'state> NodeRef<'state> {
    #[cfg(feature = "foreign-nodes")]
    pub(crate) fn foreign_record_identity(self) -> &'state ForeignRecordIdentity {
        &self.slot.foreign_identity.0
    }

    #[cfg(feature = "foreign-nodes")]
    pub(crate) fn from_retired(
        slot: &'state NodeSlot,
        registry: &'state std::sync::Arc<Registry>,
    ) -> Self {
        Self { slot, registry }
    }

    /// Capture raw development host fields without running an upstream clone hook.
    /// The copied record cannot make a live source slot require snapshot cloning.
    #[cfg(feature = "foreign-nodes")]
    pub fn capture_for_foreign_read(self) -> NodeRecord {
        NodeRecord {
            slot: self.slot.clone(),
            registry: self.registry.clone(),
        }
    }
    /// Make an independent ephemeral record, applying the clone hook.
    /// s2: ID-07
    pub fn to_owned(self) -> NodeRecord {
        #[cfg(feature = "foreign-nodes")]
        {
            self.to_owned_impl(None)
        }
        #[cfg(not(feature = "foreign-nodes"))]
        {
            self.to_owned_impl()
        }
    }
    #[cfg(feature = "foreign-nodes")]
    pub(crate) fn to_owned_with_source(self, source: ForeignReadSnapshot) -> NodeRecord {
        self.to_owned_impl(Some(source))
    }
    fn to_owned_impl(
        self,
        #[cfg(feature = "foreign-nodes")] source: Option<ForeignReadSnapshot>,
    ) -> NodeRecord {
        let mut slot = self.slot.clone();
        #[cfg(feature = "foreign-nodes")]
        let replacement = crate::foreign::payload::clone_payload(
            self.registry,
            slot.type_index,
            slot.key,
            slot.key,
            &slot.data,
            source,
        );
        #[cfg(not(feature = "foreign-nodes"))]
        let replacement = slot.data.after_clone();
        if let Some(data) = replacement {
            slot.data = data;
        }
        NodeRecord {
            slot,
            registry: std::sync::Arc::clone(self.registry),
        }
    }
    /// Node identity.
    pub fn key(self) -> NodeKey {
        self.slot.key
    }
    /// Node kind.
    pub fn kind(self) -> NodeKind {
        self.slot.base.kind()
    }
    /// Registered type index.
    pub fn type_index(self) -> NodeTypeIndex {
        self.slot.type_index
    }
    /// Registered type name.
    pub fn type_name(self) -> &'static str {
        self.registry.registered(self.slot.type_index).type_name
    }
    /// Parent identity.
    pub fn parent(self) -> Option<NodeKey> {
        self.slot.links.parent
    }
    /// Previous sibling.
    pub fn prev(self) -> Option<NodeKey> {
        self.slot.links.prev
    }
    /// Next sibling.
    pub fn next(self) -> Option<NodeKey> {
        self.slot.links.next
    }
    /// Base framework fields.
    pub fn base(self) -> &'state BaseData {
        &self.slot.base
    }
    /// Node state, if allocated.
    pub fn node_state(self) -> Option<&'state NodeState> {
        self.slot.state.as_deref()
    }
    /// Borrow a native payload or its registered native parent without graph lookup.
    /// Foreign payloads expose no native fields outside an inherited native scope.
    pub fn get<Node: NodeType>(self) -> Option<&'state Node> {
        (self.registry.vtable(self.slot.type_index).project)(
            self.slot.data.as_any(),
            TypeId::of::<Node>(),
        )?
        .downcast_ref::<Node>()
    }
    /// Type-erased user payload.
    pub fn data_any(self) -> &'state dyn std::any::Any {
        self.slot.data.as_any()
    }
}
