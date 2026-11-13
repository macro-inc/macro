//! The broker topics the webhook system subscribes to: every topic with a
//! public event, declared once in `event_stream`, and the topics it leaves
//! unread (`INTERNAL_TOPICS`, none of whose events is public).

pub use event_stream::topics::{DeclaredMacroEvent, INTERNAL_TOPICS};
