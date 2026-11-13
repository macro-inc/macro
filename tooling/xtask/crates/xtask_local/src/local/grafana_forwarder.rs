//! Forwarding every local stack's telemetry to the hosted Grafana, as `services =
//! true` in the local telemetry settings asks (`xtask_local_telemetry::forwarding`).
//!
//! The machine's lgtm collector copies everything it receives to the
//! `grafana-forwarder` container (`docker/docker-compose.yml`,
//! `docker/grafana-forwarder/config.alloy`), which samples it, tags it with the
//! machine's name and sends it with the token. Both containers are global, one
//! per machine, so every bring-up with the default `--traces lgtm` brings them in
//! line with the settings and the latest one decides for every stack on the
//! machine; one with telemetry turned off for that run leaves them as they are.

use std::path::PathBuf;
use std::process::Command;

use anyhow::{Context, Result};
use xtask_local_telemetry::forwarding::write_private;
use xtask_local_telemetry::{Forwarding, Paths, Switch, opaque_id};

use super::instance::Instance;
use super::stage::Stage;

#[cfg(test)]
mod test;

/// The forwarder's compose service and profile.
const SERVICE: &str = "grafana-forwarder";
/// Its container in the global compose project.
const CONTAINER: &str = "macro-grafana-forwarder-1";
/// Where the lgtm collector sends its copy, on the global `services` network.
const FORWARDER_URL: &str = "http://grafana-forwarder:4318";
/// What `docker/docker-compose.yml` passes on as lgtm's copy endpoint.
pub(super) const LGTM_FORWARD_VAR: &str = "MACRO_LGTM_FORWARD_ENDPOINT";
/// The lgtm image's switch for that copy (its `run-otelcol.sh`).
const LGTM_EXPORT_VAR: &str = "OTEL_EXPORTER_OTLP_ENDPOINT";
/// The forwarder's config in the repository, copied beside its token.
const CONFIG_SOURCE: &str = "docker/grafana-forwarder/config.alloy";
const CONFIG_FILE: &str = "config.alloy";
const TOKEN_FILE: &str = "token";
/// The run_local dashboard, which filters by machine; the default endpoint's.
const DASHBOARD_URL: &str = "https://grafana.macro-internal.com/d/macro-run-local";
/// The resource attribute naming the instance a service belongs to.
const INSTANCE_ATTRIBUTE: &str = "macro.local.instance";

/// What the settings ask of this machine's collector.
pub(super) struct Forwarder {
    forwarding: Option<Forwarding>,
    dir: PathBuf,
}

impl Forwarder {
    /// Read the settings, or `None` when this run has nothing to do: forwarding
    /// is off and no earlier run left it on, or `MACRO_LOCAL_TELEMETRY`/`CI`
    /// turn telemetry off for this run only, which leaves the machine's
    /// forwarder as it is. A setting that can't be used is reported and counts
    /// as off.
    pub(super) fn from_settings(stage: &Stage) -> Option<Self> {
        let paths = Paths::for_user()?;
        if paths.switch == Switch::Off {
            return None;
        }
        let forwarding = Forwarding::load(&paths).unwrap_or_else(|error| {
            stage.note(&format!(
                "  WARNING: not forwarding telemetry to Grafana: {error}"
            ));
            None
        });
        let dir = paths.forwarder_dir();
        (forwarding.is_some() || dir.exists()).then_some(Self { forwarding, dir })
    }

    /// The copy endpoint the lgtm collector should have: empty for none.
    pub(super) fn lgtm_endpoint(&self) -> &'static str {
        if self.forwarding.is_some() {
            FORWARDER_URL
        } else {
            ""
        }
    }

    /// Start or update the forwarder with the current config and token, or,
    /// with forwarding off, remove it and its token.
    pub(super) fn reconcile(&self, stage: &Stage) -> Result<()> {
        let Some(forwarding) = &self.forwarding else {
            if !stage.is_dry_run() {
                let _ = Command::new("docker")
                    .args(["rm", "-f", CONTAINER])
                    .output();
                let _ = std::fs::remove_dir_all(&self.dir);
            }
            stage.note("  stopped forwarding telemetry to Grafana (`services` is off)");
            return Ok(());
        };
        let source = super::repo_root().join(CONFIG_SOURCE);
        let config =
            std::fs::read(&source).with_context(|| format!("reading {}", source.display()))?;
        if !stage.is_dry_run() {
            write_private(&self.dir.join(CONFIG_FILE), &config)
                .context("writing the forwarder config")?;
            forwarding
                .write_token(&self.dir.join(TOKEN_FILE))
                .context("writing the forwarder token")?;
        }
        // Compose recreates the container when any of these change, and only
        // then; a changed config file changes the revision.
        let mut up = super::global_compose(SERVICE);
        up.args(["up", "-d", SERVICE])
            .env("MACRO_MACHINE_NAME", forwarding.machine().as_str())
            .env("MACRO_FORWARD_ENDPOINT", forwarding.endpoint())
            .env("MACRO_GRAFANA_FORWARDER_DIR", &self.dir)
            .env(
                "MACRO_GRAFANA_FORWARDER_REVISION",
                opaque_id(&String::from_utf8_lossy(&config)),
            );
        stage.run(
            &format!(
                "Forwarding telemetry to Grafana as {}",
                forwarding.machine().as_str()
            ),
            &mut up,
        )
    }
}

/// Whether the running lgtm collector `container` copies to an endpoint other
/// than `wanted` (empty: none).
pub(super) fn lgtm_differs(container: &str, wanted: &str) -> bool {
    Command::new("docker")
        .args([
            "inspect",
            "--format",
            "{{range .Config.Env}}{{println .}}{{end}}",
        ])
        .arg(container)
        .output()
        .ok()
        .filter(|out| out.status.success())
        .is_some_and(|out| export_endpoint(&String::from_utf8_lossy(&out.stdout)) != wanted)
}

/// Recreate the lgtm collector `container` with copy endpoint `endpoint`. Its
/// data survives in the volume; the `otel-collector` attachments running
/// instances gave it are restored, since a recreated container loses them.
pub(super) fn recreate_lgtm(stage: &Stage, container: &str, endpoint: &str) -> Result<()> {
    let networks = Command::new("docker")
        .args([
            "inspect",
            "--format",
            "{{range $name, $_ := .NetworkSettings.Networks}}{{println $name}}{{end}}",
        ])
        .arg(container)
        .output()
        .map(|out| String::from_utf8_lossy(&out.stdout).into_owned())
        .unwrap_or_default();
    let mut up = super::global_compose("lgtm");
    up.args(["up", "-d", "--force-recreate", "--no-deps", "lgtm"])
        .env(LGTM_FORWARD_VAR, endpoint);
    let label = if endpoint.is_empty() {
        "Restarting the lgtm collector without its Grafana copy"
    } else {
        "Restarting the lgtm collector to copy to Grafana"
    };
    stage.run(label, &mut up)?;
    if stage.is_dry_run() {
        return Ok(());
    }
    // The compose project's own network is attached again by compose; this
    // fails harmlessly for it.
    for network in networks.lines().map(str::trim).filter(|n| !n.is_empty()) {
        let _ = Command::new("docker")
            .args([
                "network",
                "connect",
                "--alias",
                "otel-collector",
                network,
                container,
            ])
            .output();
    }
    Ok(())
}

/// The value of the lgtm copy switch in `docker inspect`'s environment lines,
/// empty when unset.
fn export_endpoint(env: &str) -> &str {
    env.lines()
        .find_map(|line| {
            line.strip_prefix(LGTM_EXPORT_VAR)
                .and_then(|rest| rest.strip_prefix('='))
        })
        .unwrap_or_default()
        .trim()
}

/// `OTEL_RESOURCE_ATTRIBUTES` for `instance`'s services while forwarding is on,
/// so the hosted Grafana can tell this machine's stacks apart.
pub(super) fn resource_attributes(instance: &Instance) -> Option<String> {
    let paths = Paths::for_user()?;
    Forwarding::load(&paths).ok().flatten()?;
    Some(format!("{INSTANCE_ATTRIBUTE}={}", instance.name()))
}

/// The run_local dashboard filtered to this machine, while forwarding to the
/// default endpoint is on.
pub(super) fn dashboard_url() -> Option<String> {
    let paths = Paths::for_user()?;
    let forwarding = Forwarding::load(&paths).ok().flatten()?;
    (forwarding.endpoint() == xtask_local_telemetry::config::DEFAULT_ENDPOINT).then(|| {
        format!(
            "{DASHBOARD_URL}?var-machine={}",
            forwarding.machine().as_str()
        )
    })
}
