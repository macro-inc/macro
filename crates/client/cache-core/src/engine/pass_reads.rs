//! Reading once for the projection passes and the write that follows them.
//!
//! Before a network write, the host's projection passes read the stored
//! records and projection states the response touches; the write then reads
//! the same records to merge and the same states to see whether its
//! projections change anything. [`PassReads`] serves the passes through the
//! hot tier and keeps what storage returned. [`Engine::keep_pass_reads`]
//! hands that to the next write, which uses it only while storage has
//! committed nothing since, so it reads exactly what it would have read.
use super::*;
use crate::store::{DurableRead, WritePosition};
use maybe_send::MaybeSync;
use predicate_index::RecordKey as PredicateRecordKey;
use std::collections::HashSet;
use std::sync::{Mutex, PoisonError};

/// What storage returned to one set of projection passes.
#[derive(Default)]
pub struct PassReadSet {
    records: HashMap<EntityKey<'static>, Option<Record>>,
    states: HashMap<PredicateRecordKey, Option<ProjectionState>>,
}

/// [`DurableRead`] through the engine's hot tier, reading each key from
/// storage at most once.
pub struct PassReads<'a, S> {
    storage: &'a S,
    hot: &'a LruCache<EntityKey<'static>, Record>,
    read: Mutex<PassReadSet>,
}

impl<S> PassReads<'_, S> {
    /// What storage returned, for [`Engine::keep_pass_reads`].
    pub fn finish(self) -> PassReadSet {
        self.read
            .into_inner()
            .unwrap_or_else(PoisonError::into_inner)
    }

    fn read(&self) -> std::sync::MutexGuard<'_, PassReadSet> {
        self.read.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

impl<S: crate::predicate::PredicateIndexStorage + MaybeSync> DurableRead for PassReads<'_, S> {
    type Error = S::Error;
    type Storage = S;

    fn storage(&self) -> &S {
        self.storage
    }

    async fn read_records(&self, keys: &[EntityKey<'_>]) -> Result<Vec<Option<Record>>, S::Error> {
        let keys = keys
            .iter()
            .map(|key| key.clone().into_owned())
            .collect::<Vec<_>>();
        let missing = {
            let read = self.read();
            let mut missing = Vec::new();
            let mut seen = HashSet::new();
            for key in &keys {
                if self.hot.peek(key).is_none()
                    && !read.records.contains_key(key)
                    && seen.insert(key)
                {
                    missing.push(key.clone());
                }
            }
            missing
        };
        if !missing.is_empty() {
            let fetched = self.storage.get_batch(&missing).await?;
            self.read().records.extend(missing.into_iter().zip(fetched));
        }
        let read = self.read();
        Ok(keys
            .iter()
            .map(|key| match self.hot.peek(key) {
                Some(record) => Some(record.clone()),
                None => read.records.get(key).cloned().flatten(),
            })
            .collect())
    }

    async fn read_projection_states(
        &self,
        keys: &[PredicateRecordKey],
    ) -> Result<Vec<Option<ProjectionState>>, S::Error> {
        let missing = {
            let read = self.read();
            let mut missing = Vec::new();
            let mut seen = HashSet::new();
            for key in keys {
                if !read.states.contains_key(key) && seen.insert(key) {
                    missing.push(key.clone());
                }
            }
            missing
        };
        if !missing.is_empty() {
            let fetched = self.storage.load_projection_states(&missing).await?;
            self.read().states.extend(missing.into_iter().zip(fetched));
        }
        let read = self.read();
        Ok(keys
            .iter()
            .map(|key| read.states.get(key).cloned().flatten())
            .collect())
    }

    async fn read_mutation_queue(&self) -> Result<Vec<QueuedMutation>, S::Error> {
        self.storage.load_mutation_queue().await
    }
}

/// A [`PassReadSet`] and where storage stood when it was read.
pub(super) struct KeptReads {
    position: WritePosition,
    set: PassReadSet,
}

impl<S: Storage> Engine<S> {
    /// Durable reads for the projection passes of the next write. Take
    /// [`Storage::write_position`] first, and hand it with
    /// [`PassReads::finish`] to [`Self::keep_pass_reads`] after them.
    pub fn pass_reads(&self) -> PassReads<'_, S> {
        self.resume_pass_reads(PassReadSet::default())
    }

    /// [`Self::pass_reads`] that already holds what earlier passes read, for
    /// a host that runs other work between passes. The caller checks that
    /// [`Storage::write_position`] has not moved since `set` was read.
    pub fn resume_pass_reads(&self, set: PassReadSet) -> PassReads<'_, S> {
        PassReads {
            storage: &self.storage,
            hot: &self.hot,
            read: Mutex::new(set),
        }
    }

    /// Keeps what the projection passes read for the next write. `position`
    /// is [`Storage::write_position`] taken before the passes read anything,
    /// so a commit while they read leaves the next write a moved position.
    /// Without a position the write reads storage itself.
    pub fn keep_pass_reads(&mut self, set: PassReadSet, position: Option<WritePosition>) {
        self.kept_reads = position.map(|position| KeptReads { position, set });
    }

    /// The kept reads, while storage has committed nothing since they were
    /// read. Taking them forgets them either way.
    pub(super) fn take_kept_reads(&mut self) -> Option<PassReadSet> {
        let kept = self.kept_reads.take()?;
        (self.storage.write_position() == Some(kept.position)).then_some(kept.set)
    }
}

impl PassReadSet {
    /// The stored record for `key`, when the passes read it.
    pub(super) fn record(&mut self, key: &EntityKey<'static>) -> Option<Option<Record>> {
        self.records.remove(key)
    }

    /// The projection state for `key`, when the passes read it.
    pub(super) fn state(&self, key: &PredicateRecordKey) -> Option<Option<ProjectionState>> {
        self.states.get(key).cloned()
    }
}
