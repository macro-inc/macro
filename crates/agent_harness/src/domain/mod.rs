/// Fresh ACP capability discovery without creating an agent session.
pub mod capability_discovery;
/// Owner-only metadata and context boundaries for agent DMs.
pub mod direct_messages;
pub mod dm_turns;
pub mod error;
pub mod model;
/// Which lifecycle facts become notifications for people, and for whom.
pub mod notifications;
/// A shared record of sessions with a command admitted but not yet resolved,
/// consulted by container managers' idle reapers.
pub mod pending;
pub mod ports;
/// Which channel messages an agent's reply is shown through.
pub mod presenter;
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
/// Admitted model-backed repository choice, with deterministic paths kept free.
pub mod repository_choice;
/// Repository selection and fallback policy for hosted coding sessions.
pub(crate) mod repository_selection;
