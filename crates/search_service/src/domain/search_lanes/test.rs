use super::*;
use std::sync::Arc;
use std::time::Duration;

const AGENT: Uuid = Uuid::from_u128(0xA9E7);

fn lanes() -> Arc<SearchLanes> {
    Arc::new(SearchLanes::new(LanePolicy {
        app_concurrency: 2,
        concurrency: 2,
        max_wait: Duration::from_secs(20),
    }))
}

fn agent_of(user: &str) -> SearchCaller {
    SearchCaller::new(user, SearchActor::Agent(AGENT))
}

#[tokio::test(start_paused = true)]
async fn a_callers_third_search_waits_for_one_of_its_first_two_to_end() {
    let lanes = lanes();
    let first = lanes
        .take_turn(agent_of("macro|a@example.com"))
        .await
        .unwrap();
    let second = lanes
        .take_turn(agent_of("macro|a@example.com"))
        .await
        .unwrap();
    assert!(!first.queued);
    assert!(!second.queued);

    let mut third = tokio::spawn({
        let lanes = Arc::clone(&lanes);
        async move { lanes.take_turn(agent_of("macro|a@example.com")).await }
    });
    assert!(
        tokio::time::timeout(Duration::from_secs(5), &mut third)
            .await
            .is_err()
    );

    drop(first);
    let third = third.await.unwrap().unwrap();
    assert!(third.queued);
    assert_eq!(third.waited, Duration::from_secs(5));
}

#[tokio::test(start_paused = true)]
async fn a_person_never_waits_behind_their_own_agent() {
    let lanes = lanes();
    let _first = lanes
        .take_turn(agent_of("macro|a@example.com"))
        .await
        .unwrap();
    let _second = lanes
        .take_turn(agent_of("macro|a@example.com"))
        .await
        .unwrap();
    let waiting = tokio::spawn({
        let lanes = Arc::clone(&lanes);
        async move { lanes.take_turn(agent_of("macro|a@example.com")).await }
    });

    let own = lanes
        .take_turn(SearchCaller::new("macro|a@example.com", SearchActor::App))
        .await
        .unwrap();
    assert!(!own.queued);
    assert_eq!(own.waited, Duration::ZERO);
    waiting.abort();
}

#[tokio::test(start_paused = true)]
async fn another_user_never_waits_behind_a_full_lane() {
    let lanes = lanes();
    let _first = lanes
        .take_turn(agent_of("macro|a@example.com"))
        .await
        .unwrap();
    let _second = lanes
        .take_turn(agent_of("macro|a@example.com"))
        .await
        .unwrap();

    let other = lanes
        .take_turn(agent_of("macro|b@example.com"))
        .await
        .unwrap();
    assert!(!other.queued);
}

#[tokio::test(start_paused = true)]
async fn one_user_id_in_another_case_shares_the_lane() {
    let lanes = lanes();
    let _first = lanes
        .take_turn(agent_of("macro|a@example.com"))
        .await
        .unwrap();
    let _second = lanes
        .take_turn(agent_of("macro|A@Example.com"))
        .await
        .unwrap();

    let refused = lanes
        .take_turn(agent_of("macro|a@example.com"))
        .await
        .unwrap_err();
    assert_eq!(refused.waited, Duration::from_secs(20));
}

#[tokio::test(start_paused = true)]
async fn a_search_still_waiting_at_the_deadline_is_refused_and_takes_no_slot() {
    let lanes = lanes();
    let first = lanes
        .take_turn(agent_of("macro|a@example.com"))
        .await
        .unwrap();
    let _second = lanes
        .take_turn(agent_of("macro|a@example.com"))
        .await
        .unwrap();

    let refused = lanes
        .take_turn(agent_of("macro|a@example.com"))
        .await
        .unwrap_err();
    assert_eq!(refused.waited, Duration::from_secs(20));

    drop(first);
    let next = lanes
        .take_turn(agent_of("macro|a@example.com"))
        .await
        .unwrap();
    assert!(!next.queued);
}

#[tokio::test(start_paused = true)]
async fn waiting_searches_take_their_turns_in_the_order_they_came() {
    let lanes = lanes();
    let first = lanes
        .take_turn(agent_of("macro|a@example.com"))
        .await
        .unwrap();
    let _second = lanes
        .take_turn(agent_of("macro|a@example.com"))
        .await
        .unwrap();

    let mut early = tokio::spawn({
        let lanes = Arc::clone(&lanes);
        async move { lanes.take_turn(agent_of("macro|a@example.com")).await }
    });
    assert!(
        tokio::time::timeout(Duration::from_secs(1), &mut early)
            .await
            .is_err()
    );
    let mut late = tokio::spawn({
        let lanes = Arc::clone(&lanes);
        async move { lanes.take_turn(agent_of("macro|a@example.com")).await }
    });
    assert!(
        tokio::time::timeout(Duration::from_secs(1), &mut late)
            .await
            .is_err()
    );

    drop(first);
    let early = early.await.unwrap().unwrap();
    assert_eq!(early.waited, Duration::from_secs(2));
    assert!(
        tokio::time::timeout(Duration::from_secs(1), &mut late)
            .await
            .is_err()
    );

    drop(early);
    let late = late.await.unwrap().unwrap();
    assert_eq!(late.waited, Duration::from_secs(2));
}

#[tokio::test(start_paused = true)]
async fn a_search_cancelled_while_waiting_gives_up_its_place() {
    let lanes = lanes();
    let first = lanes
        .take_turn(agent_of("macro|a@example.com"))
        .await
        .unwrap();
    let _second = lanes
        .take_turn(agent_of("macro|a@example.com"))
        .await
        .unwrap();

    let mut cancelled = tokio::spawn({
        let lanes = Arc::clone(&lanes);
        async move { lanes.take_turn(agent_of("macro|a@example.com")).await }
    });
    assert!(
        tokio::time::timeout(Duration::from_secs(1), &mut cancelled)
            .await
            .is_err()
    );
    let mut next = tokio::spawn({
        let lanes = Arc::clone(&lanes);
        async move { lanes.take_turn(agent_of("macro|a@example.com")).await }
    });
    assert!(
        tokio::time::timeout(Duration::from_secs(1), &mut next)
            .await
            .is_err()
    );

    cancelled.abort();
    assert!(cancelled.await.unwrap_err().is_cancelled());
    drop(first);
    let next = next.await.unwrap().unwrap();
    assert_eq!(next.waited, Duration::from_secs(1));
}

#[tokio::test(start_paused = true)]
async fn dropping_idle_lanes_keeps_a_busy_one() {
    let lanes = Arc::new(SearchLanes::new(LanePolicy {
        app_concurrency: 1,
        concurrency: 1,
        max_wait: Duration::from_secs(20),
    }));
    let _busy = lanes
        .take_turn(agent_of("macro|busy@example.com"))
        .await
        .unwrap();
    for idle in 0..MAX_LANES {
        let turn = lanes
            .take_turn(agent_of(&format!("macro|idle-{idle}@example.com")))
            .await
            .unwrap();
        drop(turn);
    }

    let refused = lanes
        .take_turn(agent_of("macro|busy@example.com"))
        .await
        .unwrap_err();
    assert_eq!(refused.waited, Duration::from_secs(20));
    assert!(lanes.lanes.lock().unwrap().len() < MAX_LANES);
}

#[tokio::test(start_paused = true)]
async fn the_person_in_the_app_runs_three_searches_at_once_and_programs_two() {
    let lanes = Arc::new(SearchLanes::new(LanePolicy::DEFAULT));
    let _first = lanes
        .take_turn(agent_of("macro|a@example.com"))
        .await
        .unwrap();
    let _second = lanes
        .take_turn(agent_of("macro|a@example.com"))
        .await
        .unwrap();
    let refused = lanes
        .take_turn(agent_of("macro|a@example.com"))
        .await
        .unwrap_err();
    assert_eq!(refused.waited, Duration::from_secs(20));

    let app = || SearchCaller::new("macro|a@example.com", SearchActor::App);
    let mut held = Vec::new();
    for _ in 0..3 {
        let turn = lanes.take_turn(app()).await.unwrap();
        assert!(!turn.queued);
        held.push(turn);
    }
    let mut fourth = tokio::spawn({
        let lanes = Arc::clone(&lanes);
        async move { lanes.take_turn(app()).await }
    });
    assert!(
        tokio::time::timeout(Duration::from_secs(1), &mut fourth)
            .await
            .is_err()
    );
    held.pop();
    assert!(fourth.await.unwrap().unwrap().queued);
}
