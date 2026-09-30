//! Pure Slack export parsing. Callers enforce archive/record byte limits before decoding.
//!
//! These models accept unknown export fields and message subtypes. They perform no
//! network lookups, target authorization, ZIP extraction, or historical writes.

pub mod export;
pub mod mrkdwn;
pub mod reactions;
pub mod threads;
pub mod users;
