use strum::IntoEnumIterator;

use super::*;

use LifecycleEvent as E;
use SuggestionState as S;

/// The table in the module's docs: every move there is; any other pair is
/// refused.
const MOVES: &[(LifecycleEvent, SuggestionState, SuggestionState)] = &[
    (E::TakeOn, S::Proposed, S::Accepted),
    (E::StartRun, S::Proposed, S::Accepted),
    (E::StartRun, S::Accepted, S::Accepted),
    (E::Complete, S::Proposed, S::Done),
    (E::Complete, S::Accepted, S::Done),
    (E::RunFinished, S::Accepted, S::Done),
    (E::Dismiss, S::Proposed, S::Dismissed),
    (E::Dismiss, S::Accepted, S::Dismissed),
    (E::Retire, S::Proposed, S::Retired),
    (E::Retire, S::Accepted, S::Retired),
    (E::Resolve, S::Proposed, S::Resolved),
    (E::Resolve, S::Accepted, S::Resolved),
    (E::Rewrite, S::Proposed, S::Proposed),
    (E::Rewrite, S::Accepted, S::Accepted),
    (E::AttachDraft, S::Proposed, S::Proposed),
    (E::AttachDraft, S::Accepted, S::Accepted),
    (E::Restore, S::Done, S::Proposed),
    (E::Restore, S::Dismissed, S::Proposed),
    (E::Restore, S::Resolved, S::Proposed),
    (E::Restore, S::Retired, S::Proposed),
];

#[test]
fn every_event_moves_from_every_state_as_the_table_says() {
    for event in LifecycleEvent::iter() {
        for from in SuggestionState::iter() {
            let expected = MOVES
                .iter()
                .find(|(e, f, _)| *e == event && *f == from)
                .map(|(_, _, to)| *to);
            assert_eq!(transition(from, event), expected, "{event:?} from {from:?}");
        }
    }
}

#[test]
fn sources_are_the_states_an_event_applies_in() {
    for event in LifecycleEvent::iter() {
        let expected: Vec<_> = SuggestionState::iter()
            .filter(|from| MOVES.iter().any(|(e, f, _)| *e == event && f == from))
            .collect();
        assert_eq!(sources(event), expected, "{event:?}");
        assert!(!expected.is_empty(), "{event:?} applies nowhere");
    }
}

#[test]
fn only_a_restore_reopens_a_closed_suggestion() {
    for event in LifecycleEvent::iter() {
        for from in SuggestionState::iter().filter(|state| !state.is_open()) {
            if let Some(to) = transition(from, event) {
                assert_eq!(event, E::Restore, "{event:?} from {from:?}");
                assert_eq!(to, S::Proposed);
            }
        }
    }
}

#[test]
fn a_restore_applies_only_to_closed_suggestions() {
    assert!(sources(E::Restore).iter().all(|state| !state.is_open()));
}

#[test]
fn writes_that_keep_the_state_leave_it_open() {
    for event in [E::Rewrite, E::AttachDraft] {
        for from in SuggestionState::iter() {
            if let Some(to) = transition(from, event) {
                assert_eq!(to, from);
                assert!(from.is_open());
            }
        }
    }
}
