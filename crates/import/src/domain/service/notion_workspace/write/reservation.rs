//! Bounded source attempts, sustained outage state and terminal link outcomes.

use super::*;
use crate::domain::models::{NOTION_OUTAGE_PREFIX, SourceStopReason};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Observation {
    review_id: Uuid,
    at: DateTime<Utc>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Window {
    first_at: DateTime<Utc>,
    observations: Vec<Observation>,
}

impl Window {
    fn new(review_id: Uuid, at: DateTime<Utc>) -> Self {
        Self {
            first_at: at,
            observations: vec![Observation { review_id, at }],
        }
    }

    fn eligible(&self) -> bool {
        self.observations.len() >= RESERVATION_ATTEMPTS
            && self
                .observations
                .last()
                .is_some_and(|last| last.at - self.first_at >= chrono::Duration::hours(24))
    }

    fn observe(&mut self, review_id: Uuid, now: DateTime<Utc>) -> bool {
        // Re-delivery of a review never advances its timestamp. The storage
        // fence rejects stale reviews; three recent identities bound the state.
        if self
            .observations
            .iter()
            .any(|seen| seen.review_id == review_id)
        {
            return false;
        }
        let Some(last) = self.observations.last().map(|observation| observation.at) else {
            return false;
        };
        if now < last {
            return false;
        }
        if now - last > chrono::Duration::hours(12) {
            *self = Self::new(review_id, now);
        } else {
            if self.observations.len() == RESERVATION_ATTEMPTS {
                self.observations.remove(0);
            }
            self.observations.push(Observation { review_id, at: now });
        }
        true
    }
}

#[derive(Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case", deny_unknown_fields)]
enum Receipt {
    NotionFailure { window: Window },
    Degraded { reason: SourceStopReason },
}

#[derive(Default)]
struct State {
    attempts: usize,
    outage: Option<(String, Window)>,
    degraded: Option<SourceStopReason>,
}

impl<Store: WrittenObjects> Progress<'_, Store> {
    fn reservation_state(&self) -> anyhow::Result<State> {
        let invalid = || SourceStopReason::UnsupportedMarker;
        let mut state = State::default();
        let mut identities = HashSet::new();
        for (object, id) in self.all(WrittenKind::DatabaseReservationFailure) {
            if let Ok(attempt) = Uuid::parse_str(&object) {
                anyhow::ensure!(attempt == id && identities.insert(id), invalid());
                state.attempts += 1;
                continue;
            }
            match serde_json::from_str::<Receipt>(&object).map_err(|_| invalid())? {
                Receipt::NotionFailure { window } => {
                    anyhow::ensure!(
                        state.outage.is_none()
                            && !window.observations.is_empty()
                            && window.observations.len() <= RESERVATION_ATTEMPTS,
                        invalid()
                    );
                    let mut reviews = HashSet::new();
                    let mut previous = window.first_at;
                    for observation in &window.observations {
                        anyhow::ensure!(
                            observation.at >= previous && reviews.insert(observation.review_id),
                            invalid()
                        );
                        previous = observation.at;
                    }
                    anyhow::ensure!(
                        window
                            .observations
                            .windows(2)
                            .all(|pair| pair[1].at - pair[0].at <= chrono::Duration::hours(12)),
                        invalid()
                    );
                    anyhow::ensure!(
                        window
                            .observations
                            .last()
                            .is_some_and(|last| last.review_id == id),
                        invalid()
                    );
                    state.outage = Some((object, window));
                }
                Receipt::Degraded { reason } => {
                    anyhow::ensure!(id == self.import_id && state.degraded.is_none(), invalid());
                    anyhow::ensure!(
                        matches!(
                            reason,
                            SourceStopReason::ReservationRetriesExhausted
                                | SourceStopReason::UnexpectedReservationErrors
                                | SourceStopReason::NotionPersistentFailure
                        ),
                        invalid()
                    );
                    state.degraded = Some(reason);
                }
            }
        }
        anyhow::ensure!(state.attempts <= RESERVATION_ATTEMPTS, invalid());
        Ok(state)
    }

    pub fn reservation_failures(&self) -> anyhow::Result<usize> {
        Ok(self.reservation_state()?.attempts)
    }

    pub fn degraded_reservation(&self) -> anyhow::Result<Option<SourceStopReason>> {
        Ok(self.reservation_state()?.degraded)
    }

    /// Fold only distinct, active reviews into a chain with gaps at most 12h.
    pub async fn prolonged_notion_failure(
        &self,
        now: DateTime<Utc>,
        review_id: Uuid,
    ) -> anyhow::Result<bool> {
        let state = self.reservation_state()?;
        let (expected, window, changed) = match state.outage {
            Some((payload, mut window)) => {
                let changed = window.observe(review_id, now);
                (Some(payload), window, changed)
            }
            None => (None, Window::new(review_id, now), true),
        };
        let eligible = window.eligible();
        tracing::Span::current().record("observations", window.observations.len() as i64);
        let age = window
            .observations
            .last()
            .map(|last| last.at - window.first_at)
            .unwrap_or_default();
        tracing::Span::current().record("age_seconds", age.num_seconds());
        if changed {
            let mut facts = vec![WrittenObject {
                import_id: self.import_id,
                kind: WrittenKind::DatabaseReservationFailure,
                object: serde_json::to_string(&Receipt::NotionFailure { window })?,
                macro_id: review_id,
            }];
            if eligible {
                facts.push(self.degraded_fact(SourceStopReason::NotionPersistentFailure)?);
            }
            self.store
                .replace_database_outage(
                    self.user,
                    self.import_id,
                    review_id,
                    expected.as_deref(),
                    &facts,
                )
                .await?;
            let mut known = self
                .known
                .lock()
                .map_err(|_| anyhow::anyhow!("written marker buffer unavailable"))?;
            known.retain(|(kind, object), _| {
                *kind != WrittenKind::DatabaseReservationFailure
                    || !object.starts_with(NOTION_OUTAGE_PREFIX)
            });
            for fact in facts {
                known.insert((fact.kind, fact.object), fact.macro_id);
            }
        }
        Ok(eligible)
    }

    fn degraded_fact(&self, reason: SourceStopReason) -> anyhow::Result<WrittenObject> {
        Ok(WrittenObject {
            import_id: self.import_id,
            kind: WrittenKind::DatabaseReservationFailure,
            object: serde_json::to_string(&Receipt::Degraded { reason })?,
            macro_id: self.import_id,
        })
    }

    /// Persist before reporting so a crash cannot restart an exhausted budget.
    pub async fn degrade_reservation(&self, reason: SourceStopReason) -> anyhow::Result<()> {
        self.record_all(vec![self.degraded_fact(reason)?]).await
    }
}
