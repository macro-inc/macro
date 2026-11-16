use std::collections::HashSet;
use std::str::FromStr;

use strum::VariantArray;
use suggestions::domain::model::SuggestionState;

use super::RoutineSuggestionEvent::{Dismiss, Retire, Save};
use super::RoutineSuggestionState::{Dismissed, Open, Retired, Saved};
use super::{RoutineSuggestionEvent, RoutineSuggestionState, Transition};

/// Every state and event, and what the event does there.
const TABLE: [(RoutineSuggestionState, RoutineSuggestionEvent, Transition); 12] = [
    (Open, Retire, Transition::Move(Retired)),
    (Open, Dismiss, Transition::Move(Dismissed)),
    (Open, Save, Transition::Move(Saved)),
    (Dismissed, Retire, Transition::Refuse),
    (Dismissed, Dismiss, Transition::Stay),
    (Dismissed, Save, Transition::Move(Saved)),
    (Retired, Retire, Transition::Refuse),
    (Retired, Dismiss, Transition::Move(Dismissed)),
    (Retired, Save, Transition::Move(Saved)),
    (Saved, Retire, Transition::Refuse),
    (Saved, Dismiss, Transition::Stay),
    (Saved, Save, Transition::Stay),
];

#[test]
fn every_event_in_every_state_does_what_the_table_says() {
    for (state, event, expected) in TABLE {
        assert_eq!(state.on(event), expected, "{state:?} on {event:?}");
    }
    let covered: HashSet<(RoutineSuggestionState, RoutineSuggestionEvent)> = TABLE
        .iter()
        .map(|(state, event, _)| (*state, *event))
        .collect();
    assert_eq!(
        covered.len(),
        RoutineSuggestionState::VARIANTS.len() * RoutineSuggestionEvent::VARIANTS.len(),
        "the table covers every state and event once"
    );
}

#[test]
fn nothing_reopens_a_suggestion_or_moves_it_where_it_is() {
    for state in RoutineSuggestionState::VARIANTS {
        for event in RoutineSuggestionEvent::VARIANTS {
            if let Transition::Move(to) = state.on(*event) {
                assert_ne!(to, Open, "{state:?} on {event:?}");
                assert_ne!(to, *state, "{state:?} on {event:?} moves nowhere");
            }
        }
    }
}

#[test]
fn only_an_open_suggestion_is_retired_and_a_saved_one_stays_saved() {
    for state in RoutineSuggestionState::VARIANTS {
        let retired = state.on(Retire) == Transition::Move(Retired);
        assert_eq!(retired, *state == Open, "{state:?}");
        if *state == Saved {
            for event in RoutineSuggestionEvent::VARIANTS {
                assert!(
                    !matches!(state.on(*event), Transition::Move(_)),
                    "{event:?} moves a saved suggestion"
                );
            }
        }
    }
}

#[test]
fn every_state_shows_its_own_card_and_only_an_open_one_is_open() {
    let cards: Vec<SuggestionState> = RoutineSuggestionState::VARIANTS
        .iter()
        .map(|state| state.card())
        .collect();
    assert_eq!(
        cards,
        [
            SuggestionState::Proposed,
            SuggestionState::Dismissed,
            SuggestionState::Retired,
            SuggestionState::Done,
        ]
    );
    for state in RoutineSuggestionState::VARIANTS {
        assert_eq!(state.card().is_open(), *state == Open, "{state:?}");
    }
}

#[test]
fn a_state_reads_back_as_stored() {
    for state in RoutineSuggestionState::VARIANTS {
        assert_eq!(
            RoutineSuggestionState::from_str(state.as_ref()).unwrap(),
            *state
        );
        assert_eq!(
            serde_json::to_value(state).unwrap(),
            serde_json::Value::String(state.as_ref().to_owned())
        );
    }
    assert_eq!(
        RoutineSuggestionState::VARIANTS
            .iter()
            .map(AsRef::as_ref)
            .collect::<Vec<&str>>(),
        ["open", "dismissed", "retired", "saved"],
        "the names the database check allows"
    );
}
