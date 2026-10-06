//! Pure logic for diffd. Nothing in this crate touches the network, the
//! filesystem or a clock: callers hand in file contents and engine output,
//! and get back the data the page and the agent see.

pub mod anchor;
pub mod build;
pub mod difft;
pub mod feedback;
pub mod highlight;
pub mod kinds;
pub mod lang;
pub mod linediff;
pub mod model;
pub mod protocol;
pub mod symbols;
pub mod text;
