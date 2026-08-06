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

/// Container build recipe.
pub(crate) const CONTAINER_DOCKERFILE: &str = include_str!("../../container/Dockerfile");

/// OpenCode configuration baked into the container.
pub(crate) const CONTAINER_OPENCODE_CONFIG: &str = include_str!("../../container/opencode.json");

/// System instructions baked into the container.
pub(crate) const CONTAINER_SYSTEM_INSTRUCTIONS: &str = include_str!("../../container/SYSTEM.md");

/// Readiness recipe baked alongside the harness container.
pub(crate) const ENSURE_READY_SCRIPT: &str = include_str!("../../container/ensure_ready.sh");

/// Wrap the readiness recipe as one command for provider exec APIs.
#[must_use]
pub fn ensure_ready_command() -> String {
    format!("bash -c '{}'", ENSURE_READY_SCRIPT.replace('\'', r"'\''"))
}
