//! The in-memory agent's domain: the turn engine seam, per-session state, and
//! the ACP agent surface.

pub mod admission;
pub mod agent;
/// Which model an Auto turn runs on.
pub mod auto_model;
pub mod engine;
pub mod mcp;
pub mod model_access;
/// ACP session configuration generated from the turn engine catalog.
pub mod model_options;
/// Models this runtime advertises, including routed Fireworks and Gemini ids.
pub mod models;
pub mod replay;
pub mod session;
/// Which skills a turn loads on its own, and what each session has loaded.
pub mod skill_routing;
/// Whether one of Macro's own tools may run in this turn.
pub mod tool_gate;
pub mod tool_mode;
pub mod tool_stream;
pub mod user_input;
