//! Personal and team booking links, availability, and booking lifecycle.
#![deny(missing_docs)]
pub mod domain;
#[cfg(any(feature = "inbound", feature = "ai_tools"))]
pub mod inbound;
#[cfg(any(feature = "postgres", feature = "calendar"))]
pub mod outbound;
