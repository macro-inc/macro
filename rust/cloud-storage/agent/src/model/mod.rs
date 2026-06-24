//! Models are strings
//! AgentModel exists to help the backend use AI
//! Model routing takes a string and returns the appropriate client
mod predefined_model;
mod types;
pub use predefined_model::*;
mod anthropic;
mod openai;
pub mod router;

#[cfg(test)]
mod test;
