//! FusionAuth local bootstrap: generate the per-instance kickstart artifacts
//! and wait for readiness. No Pulumi, no API read-back, no patch step.

use std::process::Command;

use anyhow::{Context, Result};

use super::instance::{Instance, Port};
use super::{gen_compose, kickstart, stage::Stage};

/// The local populate-JWT lambda, embedded at compile time from its canonical
/// source in the FusionAuth stack. It's tiny and effectively static, so there's
/// no reason to read it from disk at runtime (and `include_str!` fails the build
/// if the file ever moves). FA gets the body inlined into `kickstart.json`.
const POPULATE_JWT_LAMBDA: &str = include_str!(
    "../../../../../../infra/stacks/fusionauth-instance/kickstart/lambdas/populate_jwt_local.js"
);

/// Generate `kickstart.json` into the instance's kickstart dir, which the
/// FusionAuth container mounts. The kickstart is pure identity-provider config:
/// run_local pre-seeds no users — passwordless login auto-creates any user on
/// demand.
pub fn write_kickstart(instance: &Instance) -> Result<()> {
    let dir = gen_compose::kickstart_dir(instance);
    std::fs::create_dir_all(&dir)
        .with_context(|| format!("creating kickstart dir {}", dir.display()))?;

    // FusionAuth's kickstart processor strips newlines from string values, which
    // would collapse the leading `//` comments into a single line that swallows
    // `function populate(...)` (FA then rejects it: functionMissing). Drop
    // comment-only lines so the body stays valid even when flattened to one line.
    let lambda_body: String = POPULATE_JWT_LAMBDA
        .lines()
        .filter(|l| !l.trim_start().starts_with("//"))
        .collect::<Vec<_>>()
        .join("\n");

    let doc = kickstart::build(
        instance.port(Port::Frontend),
        instance.port(Port::Auth),
        &lambda_body,
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
