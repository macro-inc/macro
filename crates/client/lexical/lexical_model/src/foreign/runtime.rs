//! Development registrations added after editor construction.
use crate::{collections::IndexMap, plugin, *};
use std::sync::Arc;

/// Identity returned by a development listener or transform registration.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub struct ForeignListenerId(u32);
impl ForeignListenerId {
    /// Boundary identity for the host's unregister function.
    pub fn get(self) -> u32 {
        self.0
    }
}
/// A host command callback executed inside the dispatching transaction.
pub trait ForeignListener: Send + Sync + 'static {
    /// Handle the command, stopping propagation when handled.
    fn handle(&self, tx: &mut Transaction<'_>, command: &Command) -> Result<Handled, Error>;
}
/// A host transform executed in the model's normal fixpoint pipeline.
pub trait ForeignTransform: Send + Sync + 'static {
    /// Transform a dirty node of the registered type.
    fn transform(&self, tx: &mut Transaction<'_>, key: NodeKey) -> Result<(), Error>;
}
type ForeignTransforms = IndexMap<NodeTypeIndex, Vec<Arc<dyn ForeignTransform>>>;
#[derive(Default)]
pub(crate) struct ForeignRuntime {
    next: u32,
    registrations: IndexMap<ForeignListenerId, Registration>,
    transforms: ForeignTransforms,
}
#[derive(Clone)]
enum Registration {
    Command {
        command: CommandKind,
        priority: CommandPriority,
        listener: Arc<dyn ForeignListener>,
    },
    Transform {
        indices: Vec<NodeTypeIndex>,
        callback: Arc<dyn ForeignTransform>,
    },
}
impl ForeignRuntime {
    fn allocate(&mut self, registration: Registration) -> ForeignListenerId {
        loop {
            let id = ForeignListenerId(self.next);
            self.next = self.next.wrapping_add(1);
            if !self.registrations.contains_key(&id) {
                self.registrations.insert(id, registration);
                return id;
            }
        }
    }
}
struct CommandPlugin {
    registration: [CommandRegistration; 1],
    callback: Arc<dyn ForeignListener>,
}
impl Plugin for CommandPlugin {
    fn name(&self) -> &'static str {
        "foreign-command"
    }
    fn commands(&self) -> &[CommandRegistration] {
        &self.registration
    }
    fn handle(&self, tx: &mut Transaction<'_>, command: &Command) -> Result<Handled, Error> {
        super::projection::foreign(tx, |tx| self.callback.handle(tx, command))?
    }
}
impl Editor {
    /// Add a host listener with the same priority and placement rules as plugins.
    pub fn register_foreign_listener(
        &mut self,
        registration: CommandRegistration,
        listener: Arc<dyn ForeignListener>,
    ) -> ForeignListenerId {
        if let Some((id, _)) = self.foreign_runtime.registrations.iter().find(|(_, entry)| {
            matches!(entry, Registration::Command { command, priority, listener: existing }
                if *command == registration.command && *priority == registration.priority && Arc::ptr_eq(existing, &listener))
        }) { return *id; }
        let id = self.foreign_runtime.allocate(Registration::Command {
            command: registration.command,
            priority: registration.priority,
            listener: listener.clone(),
        });
        plugin::insert_listener(
            &mut self.listeners,
            registration,
            plugin::Listener {
                priority: registration.priority,
                plugin: Arc::new(CommandPlugin {
                    registration: [registration],
                    callback: listener,
                }),
                command_callback: None,
                foreign_id: Some(id),
            },
        );
        self.listener_table = plugin::listener_table(&self.listeners);
        id
    }
    /// Remove a host listener; unknown ids and transform ids have no effect.
    pub fn unregister_foreign_listener(&mut self, id: ForeignListenerId) {
        let Some(Registration::Command { command: kind, .. }) =
            self.foreign_runtime.registrations.get(&id)
        else {
            return;
        };
        let kind = *kind;
        self.foreign_runtime.registrations.shift_remove(&id);
        if let Some(list) = self.listeners.get_mut(&kind) {
            list.retain(|listener| listener.foreign_id != Some(id));
            if list.is_empty() {
                self.listeners.shift_remove(&kind);
            }
        }
        self.listener_table = plugin::listener_table(&self.listeners);
    }
    /// Add a host transform after build-time transforms, including a direct replacement.
    pub fn register_foreign_transform(
        &mut self,
        type_name: &str,
        transform: Arc<dyn ForeignTransform>,
    ) -> Result<ForeignListenerId, Error> {
        let node = self.registry().get_or_err(type_name)?;
        let mut indices = vec![node.index];
        if let Some(replacement) = node.replaced_by {
            indices.push(replacement);
        }
        let existing =
            self.foreign_runtime
                .registrations
                .iter()
                .find_map(|(id, entry)| match entry {
                    Registration::Transform {
                        indices: existing,
                        callback,
                    } if *existing == indices && Arc::ptr_eq(callback, &transform) => Some(*id),
                    _ => None,
                });
        let id = existing.unwrap_or_else(|| {
            self.foreign_runtime.allocate(Registration::Transform {
                indices: indices.clone(),
                callback: transform.clone(),
            })
        });
        for index in indices {
            let list = self.foreign_runtime.transforms.entry(index).or_default();
            if !list
                .iter()
                .any(|callback| Arc::ptr_eq(callback, &transform))
            {
                list.push(transform.clone());
            }
        }
        Ok(id)
    }
    /// Remove a host transform; unknown ids and command ids have no effect.
    pub fn unregister_foreign_transform(&mut self, id: ForeignListenerId) {
        let Some(Registration::Transform { indices, callback }) =
            self.foreign_runtime.registrations.get(&id).cloned()
        else {
            return;
        };
        self.foreign_runtime.registrations.shift_remove(&id);
        for index in indices {
            if let Some(list) = self.foreign_runtime.transforms.get_mut(&index) {
                list.retain(|existing| !Arc::ptr_eq(existing, &callback));
            }
        }
        self.foreign_runtime
            .transforms
            .retain(|_, list| !list.is_empty());
    }
}
impl Transaction<'_> {
    /// Add a command callback during an update, including from another host callback.
    pub fn register_foreign_listener(
        &mut self,
        registration: CommandRegistration,
        listener: Arc<dyn ForeignListener>,
    ) -> ForeignListenerId {
        self.editor
            .register_foreign_listener(registration, listener)
    }
    /// Remove a command callback during an update.
    pub fn unregister_foreign_listener(&mut self, id: ForeignListenerId) {
        self.editor.unregister_foreign_listener(id);
    }
    /// Add a transform during an update; mark its type dirty explicitly.
    pub fn register_foreign_transform(
        &mut self,
        type_name: &str,
        transform: Arc<dyn ForeignTransform>,
    ) -> Result<ForeignListenerId, Error> {
        self.editor.register_foreign_transform(type_name, transform)
    }
    /// Remove a transform during an update.
    pub fn unregister_foreign_transform(&mut self, id: ForeignListenerId) {
        self.editor.unregister_foreign_transform(id);
    }
    /// Mark all attached records of a registered runtime type and its direct replacement.
    pub fn mark_foreign_type_dirty(&mut self, type_name: &str) -> Result<(), Error> {
        let node = self.pending.registry.get_or_err(type_name)?;
        let mut keys = self.view().nodes_of_type_index(node.index);
        if let Some(index) = node.replaced_by {
            keys.extend(self.view().nodes_of_type_index(index));
        }
        for key in keys {
            self.mark_dirty(key)?;
        }
        Ok(())
    }
    /// Synchronize and suspend native inheritance projections around a host callout.
    pub fn with_foreign_call<Value>(
        &mut self,
        call: impl FnOnce(&mut Transaction<'_>) -> Result<Value, Error>,
    ) -> Result<Value, Error> {
        super::projection::foreign(self, call)?
    }
}

/// Upstream snapshots each type's transform Set at first use within a pipeline pass.
#[derive(Default)]
pub(crate) struct TransformCache(IndexMap<NodeTypeIndex, Vec<Arc<dyn ForeignTransform>>>);
impl TransformCache {
    pub(crate) fn prepare(&mut self, tx: &Transaction<'_>, index: NodeTypeIndex) {
        self.0.entry(index).or_insert_with(|| {
            tx.editor
                .foreign_runtime
                .transforms
                .get(&index)
                .into_iter()
                .flatten()
                .cloned()
                .collect()
        });
    }
    pub(crate) fn run(
        &self,
        tx: &mut Transaction<'_>,
        index: NodeTypeIndex,
        key: NodeKey,
    ) -> Result<(), Error> {
        for transform in self.0.get(&index).into_iter().flatten() {
            if !tx.is_attached(key) {
                break;
            }
            tx.with_foreign_call(|tx| transform.transform(tx, key))?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod test;
