//! Emit host-facing connection env for seeding an instance.
//!
//! Dockerized services reach each other over the compose network
//! (`postgres:5432`, `fusionauth:9011`, ...), but the seed CLI runs on the host
//! and needs `localhost:<host-port>`. This owns the environment used by both
//! `seed-env` and `seed-scenario`, so instance endpoint resolution cannot drift.
//! Each export preserves a value already in the environment (`${VAR:-...}`),
//! so explicit overrides still win and the default instance reproduces the
//! recipe's historical fixed-port defaults exactly.
//!
//! Sync-service and lexical-service do not publish host ports for named
//! instances, so their host-facing URLs go through the instance proxy.

#[cfg(test)]
mod test;

use std::ffi::OsString;
use std::process::Command;

use anyhow::{Context, Result, ensure};

use super::instance::{Instance, Port};

/// Print `export KEY="${KEY:-<host value>}"` lines for the instance's
/// host-facing connection endpoints.
pub fn emit(instance: &Instance) -> Result<()> {
    print!("{}", render(instance));
    Ok(())
}

/// Run `seed_cli scenario` with host-facing defaults for `instance`.
pub fn run_scenario(instance: &Instance, scenario_args: &[OsString]) -> Result<()> {
    let mut cmd = Command::new("just");
    cmd.current_dir(super::repo_root())
        .arg("tooling/seed_cli/scenario")
        .args(scenario_args);
    for (key, value) in values(instance) {
        cmd.env(key, value);
    }
    let status = cmd.status().context("running seed_cli scenario")?;
    ensure!(status.success(), "seed_cli scenario exited with {status}");
    Ok(())
}

/// The `eval`-able export block for the instance's host-facing endpoints. Each
/// line preserves any value already in the environment so explicit overrides
/// win and the default instance reproduces the recipe's fixed-port defaults.
fn render(instance: &Instance) -> String {
    values(instance)
        .into_iter()
        .map(|(key, value)| format!(r#"export {key}="${{{key}:-{value}}}""#))
        .collect::<Vec<_>>()
        .join("\n")
        + "\n"
}

fn values(instance: &Instance) -> Vec<(&'static str, String)> {
    let postgres = instance.port(Port::Postgres);
    let localstack = instance.port(Port::LocalStack);
    let fusionauth = instance.port(Port::FusionAuth);
    let frontend = instance.port(Port::Frontend);
    let (sync_service_url, lexical_service_url) = if instance.is_default() {
        (
            "http://localhost:8787".to_string(),
            "http://localhost:8096".to_string(),
        )
    } else {
        let proxy = instance.port(Port::Proxy);
        (
            format!("http://localhost:{proxy}/sync"),
            format!("http://localhost:{proxy}/lexical"),
        )
    };

    vec![
        (
            "DATABASE_URL",
            format!("postgres://user:password@localhost:{postgres}/macrodb"),
        ),
        ("LOCAL_AWS_URL", format!("http://localhost:{localstack}")),
        (
            "FUSIONAUTH_BASE_URL",
            format!("http://localhost:{fusionauth}"),
        ),
        ("FRONTEND_PORT", frontend.to_string()),
        ("SYNC_SERVICE_URL", sync_service_url),
        ("LEXICAL_SERVICE_URL", lexical_service_url),
    ]
}
