//! Bounded source attempts, long outage observations and terminal link outcomes.

use super::*;
use crate::domain::models::SourceStopReason;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case", deny_unknown_fields)]
enum Receipt {
    NotionFailure { attempt: Uuid, at: DateTime<Utc> },
    Degraded { reason: SourceStopReason },
}

#[derive(Default)]
struct State {
    attempts: usize,
    observations: Vec<DateTime<Utc>>,
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
                Receipt::NotionFailure { attempt, at } => {
                    anyhow::ensure!(attempt == id && identities.insert(id), invalid());
                    state.observations.push(at);
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
        anyhow::ensure!(
            state.attempts <= RESERVATION_ATTEMPTS
                && state.observations.len() <= RESERVATION_ATTEMPTS,
            invalid()
        );
        Ok(state)
    }

    /// Only validated source attempts spend the consecutive source budget.
    pub fn reservation_failures(&self) -> anyhow::Result<usize> {
        Ok(self.reservation_state()?.attempts)
    }

    /// A terminal outcome is sticky for this generation, even on a new review.
    pub fn degraded_reservation(&self) -> anyhow::Result<Option<SourceStopReason>> {
        Ok(self.reservation_state()?.degraded)
    }

    /// Observe at most three failures; a current failure proves the last timestamp.
    pub async fn prolonged_notion_failure(&self, now: DateTime<Utc>) -> anyhow::Result<bool> {
        let mut state = self.reservation_state()?;
        if state.observations.len() < RESERVATION_ATTEMPTS {
            let attempt = Uuid::now_v7();
            self.record_all(vec![WrittenObject {
                import_id: self.import_id,
                kind: WrittenKind::DatabaseReservationFailure,
                object: serde_json::to_string(&Receipt::NotionFailure { attempt, at: now })?,
                macro_id: attempt,
            }])
            .await?;
            state.observations.push(now);
        }
        let age = state
            .observations
            .iter()
            .min()
            .map(|first| now.signed_duration_since(*first))
            .unwrap_or_default();
        tracing::Span::current().record("observations", state.observations.len() as i64);
        tracing::Span::current().record("age_seconds", age.num_seconds());
        Ok(state.observations.len() >= RESERVATION_ATTEMPTS && age >= chrono::Duration::hours(24))
    }

    /// Persist before reporting so a crash cannot restart an exhausted budget.
    pub async fn degrade_reservation(&self, reason: SourceStopReason) -> anyhow::Result<()> {
        self.record_all(vec![WrittenObject {
            import_id: self.import_id,
            kind: WrittenKind::DatabaseReservationFailure,
            object: serde_json::to_string(&Receipt::Degraded { reason })?,
            macro_id: self.import_id,
        }])
        .await
    }
}
