//! Owned caret metadata and single-consumption iterators for callback frames.
use super::{Result, fail};
use crate::api::caret::CaretValue;
use lexical_model::NodeCaretCursor;
use serde_json::Value;
use std::{
    collections::HashMap,
    sync::{Arc, Mutex, MutexGuard},
};

pub(crate) enum IteratorValue {
    Carets(NodeCaretCursor, Option<Value>),
    Children(lexical_rich_nodes::utils::ChildCursor),
    Values(Vec<Value>),
}

#[derive(Clone, Default)]
pub(crate) struct CaretBindings(Arc<Mutex<Carets>>);

#[derive(Default)]
struct Carets {
    values: Vec<CaretValue>,
    endpoints: HashMap<usize, (Value, Value)>,
    origins: HashMap<usize, Value>,
    iterators: Vec<Option<IteratorValue>>,
}

impl CaretBindings {
    fn lock(&self) -> Result<MutexGuard<'_, Carets>> {
        self.0
            .lock()
            .map_err(|_| fail("caret binding store poisoned"))
    }

    pub fn push(&self, value: CaretValue) -> Result<usize> {
        let mut carets = self.lock()?;
        let id = carets.values.len();
        carets.values.push(value);
        Ok(id)
    }

    pub fn get(&self, id: usize) -> Result<CaretValue> {
        self.lock()?
            .values
            .get(id)
            .copied()
            .ok_or_else(|| fail("unknown caret"))
    }

    pub fn endpoints(&self, id: usize) -> Result<Option<(Value, Value)>> {
        Ok(self.lock()?.endpoints.get(&id).cloned())
    }

    pub fn set_endpoints(&self, id: usize, endpoints: (Value, Value)) -> Result<()> {
        self.lock()?.endpoints.insert(id, endpoints);
        Ok(())
    }

    pub fn origin(&self, id: usize) -> Result<Option<Value>> {
        Ok(self.lock()?.origins.get(&id).cloned())
    }

    pub fn set_origin(&self, id: usize, origin: Value) -> Result<()> {
        self.lock()?.origins.insert(id, origin);
        Ok(())
    }

    pub fn iterator(&self, value: IteratorValue) -> Result<usize> {
        let mut carets = self.lock()?;
        let id = carets.iterators.len();
        carets.iterators.push(Some(value));
        Ok(id)
    }

    /// Move the cursor out before traversing the model or invoking host hooks.
    pub fn take_iterator(&self, id: usize) -> Result<Option<IteratorValue>> {
        Ok(self
            .lock()?
            .iterators
            .get_mut(id)
            .ok_or_else(|| fail("iterator handle"))?
            .take())
    }
}
