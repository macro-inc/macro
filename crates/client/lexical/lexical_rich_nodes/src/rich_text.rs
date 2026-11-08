//! Model halves of `registerRichText`; views own event routing and layout queries.
mod commands;
mod config;
mod movement;
pub use commands::*;
pub use config::*;
pub use movement::*;
#[cfg(test)]
mod test;
