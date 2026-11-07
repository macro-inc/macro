//! Typed plugin commands and upstream priority ordering.
use crate::{collections::HashMap, *};
use std::{
    any::Any,
    fmt,
    hash::{Hash, Hasher},
    marker::PhantomData,
    sync::Arc,
};

/// Identity shared by typed application-command keys.
pub trait AnyCommandKey: Send + Sync + fmt::Debug {
    /// Diagnostic name; identity is the static's address, not this string.
    fn name(&self) -> &'static str;
}
/// A static, typed application-command identity.
pub struct CommandKey<Payload: Clone + fmt::Debug + Send + Sync + 'static> {
    name: &'static str,
    payload: PhantomData<fn() -> Payload>,
}
impl<Payload: Clone + fmt::Debug + Send + Sync + 'static> CommandKey<Payload> {
    /// Declare a static command key.
    pub const fn new(name: &'static str) -> Self {
        Self {
            name,
            payload: PhantomData,
        }
    }
    /// Diagnostic command name.
    pub fn name(&self) -> &'static str {
        self.name
    }
}
impl<Payload: Clone + fmt::Debug + Send + Sync + 'static> fmt::Debug for CommandKey<Payload> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_tuple("CommandKey").field(&self.name).finish()
    }
}
impl<Payload: Clone + fmt::Debug + Send + Sync + 'static> AnyCommandKey for CommandKey<Payload> {
    fn name(&self) -> &'static str {
        self.name
    }
}
fn same_key(a: &dyn AnyCommandKey, b: &dyn AnyCommandKey) -> bool {
    std::ptr::addr_eq(a, b)
}
/// An application command with a typed, cloneable payload.
#[derive(Clone)]
pub struct ExtensionCommand {
    key: &'static dyn AnyCommandKey,
    value: Arc<dyn Any + Send + Sync>,
}
impl ExtensionCommand {
    /// Construct a command, retaining its key identity across clones.
    pub fn new<Payload: Clone + fmt::Debug + Send + Sync + 'static>(
        key: &'static CommandKey<Payload>,
        payload: Payload,
    ) -> Self {
        Self {
            key,
            value: Arc::new(payload),
        }
    }
    /// Read this payload only when the static key matches.
    pub fn payload<Payload: Clone + fmt::Debug + Send + Sync + 'static>(
        &self,
        key: &'static CommandKey<Payload>,
    ) -> Option<&Payload> {
        if same_key(self.key, key) {
            self.value.downcast_ref()
        } else {
            None
        }
    }
}
impl fmt::Debug for ExtensionCommand {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("ExtensionCommand")
            .field("key", &self.key)
            .finish_non_exhaustive()
    }
}
impl PartialEq for ExtensionCommand {
    fn eq(&self, other: &Self) -> bool {
        same_key(self.key, other.key) && Arc::ptr_eq(&self.value, &other.value)
    }
}
/// Commands needed by selection plugins and application extensions.
#[derive(Clone, Debug, PartialEq)]
pub enum Command {
    /// The host selection and typing attributes have changed.
    SelectionChange,
    /// An application-defined typed command.
    Extension(ExtensionCommand),
}
impl Command {
    /// Listener-list identity for this command.
    pub fn kind(&self) -> CommandKind {
        match self {
            Self::SelectionChange => CommandKind::SelectionChange,
            Self::Extension(command) => CommandKind::Extension(command.key),
        }
    }
}
/// Const-constructible listener-list identity.
#[derive(Clone, Copy, Debug)]
pub enum CommandKind {
    /// Selection changes from the host.
    SelectionChange,
    /// An application-command static.
    Extension(&'static dyn AnyCommandKey),
}
impl PartialEq for CommandKind {
    fn eq(&self, other: &Self) -> bool {
        match (self, other) {
            (Self::SelectionChange, Self::SelectionChange) => true,
            (Self::Extension(a), Self::Extension(b)) => same_key(*a, *b),
            _ => false,
        }
    }
}
impl Eq for CommandKind {}
impl Hash for CommandKind {
    fn hash<H: Hasher>(&self, state: &mut H) {
        std::mem::discriminant(self).hash(state);
        if let Self::Extension(key) = self {
            std::ptr::from_ref(*key).cast::<()>().hash(state);
        }
    }
}
/// Whether command propagation stops at a listener.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Handled {
    /// Stop propagation.
    Yes,
    /// Continue to the next listener.
    No,
}
/// Upstream listener priority, visited from Critical to Editor.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum CommandPriority {
    /// Default editor behavior.
    Editor = 0,
    /// Low priority.
    Low = 1,
    /// Normal priority.
    Normal = 2,
    /// High priority.
    High = 3,
    /// Critical priority.
    Critical = 4,
}
/// Position within a priority level.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Placement {
    /// Prepend to this priority; later registrations run first.
    Before,
    /// Append to this priority in registration order.
    After,
}
/// One command listener declared by a plugin.
#[derive(Clone, Copy, Debug)]
pub struct CommandRegistration {
    /// Listener-list identity.
    pub command: CommandKind,
    /// Listener priority.
    pub priority: CommandPriority,
    /// Registration placement at this priority.
    pub placement: Placement,
}
/// Immutable command behavior; mutable plugin data lives in `ExtensionState`.
pub trait Plugin: Send + Sync + 'static {
    /// Diagnostic identity for duplicate-install detection.
    fn name(&self) -> &'static str;
    /// Commands and priorities declared by this plugin.
    fn commands(&self) -> &[CommandRegistration];
    /// Handle a declared command; nested dispatch runs inline without a flush.
    fn handle(&self, tx: &mut Transaction<'_>, command: &Command) -> Result<Handled, Error>;
}
#[derive(Clone)]
struct Listener {
    plugin: Arc<dyn Plugin>,
    registration: CommandRegistration,
    order: usize,
}
#[derive(Clone, Default)]
pub(crate) struct CommandListeners(HashMap<CommandKind, Vec<Listener>>);
impl CommandListeners {
    pub(crate) fn new(plugins: &[Arc<dyn Plugin>]) -> Result<Self, BuildError> {
        let mut names = Vec::new();
        let mut lists: HashMap<CommandKind, Vec<Listener>> = HashMap::default();
        let mut order = 0;
        for plugin in plugins {
            if names.contains(&plugin.name()) {
                return Err(BuildError::DuplicatePlugin {
                    name: plugin.name(),
                });
            }
            names.push(plugin.name());
            for registration in plugin.commands() {
                lists
                    .entry(registration.command)
                    .or_default()
                    .push(Listener {
                        plugin: plugin.clone(),
                        registration: *registration,
                        order,
                    });
                order += 1;
            }
        }
        for listeners in lists.values_mut() {
            listeners.sort_by(|a, b| {
                b.registration
                    .priority
                    .cmp(&a.registration.priority)
                    .then_with(
                        || match (a.registration.placement, b.registration.placement) {
                            (Placement::Before, Placement::Before) => b.order.cmp(&a.order),
                            (Placement::Before, Placement::After) => std::cmp::Ordering::Less,
                            (Placement::After, Placement::Before) => std::cmp::Ordering::Greater,
                            (Placement::After, Placement::After) => a.order.cmp(&b.order),
                        },
                    )
            });
        }
        Ok(Self(lists))
    }
}
impl Transaction<'_> {
    /// Dispatch declared listeners inline; staged writes are visible to reentrant handlers.
    pub fn dispatch(&mut self, command: &Command) -> Result<Handled, Error> {
        let listeners = self
            .editor
            .listeners
            .0
            .get(&command.kind())
            .cloned()
            .unwrap_or_default();
        for listener in listeners {
            if listener.plugin.handle(self, command)? == Handled::Yes {
                return Ok(Handled::Yes);
            }
        }
        Ok(Handled::No)
    }
}
impl Editor {
    /// Dispatch from outside an update, flushing between nonempty priority levels.
    pub fn dispatch(&mut self, command: &Command) -> Result<(Handled, Commit), Error> {
        let listeners = self
            .listeners
            .0
            .get(&command.kind())
            .cloned()
            .unwrap_or_default();
        if listeners.is_empty() {
            return Ok((
                Handled::No,
                Commit {
                    id: self.keys.next_commit()?,
                    prev: self.state.clone(),
                    next: self.state.clone(),
                    changes: Changes::default(),
                    tags: TagSet::default(),
                    normalized: Default::default(),
                    selection_changed: false,
                    composition_key: self.composition_key,
                    composition_changed: false,
                    full_reconcile: false,
                    preceding: None,
                    #[cfg(feature = "bench-counters")]
                    work: WorkCounters::default(),
                },
            ));
        }
        let mut tx = self.transaction();
        let mut previous_priority = None;
        let mut handled = Handled::No;
        for listener in listeners {
            let priority = listener.registration.priority;
            if previous_priority.is_some_and(|previous| previous != priority) {
                tx.flush()?;
            }
            previous_priority = Some(priority);
            handled = listener.plugin.handle(&mut tx, command)?;
            if handled == Handled::Yes {
                break;
            }
        }
        Ok((handled, tx.commit()?))
    }
}
#[cfg(test)]
mod test;
