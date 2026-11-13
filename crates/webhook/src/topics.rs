//! The broker topics the webhook system subscribes to: every topic carrying
//! public events, declared once in `event_stream`.

pub use event_stream::topics::{DeclaredMacroEvent, INTERNAL_TOPICS};
