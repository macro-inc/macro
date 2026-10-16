//! Models are strings
//! AgentModel exists to help the backend use AI
//! Model routing takes a string and returns the appropriate client
mod predefined_model;
mod reasoning_effort;
mod speed;
pub(crate) mod types;
pub use predefined_model::*;
pub use reasoning_effort::*;
pub use speed::*;
pub(crate) mod anthropic;
pub mod anthropic_prompt_layout;
mod gemini;
pub mod metering;
pub mod metering_http;
mod openai;
pub mod router;
pub(crate) mod usage_amount;
