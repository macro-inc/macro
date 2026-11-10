//! Page turns: one server task's page slots, shared among its open streams.

#[cfg(test)]
mod test;

use std::{
    collections::{BTreeMap, HashMap},
    hash::Hash,
    sync::{Arc, Mutex, MutexGuard, PoisonError},
    time::Duration,
};
use tokio::{sync::oneshot, time::Instant};

/// How long a key's page time is remembered after its last page. A user's
/// streams follow each other within seconds, so the time carries over from
/// one to the next. A key that got no page for this long counts as new, which
/// also bounds how long a long sync is held back by shorter ones.
const SERVED_MEMORY: Duration = Duration::from_secs(5 * 60);

/// Runs at most a fixed number of pages at once across every stream of a
/// server task. While streams wait, a freed slot goes to the key (user) whose
/// pages took the least time recently. Every user gets the same share of the
/// slots' time whatever their pages cost, so a small sync, and the first
/// pages of any sync, finish ahead of a long one instead of waiting behind it.
#[derive(Debug)]
pub struct PageTurns<K> {
    shared: Arc<Mutex<Shared<K>>>,
}

/// The turns of one stream. Every stream of a key shares the key's page time.
#[derive(Debug)]
pub struct StreamTurns<K> {
    shared: Arc<Mutex<Shared<K>>>,
    key: K,
}

/// One page's slot. Dropping it charges the page's time to its key and passes
/// the slot to the next waiting stream.
#[derive(Debug)]
pub struct PageTurn<K: Hash + Eq> {
    shared: Arc<Mutex<Shared<K>>>,
    key: K,
    started: Instant,
}

#[derive(Debug)]
struct Shared<K> {
    /// Slots no page holds. Above zero only while no stream waits.
    free: usize,
    /// Streams waiting for a slot; the first entry goes next.
    waiting: BTreeMap<Position, oneshot::Sender<()>>,
    /// Waits started so far: the next wait's `arrival`.
    arrivals: u64,
    /// The time each key's pages took, while remembered.
    served: HashMap<K, Served>,
}

/// A waiting stream's place: least page time first, then first come.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
struct Position {
    served: Duration,
    arrival: u64,
}

#[derive(Debug, Clone, Copy)]
struct Served {
    /// The time the key's pages held a slot.
    time: Duration,
    last_page: Instant,
}

impl<K: Hash + Eq + Clone> PageTurns<K> {
    /// Turns over `slots` page slots.
    pub fn new(slots: usize) -> Self {
        Self {
            shared: Arc::new(Mutex::new(Shared {
                free: slots,
                waiting: BTreeMap::new(),
                arrivals: 0,
                served: HashMap::new(),
            })),
        }
    }

    /// The turns of a new stream of `key`.
    pub fn stream(&self, key: K) -> StreamTurns<K> {
        let now = Instant::now();
        lock(&self.shared)
            .served
            .retain(|_, served| served.remembered(now));

        StreamTurns {
            shared: Arc::clone(&self.shared),
            key,
        }
    }
}

impl<K: Hash + Eq + Clone> StreamTurns<K> {
    /// Waits for a slot for this stream's next page.
    ///
    /// Dropping the wait leaves the queue. Asking again loses nothing: a
    /// stream's place depends on its key's page time, not on when it asked.
    pub async fn next(&self) -> PageTurn<K> {
        self.slot().await;

        let started = Instant::now();
        let mut shared = lock(&self.shared);
        let time = shared.served(&self.key, started);
        // Kept from here so that the page's end finds the key to charge.
        shared.served.insert(
            self.key.clone(),
            Served {
                time,
                last_page: started,
            },
        );

        PageTurn {
            shared: Arc::clone(&self.shared),
            key: self.key.clone(),
            started,
        }
    }

    /// Takes a free slot, or waits in line for one.
    async fn slot(&self) {
        loop {
            let mut wait = {
                let mut shared = lock(&self.shared);
                if shared.free > 0 {
                    shared.free -= 1;
                    return;
                }

                let position = Position {
                    served: shared.served(&self.key, Instant::now()),
                    arrival: shared.arrivals,
                };
                shared.arrivals = shared.arrivals.saturating_add(1);
                let (sender, receiver) = oneshot::channel();
                shared.waiting.insert(position, sender);

                Wait {
                    shared: &self.shared,
                    position,
                    receiver,
                }
            };

            if (&mut wait.receiver).await.is_ok() {
                return;
            }
        }
    }
}

impl<K> Shared<K>
where
    K: Hash + Eq,
{
    /// The time `key`'s recent pages took.
    fn served(&self, key: &K, now: Instant) -> Duration {
        self.served
            .get(key)
            .filter(|served| served.remembered(now))
            .map_or(Duration::ZERO, |served| served.time)
    }
}

impl Served {
    fn remembered(&self, now: Instant) -> bool {
        now.saturating_duration_since(self.last_page) < SERVED_MEMORY
    }
}

/// A stream's place in line. Dropping it leaves the line, and frees a slot
/// that was handed over but never taken.
struct Wait<'a, K> {
    shared: &'a Mutex<Shared<K>>,
    position: Position,
    receiver: oneshot::Receiver<()>,
}

impl<K> Drop for Wait<'_, K> {
    fn drop(&mut self) {
        self.receiver.close();
        let handed_over = self.receiver.try_recv().is_ok();

        let mut shared = lock(self.shared);
        shared.waiting.remove(&self.position);
        if handed_over {
            shared.release();
        }
    }
}

impl<K: Hash + Eq> Drop for PageTurn<K> {
    fn drop(&mut self) {
        let now = Instant::now();
        let mut shared = lock(&self.shared);
        if let Some(served) = shared.served.get_mut(&self.key) {
            served.time = served
                .time
                .saturating_add(now.saturating_duration_since(self.started));
            served.last_page = now;
        }
        shared.release();
    }
}

impl<K> Shared<K> {
    /// Hands a slot to the first stream still waiting, or frees it.
    fn release(&mut self) {
        while let Some((_, waiter)) = self.waiting.pop_first() {
            if waiter.send(()).is_ok() {
                return;
            }
        }

        self.free = self.free.saturating_add(1);
    }
}

fn lock<K>(shared: &Mutex<Shared<K>>) -> MutexGuard<'_, Shared<K>> {
    shared.lock().unwrap_or_else(PoisonError::into_inner)
}
