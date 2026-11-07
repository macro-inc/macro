//! Transactional plugin notifications, delivered only through successful commits.
use crate::{Commit, Transaction};
use std::{any::Any, fmt, marker::PhantomData, sync::Arc};
trait AnyEventKey: Send + Sync + fmt::Debug {}
/// Static typed event identity, compared by address rather than diagnostic name.
pub struct EventKey<Event: Clone + fmt::Debug + Send + Sync + 'static> {
    name: &'static str,
    event: PhantomData<fn() -> Event>,
}
impl<Event: Clone + fmt::Debug + Send + Sync + 'static> EventKey<Event> {
    /// Declare a plugin event static.
    pub const fn new(name: &'static str) -> Self {
        Self {
            name,
            event: PhantomData,
        }
    }
    /// Diagnostic name; distinct statics may share it.
    pub fn name(&self) -> &'static str {
        self.name
    }
}
impl<Event: Clone + fmt::Debug + Send + Sync + 'static> fmt::Debug for EventKey<Event> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_tuple("EventKey").field(&self.name).finish()
    }
}
impl<Event: Clone + fmt::Debug + Send + Sync + 'static> AnyEventKey for EventKey<Event> {}
/// One immutable event; equality retains key and shared payload identity.
#[derive(Clone)]
pub struct PluginEvent {
    key: &'static dyn AnyEventKey,
    payload: Arc<dyn Any + Send + Sync>,
}
impl fmt::Debug for PluginEvent {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("PluginEvent")
            .field("key", &self.key)
            .finish_non_exhaustive()
    }
}
impl PartialEq for PluginEvent {
    fn eq(&self, other: &Self) -> bool {
        std::ptr::addr_eq(self.key, other.key) && Arc::ptr_eq(&self.payload, &other.payload)
    }
}
impl PluginEvent {
    /// Borrow the typed payload only if this exact event static matches.
    pub fn payload<Event: Clone + fmt::Debug + Send + Sync + 'static>(
        &self,
        key: &'static EventKey<Event>,
    ) -> Option<&Event> {
        if std::ptr::addr_eq(self.key, key as &dyn AnyEventKey) {
            self.payload.downcast_ref()
        } else {
            None
        }
    }
}
impl Transaction<'_> {
    /// Stage a notification; dropping or failing the transaction discards it.
    pub fn emit<Event: Clone + fmt::Debug + Send + Sync + 'static>(
        &mut self,
        key: &'static EventKey<Event>,
        event: Event,
    ) {
        self.events.push(PluginEvent {
            key,
            payload: Arc::new(event),
        });
    }
}
impl Commit {
    /// Events of this type, in emission order within this commit.
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
