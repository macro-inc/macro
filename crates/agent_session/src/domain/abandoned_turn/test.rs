use super::*;
use crate::domain::ports::NoOpRealtime;
use crate::testing::{InMemoryAgentSessionRepo, RecordingRealtime, test_agent_session};
use agent_fold::domain::model::TurnState;
use agent_fold::testing::{TURN, parse_log_as};

/// Everything past the fixture's prompt, dropped: a session whose log stops
/// mid-turn, which is what a replica dying mid-stream leaves behind.
async fn session_stuck_mid_turn(repo: &InMemoryAgentSessionRepo) -> AgentSessionId {
    let session = AgentSessionId::new();
    repo.insert_session(test_agent_session(session));
    let mut logs = LiveSessionLogWriter::new(repo.clone(), NoOpRealtime);
    for frame in parse_log_as(session, TURN) {
        logs.append(frame).await.expect("fixture frame appends");
        logs.flush().await.expect("fixture frame is durable");
        if repo.turn_state(session).is_some_and(TurnState::is_open) {
            return session;
        }
    }
    panic!("the fixture turn never opened");
}

/// A sweep of everything on offer, from a replica of this process.
async fn sweep(
    repo: &InMemoryAgentSessionRepo,
    realtime: &RecordingRealtime,
) -> AbandonedTurnSweep {
    close_abandoned_turns(
        repo,
        realtime,
        ReplicaId::mint(),
        Duration::ZERO,
        NonZeroUsize::new(10).unwrap(),
    )
    .await
    .expect("the sweep runs")
}

#[tokio::test]
async fn a_turn_no_replica_is_driving_is_closed_and_published() {
    let repo = InMemoryAgentSessionRepo::new();
    let realtime = RecordingRealtime::new();
    let session = session_stuck_mid_turn(&repo).await;

    assert_eq!(
        sweep(&repo, &realtime).await,
        AbandonedTurnSweep {
            examined: 1,
            closed: 1
        }
    );
    assert_eq!(repo.turn_state(session), Some(TurnState::Disconnected));
    // Whoever has the transcript open learns without reloading.
    assert!(
        realtime
            .published()
            .iter()
            .any(|event| event.agent_session_id == session)
    );
}

#[tokio::test]
async fn a_closed_turn_is_not_swept_again_and_keeps_no_lease() {
    let repo = InMemoryAgentSessionRepo::new();
    let realtime = RecordingRealtime::new();
    let session = session_stuck_mid_turn(&repo).await;
    sweep(&repo, &realtime).await;

    assert_eq!(sweep(&repo, &realtime).await, AbandonedTurnSweep::default());
    // The sweep swept; it did not take the session over. The next prompt
    // must be free to open it on whichever replica handles it.
    assert!(repo.manager_of(session).await.unwrap().is_none());
}

#[tokio::test]
async fn a_turn_a_live_replica_holds_is_left_alone() {
    let repo = InMemoryAgentSessionRepo::new();
    let realtime = RecordingRealtime::new();
    let session = session_stuck_mid_turn(&repo).await;
    let holder = ReplicaId::mint();
    repo.claim(session, holder).await.expect("the claim lands");

    assert_eq!(sweep(&repo, &realtime).await, AbandonedTurnSweep::default());
    assert!(repo.turn_state(session).is_some_and(TurnState::is_open));
}

#[tokio::test]
async fn a_session_that_is_still_talking_is_left_alone() {
    let repo = InMemoryAgentSessionRepo::new();
    let realtime = RecordingRealtime::new();
    let session = session_stuck_mid_turn(&repo).await;

    // The quiet period is what separates "nobody is driving this" from "the
    // replica beating a moment ago has not written its next frame yet".
    let swept = close_abandoned_turns(
        &repo,
        &realtime,
        ReplicaId::mint(),
        Duration::from_secs(600),
        NonZeroUsize::new(10).unwrap(),
    )
    .await
    .expect("the sweep runs");

    assert_eq!(swept, AbandonedTurnSweep::default());
    assert!(repo.turn_state(session).is_some_and(TurnState::is_open));
}

#[tokio::test]
async fn a_settled_session_is_never_examined() {
    let repo = InMemoryAgentSessionRepo::new();
    let realtime = RecordingRealtime::new();
    let session = AgentSessionId::new();
    repo.insert_session(test_agent_session(session));
    let mut logs = LiveSessionLogWriter::new(repo.clone(), NoOpRealtime);
    for frame in parse_log_as(session, TURN) {
        logs.append(frame).await.expect("fixture frame appends");
    }
    logs.flush().await.expect("the fixture turn is durable");
    assert_eq!(repo.turn_state(session), Some(TurnState::Idle));

    assert_eq!(sweep(&repo, &realtime).await, AbandonedTurnSweep::default());
    assert_eq!(repo.turn_state(session), Some(TurnState::Idle));
}

#[tokio::test]
async fn a_pass_closes_at_most_its_limit() {
    let repo = InMemoryAgentSessionRepo::new();
    let realtime = RecordingRealtime::new();
    session_stuck_mid_turn(&repo).await;
    session_stuck_mid_turn(&repo).await;
    session_stuck_mid_turn(&repo).await;

    let swept = close_abandoned_turns(
        &repo,
        &realtime,
        ReplicaId::mint(),
        Duration::ZERO,
        NonZeroUsize::new(2).unwrap(),
    )
    .await
    .expect("the sweep runs");

    assert_eq!(
        swept,
        AbandonedTurnSweep {
            examined: 2,
            closed: 2
        }
    );
    assert_eq!(
        sweep(&repo, &realtime).await,
        AbandonedTurnSweep {
            examined: 1,
            closed: 1
        }
    );
}
