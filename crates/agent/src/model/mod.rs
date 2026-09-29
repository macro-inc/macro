//! Models are strings
//! AgentModel exists to help the backend use AI
//! Model routing takes a string and returns the appropriate client
mod predefined_model;
pub(crate) mod types;
pub use predefined_model::*;
mod anthropic;
mod gemini;
pub mod metering;
pub mod metering_http;
mod openai;
pub mod router;
