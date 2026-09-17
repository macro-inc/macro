//! The model that answers a session's opening prompt.
//!
//! Time to first token dominates how a new session feels: the reader is
//! staring at an empty transcript, and every second before the first word is
//! a second of nothing. A small fast model closes that gap, and by the second
//! turn the conversation has content on screen and can afford the better
//! model it was configured with.
//!
//! Only the *first* turn, and only when nobody asked for a particular model.
//! A caller who picks a model has picked it for everything they send; quietly
//! answering their first question on something else would be a different
//! agent than the one they chose.

mod env {
    macro_env_var::maybe_env_vars! {
        /// `AGENT_INMEM_FIRST_TURN_MODEL`: the model to open a session on.
        /// Unset, [`DEFAULT_FIRST_TURN_MODEL`] is used; set to the configured
        /// model (or to anything the engine does not serve) the substitution
        /// is off and every turn runs on the session's own model.
        pub struct AgentInmemFirstTurnModel;
    }
}

/// The model an unconfigured session opens on: the fastest one the catalog
/// offers, so the first token arrives while the reader is still looking.
pub const DEFAULT_FIRST_TURN_MODEL: &str = "anthropic/claude-haiku-4-5";

/// The configured opening model: `AGENT_INMEM_FIRST_TURN_MODEL`, or
/// [`DEFAULT_FIRST_TURN_MODEL`]. Read where the decision is made rather than
/// cached, because it is read once per session's first turn and never again.
#[must_use]
pub fn configured_fast_model() -> String {
    env::AgentInmemFirstTurnModel::new()
        .and_then(|set| set.value().map(str::to_owned))
        .unwrap_or_else(|| DEFAULT_FIRST_TURN_MODEL.to_owned())
}

/// The model that should answer this turn, or `None` to use the session's.
///
/// `None` for every turn after the first, for a session whose model the
/// caller chose, and for a `fast` model the engine cannot serve - an
/// unroutable id would fail the turn, which is worse than a slow one.
#[must_use]
pub fn first_turn_model(
    is_first_turn: bool,
    model_pinned: bool,
    session_model: &str,
    supported: &[&str],
    fast: &str,
) -> Option<String> {
    if !is_first_turn || model_pinned {
        return None;
    }
    if fast == session_model || !supported.contains(&fast) {
        return None;
    }
    Some(fast.to_owned())
}

#[cfg(test)]
mod test;
