//! Forwarding every local stack's telemetry to the hosted Grafana, as `services =
//! true` in the local telemetry settings asks (`xtask_local_telemetry::forwarding`).
//!
//! The machine's lgtm collector copies everything it receives to the
//! `grafana-forwarder` container (`docker/docker-compose.yml`,
//! `docker/grafana-forwarder/config.alloy`), which samples it, tags it with the
//! machine's name and sends it with the token. Both containers are global, one
//! per machine, so every bring-up with the default `--traces lgtm` brings them in
//! line with the settings: the latest one decides for every stack on the
//! machine. The forwarder's directory, which holds the token, marks that an
//! earlier run turned forwarding on; it goes only once lgtm stopped copying, so
//! a failed switch-off is retried by the next run.

use std::path::PathBuf;
use std::process::Command;

use anyhow::{Context, Result};
use xtask_local_telemetry::forwarding::write_private;
use xtask_local_telemetry::{Forwarding, ForwardingError, Paths, opaque_id};

use super::instance::Instance;
use super::stage::Stage;

#[cfg(test)]
mod test;

/// The forwarder's compose service and profile.
const SERVICE: &str = "grafana-forwarder";
/// Its container in the global compose project.
const CONTAINER: &str = "macro-grafana-forwarder-1";
/// The lgtm collector's container in the global compose project.
pub(super) const LGTM_CONTAINER: &str = "macro-lgtm-1";
/// The global compose project's `services` network, which the default instance
/// shares; other instances' are `macro-<name>_services`.
const GLOBAL_NETWORK: &str = "macro_services";
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
    /// is off and no earlier run left it on, or the settings can't be used,
    /// which leaves the machine as it is rather than switching on a typo. Off
    /// includes `MACRO_LOCAL_TELEMETRY` and `CI` turning telemetry off.
    pub(super) fn from_settings(stage: &Stage) -> Option<Self> {
        let (forwarder, problem) = Self::from_paths(&Paths::for_user()?);
        if let Some(error) = problem {
            stage.note(&format!(
                "  WARNING: not forwarding telemetry to Grafana: {error}"
            ));
        }
        forwarder
    }

    /// [`Self::from_settings`] for `paths`, with the problem to report.
    fn from_paths(paths: &Paths) -> (Option<Self>, Option<ForwardingError>) {
        let forwarding = match Forwarding::load(paths) {
            Ok(forwarding) => forwarding,
            // The recorder already reports a settings file it can't read.
            Err(ForwardingError::Config(_)) => return (None, None),
            Err(error) => return (None, Some(error)),
        };
        let dir = paths.forwarder_dir();
        let forwarder = (forwarding.is_some() || dir.exists()).then_some(Self { forwarding, dir });
        (forwarder, None)
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
    /// with forwarding off, remove it ([`Self::settle`] removes its token).
    pub(super) fn reconcile(&self, stage: &Stage) -> Result<()> {
        let Some(forwarding) = &self.forwarding else {
            if !stage.is_dry_run() {
                let _ = Command::new("docker")
                    .args(["rm", "-f", CONTAINER])
                    .output();
            }
            stage.note("  stopped forwarding telemetry to Grafana");
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
        // A fixed label: it is also a step name in the run_local dashboard.
        stage.run("Forwarding telemetry to Grafana", &mut up)?;
        stage.note(&format!("  as {}", forwarding.machine().as_str()));
        Ok(())
    }

    /// With forwarding off, remove the token once the lgtm collector
    /// `container` no longer copies to the forwarder; until then the directory
    /// makes the next run try again.
    pub(super) fn settle(&self, stage: &Stage, container: &str) {
        if self.forwarding.is_none()
            && !stage.is_dry_run()
            && lgtm_copy(container).is_some_and(|endpoint| endpoint.is_empty())
        {
            let _ = std::fs::remove_dir_all(&self.dir);
        }
    }
}

/// Whether the running lgtm collector `container` copies to an endpoint other
/// than `wanted` (empty: none).
pub(super) fn lgtm_differs(container: &str, wanted: &str) -> bool {
    lgtm_copy(container).is_some_and(|endpoint| endpoint != wanted)
}

/// The copy endpoint of the lgtm collector `container` (empty: none), or
/// `None` when Docker can't say.
fn lgtm_copy(container: &str) -> Option<String> {
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
        .map(|out| export_endpoint(&String::from_utf8_lossy(&out.stdout)).to_owned())
}

/// Recreate the lgtm collector `container` with copy endpoint `endpoint`. Its
/// data survives in the volume. A recreated container loses the
/// `otel-collector` attachments instances gave it, so it gets back the ones it
/// had and those of every instance network that exists by then, which covers
/// an instance attaching while it was being recreated.
pub(super) fn recreate_lgtm(stage: &Stage, container: &str, endpoint: &str) -> Result<()> {
    let attached = docker_lines(&[
        "inspect",
        "--format",
        "{{range $name, $_ := .NetworkSettings.Networks}}{{println $name}}{{end}}",
        container,
    ]);
    let mut up = super::global_compose("lgtm");
    up.args(["up", "-d", "--force-recreate", "--no-deps", "lgtm"])
        .env(LGTM_FORWARD_VAR, endpoint);
    let label = if endpoint.is_empty() {
        "Restarting the lgtm collector without its Grafana copy"
    } else {
        "Restarting the lgtm collector to copy to Grafana"
    };
    let recreated = stage.run(label, &mut up);
    if stage.is_dry_run() {
        return recreated;
    }
    // Also after a failed `up`, which may have replaced the container. Compose
    // attaches its own project's network; connecting one already attached
    // fails harmlessly.
    let joined: Vec<String> = docker_lines(&["network", "ls", "--format", "{{.Name}}"])
        .into_iter()
        .filter(|name| is_instance_network(name) && !attached.contains(name))
        .filter(|name| has_running_containers(name))
        .collect();
    let networks = attached.into_iter().chain(joined);
    for network in networks {
        let _ = Command::new("docker")
            .args(["network", "connect", "--alias", "otel-collector"])
            .args([network.as_str(), container])
            .output();
    }
    recreated
}

/// The non-empty lines `docker args` prints, none when it fails.
fn docker_lines(args: &[&str]) -> Vec<String> {
    Command::new("docker")
        .args(args)
        .output()
        .ok()
        .filter(|out| out.status.success())
        .map(|out| {
            String::from_utf8_lossy(&out.stdout)
                .lines()
                .map(str::trim)
                .filter(|line| !line.is_empty())
                .map(str::to_owned)
                .collect()
        })
        .unwrap_or_default()
}

/// Whether a container runs on `network`: a stopped instance's network is left
/// alone.
fn has_running_containers(network: &str) -> bool {
    docker_lines(&[
        "network",
        "inspect",
        "--format",
        "{{len .Containers}}",
        network,
    ])
    .first()
    .is_some_and(|count| count != "0")
}

/// Whether `name` is an instance's `services` network (`Instance::network_services`).
fn is_instance_network(name: &str) -> bool {
    name == GLOBAL_NETWORK || (name.starts_with("macro-") && name.ends_with("_services"))
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
