//! Local OpenSearch index bootstrap. The index mappings live in the TS infra
//! helpers (the canonical, test-guarded source), so we run `create_indices.ts`
//! against the local cluster rather than duplicate the mapping bodies in Rust.
//! It creates every index + alias the search reads (documents, emails, channels,
//! chats, call_records) and is idempotent — safe to run on every startup.

use std::collections::BTreeMap;
use std::process::Command;

use anyhow::Result;

use super::instance::{Instance, Port};
use super::{repo_root, stage::Stage};

/// The TS OpenSearch helpers package (its own package.json + bun.lock).
fn helpers_dir() -> std::path::PathBuf {
    repo_root().join("infra/stacks/opensearch/helpers")
}

/// Create the search indices + aliases in the local OpenSearch by running the
/// canonical TS bootstrap script. The local cluster runs with the security
/// plugin disabled, so the credentials are accepted but ignored — they only need
/// to be present for the client to construct.
pub fn provision_indices(
    stage: &Stage,
    instance: &Instance,
    env: &BTreeMap<String, String>,
) -> Result<()> {
    let dir = helpers_dir();
    let url = format!("http://localhost:{}", instance.port(Port::OpenSearch));
    let username = env
        .get("OPENSEARCH_USERNAME")
        .cloned()
        .unwrap_or_else(|| "macrouser".to_string());
    let password = env
        .get("OPENSEARCH_PASSWORD")
        .cloned()
        .unwrap_or_else(|| "local".to_string());

    if !dir.join("node_modules").exists() {
        let mut install = Command::new("bun");
        install.current_dir(&dir).arg("install");
        stage.run("Installing OpenSearch helper deps", &mut install)?;
    }

    let mut cmd = Command::new("bun");
    cmd.current_dir(&dir)
        .args(["run", "scripts/create_indices.ts"])
        .env("ENVIRONMENT", "local")
        // The helper scripts are dry-run by default. Local bootstrap always
        // applies for real.
        .env("DRY_RUN", "false")
        .env("OPENSEARCH_URL", &url)
        .env("OPENSEARCH_USERNAME", &username)
        .env("OPENSEARCH_PASSWORD", &password);
    stage.run("Creating search indices", &mut cmd)?;
    Ok(())
}
