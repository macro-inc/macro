//! Shared container-image readiness recipe used by sandbox providers.

use std::time::Duration;

/// Clone and sidecar startup timeout.
pub const ENSURE_TIMEOUT: Duration = Duration::from_secs(300);

/// Time allowed for the sidecar readiness probe.
pub const PING_TIMEOUT: Duration = Duration::from_secs(60);

/// Location of sidecar output inside the container.
pub const SIDECAR_LOG: &str = "/tmp/acp-sidecar.log";

/// Port exposed by the ACP sidecar.
pub const SIDECAR_PORT: u16 = 8700;

/// Provider-side label carrying the session a container belongs to.
///
/// Shared by every provider because it is what `resume` and `teardown` look a
/// container up by: the harness knows only the session id, and the container is
/// whatever the provider tagged with it.
pub const SESSION_LABEL: &str = "macro.agent_session_id";

/// Readiness recipe baked alongside the harness container.
const ENSURE_READY_SCRIPT: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/container/ensure_ready.sh"
));

/// Wrap the readiness recipe as one command for provider exec APIs.
#[must_use]
pub fn ensure_ready_command() -> String {
    format!("bash -c '{}'", ENSURE_READY_SCRIPT.replace('\'', r"'\''"))
}
