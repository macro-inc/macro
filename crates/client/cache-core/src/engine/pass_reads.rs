//! Reading once for the projection passes and the write that follows them.
//!
//! Before a network write, the host's projection passes read the stored
//! records and projection states the response touches; the write then reads
//! the same records to merge and the same states to see whether its
//! projections change anything. [`PassReads`] serves the passes from storage,
//! as before, reading each key once, and keeps what storage returned, except
//! records the hot tier holds, which the write takes from the hot tier.
//! [`Engine::keep_pass_reads`] hands that to the next write, which uses it in
//! place of its own storage reads only when storage has committed nothing
//! between the passes' reads and the write's last storage read, so the write
//! sees exactly what reading storage then would have returned.
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

/// [`DurableRead`] from storage, reading each key at most once, except a
/// record the hot tier holds: that is read from storage on every call, and
/// not kept, since the write merges onto the hot copy and keeping it would
/// only copy it.
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
                if !read.records.contains_key(key) && seen.insert(key) {
                    missing.push(key.clone());
                }
            }
            missing
        };
        let mut unkept = HashMap::new();
        if !missing.is_empty() {
            let fetched = self.storage.get_batch(&missing).await?;
            let mut read = self.read();
            for (key, record) in missing.into_iter().zip(fetched) {
                if self.hot.contains(&key) {
                    unkept.insert(key, record);
                } else {
                    read.records.insert(key, record);
                }
            }
        }
        let read = self.read();
        let mut records: Vec<Option<Record>> = Vec::with_capacity(keys.len());
        let mut handed: HashMap<&EntityKey<'static>, usize> = HashMap::new();
        for key in &keys {
            let record = if let Some(&index) = handed.get(key) {
                records[index].clone()
            } else if let Some(record) = unkept.remove(key) {
                handed.insert(key, records.len());
                record
            } else {
                read.records.get(key).cloned().flatten()
            };
            records.push(record);
        }
        Ok(records)
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

/// A [`PassReadSet`] and where storage stood before it was read.
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

    /// The kept reads, forgotten here. The write confirms what it used with
    /// [`Self::kept_reads_hold`] after its own storage reads.
    pub(super) fn take_kept_reads(&mut self) -> Option<KeptReads> {
        self.kept_reads.take()
    }

    /// Whether storage has committed nothing since `kept` was read, so each
    /// kept read is what reading storage now would return. The write asks
    /// after its last storage read, so the kept reads stand for reads made
    /// alongside it.
    pub(super) fn kept_reads_hold(&self, kept: &KeptReads) -> bool {
        self.storage.write_position() == Some(kept.position)
    }
}

impl KeptReads {
    /// The stored record for `key`, when the passes read it.
    pub(super) fn record(&mut self, key: &EntityKey<'static>) -> Option<Option<Record>> {
        self.set.records.remove(key)
    }

    /// The projection state for `key`, when the passes read it.
    pub(super) fn state(&self, key: &PredicateRecordKey) -> Option<Option<ProjectionState>> {
        self.set.states.get(key).cloned()
    }
}
