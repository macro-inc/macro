//! Reconcile enrolled brain units and retain their latest turn observation.

use std::collections::BTreeMap;
use std::num::NonZeroU16;
use std::time::{Duration, Instant};

use chrono::{DateTime, Utc};
use futures::{FutureExt as _, StreamExt as _, stream};
use harnesses::domain::models::PersonaHealth;

#[cfg(test)]
mod test;

/// No credentials cross the privileged discovery boundary.
pub(crate) type Personas = BTreeMap<String, Option<NonZeroU16>>;
const CONCURRENCY: usize = 8;
const INITIAL_BACKOFF: u64 = 5;
const MAX_BACKOFF: u64 = 300;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum UnitState {
    Active,
    Stopped,
    Failed,
    Transitioning,
    Missing,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum UnitAction {
    Start,
    Restart,
}

pub(crate) trait UnitController: Sync {
    type Err: std::error::Error + Send + Sync + 'static;

    fn state(&self, os_user: &str) -> impl Future<Output = Result<UnitState, Self::Err>> + Send;
    fn apply(
        &self,
        os_user: &str,
        action: UnitAction,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;
}

pub(crate) trait HealthProbe: Sync {
    fn probe(
        &self,
        port: NonZeroU16,
        checked_at: DateTime<Utc>,
    ) -> impl Future<Output = PersonaHealth> + Send;
}

pub(crate) fn valid_os_user(name: &str) -> bool {
    name != "root"
        && name != "macro"
        && lazy_regex::regex_is_match!(r"^[a-z_][a-z0-9_-]{0,30}$", name)
}

pub(crate) struct Supervisor<Units, Health> {
    units: Units,
    health: Health,
    personas: BTreeMap<String, Observation>,
}

impl<Units: UnitController, Health: HealthProbe> Supervisor<Units, Health> {
    pub(crate) fn new(units: Units, health: Health) -> Self {
        Self {
            units,
            health,
            personas: BTreeMap::new(),
        }
    }

    #[tracing::instrument(name = "macrod.personas.reconcile", skip_all, fields(persona_count = config.len()))]
    pub(crate) async fn snapshot(
        &mut self,
        config: &Personas,
        now: Instant,
        checked_at: DateTime<Utc>,
    ) -> BTreeMap<String, PersonaHealth> {
        self.personas.retain(|name, _| config.contains_key(name));
        for name in config.keys() {
            self.personas.entry(name.clone()).or_default();
        }
        let units = &self.units;
        let health = &self.health;
        let pending: Vec<_> = self
            .personas
            .iter_mut()
            .map(|(name, observation)| {
                async move {
                    let report = observation
                        .check(
                            name,
                            config.get(name).copied().flatten(),
                            units,
                            health,
                            now,
                            checked_at,
                        )
                        .await;
                    (name.clone(), report)
                }
                .boxed()
            })
            .collect();
        stream::iter(pending)
            .buffer_unordered(CONCURRENCY)
            .collect()
            .await
    }
}

#[derive(Default)]
struct Observation {
    failures: u8,
    retry_at: Option<Instant>,
    last_turn_at: Option<DateTime<Utc>>,
}

impl Observation {
    async fn check<Units: UnitController, Health: HealthProbe>(
        &mut self,
        name: &str,
        port: Option<NonZeroU16>,
        units: &Units,
        health: &Health,
        now: Instant,
        checked_at: DateTime<Utc>,
    ) -> PersonaHealth {
        if !valid_os_user(name) {
            return self.unhealthy(checked_at, "invalid persona OS username");
        }
        let Some(port) = port else {
            return self.unhealthy(checked_at, "BRAIN_HEALTH_PORT is missing or invalid");
        };
        let state = match units.state(name).await {
            Ok(state) => state,
            Err(_) => return self.unhealthy(checked_at, "could not inspect the brain unit"),
        };
        match state {
            UnitState::Missing => return self.missing(checked_at, "brain unit is not installed"),
            UnitState::Transitioning => {
                return self.missing(checked_at, "brain unit is starting or stopping");
            }
            UnitState::Stopped | UnitState::Failed => {
                if self.retry_at.is_some_and(|retry| now < retry) {
                    return self.missing(checked_at, "brain unit restart is backing off");
                }
                let delay = INITIAL_BACKOFF
                    .saturating_mul(1u64 << self.failures.min(6))
                    .min(MAX_BACKOFF);
                self.retry_at = Some(now + Duration::from_secs(delay));
                self.failures = self.failures.saturating_add(1);
                let action = if state == UnitState::Failed {
                    UnitAction::Restart
                } else {
                    UnitAction::Start
                };
                if units.apply(name, action).await.is_err() {
                    return self.unhealthy(checked_at, "could not start the brain unit");
                }
            }
            UnitState::Active => {}
        }
        let mut report = health.probe(port, checked_at).await;
        let last_turn_at = match &mut report {
            PersonaHealth::Healthy { last_turn_at, .. }
            | PersonaHealth::Unhealthy { last_turn_at, .. }
            | PersonaHealth::Missing { last_turn_at, .. } => last_turn_at,
        };
        // An unavailable brain, or a new process with no completed turn,
        // must not erase the previous completed turn.
        self.last_turn_at = (*last_turn_at).or(self.last_turn_at);
        *last_turn_at = self.last_turn_at;
        if matches!(report, PersonaHealth::Healthy { .. }) {
            self.failures = 0;
            self.retry_at = None;
        }
        report
    }

    fn unhealthy(&self, checked_at: DateTime<Utc>, error: &str) -> PersonaHealth {
        PersonaHealth::Unhealthy {
            checked_at,
            last_error: error.to_owned(),
            last_turn_at: self.last_turn_at,
        }
    }

    fn missing(&self, checked_at: DateTime<Utc>, error: &str) -> PersonaHealth {
        PersonaHealth::Missing {
            checked_at,
            last_error: error.to_owned(),
            last_turn_at: self.last_turn_at,
        }
    }
}
