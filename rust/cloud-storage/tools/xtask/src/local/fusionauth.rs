//! FusionAuth local bootstrap: generate the per-instance kickstart artifacts
//! and wait for readiness. No Pulumi, no API read-back, no patch step.

use std::process::Command;

use anyhow::{Context, Result};

use super::instance::{Instance, Port};
use super::{gen_compose, kickstart, stage::Stage};

/// The local populate-JWT lambda body, inlined into `kickstart.json`.
///
/// LOCAL-ONLY variant of the production populate-JWT lambda. Production enriches
/// the JWT by calling authentication-service over HTTP, but Lambda HTTP Connect
/// is a licensed FusionAuth feature that silently fails without a Reactor
/// license. Local runs unlicensed, so we derive the claims instead: password
/// users follow the `macro|<email>` convention (see `seed_cli`) and no Google
/// IdP is configured locally, so every local user is a `macro|` user.
/// Divergence from production: `root_macro_id` / `macro_organization_id` are
/// never populated — org-scoped JWT flows need the licensed lambda + a license.
///
/// Inlined (not `include_str!`) because the canonical `.js` lives under
/// `infra/` where a blanket `*.js` gitignore makes it untracked — a fresh
/// checkout / CI / devcontainer wouldn't have it, breaking the build. Kept
/// comment-free so it survives FusionAuth flattening the body to one line.
const POPULATE_JWT_LAMBDA: &str = "function populate(jwt, user, _registration) {
  jwt.fusion_user_id = user.id;
  jwt.email = user.email;
  jwt.macro_user_id = 'macro|' + user.email;
}";

/// Generate `kickstart.json` into the instance's kickstart dir, which the
/// FusionAuth container mounts. The kickstart is pure identity-provider config:
/// run_local pre-seeds no users — passwordless login auto-creates any user on
/// demand.
pub fn write_kickstart(instance: &Instance) -> Result<()> {
    let dir = gen_compose::kickstart_dir(instance);
    std::fs::create_dir_all(&dir)
        .with_context(|| format!("creating kickstart dir {}", dir.display()))?;

    let doc = kickstart::build(
        instance.port(Port::Frontend),
        instance.port(Port::Auth),
        POPULATE_JWT_LAMBDA,
    );
    let json = serde_json::to_string_pretty(&doc)? + "\n";
    std::fs::write(dir.join("kickstart.json"), json)
        .with_context(|| format!("writing {}", dir.join("kickstart.json").display()))?;
    Ok(())
}

/// Block until FusionAuth reports status Ok (it applies the kickstart on first
/// boot against an empty DB, which is slow). Runs as a stage so it shows the
/// spinner.
pub fn wait_ready(stage: &Stage, instance: &Instance) -> Result<()> {
    let url = format!(
        "http://localhost:{}/api/status",
        instance.port(Port::FusionAuth)
    );
    let script = format!(
        "for i in $(seq 1 90); do curl -fsS {url} 2>/dev/null | grep -q '\"status\":\"Ok\"' && exit 0; sleep 2; done; echo 'timed out waiting for FusionAuth'; exit 1"
    );
    let mut cmd = Command::new("bash");
    cmd.arg("-lc").arg(script);
    stage.run("Waiting for FusionAuth", &mut cmd)
}
