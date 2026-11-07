//! Deprecated: use `bearer_token`. Kept for one release so open branches
//! keep compiling; delete once nothing depends on it.

#![deny(missing_docs)]

pub use bearer_token::{HashedHarnessToken, hash_token};

/// Display prefix for a harness bearer token; see [`bearer_token::token_prefix`].
pub fn token_prefix(token: &str) -> String {
    bearer_token::token_prefix::<bearer_token::Harness>(token)
}
