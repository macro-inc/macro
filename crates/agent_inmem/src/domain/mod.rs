//! The in-memory agent's domain: the turn engine seam, per-session state, and
//! the ACP agent surface.

pub mod agent;
pub mod engine;
pub mod mcp;
/// ACP model configuration generated from the turn engine catalog.
pub mod model_options;
pub mod replay;
pub mod session;
pub mod user_input;
