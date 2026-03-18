#![deny(missing_docs)]
//! Generic rate limiting library.
//!
//! Provides models, a service trait ([`RateLimitPort`]), and a Redis-backed
//! adapter following hexagonal architecture.

pub mod domain;
pub mod outbound;

// Re-export key types at crate root for convenience.
pub use domain::models::{
    RateLimitConfig, RateLimitExceeded, RateLimitKey, RateLimitKeyBuilder, RateLimitResult,
};
pub use domain::ports::RateLimitPort;
pub use outbound::redis::{RedisRateLimitAdapter, RedisRateLimitOps};
