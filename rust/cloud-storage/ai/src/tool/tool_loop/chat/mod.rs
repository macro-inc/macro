mod agent;

#[cfg(test)]
mod test;

pub use agent::*;

use crate::types::Model;
pub const MAX_RECURSIONS: u32 = 100;
pub const TOOL_GENERATOR: Model = Model::Gemini20Flash;
