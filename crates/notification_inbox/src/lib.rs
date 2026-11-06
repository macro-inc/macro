#![deny(missing_docs)]
//! The notifications inbox: the viewer's pending notifications grouped by
//! the entity they are filed under and cut into rows, one per conversation
//! thread, channel top level, email thread, task, pull request, request or
//! agent session, served as one paginated, live-updating list. Each row also
//! says who it is from and what the viewer can do from it, as data.
//!
//! # Architecture
//!
//! - **domain**: rows, membership policy, and the page, recompute, done,
//!   seen and undo use cases.
//!
//! Paging, notification loading, acknowledgment and the adapters over the
//! services that own the data are the shared feed layer's
//! (`crates/attention_feed`).

pub mod domain;
