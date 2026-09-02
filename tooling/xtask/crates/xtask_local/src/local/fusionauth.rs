//! FusionAuth local bootstrap: generate the per-instance kickstart artifacts
//! and wait for readiness. No Pulumi, no API read-back, no patch step.

use std::process::Command;

use anyhow::{Context, Result};

use super::instance::{Instance, Port};
use super::{gen_compose, identity, kickstart, stage::Stage};

/// The FusionAuth lambda sources, read from the tracked templates at
/// generation time (anchored on [`xtask_paths::repo_root`], so any cwd works).
/// `populate_jwt_local.js` is the unlicensed local variant (see its header);
/// the reconcile lambda is the same file production deploys via Pulumi.
const POPULATE_JWT_LAMBDA: xtask_paths::RepoFile<'static> =
    xtask_paths::RepoFile::new("infra/stacks/fusionauth-instance/templates/populate_jwt_local.js");
const RECONCILE_LAMBDA: xtask_paths::RepoFile<'static> = xtask_paths::RepoFile::new(
    "infra/stacks/fusionauth-instance/templates/reconcile_secondary_idp_link.js",
);

fn read_lambda(file: xtask_paths::RepoFile<'static>) -> Result<String> {
    let path = xtask_paths::repo_root().join(file.as_str());
    std::fs::read_to_string(&path).with_context(|| format!("reading {}", path.display()))
}

/// Generate `kickstart.json` into the instance's kickstart dir, which the
/// FusionAuth container mounts. The kickstart is pure identity-provider config:
/// run_local pre-seeds no users — passwordless login auto-creates any user on
/// demand. `google` (from the resolved run env) additionally configures the
/// `google`/`google_gmail` OIDC IdPs so the email connect flows work locally,
/// and `github` the `github` IdP that `POST /link/github` resolves; the
/// generated file is gitignored, and the init-snapshot key hashes it, so
/// adding/removing either client re-inits the stack automatically.
pub fn write_kickstart(
    instance: &Instance,
    google: Option<&kickstart::GoogleIdp>,
    github: Option<&kickstart::GithubIdp>,
) -> Result<()> {
    let dir = gen_compose::kickstart_dir(instance);
    std::fs::create_dir_all(&dir)
        .with_context(|| format!("creating kickstart dir {}", dir.display()))?;

    let doc = kickstart::build(
        instance.port(Port::Frontend),
        instance.port(Port::Auth),
        &read_lambda(POPULATE_JWT_LAMBDA)?,
        &read_lambda(RECONCILE_LAMBDA)?,
        google,
        github,
    );
    let json = serde_json::to_string_pretty(&doc)? + "\n";
    std::fs::write(dir.join("kickstart.json"), json)
        .with_context(|| format!("writing {}", dir.join("kickstart.json").display()))?;
    Ok(())
}

/// Block until the kickstart has fully applied (first boot against an empty DB
/// is slow). Runs as a stage so it shows the spinner.
///
/// Polls the kickstart's OWN artifacts — a tenant fetch authorized by the
/// kickstart API key — NOT `/api/status`: FusionAuth reports status Ok while
/// the kickstart is still applying, and the snapshot save stops the containers
/// right after this wait. Gating on status alone once froze a mid-kickstart DB
/// into a snapshot (no tenant), and every stack restored from it 500'd at
/// login with `InvalidTenantIdException` — while the key never changed, so the
/// bad snapshot was sticky. The fetch below succeeds only once the API key,
/// the tenant, and the application all exist (the kickstart creates the
/// application after the tenant).
pub fn wait_ready(stage: &Stage, instance: &Instance) -> Result<()> {
    let url = format!(
        "http://localhost:{}/api/application/{}",
        instance.port(Port::FusionAuth),
        identity::APPLICATION_ID,
    );
    // Require an actual 200: `curl -f` only fails on 400+, so FusionAuth's
    // maintenance-mode 302 (e.g. after a boot-time DB connect failure) would
    // otherwise pass as ready and every later login would 500.
    let script = format!(
        "for i in $(seq 1 120); do [ \"$(curl -sS -o /dev/null -w '%{{http_code}}' --max-time 3 -H 'Authorization: {key}' {url} 2>/dev/null)\" = 200 ] && exit 0; sleep 2; done; \
         echo 'timed out waiting for the FusionAuth kickstart (a 302 here means maintenance mode: FusionAuth could not reach its db)'; exit 1",
        key = identity::FUSIONAUTH_API_KEY,
    );
    let mut cmd = Command::new("bash");
    cmd.arg("-lc").arg(script);
    stage.run("Waiting for FusionAuth (kickstart)", &mut cmd)
}
