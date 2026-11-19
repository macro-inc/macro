use std::sync::Arc;
use std::time::Duration;

use tokio::time::Instant;
use uuid::Uuid;

use super::*;
use crate::domain::model::{EntityId, EntityType, Presence, SearchQuery, Token};

#[derive(Debug, thiserror::Error)]
#[error("search is down")]
struct Down;

type Answer = dyn Fn(&SearchQuery, Duration) -> Result<Vec<EntityId>, Down> + Send + Sync;

/// Answers each query from how long ago the write was acknowledged.
struct ScriptedSearch {
    written_at: Instant,
    answer: Arc<Answer>,
}

impl Search for ScriptedSearch {
    type Err = Down;

    async fn hits(&self, query: &SearchQuery) -> Result<Vec<EntityId>, Down> {
        (self.answer)(query, Instant::now() - self.written_at)
    }
}

const ENTITY: EntityId = EntityId(Uuid::from_u128(7));

fn text(token: &Token) -> SearchQuery {
    SearchQuery::Text {
        entity_type: EntityType::Document,
        token: token.clone(),
    }
}

fn check(token: &Token, presence: Presence) -> Check {
    Check {
        query: text(token),
        entity_id: ENTITY,
        presence,
    }
}

/// Watches `checks` against `answer`, starting at the write.
async fn watch_with(
    checks: &[Check],
    answer: impl Fn(&SearchQuery, Duration) -> Result<Vec<EntityId>, Down> + Send + Sync + 'static,
) -> Watched {
    let written_at = Instant::now();
    let search = ScriptedSearch {
        written_at,
        answer: Arc::new(answer),
    };
    watch(&search, checks, Schedule::PRODUCTION, written_at).await
}

#[tokio::test(start_paused = true)]
async fn a_change_already_searchable_is_seen_on_the_first_poll() {
    let token = Token::random();

    let watched = watch_with(&[check(&token, Presence::Present)], |_, _| Ok(vec![ENTITY])).await;

    assert_eq!(
        watched,
        Watched {
            outcome: Outcome::Seen(Duration::ZERO),
            polls: 1,
            failed_polls: 0,
        }
    );
}

#[tokio::test(start_paused = true)]
async fn the_first_minute_is_polled_every_second() {
    let token = Token::random();

    let watched = watch_with(&[check(&token, Presence::Present)], |_, elapsed| {
        Ok(if elapsed >= Duration::from_millis(2_500) {
            vec![ENTITY]
        } else {
            vec![]
        })
    })
    .await;

    assert_eq!(
        watched,
        Watched {
            outcome: Outcome::Seen(Duration::from_secs(3)),
            polls: 4,
            failed_polls: 0,
        }
    );
}

#[tokio::test(start_paused = true)]
async fn after_a_minute_polls_come_every_five_seconds() {
    let token = Token::random();

    let watched = watch_with(&[check(&token, Presence::Present)], |_, elapsed| {
        Ok(if elapsed >= Duration::from_secs(61) {
            vec![ENTITY]
        } else {
            vec![]
        })
    })
    .await;

    // 0 s to 60 s every second, then 65 s: past the target, so late.
    assert_eq!(
        watched,
        Watched {
            outcome: Outcome::Late(Duration::from_secs(65)),
            polls: 62,
            failed_polls: 0,
        }
    );
}

#[tokio::test(start_paused = true)]
async fn a_change_never_searchable_is_unseen_after_five_minutes() {
    let token = Token::random();
    let started = Instant::now();

    let watched = watch_with(&[check(&token, Presence::Present)], |_, _| Ok(vec![])).await;

    // 61 polls in the first minute, then 65 s to 300 s every 5 s.
    assert_eq!(
        watched,
        Watched {
            outcome: Outcome::Unseen,
            polls: 61 + 48,
            failed_polls: 0,
        }
    );
    assert_eq!(Instant::now() - started, Duration::from_secs(300));
}

#[tokio::test(start_paused = true)]
async fn an_edit_is_seen_only_once_the_replaced_token_stops_matching() {
    let new = Token::random();
    let old = Token::random();
    let checks = [
        check(&new, Presence::Present),
        check(&old, Presence::Absent),
    ];

    let watched = watch_with(&checks, {
        let old = old.clone();
        move |query, elapsed| {
            let SearchQuery::Text { token, .. } = query else {
                return Ok(vec![]);
            };
            let still_old = *token == old && elapsed < Duration::from_secs(10);
            let new_now = *token != old;
            Ok(if still_old || new_now {
                vec![ENTITY]
            } else {
                vec![]
            })
        }
    })
    .await;

    assert_eq!(watched.outcome, Outcome::Seen(Duration::from_secs(10)));
}

#[tokio::test(start_paused = true)]
async fn a_delete_is_seen_once_the_entity_matches_nothing() {
    let token = Token::random();

    let watched = watch_with(&[check(&token, Presence::Absent)], |_, elapsed| {
        Ok(if elapsed < Duration::from_secs(4) {
            vec![ENTITY]
        } else {
            vec![]
        })
    })
    .await;

    assert_eq!(watched.outcome, Outcome::Seen(Duration::from_secs(4)));
}

#[tokio::test(start_paused = true)]
async fn a_failed_poll_is_retried_at_the_next_one() {
    let token = Token::random();

    let watched = watch_with(&[check(&token, Presence::Present)], |_, elapsed| {
        if elapsed < Duration::from_secs(2) {
            Err(Down)
        } else {
            Ok(vec![ENTITY])
        }
    })
    .await;

    assert_eq!(
        watched,
        Watched {
            outcome: Outcome::Seen(Duration::from_secs(2)),
            polls: 3,
            failed_polls: 2,
        }
    );
}

#[tokio::test(start_paused = true)]
async fn a_search_outage_ends_the_round_after_30_seconds_of_failures() {
    let token = Token::random();
    let started = Instant::now();

    let watched = watch_with(&[check(&token, Presence::Present)], |_, _| Err(Down)).await;

    // A round a minute fails during an outage, rather than one in five.
    assert_eq!(
        watched,
        Watched {
            outcome: Outcome::SearchFailed,
            polls: 31,
            failed_polls: 31,
        }
    );
    assert_eq!(Instant::now() - started, Duration::from_secs(30));
}

#[tokio::test(start_paused = true)]
async fn a_round_whose_last_poll_failed_is_a_search_failure_not_a_miss() {
    let token = Token::random();

    let watched = watch_with(&[check(&token, Presence::Present)], |_, elapsed| {
        if elapsed >= Duration::from_secs(290) {
            Err(Down)
        } else {
            Ok(vec![])
        }
    })
    .await;

    assert_eq!(watched.outcome, Outcome::SearchFailed);
    assert_eq!(watched.failed_polls, 3);
}

#[tokio::test(start_paused = true)]
async fn a_short_search_outage_does_not_end_the_round() {
    let token = Token::random();

    let watched = watch_with(&[check(&token, Presence::Present)], |_, elapsed| {
        if elapsed < Duration::from_secs(20) {
            Err(Down)
        } else {
            Ok(vec![])
        }
    })
    .await;

    assert_eq!(
        watched,
        Watched {
            outcome: Outcome::Unseen,
            polls: 61 + 48,
            failed_polls: 20,
        }
    );
}

#[tokio::test(start_paused = true)]
async fn a_change_shown_at_the_target_is_seen_not_late() {
    let token = Token::random();

    let watched = watch_with(&[check(&token, Presence::Present)], |_, elapsed| {
        Ok(if elapsed >= Duration::from_secs(60) {
            vec![ENTITY]
        } else {
            vec![]
        })
    })
    .await;

    assert_eq!(watched.outcome, Outcome::Seen(Duration::from_secs(60)));
}

#[tokio::test(start_paused = true)]
async fn a_recall_round_polls_every_five_seconds() {
    let token = Token::random();
    let written_at = Instant::now();
    let search = ScriptedSearch {
        written_at,
        answer: Arc::new(|_: &SearchQuery, _| Ok(vec![])),
    };

    let watched = watch(
        &search,
        &[check(&token, Presence::Present)],
        Schedule::RECALL,
        written_at,
    )
    .await;

    // 0 s to 300 s every 5 s.
    assert_eq!(watched.polls, 61);
    assert_eq!(watched.outcome, Outcome::Unseen);
}
