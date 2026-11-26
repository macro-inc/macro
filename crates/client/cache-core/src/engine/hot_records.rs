//! The hot tier: decoded records kept in memory in front of storage, bounded
//! by a record count (chosen by the host) and by an estimate of their heap
//! bytes (the same for every host). Storage holds every record the tier
//! holds, so whatever it evicts is read back on the next miss.

use crate::value::{CacheValue, EntityKey, Record};
use lru::LruCache;
use std::collections::BTreeMap;
use std::mem::size_of;
use std::num::NonZeroUsize;

/// Heap bytes the hot tier may hold, estimated by [`record_bytes`]. In a
/// replay of a 6,500-channel chat sidebar its records average about 65 KB, so
/// the budget holds about 900 of them; most other records are far smaller,
/// and the host's record cap bounds those. In that replay, holding an
/// estimated 63 MB instead of 460 MB lowered peak RSS by about 436 MiB.
pub const HOT_BYTE_BUDGET: usize = 64 << 20;

/// Entries a `BTreeMap` node has room for (std's `CAPACITY`). Every node
/// allocates all of them, so a map of one entry costs a whole node.
const BTREE_NODE_SLOTS: usize = 11;

/// Entries a node holds on average once a map grows past one node.
/// Inserting in key order, as decoding does, splits nodes about half full:
/// measured with a counting allocator, 100 entries take 15 leaves and 2
/// internal nodes, and 500 take 72 and 11.
const BTREE_ENTRIES_PER_NODE: usize = 7;

/// A leaf's parent pointer, its index in the parent and its length, before
/// its key and value slots.
const BTREE_LEAF_HEADER: usize =
    (size_of::<usize>() + 2 * size_of::<u16>()).next_multiple_of(align_of::<usize>());

struct HotRecord {
    record: Record,
    bytes: usize,
}

pub struct HotRecords {
    records: LruCache<EntityKey<'static>, HotRecord>,
    bytes: usize,
    budget: usize,
}

impl HotRecords {
    pub fn new(capacity: NonZeroUsize, budget: usize) -> Self {
        Self {
            records: LruCache::new(capacity),
            bytes: 0,
            budget,
        }
    }

    /// The record, marked as the most recently used.
    pub fn get(&mut self, key: &EntityKey<'static>) -> Option<&Record> {
        self.records.get(key).map(|hot| &hot.record)
    }

    /// The record, leaving recency as it is.
    pub fn peek(&self, key: &EntityKey<'static>) -> Option<&Record> {
        self.records.peek(key).map(|hot| &hot.record)
    }

    pub fn contains(&self, key: &EntityKey<'static>) -> bool {
        self.records.contains(key)
    }

    pub fn pop(&mut self, key: &EntityKey<'static>) -> Option<Record> {
        let hot = self.records.pop(key)?;
        self.bytes -= hot.bytes;
        Some(hot.record)
    }

    /// Keeps the record as the most recently used, then evicts the least
    /// recently used until both bounds hold. A record larger than the whole
    /// byte budget is not kept, and drops any older copy of itself.
    pub fn put(&mut self, key: EntityKey<'static>, record: Record) {
        let bytes = record_bytes(&key, &record);
        if bytes > self.budget {
            self.pop(&key);
            return;
        }
        if let Some((_, replaced)) = self.records.push(key, HotRecord { record, bytes }) {
            self.bytes -= replaced.bytes;
        }
        self.bytes += bytes;
        while self.bytes > self.budget {
            let Some((_, evicted)) = self.records.pop_lru() else {
                break;
            };
            self.bytes -= evicted.bytes;
        }
    }

    pub fn clear(&mut self) {
        self.records.clear();
        self.bytes = 0;
    }

    #[cfg(test)]
    pub fn is_empty(&self) -> bool {
        self.records.is_empty()
    }

    pub fn size(&self) -> HotTierSize {
        HotTierSize {
            records: self.records.len(),
            bytes: self.bytes,
        }
    }
}

/// What the hot tier holds.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HotTierSize {
    pub records: usize,
    /// Estimated by [`record_bytes`].
    pub bytes: usize,
}

/// An estimate of the heap bytes an entry holds: its key, the nodes of each
/// field map and everything the values own. It counts string and list
/// lengths, not their spare capacity, which a decoded record rarely has, and
/// leaves out what the allocator adds to each allocation.
pub fn record_bytes(key: &EntityKey<'_>, record: &Record) -> usize {
    key.0.len() + fields_bytes(&record.fields)
}

fn fields_bytes(fields: &BTreeMap<String, CacheValue>) -> usize {
    map_nodes_bytes(fields.len())
        + fields
            .iter()
            .map(|(name, value)| name.len() + value_bytes(value))
            .sum::<usize>()
}

/// The nodes of a `BTreeMap<String, CacheValue>` holding `entries`.
fn map_nodes_bytes(entries: usize) -> usize {
    if entries == 0 {
        return 0;
    }
    let leaf =
        BTREE_LEAF_HEADER + BTREE_NODE_SLOTS * (size_of::<String>() + size_of::<CacheValue>());
    if entries <= BTREE_NODE_SLOTS {
        return leaf;
    }
    let internal = leaf + (BTREE_NODE_SLOTS + 1) * size_of::<usize>();
    let leaves = entries.div_ceil(BTREE_ENTRIES_PER_NODE);
    let internals = (leaves - 1).div_ceil(BTREE_ENTRIES_PER_NODE);
    leaves * leaf + internals * internal
}

fn value_bytes(value: &CacheValue) -> usize {
    match value {
        CacheValue::Null | CacheValue::Bool(_) | CacheValue::Number(_) => 0,
        CacheValue::String(text) | CacheValue::Opaque(text) => text.len(),
        CacheValue::Ref(key) => key.0.len(),
        CacheValue::Object(fields) => fields_bytes(fields),
        CacheValue::List(items) => items
            .iter()
            .map(|item| size_of::<CacheValue>() + value_bytes(item))
            .sum(),
    }
}

#[cfg(test)]
mod test;
