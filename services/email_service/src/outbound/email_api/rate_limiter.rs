//! Email-service provider rate-limiter adapter.

#[cfg(test)]
mod test;

/// Email-service rate limiter used by the Gmail API composition.
///
/// Its provider quota implementation is added separately from token acquisition.
#[derive(Debug, Clone, Copy, Default)]
pub struct EmailServiceRateLimiter;
