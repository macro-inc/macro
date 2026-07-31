//! The idempotent recipe that turns a booted container into a ready sandbox,
//! shared by every provider.
//!
//! Providers implement only the command transport; the recipe is coupled to
//! the container image (bash, the baked nix devshell at `/env`, the sidecar
//! at `/opt/acp-sidecar`), not to any provider. That is why it sits in the
//! domain: the stages and their timeouts are policy, while running a command
//! and polling an HTTP probe are adapter work.
//!
//! The recipe itself is [`ensure_ready.sh`](ENSURE_READY_SCRIPT), embedded at
//! compile time. Paths that only the script uses live in the script; the only
//! value duplicated on this side is [`SIDECAR_PORT`], because Rust has to dial
//! the sidecar afterwards.

use std::time::Duration;

/// Clone + sidecar start; the dev env is prebaked so nothing builds here.
pub const ENSURE_TIMEOUT: Duration = Duration::from_secs(300);

/// How long the sidecar gets to answer its readiness probe after ensure.
pub const PING_TIMEOUT: Duration = Duration::from_secs(60);

/// Where the sidecar's output lands inside the sandbox.
///
/// Mirrored by `sidecar_log` in the script. Named here so a failed boot can
/// fetch it before the sandbox is destroyed.
pub const SIDECAR_LOG: &str = "/tmp/acp-sidecar.log";

/// Port the ACP sidecar listens on inside the sandbox (see
/// `container/Dockerfile`).
///
/// Mirrored by `sidecar_port` in the script.
pub const SIDECAR_PORT: u16 = 8700;

/// The only repository sessions run against for now.
///
/// Reaches the sandbox as the `REPO_URL` environment variable, never
/// interpolated into a shell command. When sessions need to target arbitrary
/// repos this becomes per-session data and grows a validation boundary with it.
pub const REPO_URL: &str = "https://github.com/macro-inc/macro";

/// The readiness recipe, verbatim.
pub const ENSURE_READY_SCRIPT: &str = include_str!("ensure_ready.sh");

/// The recipe as one command for a provider's exec transport.
///
/// Wrapped in `bash -c` rather than handed over as a bare script because the
/// toolbox transport takes a command line, not a file. The script is
/// single-quoted, so any single quote inside it is escaped the usual shell way.
#[must_use]
pub fn ensure_ready_command() -> String {
    format!("bash -c '{}'", ENSURE_READY_SCRIPT.replace('\'', r"'\''"))
}
