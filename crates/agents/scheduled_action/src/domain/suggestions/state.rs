//! Where a routine suggestion AI made is, and the one function that moves it.
//!
//! Every change to a routine suggestion's state, and to its card in the
//! Suggestions feed, goes through [`RoutineSuggestionState::on`]: a
//! routines session retiring it, the person dismissing it (on the Routines
//! page or in the feed) or saving a routine from it. The store applies the
//! transition with its card in one transaction, guarded on the state it was
//! read in.

use serde::Serialize;
use suggestions::domain::model::SuggestionState;
use utoipa::ToSchema;

#[cfg(test)]
mod test;

/// Where one of the person's routine suggestions is.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Hash,
    Serialize,
    ToSchema,
    strum::EnumString,
    strum::AsRefStr,
    strum::VariantArray,
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
#[schema(as = ReviewedState)]
pub enum RoutineSuggestionState {
    /// Shown.
    Open,
    /// The person turned it down; never suggested again.
    Dismissed,
    /// A routines session found it no longer fits; it may be suggested again.
    Retired,
    /// The person saved a routine from it.
    Saved,
}

/// What can happen to a routine suggestion.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, strum::AsRefStr, strum::VariantArray)]
#[strum(serialize_all = "snake_case")]
pub enum RoutineSuggestionEvent {
    /// A routines session retires it: it no longer fits.
    Retire,
    /// The person dismisses it, on the Routines page or in the feed.
    Dismiss,
    /// The person saves a routine from it.
    Save,
}

/// What an event does to a routine suggestion.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Transition {
    /// It moves to this state, and its card to [`RoutineSuggestionState::card`]
    /// of it.
    Move(RoutineSuggestionState),
    /// It is there already: nothing changes.
    Stay,
    /// The event doesn't apply to it: nothing changes, and the caller is told.
    Refuse,
}

impl RoutineSuggestionState {
    /// What `event` does to a routine suggestion in this state.
    ///
    /// Saving wins over everything: a routine saved from a dismissed or
    /// retired suggestion still came from it. Dismissing is for good, so a
    /// retired suggestion the person dismisses is never suggested again.
    /// Only an open suggestion is retired.
    pub fn on(self, event: RoutineSuggestionEvent) -> Transition {
        use RoutineSuggestionEvent::{Dismiss, Retire, Save};
        use RoutineSuggestionState::{Dismissed, Open, Retired, Saved};
        match (self, event) {
            (Open, Retire) => Transition::Move(Retired),
            (Dismissed | Retired | Saved, Retire) => Transition::Refuse,
            (Open | Retired, Dismiss) => Transition::Move(Dismissed),
            (Dismissed | Saved, Dismiss) => Transition::Stay,
            (Open | Dismissed | Retired, Save) => Transition::Move(Saved),
            (Saved, Save) => Transition::Stay,
        }
    }

    /// The state a drafted routine's card shows in the Suggestions feed.
    pub fn card(self) -> SuggestionState {
        match self {
            Self::Open => SuggestionState::Proposed,
            Self::Dismissed => SuggestionState::Dismissed,
            Self::Retired => SuggestionState::Retired,
            Self::Saved => SuggestionState::Done,
        }
    }
}
