//! The macrod control panel: one process that serves and shows itself.
//!
//! `macrod` runs the serving core (SSE listener, harness bridge) inside a
//! terminal UI that shows what the server knows about this harness - its
//! registration, the agents bound to it, their sessions, and the daemon's
//! own logs - and drives its lifecycle: edit `macrod.toml`, pair (or re-pair,
//! restarting the core on the new credential), and retire the harness.

// `service` reuses agent discovery and the comment-preserving config editor;
// they live here because the TUI grew them first.
pub(crate) mod agent_catalog;
mod api;
mod app;
pub(crate) mod config_form;
#[cfg(unix)]
mod herdr_pane;
mod input;
mod logging;
mod platform;
mod process;
mod quickstart;
mod runner;
mod ui;

#[cfg(unix)]
pub use herdr_pane::run_herdr_pane;
pub use logging::LogBuffer;
pub use runner::run;
