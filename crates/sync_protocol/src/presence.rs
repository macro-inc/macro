//! Clock-injected EphemeralStore, vendored from loro-internal 1.16.2 awareness.rs.
//! Copyright Loro contributors, MIT license (see presence/LICENSE).
//! Only clock injection, imports and API documentation differ from upstream.
use crate::time::UnixMillis;
use loro::LoroValue;
use loro_internal::{sync::Mutex, SubscriberSetWithQueue, Subscription};
use rustc_hash::FxHashMap;
use serde::de::{DeserializeSeed, EnumAccess, MapAccess, SeqAccess, VariantAccess};
use serde::{Deserialize, Deserializer, Serialize};
use std::sync::{atomic::AtomicI64, Arc};
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
/// Cause of a presence notification.
pub enum EphemeralEventTrigger {
    /// A local set or delete.
    Local,
    /// An imported update.
    Import,
    /// Expired state removal.
    Timeout,
}

#[derive(Debug, Clone)]
/// Keys changed by one store operation.
pub struct EphemeralStoreEvent {
    /// Change source.
    pub by: EphemeralEventTrigger,
    /// New keys.
    pub added: Arc<Vec<String>>,
    /// Replaced keys.
    pub updated: Arc<Vec<String>>,
    /// Removed keys.
    pub removed: Arc<Vec<String>>,
}

/// Encoded local-update subscriber.
pub type LocalEphemeralCallback = Box<dyn Fn(&Vec<u8>) -> bool + Send + Sync + 'static>;
/// Merged state subscriber.
pub type EphemeralSubscriber = Box<dyn Fn(&EphemeralStoreEvent) -> bool + Send + Sync + 'static>;

/// `EphemeralStore` is a structure that tracks ephemeral key-value state across peers.
///
/// - Use it for syncing lightweight presence/state like cursors, selections, and UI hints.
/// - Each key uses timestamp-based LWW (Last-Write-Wins) conflict resolution.
/// - Timeout unit: milliseconds.
/// - After timeout: entries are considered expired. They are omitted from
///   `encode`/`encode_all`, and calling [`Self::remove_outdated`] will purge them and
///   notify subscribers with `EphemeralEventTrigger::Timeout`.
///
/// In Rust, you are responsible for periodically calling [`Self::remove_outdated`]
/// if you want timed-out entries to be removed and corresponding events to be
/// emitted. In the WASM/TS wrapper, a timer runs automatically while the store
/// is non-empty.
///
/// See: https://loro.dev/docs/tutorial/ephemeral
///
/// # Example
///
/// ```rust
/// use sync_protocol::{presence::EphemeralStore, time::UnixMillis};
///
/// let mut store = EphemeralStore::new(1000);
/// store.set("key", "value", UnixMillis(100));
/// let encoded = store.encode("key", UnixMillis(100));
/// let mut store2 = EphemeralStore::new(1000);
/// store.subscribe_local_updates(Box::new(|data| {
///     println!("local update: {:?}", data);
///     true
/// }));
/// store2.apply(&encoded, UnixMillis(100)).unwrap();
/// assert_eq!(store2.get("key"), Some("value".into()));
/// ```
#[derive(Debug, Clone)]
pub struct EphemeralStore {
    inner: Arc<EphemeralStoreInner>,
}

impl EphemeralStore {
    /// Create a new `EphemeralStore`.
    ///
    /// - `timeout`: inactivity timeout in milliseconds. If a key does not
    ///   receive updates within this duration, it is considered expired. It
    ///   will be skipped by `encode`/`encode_all`, and removed when
    ///   [`Self::remove_outdated`] is called (triggering a `Timeout` event to
    ///   subscribers).
    pub fn new(timeout: i64) -> Self {
        Self {
            inner: Arc::new(EphemeralStoreInner::new(timeout)),
        }
    }

    /// Encode the latest value of `key`.
    ///
    /// Expired keys (past timeout) are omitted and produce an empty payload.
    pub fn encode(&self, key: &str, now: UnixMillis) -> Vec<u8> {
        self.inner.encode(key, now)
    }

    /// Encode all non-expired keys.
    ///
    /// Entries that have exceeded the timeout are not included in the payload.
    pub fn encode_all(&self, now: UnixMillis) -> Vec<u8> {
        self.inner.encode_all(now)
    }

    /// Apply encoded updates imported from another peer/process.
    ///
    /// Subscribers receive an event with `by = Import` and the lists of
    /// `added`/`updated`/`removed` keys as appropriate.
    pub fn apply(&self, data: &[u8], now: UnixMillis) -> Result<(), Box<str>> {
        self.inner.apply(data, now)
    }

    /// Set local state with the supplied wall timestamp.
    pub fn set(&self, key: &str, value: impl Into<LoroValue>, now: UnixMillis) {
        self.inner.set(key, value, now)
    }

    /// Write a local tombstone with the supplied wall timestamp.
    pub fn delete(&self, key: &str, now: UnixMillis) {
        self.inner.delete(key, now)
    }

    /// Read the current value without expiring it.
    pub fn get(&self, key: &str) -> Option<LoroValue> {
        self.inner.get(key)
    }

    /// Remove entries whose last update timestamp has exceeded the timeout.
    ///
    /// If any keys are removed, subscribers receive an event with
    /// `by = Timeout` and the `removed` keys. This does not run automatically
    /// in Rust; call it on your own schedule.
    pub fn remove_outdated(&self, now: UnixMillis) {
        self.inner.remove_outdated(now)
    }

    /// Read all non-tombstone values without expiring them.
    pub fn get_all_states(&self) -> FxHashMap<String, LoroValue> {
        self.inner.get_all_states()
    }

    /// List non-tombstone keys without expiring them.
    pub fn keys(&self) -> Vec<String> {
        self.inner.keys()
    }

    /// Subscribe to local ephemeral/awareness updates.
    ///
    /// The callback receives encoded update bytes whenever local ephemeral state changes.
    /// This is useful for syncing awareness information like cursor positions, selections,
    /// or presence data to other peers in real-time.
    ///
    /// **Auto-unsubscription**: If the callback returns `false`, the subscription will be
    /// automatically removed, providing a convenient way to implement one-time or conditional
    /// subscriptions in Rust.
    ///
    /// # Parameters
    /// - `callback`: Function that receives `&Vec<u8>` (encoded ephemeral updates) and returns `bool`
    ///   - Return `true` to keep the subscription active
    ///   - Return `false` to automatically unsubscribe
    ///
    /// # Example
    /// ```rust
    /// use sync_protocol::{presence::EphemeralStore, time::UnixMillis};
    /// use std::sync::{Arc, Mutex};
    ///
    /// let store = EphemeralStore::new(30000);
    /// let update_count = Arc::new(Mutex::new(0));
    /// let count_clone = update_count.clone();
    ///
    /// // Subscribe and collect first 3 updates, then auto-unsubscribe
    /// let sub = store.subscribe_local_updates(Box::new(move |bytes| {
    ///     println!("Received {} bytes of ephemeral data", bytes.len());
    ///     let mut count = count_clone.lock().unwrap();
    ///     *count += 1;
    ///     *count < 3  // Auto-unsubscribe after 3 updates
    /// }));
    ///
    /// store.set("cursor", 42, UnixMillis(100));
    /// ```
    pub fn subscribe_local_updates(&self, callback: LocalEphemeralCallback) -> Subscription {
        self.inner.subscribe_local_updates(callback)
    }

    /// Subscribe to merged changes.
    pub fn subscribe(&self, callback: EphemeralSubscriber) -> Subscription {
        self.inner.subscribe(callback)
    }
}

struct EphemeralStoreInner {
    states: Mutex<FxHashMap<String, State>>,
    local_subs: SubscriberSetWithQueue<(), LocalEphemeralCallback, Vec<u8>>,
    subscribers: SubscriberSetWithQueue<(), EphemeralSubscriber, EphemeralStoreEvent>,
    timeout: AtomicI64,
}

impl std::fmt::Debug for EphemeralStoreInner {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "AwarenessV2 {{ states: {:?}, timeout: {:?} }}",
            self.states, self.timeout
        )
    }
}

#[derive(Serialize, Deserialize)]
struct EncodedState<'a> {
    #[serde(borrow)]
    key: &'a str,
    value: Option<LoroValue>,
    timestamp: i64,
}

#[derive(Deserialize)]
struct DecodedState<'a> {
    #[serde(borrow)]
    key: &'a str,
    #[serde(deserialize_with = "deserialize_optional_depth_limited_loro_value")]
    value: Option<LoroValue>,
    timestamp: i64,
}

const EPHEMERAL_VALUE_MAX_DEPTH: usize = 512;

fn deserialize_optional_depth_limited_loro_value<'de, D>(
    deserializer: D,
) -> Result<Option<LoroValue>, D::Error>
where
    D: Deserializer<'de>,
{
    Option::<DepthLimitedLoroValue>::deserialize(deserializer)
        .map(|value| value.map(DepthLimitedLoroValue::into_inner))
}

fn deserialize_depth_limited_loro_value<'de, D>(deserializer: D) -> Result<LoroValue, D::Error>
where
    D: Deserializer<'de>,
{
    LoroValueSeed {
        remaining_depth: EPHEMERAL_VALUE_MAX_DEPTH,
    }
    .deserialize(deserializer)
}

struct DepthLimitedLoroValue(LoroValue);

impl DepthLimitedLoroValue {
    fn into_inner(self) -> LoroValue {
        self.0
    }
}

impl<'de> Deserialize<'de> for DepthLimitedLoroValue {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        deserialize_depth_limited_loro_value(deserializer).map(Self)
    }
}

#[derive(Clone, Copy)]
struct LoroValueSeed {
    remaining_depth: usize,
}

impl LoroValueSeed {
    fn nested<E>(self) -> Result<Self, E>
    where
        E: serde::de::Error,
    {
        let remaining_depth = self
            .remaining_depth
            .checked_sub(1)
            .ok_or_else(|| E::custom("LoroValue nesting depth exceeded"))?;
        Ok(Self { remaining_depth })
    }
}

impl<'de> DeserializeSeed<'de> for LoroValueSeed {
    type Value = LoroValue;

    fn deserialize<D>(self, deserializer: D) -> Result<Self::Value, D::Error>
    where
        D: Deserializer<'de>,
    {
        if deserializer.is_human_readable() {
            return Err(serde::de::Error::custom(
                "human-readable LoroValue is not supported by the awareness decoder",
            ));
        }

        deserializer.deserialize_enum(
            "LoroValue",
            &[
                "Null",
                "Bool",
                "Double",
                "I32",
                "String",
                "List",
                "Map",
                "Container",
                "Binary",
            ],
            LoroValueSeedVisitor { seed: self },
        )
    }
}

struct LoroValueSeedVisitor {
    seed: LoroValueSeed,
}

impl<'de> serde::de::Visitor<'de> for LoroValueSeedVisitor {
    type Value = LoroValue;

    fn expecting(&self, formatter: &mut std::fmt::Formatter) -> std::fmt::Result {
        formatter.write_str("a depth-limited LoroValue")
    }

    fn visit_enum<A>(self, data: A) -> Result<Self::Value, A::Error>
    where
        A: EnumAccess<'de>,
    {
        match data.variant()? {
            (DepthLimitedLoroValueField::Null, v) => {
                v.unit_variant()?;
                Ok(LoroValue::Null)
            }
            (DepthLimitedLoroValueField::Bool, v) => v.newtype_variant().map(LoroValue::Bool),
            (DepthLimitedLoroValueField::Double, v) => v.newtype_variant().map(LoroValue::Double),
            (DepthLimitedLoroValueField::I32, v) => v.newtype_variant().map(LoroValue::I64),
            (DepthLimitedLoroValueField::String, v) => v
                .newtype_variant()
                .map(|value: String| LoroValue::String(value.into())),
            (DepthLimitedLoroValueField::List, v) => v
                .newtype_variant_seed(LoroListSeed {
                    value_seed: self.seed.nested()?,
                })
                .map(|value| LoroValue::List(value.into())),
            (DepthLimitedLoroValueField::Map, v) => v
                .newtype_variant_seed(LoroMapSeed {
                    value_seed: self.seed.nested()?,
                })
                .map(|value| LoroValue::Map(value.into())),
            (DepthLimitedLoroValueField::Container, v) => {
                v.newtype_variant().map(LoroValue::Container)
            }
            (DepthLimitedLoroValueField::Binary, v) => v
                .newtype_variant()
                .map(|value: Vec<u8>| LoroValue::Binary(value.into())),
        }
    }
}

#[derive(Deserialize)]
enum DepthLimitedLoroValueField {
    Null,
    Bool,
    Double,
    I32,
    String,
    List,
    Map,
    Container,
    Binary,
}

struct LoroListSeed {
    value_seed: LoroValueSeed,
}

impl<'de> DeserializeSeed<'de> for LoroListSeed {
    type Value = Vec<LoroValue>;

    fn deserialize<D>(self, deserializer: D) -> Result<Self::Value, D::Error>
    where
        D: Deserializer<'de>,
    {
        deserializer.deserialize_seq(LoroListVisitor {
            value_seed: self.value_seed,
        })
    }
}

struct LoroListVisitor {
    value_seed: LoroValueSeed,
}

impl<'de> serde::de::Visitor<'de> for LoroListVisitor {
    type Value = Vec<LoroValue>;

    fn expecting(&self, formatter: &mut std::fmt::Formatter) -> std::fmt::Result {
        formatter.write_str("a depth-limited LoroValue list")
    }

    fn visit_seq<A>(self, mut seq: A) -> Result<Self::Value, A::Error>
    where
        A: SeqAccess<'de>,
    {
        let mut list = Vec::new();
        while let Some(value) = seq.next_element_seed(self.value_seed)? {
            list.push(value);
        }
        Ok(list)
    }
}

struct LoroMapSeed {
    value_seed: LoroValueSeed,
}

impl<'de> DeserializeSeed<'de> for LoroMapSeed {
    type Value = FxHashMap<String, LoroValue>;

    fn deserialize<D>(self, deserializer: D) -> Result<Self::Value, D::Error>
    where
        D: Deserializer<'de>,
    {
        deserializer.deserialize_map(LoroMapVisitor {
            value_seed: self.value_seed,
        })
    }
}

struct LoroMapVisitor {
    value_seed: LoroValueSeed,
}

impl<'de> serde::de::Visitor<'de> for LoroMapVisitor {
    type Value = FxHashMap<String, LoroValue>;

    fn expecting(&self, formatter: &mut std::fmt::Formatter) -> std::fmt::Result {
        formatter.write_str("a depth-limited LoroValue map")
    }

    fn visit_map<A>(self, mut map: A) -> Result<Self::Value, A::Error>
    where
        A: MapAccess<'de>,
    {
        let mut value = FxHashMap::default();
        while let Some(key) = map.next_key()? {
            let entry = map.next_value_seed(self.value_seed)?;
            value.insert(key, entry);
        }
        Ok(value)
    }
}

#[derive(Debug, Clone)]
struct State {
    state: Option<LoroValue>,
    timestamp: i64,
}

impl EphemeralStoreInner {
    pub fn new(timeout: i64) -> EphemeralStoreInner {
        EphemeralStoreInner {
            timeout: AtomicI64::new(timeout),
            states: Mutex::new(FxHashMap::default()),
            local_subs: SubscriberSetWithQueue::new(),
            subscribers: SubscriberSetWithQueue::new(),
        }
    }

    pub fn encode(&self, key: &str, now: UnixMillis) -> Vec<u8> {
        let mut peers_info = Vec::new();
        let now = now.0;
        let states = self.states.lock();
        if let Some(peer_state) = states.get(key) {
            if now - peer_state.timestamp > self.timeout.load(std::sync::atomic::Ordering::Relaxed)
            {
                return vec![];
            }
            let encoded_peer_info = EncodedState {
                key,
                value: peer_state.state.clone(),
                timestamp: peer_state.timestamp,
            };
            peers_info.push(encoded_peer_info);
        }

        postcard::to_allocvec(&peers_info).unwrap()
    }

    pub fn encode_all(&self, now: UnixMillis) -> Vec<u8> {
        let mut peers_info = Vec::new();
        let now = now.0;
        let states = self.states.lock();
        for (key, peer_state) in states.iter() {
            if now - peer_state.timestamp > self.timeout.load(std::sync::atomic::Ordering::Relaxed)
            {
                continue;
            }
            let encoded_peer_info = EncodedState {
                key,
                value: peer_state.state.clone(),
                timestamp: peer_state.timestamp,
            };
            peers_info.push(encoded_peer_info);
        }
        postcard::to_allocvec(&peers_info).unwrap()
    }

    pub fn apply(&self, data: &[u8], now: UnixMillis) -> Result<(), Box<str>> {
        let peers_info = match postcard::from_bytes::<Vec<DecodedState>>(data) {
            Ok(ans) => ans,
            Err(err) => return Err(format!("Failed to decode data: {}", err).into()),
        };

        let mut updated_keys = Vec::new();
        let mut added_keys = Vec::new();
        let mut removed_keys = Vec::new();
        let now = now.0;
        let timeout = self.timeout.load(std::sync::atomic::Ordering::Relaxed);
        let mut states = self.states.lock();
        for DecodedState {
            key,
            value: record,
            timestamp,
        } in peers_info
        {
            if now - timestamp > timeout {
                continue;
            }

            match states.get_mut(key) {
                Some(peer_info) if peer_info.timestamp >= timestamp => {
                    // do nothing
                }
                _ => {
                    let old = states.insert(
                        key.to_string(),
                        State {
                            state: record.clone(),
                            timestamp,
                        },
                    );
                    match (old, record) {
                        (Some(_), Some(_)) => updated_keys.push(key.to_string()),
                        (None, Some(_)) => added_keys.push(key.to_string()),
                        (Some(_), None) => removed_keys.push(key.to_string()),
                        (None, None) => {}
                    }
                }
            }
        }

        drop(states);
        if !self.subscribers.inner().is_empty() {
            self.subscribers.emit(
                &(),
                EphemeralStoreEvent {
                    by: EphemeralEventTrigger::Import,
                    added: Arc::new(added_keys),
                    updated: Arc::new(updated_keys),
                    removed: Arc::new(removed_keys),
                },
            );
        }

        Ok(())
    }

    /// Set local state with the supplied wall timestamp.
    pub fn set(&self, key: &str, value: impl Into<LoroValue>, now: UnixMillis) {
        self._set_local_state(key, Some(value.into()), now);
    }

    /// Write a local tombstone with the supplied wall timestamp.
    pub fn delete(&self, key: &str, now: UnixMillis) {
        self._set_local_state(key, None, now);
    }

    /// Read the current value without expiring it.
    pub fn get(&self, key: &str) -> Option<LoroValue> {
        let states = self.states.lock();
        states.get(key).and_then(|x| x.state.clone())
    }

    pub fn remove_outdated(&self, now: UnixMillis) {
        let now = now.0;
        let mut removed = Vec::new();
        let mut states = self.states.lock();
        states.retain(|key, state| {
            if now - state.timestamp > self.timeout.load(std::sync::atomic::Ordering::Relaxed) {
                if state.state.is_some() {
                    removed.push(key.clone());
                }
                false
            } else {
                true
            }
        });
        drop(states);
        if !self.subscribers.inner().is_empty() {
            self.subscribers.emit(
                &(),
                EphemeralStoreEvent {
                    by: EphemeralEventTrigger::Timeout,
                    added: Arc::new(Vec::new()),
                    updated: Arc::new(Vec::new()),
                    removed: Arc::new(removed),
                },
            );
        }
    }

    /// Read all non-tombstone values without expiring them.
    pub fn get_all_states(&self) -> FxHashMap<String, LoroValue> {
        let states = self.states.lock();
        states
            .iter()
            .filter(|(_, v)| v.state.is_some())
            .map(|(k, v)| (k.clone(), v.state.clone().unwrap()))
            .collect()
    }

    /// List non-tombstone keys without expiring them.
    pub fn keys(&self) -> Vec<String> {
        let states = self.states.lock();
        states
            .keys()
            .filter(|&k| states.get(k).unwrap().state.is_some())
            .map(|s| s.to_string())
            .collect()
    }

    /// Subscribe to local ephemeral state updates.
    ///
    /// The callback receives encoded update bytes whenever the local peer's ephemeral state
    /// is modified. This enables real-time synchronization of awareness data like cursor
    /// positions, user presence, or temporary collaborative state.
    ///
    /// **Auto-unsubscription**: If the callback returns `false`, the subscription will be
    /// automatically removed, making it easy to implement conditional or temporary subscriptions.
    ///
    /// # Parameters
    /// - `callback`: Function that receives `&Vec<u8>` and returns `bool`
    ///   - Return `true` to maintain the subscription
    ///   - Return `false` to automatically unsubscribe
    ///
    /// # Returns
    /// A `Subscription` that can be used to manually unsubscribe if needed.
    pub fn subscribe_local_updates(&self, callback: LocalEphemeralCallback) -> Subscription {
        let (sub, activate) = self.local_subs.inner().insert((), callback);
        activate();
        sub
    }

    /// Subscribe to merged changes.
    pub fn subscribe(&self, callback: EphemeralSubscriber) -> Subscription {
        let (sub, activate) = self.subscribers.inner().insert((), callback);
        activate();
        sub
    }

    fn _set_local_state(&self, key: &str, value: Option<LoroValue>, now: UnixMillis) {
        let is_delete = value.is_none();
        let mut states = self.states.lock();
        let old = states.insert(
            key.to_string(),
            State {
                state: value,
                timestamp: now.0,
            },
        );

        drop(states);
        if !self.local_subs.inner().is_empty() {
            self.local_subs.emit(&(), self.encode(key, now));
        }
        if !self.subscribers.inner().is_empty() {
            if old.is_some() {
                self.subscribers.emit(
                    &(),
                    EphemeralStoreEvent {
                        by: EphemeralEventTrigger::Local,
                        added: Arc::new(Vec::new()),
                        updated: if !is_delete {
                            Arc::new(vec![key.to_string()])
                        } else {
                            Arc::new(Vec::new())
                        },
                        removed: if !is_delete {
                            Arc::new(Vec::new())
                        } else {
                            Arc::new(vec![key.to_string()])
                        },
                    },
                );
            } else if !is_delete {
                self.subscribers.emit(
                    &(),
                    EphemeralStoreEvent {
                        by: EphemeralEventTrigger::Local,
                        added: Arc::new(vec![key.to_string()]),
                        updated: Arc::new(Vec::new()),
                        removed: Arc::new(Vec::new()),
                    },
                );
            }
        }
    }
}

#[cfg(test)]
mod test;

/// Ordered wire values and their exact sender timestamps, including tombstones.
pub type TimestampedStates = std::collections::BTreeMap<String, (Option<LoroValue>, UnixMillis)>;

/// Decode wire values and timestamps without applying expiry or LWW filtering.
/// This uses the same depth-limited decoder as imports, including tombstones.
pub fn decode_timestamps(data: &[u8]) -> Result<TimestampedStates, Box<str>> {
    let states: Vec<DecodedState<'_>> =
        postcard::from_bytes(data).map_err(|e| e.to_string().into_boxed_str())?;
    Ok(states
        .into_iter()
        .map(|state| {
            (
                state.key.to_owned(),
                (state.value, UnixMillis(state.timestamp)),
            )
        })
        .collect())
}
