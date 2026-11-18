//! Local OpenBao (the Passwords vault): the checkout files its container
//! bind-mounts, and the gate that holds the bring-up until it has initialized.

use std::fs;
use std::os::unix::fs::PermissionsExt;

use anyhow::{Context, Result};

use super::instance::Instance;
use super::{compose_cmd, env_layer, repo_root, stage::Stage};

#[cfg(test)]
mod test;

/// Checkout files bind-mounted into the container, as (repo path, container path).
pub const MOUNTS: [(&str, &str); 2] = [
    (
        "infra/local/openbao/local.hcl",
        "/openbao/config/macro-local.hcl",
    ),
    ("infra/local/openbao/start.sh", "/openbao/config/start.sh"),
];

/// Make the bind-mounted files readable by the container's non-root `openbao`
/// user, which reads them through their group/other bits. Git records only
/// 644 or 755 and checkout applies the umask, so under `umask 077` they are
/// 0600 and the container crash-loops; git file modes cannot prevent that.
pub fn make_mounts_readable() -> Result<()> {
    for (path, _) in MOUNTS {
        let path = repo_root().join(path);
        let mode = fs::metadata(&path)
            .with_context(|| format!("reading {}", path.display()))?
            .permissions()
            .mode();
        let readable = readable_mode(mode);
        if readable != mode {
            fs::set_permissions(&path, fs::Permissions::from_mode(readable))
                .with_context(|| format!("making {} readable", path.display()))?;
        }
    }
    Ok(())
}

/// `mode` with group and other read added. Both files are public.
fn readable_mode(mode: u32) -> u32 {
    mode | 0o044
}

/// Start OpenBao and wait for its healthcheck (`bao status`), which passes only
/// once `start.sh` has initialized and unsealed it.
pub fn wait_ready(stage: &Stage, instance: &Instance, env: &env_layer::ResolvedEnv) -> Result<()> {
    let mut up = compose_cmd(instance, env);
    up.args(["up", "-d", "--wait", "openbao"]);
    stage.run("Starting OpenBao", &mut up).with_context(|| {
        format!(
            "local OpenBao did not initialize, so Passwords has no vault; \
             `docker compose -p {project} logs openbao` says why",
            project = instance.project_name(),
        )
    })
}
