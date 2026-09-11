pub mod login_code;
pub mod mobile_welcome_email;
pub mod passwordless;

/// Whether the login-code throttles apply to this build.
///
/// On by default via the `rate_limit` feature. `no_rate_limit` is the local
/// opt-out: `just run_local` needs it off (a 1-request/minute login code makes
/// local dev painful), and expressing that as an *additive* feature is what
/// lets every local service binary build in one `cargo` invocation. Turning it
/// off by dropping a default feature instead would need a package-scoped
/// `--no-default-features` build, whose different feature resolution
/// invalidates the shared dependency artifacts of every other binary — a
/// measured ~2 minutes of rebuild on every `run_local`.
pub const RATE_LIMIT_ENABLED: bool =
    cfg!(feature = "rate_limit") && !cfg!(feature = "no_rate_limit");
