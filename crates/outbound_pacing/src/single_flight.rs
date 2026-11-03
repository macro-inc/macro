use std::{
    collections::HashMap,
    future::Future,
    hash::Hash,
    sync::{Mutex, PoisonError},
};

use futures::{
    FutureExt,
    future::{BoxFuture, Shared},
};

#[cfg(test)]
mod test;

/// Shares one run of identical work among the callers waiting on it at the
/// same time. Nothing is kept once the run finishes.
pub struct SingleFlight<Key, Value> {
    in_flight: Mutex<HashMap<Key, Shared<BoxFuture<'static, Value>>>>,
}

impl<Key: Hash + Eq + Clone, Value: Clone> Default for SingleFlight<Key, Value> {
    fn default() -> Self {
        Self {
            in_flight: Mutex::new(HashMap::new()),
        }
    }
}

impl<Key: Hash + Eq + Clone, Value: Clone> SingleFlight<Key, Value> {
    /// Joins the run in flight for `key`, or starts `work` as it. Any waiter
    /// drives the run, so it continues when the caller that started it is
    /// dropped.
    pub async fn run<Work>(&self, key: Key, work: Work) -> Value
    where
        Work: Future<Output = Value> + Send + 'static,
    {
        let run = self
            .in_flight
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .entry(key.clone())
            .or_insert_with(|| work.boxed().shared())
            .clone();
        let value = run.clone().await;
        let mut in_flight = self
            .in_flight
            .lock()
            .unwrap_or_else(PoisonError::into_inner);
        if in_flight
            .get(&key)
            .is_some_and(|current| current.ptr_eq(&run))
        {
            in_flight.remove(&key);
        }
        value
    }
}
