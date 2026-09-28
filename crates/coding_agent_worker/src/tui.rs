//! The macrod control panel: one process that serves and shows itself.
//!
//! `macrod` runs the serving core (SSE listener, harness bridge) inside a
//! terminal UI that shows what the server knows about this harness - its
//! registration, the agents bound to it, their sessions, and the daemon's
//! own logs - and drives its lifecycle: edit `macrod.toml`, pair (or re-pair,
//! restarting the core on the new credential), and retire the harness.

mod agent_catalog;
mod api;
mod app;
mod config_form;
mod input;
mod logging;
mod platform;
mod process;
mod quickstart;
mod runner;
mod ui;

pub use logging::LogBuffer;
pub use runner::run;
