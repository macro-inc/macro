/// Fresh ACP capability discovery without creating an agent session.
pub mod capability_discovery;
pub mod error;
pub mod model;
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

/// Per-owner hosted Codex runtime authorization.
pub mod codex;

/// Owner-bound Claude conversation lifecycle.
pub mod claude;

/// Compatible agent model discovery.
pub mod model_load;
