use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tokio::time::Instant;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use super::*;
use crate::domain::model::{
    Change, Check, EntityId, EntityType, Operation, Presence, SearchQuery, Token,
};
use crate::domain::ports::WriteFailed;

const ENTITY: EntityId = EntityId(Uuid::from_u128(3));

#[derive(Debug, thiserror::Error)]
#[error("the API refused the write")]
struct Refused;

/// Edits one document every round, or fails every write when `fails` is set,
/// and notes when each write started.
#[derive(Clone)]
struct EditEveryRound {
    fails: bool,
    writes: Arc<Mutex<Vec<Instant>>>,
    cleaned_up: Arc<AtomicBool>,
}

impl EditEveryRound {
    fn new(fails: bool) -> Self {
        Self {
            fails,
            writes: Arc::default(),
            cleaned_up: Arc::default(),
        }
    }

    fn write_times(&self, since: Instant) -> Vec<Duration> {
        let writes = self.writes.lock().expect("writes lock");
        writes.iter().map(|at| *at - since).collect()
    }
}

impl Rotation for EditEveryRound {
    fn entity_type(&self) -> EntityType {
        EntityType::Document
    }

    async fn change(&mut self) -> Result<Change, WriteFailed> {
        self.writes
            .lock()
            .expect("writes lock")
            .push(Instant::now());
        if self.fails {
            return Err(WriteFailed {
                operation: Operation::Delete,
                error: Box::new(Refused),
            });
        }
        Ok(Change {
            operation: Operation::Edit,
            entity_id: ENTITY,
            checks: vec![Check {
                query: SearchQuery::Text {
                    entity_type: EntityType::Document,
                    token: Token::random(),
                },
                entity_id: ENTITY,
                presence: Presence::Present,
            }],
        })
    }

    async fn clean_up(&mut self) {
        self.cleaned_up.store(true, Ordering::SeqCst);
    }
}

/// Shows every change at once, or never.
struct FixedSearch {
    shows: bool,
}

impl Search for FixedSearch {
    type Err = Refused;

    async fn hits(&self, _: &SearchQuery) -> Result<Vec<EntityId>, Refused> {
        Ok(if self.shows { vec![ENTITY] } else { vec![] })
    }
}

#[derive(Clone, Default)]
struct Recorded(Arc<Mutex<Vec<Round>>>);

impl RoundSink for Recorded {
    fn record(&self, round: Round) {
        self.0.lock().expect("rounds lock").push(round);
    }
}

impl Recorded {
    fn rounds(&self) -> Vec<Round> {
        self.0.lock().expect("rounds lock").clone()
    }
}

/// Runs the probe for `rotation` against `search` until `stop_after`.
async fn run_until(rotation: EditEveryRound, shows: bool, stop_after: Duration) -> Recorded {
    let recorded = Recorded::default();
    let shutdown = CancellationToken::new();
    tokio::spawn({
        let shutdown = shutdown.clone();
        async move {
            tokio::time::sleep(stop_after).await;
            shutdown.cancel();
        }
    });
    run(
        rotation,
        FixedSearch { shows },
        recorded.clone(),
        Schedule::PRODUCTION,
        PERIOD,
        shutdown,
    )
    .await;
    recorded
}

#[tokio::test(start_paused = true)]
async fn a_round_runs_every_period_until_shutdown_then_the_probe_cleans_up() {
    let rotation = EditEveryRound::new(false);
    let started = Instant::now();

    let recorded = run_until(rotation.clone(), true, Duration::from_secs(150)).await;

    let seen = Round {
        entity_type: EntityType::Document,
        operation: Operation::Edit,
        outcome: Outcome::Seen(Duration::ZERO),
    };
    assert_eq!(recorded.rounds(), vec![seen; 3]);
    assert_eq!(
        rotation.write_times(started),
        [0, 60, 120].map(Duration::from_secs)
    );
    assert!(rotation.cleaned_up.load(Ordering::SeqCst));
}

#[tokio::test(start_paused = true)]
async fn a_failed_write_is_recorded_with_the_operation_it_attempted() {
    let recorded = run_until(EditEveryRound::new(true), true, Duration::from_secs(30)).await;

    assert_eq!(
        recorded.rounds(),
        vec![Round {
            entity_type: EntityType::Document,
            operation: Operation::Delete,
            outcome: Outcome::WriteFailed,
        }]
    );
}

#[tokio::test(start_paused = true)]
async fn a_shutdown_while_searching_records_nothing_and_still_cleans_up() {
    let rotation = EditEveryRound::new(false);

    let recorded = run_until(rotation.clone(), false, Duration::from_secs(30)).await;

    assert_eq!(recorded.rounds(), vec![]);
    assert!(rotation.cleaned_up.load(Ordering::SeqCst));
}

#[tokio::test(start_paused = true)]
async fn a_round_that_overruns_the_period_delays_the_next_one() {
    let rotation = EditEveryRound::new(false);
    let started = Instant::now();

    let recorded = run_until(rotation.clone(), false, Duration::from_secs(350)).await;

    assert_eq!(
        recorded.rounds(),
        vec![Round {
            entity_type: EntityType::Document,
            operation: Operation::Edit,
            outcome: Outcome::Unseen,
        }]
    );
    assert_eq!(
        rotation.write_times(started),
        [0, 300].map(Duration::from_secs)
    );
}
