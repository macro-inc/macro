use strum::IntoEnumIterator;

use super::*;

fn run(state: RunStateName) -> SuggestionRun {
    SuggestionRun {
        session_id: Uuid::now_v7(),
        started_at: Utc::now(),
        state,
        state_changed_at: Utc::now(),
    }
}

/// The status the feed shows, for every state and latest run there is.
#[test]
fn a_suggestions_status_follows_its_state_then_its_latest_run() {
    use SuggestionState as S;
    use SuggestionStatus as Status;
    for state in S::iter() {
        let runs = RunStateName::iter().map(Some).chain([None]);
        for latest in runs {
            let status = SuggestionStatus::of(state, latest.map(run).as_ref());
            let expected = match (state, latest) {
                (S::Done, _) => Status::Done,
                (S::Dismissed | S::Resolved | S::Retired, _) => Status::Closed,
                (_, Some(latest)) if !latest.is_settled() => Status::Running,
                (S::Accepted, Some(RunStateName::Failed)) => Status::Failed,
                (S::Proposed | S::Accepted, _) => Status::Open,
            };
            assert_eq!(status, expected, "{state:?} with {latest:?}");
        }
    }
    // Spelled out: what the feed shows a card as.
    assert_eq!(
        SuggestionStatus::of(S::Accepted, Some(&run(RunStateName::Waiting))),
        Status::Running
    );
    assert_eq!(
        SuggestionStatus::of(S::Accepted, Some(&run(RunStateName::Cancelled))),
        Status::Open
    );
    assert_eq!(
        SuggestionStatus::of(S::Proposed, Some(&run(RunStateName::Failed))),
        Status::Open
    );
    assert_eq!(
        SuggestionStatus::of(S::Dismissed, Some(&run(RunStateName::Cancelling))),
        Status::Closed
    );
}
