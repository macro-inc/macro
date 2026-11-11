//! Transaction-scoped typed values. A slot lives exactly as long as one pending update: it moves
//! with suspend/resume/adoption, survives restore_editor_state, flush passes and nested updates,
//! and is cleared by every successful publication (including empty ones) and by rollback. It is
//! never part of EditorState, Commit, snapshots or history.
use crate::*;
use std::any::{Any, TypeId};
use std::collections::HashMap;

#[cfg(test)]
mod test;

/// Typed per-update values keyed by type.
#[derive(Default)]
pub(crate) struct UpdateLocal(HashMap<TypeId, Box<dyn Any + Send + Sync>>);
impl UpdateLocal {
    pub(crate) fn get<Value: Send + Sync + 'static>(&self) -> Option<&Value> {
        self.0.get(&TypeId::of::<Value>())?.downcast_ref()
    }
    pub(crate) fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
}

impl Transaction<'_> {
    /// Read this pending update's value of one type.
    pub fn update_local<Value: Send + Sync + 'static>(&self) -> Option<&Value> {
        self.update_local.get()
    }
    /// Write this pending update's value of one type, starting from `Default`.
    pub fn update_local_mut<Value: Default + Send + Sync + 'static>(
        &mut self,
    ) -> Result<&mut Value, Error> {
        self.guard_write()?;
        self.update_local
            .0
            .entry(TypeId::of::<Value>())
            .or_insert_with(|| Box::new(Value::default()))
            .downcast_mut()
            .ok_or(Error::Invariant("update-local value type"))
    }
}
