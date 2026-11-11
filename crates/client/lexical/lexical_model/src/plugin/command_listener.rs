//! Ordinary host command entries in the editor's real ordered listener lists.
use super::*;

/// Opaque registration identity; it never exposes an allocator address.
#[derive(Clone)]
pub struct CommandListenerId(Arc<()>);
impl PartialEq for CommandListenerId {
    fn eq(&self, other: &Self) -> bool {
        Arc::ptr_eq(&self.0, &other.0)
    }
}
impl Eq for CommandListenerId {}
impl std::fmt::Debug for CommandListenerId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("CommandListenerId")
    }
}
/// An ordinary synchronous host listener, independent of foreign node support.
/// The caller lends the actual dispatching transaction; publication remains outer.
pub trait CommandListener: Send + Sync + 'static {
    /// Stop propagation on Yes, preserve typed errors on failure.
    fn handle(&self, tx: &mut Transaction<'_>, command: &Command) -> Result<Handled, Error>;
}
struct CommandPlugin {
    registration: [CommandRegistration; 1],
    callback: Arc<dyn CommandListener>,
}
impl Plugin for CommandPlugin {
    fn name(&self) -> &'static str {
        "host-command"
    }
    fn commands(&self) -> &[CommandRegistration] {
        &self.registration
    }
    fn handle(&self, tx: &mut Transaction<'_>, command: &Command) -> Result<Handled, Error> {
        self.callback.handle(tx, command)
    }
}
impl Editor {
    /// Register in the shared command list using its ordinary priority/placement.
    /// Reusing one callback at the same command and priority keeps its old slot.
    pub fn register_command_listener(
        &mut self,
        registration: CommandRegistration,
        callback: Arc<dyn CommandListener>,
    ) -> CommandListenerId {
        if let Some(id) = self
            .listeners
            .get(&registration.command)
            .into_iter()
            .flatten()
            .find_map(|listener| {
                let (id, existing) = listener.command_callback.as_ref()?;
                (listener.priority == registration.priority && Arc::ptr_eq(existing, &callback))
                    .then(|| id.clone())
            })
        {
            return id;
        }
        let id = CommandListenerId(Arc::new(()));
        insert_listener(
            &mut self.listeners,
            registration,
            Listener {
                priority: registration.priority,
                plugin: Arc::new(CommandPlugin {
                    registration: [registration],
                    callback: callback.clone(),
                }),
                command_callback: Some((id.clone(), callback)),
                #[cfg(feature = "foreign-nodes")]
                foreign_id: None,
            },
        );
        self.listener_table = listener_table(&self.listeners);
        id
    }
    /// Remove an ordinary registration; repeated or unrelated cleanup is harmless.
    pub fn unregister_command_listener(&mut self, id: &CommandListenerId) {
        for list in self.listeners.values_mut() {
            list.retain(|listener| {
                listener
                    .command_callback
                    .as_ref()
                    .is_none_or(|(entry, _)| entry != id)
            });
        }
        self.listeners.retain(|_, list| !list.is_empty());
        self.listener_table = listener_table(&self.listeners);
    }
}
impl Transaction<'_> {
    /// Register against this actual editor without reentering its host/session.
    pub fn register_command_listener(
        &mut self,
        registration: CommandRegistration,
        callback: Arc<dyn CommandListener>,
    ) -> CommandListenerId {
        self.editor
            .register_command_listener(registration, callback)
    }
    /// Remove a registration while preserving the current priority snapshot.
    pub fn unregister_command_listener(&mut self, id: &CommandListenerId) {
        self.editor.unregister_command_listener(id);
    }
}

#[cfg(test)]
mod test;
