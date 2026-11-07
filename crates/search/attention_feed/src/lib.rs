#![deny(missing_docs)]
//! The layer every attention feed builds on: Home's work feed and the
//! notifications inbox each keep their own model, and share how candidates
//! are paged and refilled, how their notifications are loaded, completed,
//! read and restored, how inbox email is archived, and how realtime changes
//! are batched into recomputes.
//!
//! # Architecture
//!
//! - **domain**: viewers, keys, tokens, candidate keying, the reader, the
//!   acknowledger, live batching, and the ports feeds depend on.
//! - **inbound** (feature `inbound`): resolving the viewer a request is
//!   evaluated as, at the entity access boundary.
//! - **outbound** (feature `outbound`): adapters over the Soup,
//!   notification, email, activity and realtime services.
//! - **test_support** (feature `test-utils`): notification fixtures and port
//!   fakes for the feeds' tests.

pub mod domain;

#[cfg(feature = "inbound")]
pub mod inbound;

#[cfg(feature = "outbound")]
pub mod outbound;

#[cfg(any(test, feature = "test-utils"))]
pub mod test_support;
