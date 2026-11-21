//! A per-endpoint circuit for transport outages, never credential refusals.
use crate::domain::models::Error;
use std::{
    collections::BTreeMap,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

#[derive(Default)]
struct State {
    in_flight: usize,
    last_seen: Option<Instant>,
    failures: u8,
    last_failure: Option<Instant>,
    open_until: Option<Instant>,
    probe_in_flight: bool,
}
#[derive(Clone, Default)]
pub(super) struct Health(Arc<Mutex<BTreeMap<String, State>>>);
impl Health {
    fn admit_at(&self, key: &str, now: Instant) -> Result<(), Error> {
        let mut states = self.0.lock().map_err(|_| Error::ConnectionUnavailable)?;
        states.retain(|_, state| {
            state.in_flight > 0
                || state.probe_in_flight
                || state.open_until.is_some_and(|until| until > now)
                || state.last_seen.is_some_and(|last| {
                    now.saturating_duration_since(last) < Duration::from_secs(3600)
                })
        });
        if states.len() >= 4096 && !states.contains_key(key) {
            return Err(Error::Throttled);
        }
        let state = states.entry(key.into()).or_default();
        if let Some(until) = state.open_until {
            if now < until || state.probe_in_flight {
                return Err(Error::Throttled);
            }
            state.probe_in_flight = true;
        }
        state.in_flight = state.in_flight.saturating_add(1);
        state.last_seen = Some(now);
        Ok(())
    }
    fn report_at(&self, key: &str, now: Instant, success: bool) {
        let Ok(mut states) = self.0.lock() else {
            return;
        };
        let state = states.entry(key.into()).or_default();
        state.in_flight = state.in_flight.saturating_sub(1);
        state.last_seen = Some(now);
        if success {
            *state = State {
                in_flight: state.in_flight,
                last_seen: Some(now),
                ..State::default()
            };
            return;
        }
        let previous_open = state.open_until.is_some();
        if state
            .last_failure
            .is_none_or(|last| now.saturating_duration_since(last) > Duration::from_secs(60))
            && !previous_open
        {
            state.failures = 0;
        }
        state.failures = state.failures.saturating_add(1);
        state.last_failure = Some(now);
        state.probe_in_flight = false;
        if state.failures >= 5 || previous_open {
            let multiplier = 1u64 << state.failures.saturating_sub(5).min(4);
            state.open_until = Some(now + Duration::from_secs((60 * multiplier).min(900)));
        }
    }
    pub(super) fn admit(&self, key: String) -> Result<Attempt, Error> {
        self.admit_at(&key, Instant::now())?;
        Ok(Attempt {
            health: self.clone(),
            key,
            finished: false,
        })
    }
}
pub(super) struct Attempt {
    health: Health,
    key: String,
    finished: bool,
}
impl Attempt {
    pub(super) fn success(mut self) {
        self.health.report_at(&self.key, Instant::now(), true);
        self.finished = true;
    }
    pub(super) fn ignore(mut self) {
        if let Ok(mut states) = self.health.0.lock()
            && let Some(state) = states.get_mut(&self.key)
        {
            state.probe_in_flight = false;
            state.in_flight = state.in_flight.saturating_sub(1);
            state.last_seen = Some(Instant::now());
        }
        self.finished = true;
    }
}
impl Drop for Attempt {
    fn drop(&mut self) {
        if !self.finished {
            self.health.report_at(&self.key, Instant::now(), false);
        }
    }
}

#[cfg(test)]
mod test;
