//! Durable, session-authorized code reviews and the agent feedback loop.
#![deny(missing_docs)]

pub mod domain;
pub mod inbound;
pub mod outbound;

#[cfg(any(test, feature = "test-utils"))]
pub mod testing;
