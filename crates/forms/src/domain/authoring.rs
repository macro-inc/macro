//! Deterministic form authoring workflows. Local keys are resolved before writes;
//! edits compare the caller's baseline with the latest durable document.
pub mod edit;
pub mod models;
pub mod ports;
pub mod validate;

pub use models::*;

pub mod workflow;

pub mod contracts;
pub use contracts::*;

pub mod journal;
