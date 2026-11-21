//! Slots for the git processes one replica runs, in total and per repo.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, PoisonError};

use tokio::sync::{OwnedSemaphorePermit, Semaphore};

use crate::domain::models::GitProcessLimits;

/// Hands out [`GitSlot`]s up to the replica's and each repo's limit.
pub(crate) struct GitSlots {
    total: Arc<Semaphore>,
    per_repo: Arc<Mutex<HashMap<String, usize>>>,
    max_per_repo: usize,
}

/// One running git request's slot, given back when dropped.
pub(crate) struct GitSlot {
    _total: OwnedSemaphorePermit,
    repo: String,
    per_repo: Arc<Mutex<HashMap<String, usize>>>,
}

impl GitSlots {
    pub(crate) fn new(limits: GitProcessLimits) -> Self {
        Self {
            total: Arc::new(Semaphore::new(limits.max_processes)),
            per_repo: Arc::default(),
            max_per_repo: limits.max_processes_per_repo,
        }
    }

    /// A slot for `repo`, or `None` when the replica or the repo has none free.
    pub(crate) fn try_acquire(&self, repo: &str) -> Option<GitSlot> {
        let total = self.total.clone().try_acquire_owned().ok()?;
        let mut per_repo = self.per_repo.lock().unwrap_or_else(PoisonError::into_inner);
        let running = per_repo.entry(repo.to_owned()).or_default();
        if *running >= self.max_per_repo {
            if *running == 0 {
                per_repo.remove(repo);
            }
            return None;
        }
        *running += 1;
        Some(GitSlot {
            _total: total,
            repo: repo.to_owned(),
            per_repo: self.per_repo.clone(),
        })
    }
}

impl Drop for GitSlot {
    fn drop(&mut self) {
        let mut per_repo = self.per_repo.lock().unwrap_or_else(PoisonError::into_inner);
        if let Some(running) = per_repo.get_mut(&self.repo) {
            *running = running.saturating_sub(1);
            if *running == 0 {
                per_repo.remove(&self.repo);
            }
        }
    }
}
