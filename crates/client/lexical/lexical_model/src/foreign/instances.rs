//! Editor-scoped opaque JS instance identities and semantic clone staging.
use crate::{node::NodeSlot, *};
use std::{
    any::Any,
    num::NonZeroU32,
    sync::{Arc, OnceLock},
};

/// A JS instance's namespace and numeric identity; never a JS object or editor.
#[derive(Clone)]
pub struct ForeignInstance {
    owner: ForeignEditorIdentity,
    class: NonZeroU32,
    instance: NonZeroU32,
    ephemeral: bool,
}
impl ForeignInstance {
    /// Bind numeric identities to their editor namespace.
    pub fn new(owner: ForeignEditorIdentity, class: u32, instance: u32) -> Result<Self, Error> {
        Ok(Self {
            owner,
            class: NonZeroU32::new(class).ok_or(Error::Invariant("zero foreign class identity"))?,
            instance: NonZeroU32::new(instance)
                .ok_or(Error::Invariant("zero foreign instance identity"))?,
            ephemeral: false,
        })
    }
    /// Mark the temporary self-resolving instance used by ephemeral export clones.
    pub fn ephemeral(mut self) -> Self {
        self.ephemeral = true;
        self
    }
    /// Owning namespace; equal numeric IDs in another namespace are unrelated.
    pub fn owner(&self) -> &ForeignEditorIdentity {
        &self.owner
    }
    /// Registered JS class identity within the owner namespace.
    pub fn class_id(&self) -> u32 {
        self.class.get()
    }
    /// JS instance slot within the owner namespace.
    pub fn instance_id(&self) -> u32 {
        self.instance.get()
    }
    /// Whether getLatest/getWritable must resolve directly to this temporary object.
    pub fn is_ephemeral(&self) -> bool {
        self.ephemeral
    }
    /// Whether the namespace is the same, without retaining its editor.
    pub fn same_owner(&self, other: &Self) -> bool {
        Arc::ptr_eq(&self.owner.0, &other.owner.0)
    }
}
impl PartialEq for ForeignInstance {
    fn eq(&self, other: &Self) -> bool {
        self.same_owner(other)
            && self.class == other.class
            && self.instance == other.instance
            && self.ephemeral == other.ephemeral
    }
}
impl Eq for ForeignInstance {}
impl std::fmt::Debug for ForeignInstance {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ForeignInstance")
            .field("class", &self.class)
            .field("instance", &self.instance)
            .field("ephemeral", &self.ephemeral)
            .finish_non_exhaustive()
    }
}
/// The semantic clone operation, independent of incidental Rust snapshot copies.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ForeignCloneMode {
    /// First write to a shared publication record.
    CopyOnWrite,
    /// A new detached node with a fresh key.
    Copy,
    /// An explicit restoring clone, when the source operation actually clones.
    Restore,
    /// A temporary original-key object whose latest/writable methods return self.
    Ephemeral,
}
/// Framework tree links observed only for validation, never applied as a patch.
#[derive(Clone, Debug, PartialEq, Eq, Default)]
pub struct ForeignCloneLinks {
    /// Parent key.
    pub parent: Option<NodeKey>,
    /// Previous sibling key.
    pub previous: Option<NodeKey>,
    /// Next sibling key.
    pub next: Option<NodeKey>,
    /// First child key for elements.
    pub first: Option<NodeKey>,
    /// Last child key for elements.
    pub last: Option<NodeKey>,
    /// Child count for elements.
    pub size: u32,
}
impl ForeignCloneLinks {
    pub(crate) fn from_slot(slot: &NodeSlot) -> Self {
        let (first, last, size) = match &slot.base {
            BaseData::Element(data) => (data.first, data.last, data.size),
            _ => (None, None, 0),
        };
        Self {
            parent: slot.links.parent,
            previous: slot.links.prev,
            next: slot.links.next,
            first,
            last,
            size,
        }
    }
}
/// Pure native payload changes; this cannot access a transaction or alter links.
pub trait ForeignPayloadPatch: Send + Sync + 'static {
    /// Apply validated native-class fields to an independent typed payload copy.
    fn apply(&self, payload: &mut dyn Any) -> Result<(), Error>;
}
/// Owned constructor input; its graph is read-only and excludes any staged writes.
pub struct ForeignInstanceCloneRequest {
    /// Actual semantic operation.
    pub mode: ForeignCloneMode,
    /// Original key seen by the static clone constructor.
    pub constructor_key: NodeKey,
    /// Final key assigned before afterCloneFrom.
    pub destination_key: NodeKey,
    /// Original instance including its owning namespace.
    pub original: ForeignInstance,
    /// Namespace of the invoking editor, independent of a transferred source instance.
    pub destination_owner: ForeignEditorIdentity,
    /// Source graph capture, not an invoking transaction reference.
    pub source: ForeignReadSnapshot,
    /// Initial destination scalar/base fields and authoritative structural fields.
    pub base: BaseData,
    /// Required final structural observations.
    pub required_links: ForeignCloneLinks,
}
/// Validated construction acknowledgement, installed only after every check succeeds.
pub struct ForeignInstanceClone {
    /// Fresh JS instance slot, with explicit namespace and ephemeral marker.
    pub instance: ForeignInstance,
    /// Final scalar base fields; structural fields must equal required_links.
    pub base: BaseData,
    /// Observed JS links, checked rather than installed.
    pub observed_links: ForeignCloneLinks,
    /// Optional pure typed native payload updates; arbitrary JS fields remain opaque.
    pub payload: Option<Box<dyn ForeignPayloadPatch>>,
    /// Final RootNode cachedText from the staged constructor; null is None.
    /// This is derived cache metadata, never a Root payload field.
    pub root_cache: Option<Arc<str>>,
}
/// A production class host; JS forwarding implementations retain weak JS ownership.
pub trait ForeignInstanceHooks: Send + Sync + 'static {
    /// Check the editor-local registered class for this native type without JS callbacks.
    fn validate_instance(&self, type_name: &str, instance: &ForeignInstance) -> Result<(), Error>;
    /// Execute static clone and afterCloneFrom against owned staged fields.
    fn clone_instance(
        &self,
        request: ForeignInstanceCloneRequest,
    ) -> Result<ForeignInstanceClone, Error>;
}
#[derive(Clone)]
pub(crate) struct ForeignRootCache {
    pub value: Arc<OnceLock<Arc<str>>>,
    pub derived: bool,
}
pub(crate) struct ForeignInstances {
    pub owner: ForeignEditorIdentity,
    hooks: OnceLock<Arc<dyn ForeignInstanceHooks>>,
}
impl ForeignInstances {
    pub(crate) fn validate_instance(
        &self,
        type_name: &str,
        instance: &ForeignInstance,
    ) -> Result<(), Error> {
        self.hooks
            .get()
            .ok_or(Error::Invariant("foreign instance host missing"))?
            .validate_instance(type_name, instance)
    }
    pub(crate) fn has_hooks(&self) -> bool {
        self.hooks.get().is_some()
    }
    pub fn for_owner(owner: Arc<()>) -> Self {
        Self::new(super::pending::ForeignEditorIdentity(owner))
    }
    pub fn new(owner: ForeignEditorIdentity) -> Self {
        Self {
            owner,
            hooks: OnceLock::new(),
        }
    }
    fn clone_record(
        &self,
        original: &NodeSlot,
        source: ForeignReadSnapshot,
        mode: ForeignCloneMode,
        destination: NodeKey,
        base: BaseData,
        links: ForeignCloneLinks,
    ) -> Result<NodeSlot, Error> {
        let instance = original
            .foreign_instance
            .get()
            .ok_or(Error::Invariant("foreign instance missing"))?
            .clone();
        let hooks = self
            .hooks
            .get()
            .ok_or(Error::Invariant("foreign instance host missing"))?;
        let registry = source.view().state.registry.clone();
        let shared_configs = source.view().state.shared_state_configs.clone();
        let operation = ForeignReadOperation::begin()?;
        let _scope = super::clone::Scope::enter(Some(source.clone()));
        let result = hooks.clone_instance(ForeignInstanceCloneRequest {
            mode,
            constructor_key: original.key,
            destination_key: destination,
            original: instance.clone(),
            destination_owner: self.owner.clone(),
            source,
            base: base.clone(),
            required_links: links.clone(),
        })?;
        ForeignReadOperation::check()?;
        if !Arc::ptr_eq(&result.instance.owner.0, &self.owner.0) {
            return Err(Error::Invariant("foreign clone destination owner mismatch"));
        }
        if result.instance.same_owner(&instance) && result.instance.class != instance.class {
            return Err(Error::Invariant("foreign clone class mismatch"));
        }
        hooks.validate_instance(
            registry.registered(original.type_index).type_name,
            &result.instance,
        )?;
        if result.instance.is_ephemeral() != (mode == ForeignCloneMode::Ephemeral) {
            return Err(Error::Invariant("foreign clone ephemeral marker mismatch"));
        }
        if (result.instance.same_owner(&instance) && result.instance.instance == instance.instance)
            || result.base.kind() != base.kind()
            || result.observed_links != links
        {
            return Err(Error::Invariant("invalid foreign clone acknowledgement"));
        }
        let mut copy = original.clone();
        copy.key = destination;
        copy.links = crate::node::Links {
            parent: links.parent,
            prev: links.previous,
            next: links.next,
        };
        copy.base = result.base;
        if mode == ForeignCloneMode::CopyOnWrite
            && let Some(state) = &original.state
        {
            let shared = shared_configs.for_type(original.type_index)?;
            copy.state = Some(Arc::new(state.clone_for_write(&shared)));
            ForeignReadOperation::check()?;
        }
        if ForeignCloneLinks::from_slot(&copy) != links {
            return Err(Error::Invariant("foreign clone structural base mismatch"));
        }
        if let Some(patch) = result.payload {
            copy.data = original.data.clone_arc();
            let payload = Arc::get_mut(&mut copy.data)
                .ok_or(Error::Invariant("shared clone payload patch"))?;
            if let Some(foreign) = payload
                .as_any_mut()
                .downcast_mut::<super::projection::ForeignPayload>()
            {
                let previous = foreign.native.to_json()?;
                foreign.native = foreign.native.clone_arc();
                patch.apply(
                    Arc::get_mut(&mut foreign.native)
                        .ok_or(Error::Invariant("shared native clone payload patch"))?
                        .as_any_mut(),
                )?;
                let fields = foreign.native.to_json()?;
                for field in previous.keys() {
                    if !fields.contains_key(field) {
                        foreign.user.fields.shift_remove(field);
                    }
                }
                foreign.user.fields.extend(fields);
            } else {
                patch.apply(payload.as_any_mut())?;
            }
        }
        ForeignReadOperation::check()?;
        if original.key != NodeKey::ROOT && result.root_cache.is_some() {
            return Err(Error::Invariant("root cache on non-root clone"));
        }
        copy.foreign_root_cache = result.root_cache.map(|value| ForeignRootCache {
            value: Arc::new(OnceLock::from(value)),
            derived: false,
        });
        copy.foreign_instance = Arc::new(OnceLock::from(result.instance));
        operation.finish(Ok(copy))
    }
}
impl Editor {
    /// Owner capability for native host instance namespaces, without retaining this editor.
    pub fn foreign_instance_owner(&self) -> ForeignEditorIdentity {
        super::pending::ForeignEditorIdentity(self.suspend_owner.clone())
    }
    /// Install one instance host before hydration; snapshots retain no JS editor values.
    pub fn install_foreign_instance_hooks(
        &self,
        hooks: Arc<dyn ForeignInstanceHooks>,
    ) -> Result<(), Error> {
        if let Some(existing) = self.foreign_instances.hooks.get() {
            return if Arc::ptr_eq(existing, &hooks) {
                Ok(())
            } else {
                Err(Error::Invariant("foreign instance host already installed"))
            };
        }
        self.foreign_instances
            .hooks
            .set(hooks)
            .map_err(|_| Error::Invariant("foreign instance host already installed"))
    }
}
impl StateRef<'_> {
    /// Identity metadata, including the owning namespace of transferred records.
    pub fn foreign_instance(self, key: NodeKey) -> Option<ForeignInstance> {
        self.slot(key)?.foreign_instance.get().cloned()
    }
    /// Hydrate the exact captured record once without dirtying, cloning or changing its graph.
    pub fn bind_foreign_instance(
        self,
        key: NodeKey,
        expected: &ForeignRecordIdentity,
        instance: ForeignInstance,
    ) -> Result<(), Error> {
        if self.foreign_record_identity(key)? != *expected {
            return Err(Error::Invariant("foreign instance record mismatch"));
        }
        let slot = self.slot(key).ok_or(Error::NodeNotFound(key))?;
        if let Some(existing) = slot.foreign_instance.get() {
            return if *existing == instance {
                Ok(())
            } else {
                Err(Error::Invariant("foreign instance already bound"))
            };
        }
        if instance.is_ephemeral() {
            return Err(Error::Invariant(
                "ephemeral instance cannot hydrate a document record",
            ));
        }
        if !Arc::ptr_eq(&instance.owner.0, &self.state.foreign_instances.owner.0) {
            return Err(Error::Invariant(
                "foreign instance hydration owner mismatch",
            ));
        }
        self.state
            .foreign_instances
            .hooks
            .get()
            .ok_or(Error::Invariant("foreign instance host missing"))?
            .validate_instance(
                self.state.registry.registered(slot.type_index).type_name,
                &instance,
            )?;
        ForeignReadOperation::check()?;
        if key == NodeKey::ROOT && self.state.registry.derive_view_caches {
            self.foreign_root_cached_text()?;
        }
        slot.foreign_instance
            .set(instance)
            .map_err(|_| Error::Invariant("foreign instance already bound"))
    }
}
impl Transaction<'_> {
    pub(crate) fn clone_foreign_instance_for_write(&mut self, key: NodeKey) -> Result<bool, Error> {
        let update = self.foreign_update_identity();
        let slot = self
            .pending
            .nodes
            .get_mut(&key)
            .ok_or(Error::NodeNotFound(key))?;
        if slot.foreign_instance.get().is_none() {
            return Ok(false);
        }
        let writable_update = slot.foreign_instance_write.clone();
        let already_writable = writable_update
            .as_ref()
            .is_some_and(|identity| identity.matches(self));
        if already_writable || !self.editor.state.nodes.contains_key(&key) {
            let slot = self
                .pending
                .nodes
                .get_mut(&key)
                .ok_or(Error::NodeNotFound(key))?;
            Arc::make_mut(slot).foreign_instance_write = Some(update);
            return Ok(true);
        }
        let original = self
            .pending
            .nodes
            .get(&key)
            .ok_or(Error::NodeNotFound(key))?
            .clone();
        let source = self.view().snapshot_for_foreign_read()?;
        let mut copy = self.editor.foreign_instances.clone_record(
            &original,
            source,
            ForeignCloneMode::CopyOnWrite,
            key,
            original.base.clone(),
            ForeignCloneLinks::from_slot(&original),
        )?;
        copy.foreign_instance_write = Some(update);
        self.pending.nodes.insert(key, Arc::new(copy));
        Ok(true)
    }
    pub(crate) fn clone_foreign_instance_for_restore(
        &mut self,
        key: NodeKey,
    ) -> Result<bool, Error> {
        let original = self
            .pending
            .nodes
            .get(&key)
            .ok_or(Error::NodeNotFound(key))?
            .clone();
        if original.foreign_instance.get().is_none() {
            return Ok(false);
        }
        let source = self.view().snapshot_for_foreign_read()?;
        let mut copy = self.editor.foreign_instances.clone_record(
            &original,
            source,
            ForeignCloneMode::Restore,
            key,
            original.base.clone(),
            ForeignCloneLinks::from_slot(&original),
        )?;
        copy.foreign_instance_write = Some(self.foreign_update_identity());
        self.pending.nodes.insert(key, Arc::new(copy));
        Ok(true)
    }
    pub(crate) fn clone_foreign_instance_for_copy(
        &mut self,
        original: &NodeSlot,
        source: ForeignReadSnapshot,
        destination: NodeKey,
        base: BaseData,
    ) -> Result<bool, Error> {
        if original.foreign_instance.get().is_none() {
            return Ok(false);
        }
        let mut copy = self.editor.foreign_instances.clone_record(
            original,
            source,
            ForeignCloneMode::Copy,
            destination,
            base,
            ForeignCloneLinks::default(),
        )?;
        copy.foreign_instance_write = Some(self.foreign_update_identity());
        self.pending.nodes.insert(destination, Arc::new(copy));
        Ok(true)
    }
}

#[cfg(test)]
mod test;

impl StateRef<'_> {
    /// Clone an owned temporary record with explicit lifecycle semantics and read authority.
    pub fn clone_foreign_record(
        self,
        key: NodeKey,
        mode: ForeignCloneMode,
    ) -> Result<NodeRecord, Error> {
        if !matches!(
            mode,
            ForeignCloneMode::Restore | ForeignCloneMode::Ephemeral
        ) {
            return Err(Error::Invariant(
                "record clone requires restore or ephemeral mode",
            ));
        }
        let node = self.node_or_err(key)?;
        let source = self.snapshot_for_foreign_read()?;
        if node.slot.foreign_instance.get().is_none() {
            let copy = node.to_owned_with_source(source);
            ForeignReadOperation::check()?;
            return Ok(copy);
        }
        let slot = self.state.foreign_instances.clone_record(
            node.slot,
            source,
            mode,
            key,
            node.slot.base.clone(),
            ForeignCloneLinks::from_slot(node.slot),
        )?;
        Ok(NodeRecord {
            slot,
            registry: self.state.registry.clone(),
        })
    }
}
impl NodeRef<'_> {
    /// Instance metadata of this exact captured or retired record.
    pub fn foreign_instance(self) -> Option<ForeignInstance> {
        self.slot.foreign_instance.get().cloned()
    }
}

impl StateRef<'_> {
    /// Root cache for this exact captured publication, lazily materialized without JS getters.
    pub fn foreign_root_cached_text(self) -> Result<Option<Arc<str>>, Error> {
        let root = self
            .slot(NodeKey::ROOT)
            .ok_or(Error::NodeNotFound(NodeKey::ROOT))?;
        let Some(cache) = &root.foreign_root_cache else {
            return Ok(None);
        };
        if let Some(value) = cache.value.get() {
            return Ok(Some(value.clone()));
        }
        if !Arc::ptr_eq(&cache.value, &self.state.root_text) {
            return Err(Error::Invariant(
                "root cache requires its captured publication",
            ));
        }
        let _ = self.cached_root_text_content();
        ForeignReadOperation::check()?;
        Ok(cache.value.get().cloned())
    }
}

mod builder;
