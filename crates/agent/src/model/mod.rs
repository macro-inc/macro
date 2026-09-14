//! Models are strings
//! AgentModel exists to help the backend use AI
//! Model routing takes a string and returns the appropriate client
mod predefined_model;
mod reasoning_effort;
pub(crate) mod types;
pub use predefined_model::*;
pub use reasoning_effort::*;
mod anthropic;
mod openai;
pub mod router;
