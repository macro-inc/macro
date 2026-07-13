//! Shared helpers for local E2E tests that run against the `run_local` stack.
//!
//! The crate intentionally reads the same seed files used by `seed_cli` and
//! Playwright so Rust integration tests do not duplicate fixture constants.

mod config;
mod fixtures;
mod jwt;
mod services;

pub use config::LocalE2eConfig;
pub use fixtures::{
    LocalE2eManifest, LocalE2eSeed, SeedChannel, SeedChannelMessage, SeedDocument, SeedMention,
    SeedUser,
};
pub use jwt::{
    DEFAULT_EXPIRY_SECONDS, LocalJwtClaims, LocalJwtOptions, encode_local_jwt,
    encode_local_jwt_claims_with, encode_local_jwt_with,
};
pub use services::LocalE2eServices;
