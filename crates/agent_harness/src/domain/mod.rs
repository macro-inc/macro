pub mod error;
pub mod model;
/// Fresh model discovery without creating an agent session.
pub mod model_load;
/// Which lifecycle facts become notifications for people, and for whom.
pub mod notifications;
/// A shared record of sessions with a command admitted but not yet resolved,
/// consulted by container managers' idle reapers.
pub mod pending;
pub mod ports;
/// The per-session queue of turn-occupying actions awaiting their turn.
pub mod queue;
/// Compute resources for a sandbox size.
pub mod sandbox;
/// The harness orchestrator: containers, announcements, and trigger commands.
pub mod service;
/// Policy for turning broker trigger events into harness work.
pub mod trigger_router;
