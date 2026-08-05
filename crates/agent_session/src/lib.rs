pub mod domain;
pub mod inbound;
pub mod outbound;

/// In-memory port implementations for tests.
#[cfg(any(test, feature = "test-utils"))]
pub mod testing;
