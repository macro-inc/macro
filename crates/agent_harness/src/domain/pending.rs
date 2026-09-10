//! A shared record of sessions with a command admitted but not yet acted on,
//! consulted by container managers' idle reapers so they never pull a
//! session's transport out from under a command already on its way in.
//!
//! Built once at process wiring and handed to both [`crate::domain::service`]
//! (which marks and clears it) and every [`crate::domain::ports::ContainerManager`]
//! whose provider reaps idle transports (which only reads it). Neither side
//! needs the other's type, which is what lets the container managers be
//! constructed before the harness that owns them.
//!
//! A session is marked from the moment its command is admitted, which is
//! before any turn exists to describe - hence the two-stage value: admission
//! records only that something is coming, and dispatch fills in the turn it
//! opened. A reaper only ever asks the first question; the harness's own
//! lifecycle events need the second.

use std::sync::Arc;

use agent_session::domain::model::AgentSessionId;
use dashmap::DashMap;

use crate::domain::queue::InFlightTurn;

/// Cheap to clone; every clone shares the same underlying map.
#[derive(Clone, Default)]
pub struct PendingCommands(Arc<DashMap<AgentSessionId, Option<InFlightTurn>>>);

impl PendingCommands {
    /// An empty tracker: no session marked pending.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Record that `session` has a command admitted, before it has been
    /// dispatched and so before there is a turn to name.
    ///
    /// Only called for a session not already pending, so it can never
    /// overwrite a dispatched turn with an empty admission.
    pub fn admit(&self, session: AgentSessionId) {
        self.0.insert(session, None);
    }

    /// Record the turn a dispatched action opened for `session`.
    pub fn mark_turn(&self, session: AgentSessionId, turn: InFlightTurn) {
        self.0.insert(session, Some(turn));
    }

    /// Clear `session`'s mark, if any.
    pub fn clear(&self, session: AgentSessionId) {
        self.0.remove(&session);
    }

    /// Clear `session`'s mark and hand back the turn it had in flight, if it
    /// had got as far as dispatching one.
    pub fn take(&self, session: AgentSessionId) -> Option<InFlightTurn> {
        self.0.remove(&session).and_then(|(_, turn)| turn)
    }

    /// The turn `session` currently has in flight, if it has one.
    ///
    /// Absent both for a session with nothing pending and for one whose
    /// command is admitted but not yet dispatched - callers reporting on a
    /// turn have nothing to say in either case.
    #[must_use]
    pub fn turn(&self, session: AgentSessionId) -> Option<InFlightTurn> {
        self.0.get(&session).and_then(|entry| entry.clone())
    }

    /// Whether `session` currently has a command admitted and unresolved.
    ///
    /// A reaper's cue to leave the session's transport alone this tick even
    /// though it otherwise looks idle: something is already on its way to
    /// it, and closing the transport now would only race that delivery.
    #[must_use]
    pub fn is_pending(&self, session: AgentSessionId) -> bool {
        self.0.contains_key(&session)
    }
}

#[cfg(test)]
mod test {
    use agent_fold::domain::model::TurnId;
    use agent_runtime_protocol::domain::action::AgentActionId;

    use super::*;

    fn session_id(n: u128) -> AgentSessionId {
        AgentSessionId::new_from_uuid(macro_uuid::Uuid::from_u128(n))
    }

    fn turn() -> InFlightTurn {
        InFlightTurn {
            action_id: AgentActionId::mint(),
            turn: TurnId(7),
            actor: None,
            announcement_message_id: None,
        }
    }

    #[test]
    fn admits_and_clears() {
        let pending = PendingCommands::new();
        let id = session_id(1);
        assert!(!pending.is_pending(id));
        pending.admit(id);
        assert!(pending.is_pending(id));
        pending.clear(id);
        assert!(!pending.is_pending(id));
    }

    #[test]
    fn an_admitted_session_has_no_turn_until_dispatch() {
        let pending = PendingCommands::new();
        let id = session_id(2);
        pending.admit(id);
        assert!(
            pending.turn(id).is_none(),
            "admission alone names no turn, but is still pending"
        );
        let dispatched = turn();
        pending.mark_turn(id, dispatched.clone());
        assert_eq!(pending.turn(id).map(|t| t.turn), Some(dispatched.turn));
    }

    #[test]
    fn take_clears_and_returns_the_turn() {
        let pending = PendingCommands::new();
        let id = session_id(3);
        let dispatched = turn();
        pending.mark_turn(id, dispatched.clone());
        assert_eq!(pending.take(id).map(|t| t.turn), Some(dispatched.turn));
        assert!(!pending.is_pending(id));
        assert!(pending.take(id).is_none(), "a second take has nothing left");
    }

    #[test]
    fn clones_share_state() {
        let pending = PendingCommands::new();
        let clone = pending.clone();
        let id = session_id(4);
        pending.admit(id);
        assert!(clone.is_pending(id), "clones observe the same map");
    }
}
