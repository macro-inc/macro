use models_email::email::service::{backfill::BackfillJob, link::Link};
use std::collections::HashMap;
use std::future::Future;
use std::hash::Hash;
use std::sync::{Arc, Mutex, MutexGuard};
use tokio::sync::Notify;
use tokio::time::{Duration, Instant};
use uuid::Uuid;

#[cfg(test)]
mod test;

const WORKER_CACHE_CAPACITY: usize = 10_000;
const WORKER_CACHE_TTL: Duration = Duration::from_secs(60);

/// Caches shared by all tasks spawned by a pubsub worker.
#[derive(Clone)]
pub struct PubSubCaches {
    /// Backfill jobs keyed by job ID.
    pub backfill_jobs: TtlCache<Uuid, BackfillJob>,
    /// Email links keyed by link ID.
    pub links: TtlCache<Uuid, Link>,
    /// CRM team membership keyed by Macro user ID, including users without a team.
    pub crm_team_ids: TtlCache<String, Option<Uuid>>,
    /// Provider label IDs mapped to database label IDs, keyed by link ID.
    pub label_ids_by_link: TtlCache<Uuid, HashMap<String, Uuid>>,
}

impl PubSubCaches {
    /// Creates the bounded, 60-second caches for one worker context.
    pub fn new() -> Self {
        Self {
            backfill_jobs: TtlCache::new(WORKER_CACHE_CAPACITY, WORKER_CACHE_TTL),
            links: TtlCache::new(WORKER_CACHE_CAPACITY, WORKER_CACHE_TTL),
            crm_team_ids: TtlCache::new(WORKER_CACHE_CAPACITY, WORKER_CACHE_TTL),
            label_ids_by_link: TtlCache::new(WORKER_CACHE_CAPACITY, WORKER_CACHE_TTL),
        }
    }
}

impl Default for PubSubCaches {
    fn default() -> Self {
        Self::new()
    }
}

/// A cloneable, bounded TTL map with per-key single-flight loading.
pub struct TtlCache<K, V> {
    inner: Arc<CacheInner<K, V>>,
}

impl<K, V> Clone for TtlCache<K, V> {
    fn clone(&self) -> Self {
        Self {
            inner: Arc::clone(&self.inner),
        }
    }
}

struct CacheInner<K, V> {
    capacity: usize,
    ttl: Duration,
    state: Mutex<CacheState<K, V>>,
}

struct CacheState<K, V> {
    entries: HashMap<K, CacheEntry<V>>,
    in_flight: HashMap<K, Arc<Notify>>,
}

struct CacheEntry<V> {
    value: V,
    expires_at: Instant,
}

enum CacheLookup<V> {
    Hit(V),
    Wait(Arc<Notify>),
    Load(Arc<Notify>),
}

impl<K, V> TtlCache<K, V>
where
    K: Clone + Eq + Hash,
    V: Clone,
{
    /// Creates a cache with the provided maximum entry count and TTL.
    ///
    /// The capacity must be greater than zero.
    pub fn new(capacity: usize, ttl: Duration) -> Self {
        assert!(capacity > 0, "TTL cache capacity must be greater than zero");
        Self {
            inner: Arc::new(CacheInner {
                capacity,
                ttl,
                state: Mutex::new(CacheState {
                    entries: HashMap::new(),
                    in_flight: HashMap::new(),
                }),
            }),
        }
    }

    /// Returns a cached value or loads it once for all concurrent callers of the key.
    ///
    /// Loader errors are not cached. Values such as `Option<T>` can be used to cache
    /// negative lookup results.
    pub async fn get_or_load<E, F, Fut>(&self, key: K, loader: F) -> Result<V, E>
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = Result<V, E>>,
    {
        let mut loader = Some(loader);

        loop {
            let lookup = {
                let mut state = self.lock_state();
                if let Some(value) = fresh_value(&mut state.entries, &key) {
                    CacheLookup::Hit(value)
                } else if let Some(in_flight) = state.in_flight.get(&key) {
                    CacheLookup::Wait(Arc::clone(in_flight))
                } else {
                    let in_flight = Arc::new(Notify::new());
                    state.in_flight.insert(key.clone(), Arc::clone(&in_flight));
                    CacheLookup::Load(in_flight)
                }
            };

            match lookup {
                CacheLookup::Hit(value) => return Ok(value),
                CacheLookup::Wait(in_flight) => {
                    let wait_for_load = Arc::clone(&in_flight).notified_owned();
                    let load_is_still_running = self
                        .lock_state()
                        .in_flight
                        .get(&key)
                        .is_some_and(|current| Arc::ptr_eq(current, &in_flight));
                    if load_is_still_running {
                        wait_for_load.await;
                    }
                }
                CacheLookup::Load(in_flight) => {
                    let load_guard = LoadGuard::new(self, key.clone(), in_flight);
                    let load = loader
                        .take()
                        .expect("cache loader is only consumed by the loading caller");
                    let result = load().await;
                    return match result {
                        Ok(value) => {
                            load_guard.complete(value.clone());
                            Ok(value)
                        }
                        Err(error) => Err(error),
                    };
                }
            }
        }
    }

    /// Removes a cached value and cancels any in-flight load from populating the key.
    pub fn invalidate(&self, key: &K) {
        let in_flight = {
            let mut state = self.lock_state();
            state.entries.remove(key);
            state.in_flight.remove(key)
        };
        if let Some(in_flight) = in_flight {
            in_flight.notify_waiters();
        }
    }

    fn lock_state(&self) -> MutexGuard<'_, CacheState<K, V>> {
        self.inner
            .state
            .lock()
            .expect("TTL cache mutex must not be poisoned")
    }
}

fn fresh_value<K, V>(entries: &mut HashMap<K, CacheEntry<V>>, key: &K) -> Option<V>
where
    K: Eq + Hash,
    V: Clone,
{
    let now = Instant::now();
    match entries.get(key) {
        Some(entry) if entry.expires_at > now => Some(entry.value.clone()),
        Some(_) => {
            entries.remove(key);
            None
        }
        None => None,
    }
}

struct LoadGuard<'a, K, V>
where
    K: Clone + Eq + Hash,
    V: Clone,
{
    cache: &'a TtlCache<K, V>,
    key: K,
    in_flight: Arc<Notify>,
    completed: bool,
}

impl<'a, K, V> LoadGuard<'a, K, V>
where
    K: Clone + Eq + Hash,
    V: Clone,
{
    fn new(cache: &'a TtlCache<K, V>, key: K, in_flight: Arc<Notify>) -> Self {
        Self {
            cache,
            key,
            in_flight,
            completed: false,
        }
    }

    fn complete(mut self, value: V) {
        let mut state = self.cache.lock_state();
        let is_current_load = state
            .in_flight
            .get(&self.key)
            .is_some_and(|in_flight| Arc::ptr_eq(in_flight, &self.in_flight));

        if is_current_load {
            remove_expired(&mut state.entries);
            if state.entries.len() >= self.cache.inner.capacity {
                remove_earliest_expiring(&mut state.entries);
            }
            state.entries.insert(
                self.key.clone(),
                CacheEntry {
                    value,
                    expires_at: Instant::now() + self.cache.inner.ttl,
                },
            );
            state.in_flight.remove(&self.key);
        }
        drop(state);

        self.completed = true;
        self.in_flight.notify_waiters();
    }
}

impl<K, V> Drop for LoadGuard<'_, K, V>
where
    K: Clone + Eq + Hash,
    V: Clone,
{
    fn drop(&mut self) {
        if self.completed {
            return;
        }

        let mut state = self.cache.lock_state();
        let is_current_load = state
            .in_flight
            .get(&self.key)
            .is_some_and(|in_flight| Arc::ptr_eq(in_flight, &self.in_flight));
        if is_current_load {
            state.in_flight.remove(&self.key);
        }
        drop(state);
        self.in_flight.notify_waiters();
    }
}

fn remove_expired<K, V>(entries: &mut HashMap<K, CacheEntry<V>>) {
    let now = Instant::now();
    entries.retain(|_, entry| entry.expires_at > now);
}

fn remove_earliest_expiring<K, V>(entries: &mut HashMap<K, CacheEntry<V>>)
where
    K: Clone + Eq + Hash,
{
    if let Some(key) = entries
        .iter()
        .min_by_key(|(_, entry)| entry.expires_at)
        .map(|(key, _)| key.clone())
    {
        entries.remove(&key);
    }
}
