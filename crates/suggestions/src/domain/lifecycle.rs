//! A suggestion's lifecycle: which [`SuggestionState`] each thing done to a
//! suggestion moves it from, and to.
//!
//! [`transition`] is the whole table. The service derives the states each
//! write may start from with [`sources`], and the repository's SQL guards are
//! tested against the table, so the two never drift.
//!
//! | Event | From | To |
//! | --- | --- | --- |
//! | `take_on` | proposed | accepted |
//! | `start_run` | proposed, accepted | accepted |
//! | `complete` | proposed, accepted | done |
//! | `run_finished` | accepted | done |
//! | `dismiss` | proposed, accepted | dismissed |
//! | `retire` | proposed, accepted | retired |
//! | `resolve` | proposed, accepted | resolved |
//! | `rewrite`, `attach_draft` | proposed, accepted | the same |
//! | `restore` | done, dismissed, resolved, retired | proposed |
//! | `undismiss` | dismissed | proposed |
//!
//! Rules beyond the states sit with the service: a dismissed suggestion comes
//! back only with a reason, or undismissed by the person within five minutes;
//! a background prompt suggestion starts a run only while none is unsettled;
//! and taking on an accepted suggestion or completing a done one changes
//! nothing.

use strum::IntoEnumIterator;

use super::model::SuggestionState;

#[cfg(test)]
mod test;

/// Something done to a suggestion that may move its state.
#[derive(Debug, Clone, Copy, PartialEq, Eq, strum::AsRefStr, strum::EnumIter)]
#[strum(serialize_all = "snake_case")]
pub enum LifecycleEvent {
    /// Someone acting for the person takes a background prompt suggestion on,
    /// for the person to run.
    TakeOn,
    /// The person runs a background prompt suggestion.
    StartRun,
    /// The person acts on a suggestion that doesn't run.
    Complete,
    /// Its background run finished.
    RunFinished,
    /// The person isn't interested.
    Dismiss,
    /// A generation session found it no longer matters.
    Retire,
    /// An event ended it, such as its email being answered.
    Resolve,
    /// A generation session changes its words, or suggests it again.
    Rewrite,
    /// A generation session attaches a reply draft.
    AttachDraft,
    /// A generation session suggests a closed suggestion again.
    Restore,
    /// The person takes back their dismissal, within minutes of it.
    Undismiss,
}

/// The state `event` moves a suggestion in state `from` to, or `None` when
/// it doesn't apply there.
pub fn transition(from: SuggestionState, event: LifecycleEvent) -> Option<SuggestionState> {
    use LifecycleEvent as E;
    use SuggestionState as S;
    match (event, from) {
        (E::TakeOn, S::Proposed) => Some(S::Accepted),
        (E::StartRun, S::Proposed | S::Accepted) => Some(S::Accepted),
        (E::Complete, S::Proposed | S::Accepted) => Some(S::Done),
        (E::RunFinished, S::Accepted) => Some(S::Done),
        (E::Dismiss, S::Proposed | S::Accepted) => Some(S::Dismissed),
        (E::Retire, S::Proposed | S::Accepted) => Some(S::Retired),
        (E::Resolve, S::Proposed | S::Accepted) => Some(S::Resolved),
        (E::Rewrite | E::AttachDraft, S::Proposed | S::Accepted) => Some(from),
        (E::Restore, S::Done | S::Dismissed | S::Resolved | S::Retired) => Some(S::Proposed),
        (E::Undismiss, S::Dismissed) => Some(S::Proposed),
        (
            E::TakeOn
            | E::StartRun
            | E::Complete
            | E::RunFinished
            | E::Dismiss
            | E::Retire
            | E::Resolve
            | E::Rewrite
            | E::AttachDraft
            | E::Restore
            | E::Undismiss,
            _,
        ) => None,
    }
}

/// Every state `event` applies in.
pub fn sources(event: LifecycleEvent) -> Vec<SuggestionState> {
    SuggestionState::iter()
        .filter(|state| transition(*state, event).is_some())
        .collect()
}

/// Whether moving a suggestion to `to` cancels its unsettled run: it closed
/// without being done (dismissed, resolved or retired).
pub fn cancels_run(to: SuggestionState) -> bool {
    !to.is_open() && to != SuggestionState::Done
}
