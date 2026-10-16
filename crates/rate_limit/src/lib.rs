#![deny(missing_docs)]
//! Generic rate limiting library.
//!
//! Provides models, a service trait ([`RateLimitPort`]), and a Redis-backed
//! adapter following hexagonal architecture.

pub mod domain;
#[cfg(feature = "axum")]
pub mod inbound;
pub mod outbound;

// Re-export key types at crate root for convenience.
pub use domain::models::{
    RateLimitConfig, RateLimitExceeded, RateLimitKey, RateLimitKeyBuilder, RateLimitResult,
};
pub use domain::ports::{RateLimitPort, RateLimitService};
pub use domain::service::RateLimitServiceImpl;
pub use outbound::redis::{RedisRateLimitAdapter, RedisRateLimitOps};

/// CI cache experiment marker (PR #8101); never merge.
pub const CI_CACHE_EXPERIMENT: u32 = 8;
