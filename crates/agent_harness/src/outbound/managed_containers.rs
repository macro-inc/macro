use std::collections::HashMap;
use std::hash::Hash;
use std::sync::Mutex;
use std::time::{Duration, Instant};

#[cfg(test)]
mod test;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ContainerState {
    Pending,
    Active { last_activity: Instant },
    Stopping { last_activity: Instant },
}

pub(crate) struct ManagedContainers<Id> {
    entries: Mutex<HashMap<Id, ContainerState>>,
}

impl<Id> ManagedContainers<Id>
where
    Id: Clone + Eq + Hash,
{
    pub(crate) fn new() -> Self {
        Self {
            entries: Mutex::new(HashMap::new()),
        }
    }

    pub(crate) fn register(&self, id: Id) {
        self.entries
            .lock()
            .expect("managed containers should not be poisoned")
            .insert(id, ContainerState::Pending);
    }

    pub(crate) fn activate(&self, id: &Id, now: Instant) -> bool {
        let mut entries = self
            .entries
            .lock()
            .expect("managed containers should not be poisoned");
        let Some(entry) = entries.get_mut(id) else {
            return false;
        };
        *entry = ContainerState::Active { last_activity: now };
        true
    }

    pub(crate) fn record_activity(&self, id: &Id, now: Instant) {
        if let Some(entry) = self
            .entries
            .lock()
            .expect("managed containers should not be poisoned")
            .get_mut(id)
        {
            match entry {
                ContainerState::Pending => {}
                ContainerState::Active { last_activity }
                | ContainerState::Stopping { last_activity } => *last_activity = now,
            }
        }
    }

    pub(crate) fn remove(&self, id: &Id) -> bool {
        self.entries
            .lock()
            .expect("managed containers should not be poisoned")
            .remove(id)
            .is_some()
    }

    pub(crate) fn reap_stale(&self, now: Instant, max_idle: Duration) -> Vec<Id> {
        let mut entries = self
            .entries
            .lock()
            .expect("managed containers should not be poisoned");
        let mut stale = Vec::new();
        for (id, state) in entries.iter_mut() {
            if let ContainerState::Active { last_activity } = *state
                && now.saturating_duration_since(last_activity) >= max_idle
            {
                *state = ContainerState::Stopping { last_activity };
                stale.push(id.clone());
            }
        }
        stale
    }

    pub(crate) fn restore_failed_stop(&self, id: Id, now: Instant, max_idle: Duration) {
        let last_activity = now.checked_sub(max_idle).unwrap_or(now);
        self.entries
            .lock()
            .expect("managed containers should not be poisoned")
            .entry(id)
            .or_insert(ContainerState::Active { last_activity });
    }

    pub(crate) fn finish_stop(&self, id: &Id, stopped: bool) {
        let mut entries = self
            .entries
            .lock()
            .expect("managed containers should not be poisoned");
        if stopped {
            if entries
                .get(id)
                .is_some_and(|state| matches!(state, ContainerState::Stopping { .. }))
            {
                entries.remove(id);
            }
        } else if let Some(state) = entries.get_mut(id)
            && let ContainerState::Stopping { last_activity } = *state
        {
            *state = ContainerState::Active { last_activity };
        }
    }

    pub(crate) fn drain(&self) -> Vec<Id> {
        self.entries
            .lock()
            .expect("managed containers should not be poisoned")
            .drain()
            .map(|(id, _)| id)
            .collect()
    }
}
