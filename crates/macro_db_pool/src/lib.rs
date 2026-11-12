//! Session bounds for MacroDB pools that serve web requests.
//!
//! Postgres keeps running a statement after its client gives up, so without a
//! bound one slow request query can run for as long as it takes.

use sqlx::postgres::PgConnectOptions;

#[cfg(test)]
mod test;

/// Longest one statement on a request-serving connection may run. A statement
/// that legitimately needs longer raises it with `SET LOCAL statement_timeout`
/// in its transaction.
pub const REQUEST_STATEMENT_TIMEOUT: &str = "30s";

/// Longest a request-serving connection may sit idle inside a transaction.
pub const REQUEST_IDLE_IN_TRANSACTION_TIMEOUT: &str = "60s";

/// Idle-in-transaction bound for advisory-lock guard pools derived from a
/// request pool, whose transactions stay open across provider calls. Matches
/// MacroDB's parameter-group default (`infra/stacks/macrodb`).
pub const LOCK_GUARD_IDLE_IN_TRANSACTION_TIMEOUT: &str = "5min";

/// Bounds every session opened with `options` by the request timeouts.
pub fn with_request_timeouts(options: PgConnectOptions) -> PgConnectOptions {
    options.options([
        ("statement_timeout", REQUEST_STATEMENT_TIMEOUT),
        (
            "idle_in_transaction_session_timeout",
            REQUEST_IDLE_IN_TRANSACTION_TIMEOUT,
        ),
    ])
}
