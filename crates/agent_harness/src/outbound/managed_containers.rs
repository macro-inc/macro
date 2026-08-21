use std::hash::Hash;
use std::time::{Duration, Instant};

use dashmap::DashMap;

#[cfg(test)]
mod test;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ContainerState {
    Pending,
    Active { last_activity: Instant },
    Stopping { last_activity: Instant },
}

pub(crate) struct ManagedContainers<Id> {
    entries: DashMap<Id, ContainerState>,
}

impl<Id> ManagedContainers<Id>
where
    Id: Clone + Eq + Hash,
{
    pub(crate) fn new() -> Self {
        Self {
            entries: DashMap::new(),
        }
    }

    pub(crate) fn register(&self, id: Id) {
        self.entries.insert(id, ContainerState::Pending);
    }

    pub(crate) fn activate(&self, id: &Id, now: Instant) -> bool {
        let Some(mut entry) = self.entries.get_mut(id) else {
            return false;
        };
        *entry = ContainerState::Active { last_activity: now };
        true
    }

    pub(crate) fn record_activity(&self, id: &Id, now: Instant) {
        if let Some(mut entry) = self.entries.get_mut(id) {
            match &mut *entry {
                ContainerState::Pending => {}
                ContainerState::Active { last_activity }
                | ContainerState::Stopping { last_activity } => *last_activity = now,
            }
        }
    }

    pub(crate) fn remove(&self, id: &Id) -> bool {
        self.entries.remove(id).is_some()
    }

    pub(crate) fn reap_stale(&self, now: Instant, max_idle: Duration) -> Vec<Id> {
        let candidates = self
            .entries
            .iter()
            .filter_map(|entry| match entry.value() {
                ContainerState::Active { last_activity }
                    if now.saturating_duration_since(*last_activity) >= max_idle =>
                {
                    Some(entry.key().clone())
                }
                _ => None,
            })
            .collect::<Vec<_>>();
        let mut stale = Vec::new();
        for id in candidates {
            let Some(mut state) = self.entries.get_mut(&id) else {
                continue;
            };
            if let ContainerState::Active { last_activity } = *state
                && now.saturating_duration_since(last_activity) >= max_idle
            {
                *state = ContainerState::Stopping { last_activity };
                stale.push(id);
            }
        }
        stale
    }

    pub(crate) fn restore_failed_stop(&self, id: Id, now: Instant, max_idle: Duration) {
        let last_activity = now.checked_sub(max_idle).unwrap_or(now);
        self.entries
            .entry(id)
            .or_insert(ContainerState::Active { last_activity });
    }

    pub(crate) fn finish_stop(&self, id: &Id, stopped: bool) {
        if stopped {
            self.entries.remove_if(id, |_, state| {
                matches!(state, ContainerState::Stopping { .. })
            });
        } else if let Some(mut state) = self.entries.get_mut(id)
            && let ContainerState::Stopping { last_activity } = *state
        {
            *state = ContainerState::Active { last_activity };
        }
    }

    pub(crate) fn drain(&self) -> Vec<Id> {
        let ids = self
            .entries
            .iter()
            .map(|entry| entry.key().clone())
            .collect::<Vec<_>>();
        ids.into_iter()
            .filter_map(|id| self.entries.remove(&id).map(|(id, _)| id))
            .collect()
    }
}
