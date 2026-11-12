//! Client-side pacing per method: Slack's tiers as a token bucket (GCRA),
//! plus `Retry-After` holds.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

use tokio::time::Instant;

use crate::method::SlackMethod;

/// Paces calls per method so a burst of work stays inside Slack's tier.
#[derive(Default)]
pub(crate) struct Pacer {
    // Theoretical arrival time of the next call, per method.
    next_arrival: Mutex<HashMap<SlackMethod, Instant>>,
}

impl Pacer {
    /// Reserves a slot for one call and returns how long to wait for it.
    pub(crate) fn reserve(&self, method: SlackMethod) -> Duration {
        let Some(interval) = method.tier().interval() else {
            return Duration::ZERO;
        };
        let burst = method.tier().per_minute().map_or(1, |per_minute| (per_minute / 4).max(1));
        let tolerance = interval * (burst - 1);
        let now = Instant::now();

        let mut next_arrival = match self.next_arrival.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        let arrival = next_arrival.entry(method).or_insert(now);
        let theoretical = (*arrival).max(now);
        let wait = theoretical.saturating_duration_since(now + tolerance);
        *arrival = theoretical + interval;
        wait
    }

    /// Holds every call of `method` until `retry_after` has passed.
    pub(crate) fn hold(&self, method: SlackMethod, retry_after: Duration) {
        let Some(interval) = method.tier().interval() else {
            return;
        };
        let burst = method.tier().per_minute().map_or(1, |per_minute| (per_minute / 4).max(1));
        let tolerance = interval * (burst - 1);
        let held_until = Instant::now() + retry_after + tolerance;

        let mut next_arrival = match self.next_arrival.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        let arrival = next_arrival.entry(method).or_insert(held_until);
        *arrival = (*arrival).max(held_until);
    }
}
