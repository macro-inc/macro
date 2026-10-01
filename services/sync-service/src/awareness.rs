//! Ephemeral presence is independent of document history. Values are JSON and
//! scoped to a decimal presence peer ID; clocks prevent reordered resurrection.
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, sync::Mutex};
use web_time::Instant;

#[derive(Clone, Serialize, Deserialize)]
struct Update {
    clock: u64,
    value: Option<serde_json::Value>,
}

struct Entry {
    update: Update,
    received: Instant,
}

pub struct PresenceStore {
    entries: Mutex<BTreeMap<String, Entry>>,
    timeout_ms: u64,
}

impl PresenceStore {
    pub fn new(timeout_ms: u64) -> Self {
        Self {
            entries: Mutex::new(BTreeMap::new()),
            timeout_ms,
        }
    }

    pub fn apply(&self, bytes: &[u8]) -> Result<(), &'static str> {
        if bytes.len() > 64 * 1024 {
            return Err("presence update too large");
        }
        let updates: BTreeMap<String, Update> =
            serde_json::from_slice(bytes).map_err(|_| "invalid presence update")?;
        let mut entries = self.entries.lock().expect("presence mutex poisoned");
        if updates.len() > 1024 || updates.keys().any(|key| key.parse::<u64>().is_err()) {
            return Err("invalid presence peers");
        }
        // Retain tombstones for the expiry window, then release their slots.
        // Presence is best effort and never part of persistent document state.
        entries
            .retain(|_, entry| entry.received.elapsed().as_millis() <= u128::from(self.timeout_ms));
        if entries.len()
            + updates
                .keys()
                .filter(|key| !entries.contains_key(*key))
                .count()
            > 1024
        {
            return Err("too many presence peers");
        }
        for (peer, update) in updates {
            if entries
                .get(&peer)
                .is_none_or(|entry| update.clock > entry.update.clock)
            {
                entries.insert(
                    peer,
                    Entry {
                        update,
                        received: Instant::now(),
                    },
                );
            }
        }
        Ok(())
    }

    pub fn delete(&self, peer: &str) {
        let mut entries = self.entries.lock().expect("presence mutex poisoned");
        if let Some(entry) = entries.get_mut(peer) {
            entry.update.value = None;
            entry.received = Instant::now();
        }
    }

    fn encoded(&self, peer: Option<&str>) -> Vec<u8> {
        let entries = self.entries.lock().expect("presence mutex poisoned");
        let values: BTreeMap<_, _> = entries
            .iter()
            .filter(|(key, _)| peer.is_none_or(|peer| peer == *key))
            .map(|(key, entry)| {
                let mut update = entry.update.clone();
                if entry.received.elapsed().as_millis() > u128::from(self.timeout_ms) {
                    update.value = None;
                }
                (key, update)
            })
            .collect();
        serde_json::to_vec(&values).expect("presence JSON is serializable")
    }

    pub fn encode_all(&self) -> Vec<u8> {
        self.encoded(None)
    }
    pub fn encode(&self, peer: &str) -> Vec<u8> {
        self.encoded(Some(peer))
    }
}

#[cfg(test)]
mod test;
