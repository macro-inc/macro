mod agent;

#[cfg(test)]
mod test;

use crate::types::Model;
pub use agent::Chat;
pub const MAX_RECURSIONS: u32 = 100;
pub const TOOL_GENERATOR: Model = Model::Gemini20Flash;
