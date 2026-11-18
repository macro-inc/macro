#![deny(missing_docs)]
//! The work feed: Home's combined list of things that need the viewer's
//! attention and work they recently did, served as one paginated, stacked,
//! live-updating feed.
//!
//! # Architecture
//!
//! - **domain**: Home's items, membership policy, notification stacking,
//!   seen/done state, and the page, recompute, done and undo use cases.
//!
//! Paging, notification loading, acknowledgment and the adapters over the
//! services that own the data are the shared feed layer's
//! (`crates/attention_feed`).

pub mod domain;
