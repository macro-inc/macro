//! The local OpenBao readiness gate: startup must initialize and unseal the vault.

use anyhow::{Context, Result};

use super::instance::Instance;
use super::{compose_cmd, env_layer, stage::Stage};

/// Start OpenBao and wait for its healthcheck (`bao status`), which passes only
/// once `start.sh` has initialized and unsealed it.
pub fn wait_ready(stage: &Stage, instance: &Instance, env: &env_layer::ResolvedEnv) -> Result<()> {
    let mut up = compose_cmd(instance, env);
    // Bounded: a crash-looping container with a restart policy is not always
    // reported unhealthy, and the healthcheck's start period exceeds the 60
    // seconds `start.sh` gives initialization.
    up.args(["up", "-d", "--wait", "--wait-timeout", "180", "openbao"]);
    stage.run("Starting OpenBao", &mut up).with_context(|| {
        format!(
            "local OpenBao did not initialize, so Passwords has no vault; \
             `docker compose -p {project} logs openbao` says why",
            project = instance.project_name(),
        )
    })
}
