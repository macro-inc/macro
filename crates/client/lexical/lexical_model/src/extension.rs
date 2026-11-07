//! Transactional per-editor state for transforms and plugins.
use crate::{collections::HashMap, *};
use std::{
    any::{Any, TypeId},
    sync::Arc,
};

/// Cloneable per-editor data staged independently from document snapshots.
pub trait ExtensionState: Clone + Send + Sync + 'static {}
impl<State: Clone + Send + Sync + 'static> ExtensionState for State {}

#[derive(Clone, Default)]
pub(crate) struct ExtensionStore(Arc<HashMap<TypeId, Arc<dyn Any + Send + Sync>>>);
impl ExtensionStore {
    pub(crate) fn insert<State: ExtensionState>(&mut self, state: State) -> bool {
        Arc::make_mut(&mut self.0)
            .insert(TypeId::of::<State>(), Arc::new(state))
            .is_none()
    }
    fn get<State: ExtensionState>(&self) -> Option<&State> {
        self.0.get(&TypeId::of::<State>())?.downcast_ref()
    }
    fn get_mut<State: ExtensionState>(&mut self) -> Result<&mut State, Error> {
        let value = Arc::make_mut(&mut self.0)
            .get_mut(&TypeId::of::<State>())
            .ok_or(Error::UnknownExtensionState)?;
        if Arc::get_mut(value).is_none() {
            let state = value
                .downcast_ref::<State>()
                .ok_or(Error::UnknownExtensionState)?
                .clone();
            *value = Arc::new(state);
        }
        Arc::get_mut(value)
            .and_then(|v| v.downcast_mut())
            .ok_or(Error::UnknownExtensionState)
    }
}
impl Editor {
    /// Read required per-editor state.
    pub fn extension<State: ExtensionState>(&self) -> Result<&State, Error> {
        self.try_extension().ok_or(Error::UnknownExtensionState)
    }
    /// Read an optional installed dependency.
    pub fn try_extension<State: ExtensionState>(&self) -> Option<&State> {
        self.extensions.get()
    }
}
impl Transaction<'_> {
    /// Read staged per-editor state, including earlier writes in this update.
    pub fn extension<State: ExtensionState>(&self) -> Result<&State, Error> {
        self.try_extension().ok_or(Error::UnknownExtensionState)
    }
    /// Read an optional installed dependency.
    pub fn try_extension<State: ExtensionState>(&self) -> Option<&State> {
        self.extensions.get()
    }
    /// Clone this state's value on its first write; rollback discards the clone.
    pub fn extension_mut<State: ExtensionState>(&mut self) -> Result<&mut State, Error> {
        self.guard_write()?;
        self.extensions.get_mut()
    }
}
#[cfg(test)]
mod test;
