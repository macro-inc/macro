//! Transaction-staged extension state and plugin events.
use crate::collections::HashMap;
use crate::*;
use std::{
    any::{Any, TypeId},
    fmt,
    marker::PhantomData,
    sync::Arc,
};
/// Cloneable per-editor state; undo affects document snapshots, not this state.
pub trait ExtensionState: Clone + Send + Sync + 'static {}
impl<State: Clone + Send + Sync + 'static> ExtensionState for State {}
type SharedExtension = Arc<dyn Any + Send + Sync>;
#[derive(Clone)]
pub(crate) struct ExtensionEntry {
    value: Arc<dyn Any + Send + Sync>,
    clone_value: fn(&SharedExtension) -> Result<SharedExtension, Error>,
}
pub(crate) type Extensions = HashMap<TypeId, ExtensionEntry>;
impl ExtensionEntry {
    pub(crate) fn new<State: ExtensionState>(value: State) -> Self {
        Self {
            value: Arc::new(value),
            clone_value: |value| {
                Ok(Arc::new(
                    value
                        .downcast_ref::<State>()
                        .ok_or(Error::Invariant("extension type"))?
                        .clone(),
                ))
            },
        }
    }
}
impl EditorBuilder {
    /// Register initial state by its concrete Rust type.
    pub fn extension_state<State: ExtensionState>(mut self, state: State) -> Self {
        if self
            .extensions
            .insert(TypeId::of::<State>(), ExtensionEntry::new(state))
            .is_some()
        {
            self.duplicate_extension = Some(std::any::type_name::<State>());
        }
        self
    }
}
impl Editor {
    /// Read a registered extension, or report a missing installation.
    pub fn extension<State: ExtensionState>(&self) -> Result<&State, Error> {
        self.try_extension().ok_or(Error::UnknownExtensionState {
            type_name: std::any::type_name::<State>(),
        })
    }
    /// Read an optional peer extension.
    pub fn try_extension<State: ExtensionState>(&self) -> Option<&State> {
        self.extensions
            .get(&TypeId::of::<State>())?
            .value
            .downcast_ref()
    }
}
impl Transaction<'_> {
    #[cfg(feature = "foreign-nodes")]
    pub(crate) fn foreign_extensions_changed(&self) -> bool {
        self.extensions.len() != self.editor.extensions.len()
            || self.extensions.iter().any(|(key, entry)| {
                self.editor
                    .extensions
                    .get(key)
                    .is_none_or(|previous| !Arc::ptr_eq(&entry.value, &previous.value))
            })
    }
    /// Read registered state from this transaction's staged copy.
    pub fn extension<State: ExtensionState>(&self) -> Result<&State, Error> {
        self.try_extension().ok_or(Error::UnknownExtensionState {
            type_name: std::any::type_name::<State>(),
        })
    }
    /// Read an optional peer extension without cloning.
    pub fn try_extension<State: ExtensionState>(&self) -> Option<&State> {
        self.extensions
            .get(&TypeId::of::<State>())?
            .value
            .downcast_ref()
    }
    /// Clone the state on first write; dropping the transaction rolls it back.
    pub fn extension_mut<State: ExtensionState>(&mut self) -> Result<&mut State, Error> {
        self.guard_write()?;
        let entry = self.extensions.get_mut(&TypeId::of::<State>()).ok_or(
            Error::UnknownExtensionState {
                type_name: std::any::type_name::<State>(),
            },
        )?;
        if Arc::get_mut(&mut entry.value).is_none() {
            entry.value = (entry.clone_value)(&entry.value)?;
        }
        Arc::get_mut(&mut entry.value)
            .and_then(|value| value.downcast_mut())
            .ok_or(Error::Invariant("extension state type"))
    }
    /// Stage a typed event for the host, publishing it only on commit.
    pub fn emit<Event: Clone + fmt::Debug + Send + Sync + 'static>(
        &mut self,
        key: &'static EventKey<Event>,
        event: Event,
    ) {
        self.events.push(PluginEvent {
            identity: std::ptr::from_ref(key) as usize,
            name: key.name,
            payload: Arc::new(event),
        });
    }
}
/// Static identity of a plugin event type (compare by address).
pub struct EventKey<Event: Clone + fmt::Debug + Send + Sync + 'static> {
    name: &'static str,
    event: PhantomData<fn() -> Event>,
}
impl<Event: Clone + fmt::Debug + Send + Sync + 'static> EventKey<Event> {
    /// Define a static event identity.
    pub const fn new(name: &'static str) -> Self {
        Self {
            name,
            event: PhantomData,
        }
    }
    /// Diagnostic name, independent of identity.
    pub fn name(&self) -> &'static str {
        self.name
    }
}
/// One typed host event; clones preserve payload identity.
#[derive(Clone)]
pub struct PluginEvent {
    identity: usize,
    name: &'static str,
    payload: Arc<dyn Any + Send + Sync>,
}
impl fmt::Debug for PluginEvent {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("PluginEvent")
            .field("name", &self.name)
            .finish_non_exhaustive()
    }
}
impl PartialEq for PluginEvent {
    fn eq(&self, other: &Self) -> bool {
        self.identity == other.identity && Arc::ptr_eq(&self.payload, &other.payload)
    }
}
impl PluginEvent {
    /// Read a payload only when the static key matches.
    pub fn payload<Event: Clone + fmt::Debug + Send + Sync + 'static>(
        &self,
        key: &'static EventKey<Event>,
    ) -> Option<&Event> {
        if self.identity != std::ptr::from_ref(key) as usize {
            return None;
        }
        self.payload.downcast_ref()
    }
}
impl Commit {
    /// Events of one type in emission order.
    pub fn events_of<'commit, Event: Clone + fmt::Debug + Send + Sync + 'static>(
        &'commit self,
        key: &'static EventKey<Event>,
    ) -> impl Iterator<Item = &'commit Event> + 'commit {
        self.events
            .iter()
            .filter_map(move |event| event.payload(key))
    }
}
#[cfg(test)]
mod test;

#[cfg(test)]
mod event_test;
