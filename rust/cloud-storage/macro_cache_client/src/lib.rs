//! A crate used for common operations on the macro cache.

#[cfg(feature = "auth")]
pub mod auth;

#[cfg(feature = "auth_rate_limit")]
pub mod passwordless_rate_limit;

#[cfg(feature = "notification_rate_limit")]
pub mod notification_rate_limit;

#[cfg(feature = "login_code_rate_limit")]
mod login_code_rate_limit;

#[cfg(feature = "verify_email_rate_limit")]
pub mod verify_email_rate_limit;

#[derive(Clone)]
pub struct MacroCache {
    inner: redis::Client,
}

impl MacroCache {
    pub fn new(redis_uri: &str) -> Self {
        let inner = redis::Client::open(redis_uri).expect("could not connect to redis client");
        Self { inner }
    }
}
