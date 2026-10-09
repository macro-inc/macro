#![deny(missing_docs)]
//! The work feed: Home's combined list of things that need the viewer's
//! attention and work they recently did, served as one paginated, stacked,
//! live-updating feed.
//!
//! # Architecture
//!
//! - **domain**: item identity, membership policy, notification stacking,
//!   seen/done state, and the page, recompute, done and undo use cases.
//! - **outbound**: adapters over the Soup, notification, email, activity and
//!   realtime services that own the underlying data.

pub mod domain;

#[cfg(feature = "outbound")]
pub mod outbound;
