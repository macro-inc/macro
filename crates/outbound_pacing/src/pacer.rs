use std::{
    collections::HashMap,
    future::Future,
    hash::Hash,
    num::NonZeroU32,
    sync::{Mutex, PoisonError},
    time::Duration,
};

use governor::{
    Quota, RateLimiter, clock::Clock, middleware::NoOpMiddleware,
    state::keyed::DefaultKeyedStateStore,
};
use tokio::time::Instant;

#[cfg(test)]
mod test;

/// Keys tracked before idle ones are forgotten.
const TRACKED_KEYS: usize = 10_000;

/// How a [`Pacer`] spaces and holds calls.
#[derive(Debug, Clone, Copy)]
pub struct PacingConfig {
    /// Calls each key may make a minute.
    pub per_minute: NonZeroU32,
    /// Calls each key may make at once before pacing starts.
    pub burst: NonZeroU32,
    /// The longest a call waits for its turn or for its key to be accepted
    /// again. Past it, the call fails at once.
    pub max_hold: Duration,
    /// How long a key is held back after a throttled answer that named no
    /// wait.
    pub unnamed_wait: Duration,
}

/// What the provider answered to one attempt.
#[derive(Debug)]
pub enum Answer<T> {
    /// The provider accepted the call.
    Accepted(T),
    /// The provider refused the call for its rate limit.
    Throttled {
        /// How long the provider asked to wait, when it said.
        retry_after: Option<Duration>,
    },
}

/// The call was not made, or the provider kept refusing it, for its rate
/// limit.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[error("rate limited")]
pub struct Throttled {
    /// How long until the key may call again, when known.
    pub retry_after: Option<Duration>,
}

/// Why [`Pacer::call`] gave up.
#[derive(Debug, PartialEq, Eq, thiserror::Error)]
pub enum PaceError<E> {
    /// Rate limited.
    #[error(transparent)]
    Throttled(Throttled),
    /// The attempt itself failed.
    #[error("attempt failed")]
    Failed(E),
}

/// governor's clock over tokio's, so paused tokio time drives pacing too.
#[derive(Debug, Clone)]
struct TokioClock {
    origin: Instant,
}

impl Clock for TokioClock {
    type Instant = Duration;

    fn now(&self) -> Duration {
        self.origin.elapsed()
    }
}

type KeyedLimiter<Key> =
    RateLimiter<Key, DefaultKeyedStateStore<Key>, TokioClock, NoOpMiddleware<Duration>>;

/// Paces calls per key. Share one per provider and process.
pub struct Pacer<Key: Hash + Eq + Clone> {
    config: PacingConfig,
    clock: TokioClock,
    limiter: KeyedLimiter<Key>,
    /// Keys the provider has refused, and when it accepts them again.
    blocked_until: Mutex<HashMap<Key, Instant>>,
}

impl<Key: Hash + Eq + Clone> Pacer<Key> {
    /// A pacer with nothing blocked.
    pub fn new(config: PacingConfig) -> Self {
        let clock = TokioClock {
            origin: Instant::now(),
        };
        let quota = Quota::per_minute(config.per_minute).allow_burst(config.burst);
        Self {
            config,
            limiter: RateLimiter::dashmap_with_clock(quota, clock.clone()),
            clock,
            blocked_until: Mutex::new(HashMap::new()),
        }
    }

    /// Holds `key` back for `wait`, as when an accepted answer says the
    /// quota is spent until then.
    pub fn block(&self, key: &Key, wait: Duration) {
        let now = Instant::now();
        let mut blocked_until = self
            .blocked_until
            .lock()
            .unwrap_or_else(PoisonError::into_inner);
        blocked_until.retain(|_, until| *until > now);
        blocked_until.insert(key.clone(), now + wait);
    }

    /// Runs `attempt` in `key`'s turn. A throttled answer holds `key` back;
    /// when its wait is inside [`PacingConfig::max_hold`] the attempt runs
    /// once more after it, otherwise the call fails with the wait.
    pub async fn call<T, E, Attempt, Attempted>(
        &self,
        key: &Key,
        mut attempt: Attempt,
    ) -> Result<T, PaceError<E>>
    where
        Attempt: FnMut() -> Attempted,
        Attempted: Future<Output = Result<Answer<T>, E>>,
    {
        self.wait_turn(key).await.map_err(PaceError::Throttled)?;
        let retry_after = match attempt().await.map_err(PaceError::Failed)? {
            Answer::Accepted(value) => return Ok(value),
            Answer::Throttled { retry_after } => retry_after,
        };
        self.block(key, retry_after.unwrap_or(self.config.unnamed_wait));
        if retry_after.is_none_or(|wait| wait > self.config.max_hold) {
            return Err(PaceError::Throttled(Throttled { retry_after }));
        }

        tracing::debug!(?retry_after, "throttled within the hold; retrying once");
        self.wait_turn(key).await.map_err(PaceError::Throttled)?;
        match attempt().await.map_err(PaceError::Failed)? {
            Answer::Accepted(value) => Ok(value),
            Answer::Throttled { retry_after } => {
                self.block(key, retry_after.unwrap_or(self.config.unnamed_wait));
                Err(PaceError::Throttled(Throttled { retry_after }))
            }
        }
    }

    /// Waits until `key` is accepted again and has a pacing turn, or fails
    /// when either is past the hold.
    async fn wait_turn(&self, key: &Key) -> Result<(), Throttled> {
        let deadline = Instant::now() + self.config.max_hold;
        let blocked_until = self
            .blocked_until
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .get(key)
            .copied();
        if let Some(until) = blocked_until.filter(|until| *until > Instant::now()) {
            if until > deadline {
                return Err(Throttled {
                    retry_after: Some(until - Instant::now()),
                });
            }
            tokio::time::sleep_until(until).await;
        }

        if self.limiter.len() > TRACKED_KEYS {
            self.limiter.retain_recent();
        }
        loop {
            let Err(not_until) = self.limiter.check_key(key) else {
                return Ok(());
            };
            let wait = not_until.wait_time_from(self.clock.now());
            if Instant::now() + wait > deadline {
                return Err(Throttled {
                    retry_after: Some(wait),
                });
            }
            tokio::time::sleep(wait).await;
        }
    }
}
