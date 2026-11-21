//! Macro computers on a local stack: which fleet `agent_harness_service`'s
//! computer control plane drives, the `COMPUTERS_*` env it reads, and the
//! macro-box image the Docker fleet runs.
//!
//! - `docker`: computers are privileged `macro-box` containers on this
//!   machine's daemon, joined to the instance's `services` network so macrod
//!   dials the stack in-network. The harness already mounts the Docker socket
//!   for local sandboxes; it also gets the enrollment directory at the same
//!   absolute path, because the daemon resolves the bind sources it creates.
//! - `off` (the default): no attached fleet; emits no `COMPUTERS_*` settings
//!   and builds no macro-box image.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::Command;

use anyhow::{Context, Result, bail};
use clap::Args;
use serde::{Deserialize, Serialize};

use super::instance::{Instance, Port};
use super::stage::Stage;
use super::{Mode, repo_root};

#[cfg(test)]
mod test;

/// Tag `nix build .#macro-box-docker` loads as.
pub const DOCKER_IMAGE: &str = "macro-box:latest";
/// Tag `nix build .#macro-box-agent-docker` loads as: the agent-mode guest
/// agent teammates' computers run.
pub const DOCKER_AGENT_IMAGE: &str = "macro-box-agent:latest";
pub const DOCKER_HOST_NAME: &str = "local-docker";
/// Label `hosted_runtimes::outbound::docker_fleet` puts on every computer.
pub const COMPUTER_ID_LABEL: &str = "macro.computer_id";

/// The `OVERRIDE_*` service URLs macrod's enrollment needs.
const MACROD_SERVICES: &[&str] = &[
    "OVERRIDE_API_GATEWAY_URL",
    "OVERRIDE_AGENT_HARNESS_EGRESS_URL",
    "OVERRIDE_AGENT_HARNESS_SERVICE_URL",
    "OVERRIDE_DOCUMENT_STORAGE_SERVICE_URL",
    "OVERRIDE_AUTH_SERVICE_URL",
    "OVERRIDE_DOCUMENT_COGNITION_SERVICE_URL",
    "OVERRIDE_SCHEDULED_ACTION_SERVICE_URL",
    "OVERRIDE_CONNECTION_GATEWAY_URL",
    "OVERRIDE_CONNECTION_GATEWAY_WEBSOCKET_URL",
    "OVERRIDE_MCP_SERVICE_URL",
    // Agent teammates clone and push their workspace repo here; the harness
    // builds clone URLs from this same override.
    "OVERRIDE_AGENT_GIT_SERVICE_URL",
    "OVERRIDE_APP_SERVICE_URL",
];

/// Which fleet runs a stack's Macro computers.
#[derive(clap::ValueEnum, Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Fleet {
    /// Containers on this machine's Docker daemon.
    Docker,
    /// No computer control plane.
    Off,
}

#[derive(Args, Clone, Default)]
pub struct ComputersArgs {
    /// Which fleet runs Macro computers. Defaults to `off`: `docker` builds
    /// the two macro-box images with Nix before the stack starts.
    #[arg(long, value_enum)]
    pub computers: Option<Fleet>,
    /// Run no computer control plane (the default; `--computers off`).
    #[arg(long, conflicts_with = "computers")]
    pub no_computers: bool,
}

impl ComputersArgs {
    /// The chosen fleet: `off` unless `--computers` names one.
    pub fn fleet(&self) -> Fleet {
        if self.no_computers {
            Fleet::Off
        } else {
            self.computers.unwrap_or(Fleet::Off)
        }
    }
}

/// One instance's computers setup.
#[derive(Clone, Debug)]
pub struct Computers {
    fleet: Fleet,
    /// Whether this mode can run computers at all (`run_dev` can't).
    local_infra: bool,
    instance: Instance,
}

impl Computers {
    /// Computers run on fully local stacks only: `run_dev` points at shared
    /// dev resources, and the control plane's URL overrides are local-only.
    pub fn new(mode: Mode, fleet: Fleet, instance: &Instance) -> Self {
        let local_infra = mode.spec().runs_local_infra;
        let fleet = if local_infra { fleet } else { Fleet::Off };
        Self {
            fleet,
            local_infra,
            instance: instance.clone(),
        }
    }

    pub fn fleet(&self) -> Fleet {
        self.fleet
    }

    /// Host directory holding each Docker computer's enrollment.
    pub fn enrollment_dir(&self) -> PathBuf {
        self.instance
            .artifact_dir()
            .join("computers")
            .join("enrollments")
    }

    /// Replace every `COMPUTERS_*` key with this fleet's. `env` must already
    /// hold the stack's in-network service URLs (`LocalEnv::to_env`).
    pub fn write_env(&self, env: &mut BTreeMap<String, String>) -> Result<()> {
        let computers = match self.fleet {
            Fleet::Off => BTreeMap::new(),
            Fleet::Docker => self.docker_env(env)?,
        };
        env.retain(|key, _| !key.starts_with("COMPUTERS_"));
        env.extend(computers);
        Ok(())
    }

    fn docker_env(&self, env: &BTreeMap<String, String>) -> Result<BTreeMap<String, String>> {
        let overrides = MACROD_SERVICES
            .iter()
            .map(|name| {
                let url = if *name == "OVERRIDE_API_GATEWAY_URL" {
                    format!("http://proxy:{}", self.instance.port(Port::ComputerGateway))
                } else {
                    in_network(env, name)?
                };
                Ok((name.to_string(), url))
            })
            .collect::<Result<BTreeMap<_, _>>>()?;
        let mut settings = BTreeMap::from([
            ("COMPUTERS_FLEET".into(), "docker".into()),
            (
                "COMPUTERS_CONTROL_PLANE_ID".into(),
                format!("local-{}", self.instance.name()),
            ),
            ("COMPUTERS_HOST_NAME".into(), DOCKER_HOST_NAME.into()),
            ("COMPUTERS_IMAGE".into(), DOCKER_IMAGE.into()),
            ("COMPUTERS_AGENT_IMAGE".into(), DOCKER_AGENT_IMAGE.into()),
            ("COMPUTERS_DOCKER_MEMORY_GB".into(), "32".into()),
            (
                "COMPUTERS_DOCKER_NETWORK".into(),
                self.instance.network_services(),
            ),
            (
                "COMPUTERS_DOCKER_ENROLLMENT_DIR".into(),
                self.enrollment_dir().display().to_string(),
            ),
        ]);
        settings.extend(overrides);
        Ok(settings)
    }

    /// Build and load the macro-box image for the Docker fleet. Nix is the
    /// build cache; the load is skipped while the daemon still holds the
    /// image this store path last loaded.
    pub fn ensure_image(&self, stage: &Stage, no_build: bool) -> Result<()> {
        if self.fleet != Fleet::Docker {
            return Ok(());
        }
        if no_build {
            stage.note(&format!(
                "computer images: skipping build (--no-build); using {DOCKER_IMAGE} and {DOCKER_AGENT_IMAGE}"
            ));
            return Ok(());
        }
        if stage.is_dry_run() {
            for build in [REGULAR_BUILD, AGENT_BUILD] {
                stage.note(&format!(
                    "computer image: would `nix build .#{}` and load {}",
                    build.attribute, build.tag
                ));
            }
            return Ok(());
        }
        stage.run_step("Building the Macro computer image", || {
            load_image(&stage.quiet(), &REGULAR_BUILD)
        })?;
        stage.run_step("Building the agent teammate computer image", || {
            load_image(&stage.quiet(), &AGENT_BUILD)
        })
    }

    /// What the developer must know once the stack is up.
    pub fn print_hint(&self, stage: &Stage) {
        match self.fleet {
            Fleet::Off if self.local_infra => stage.note(
                "  computers: off (pass --computers docker to buy and run Macro computers locally)",
            ),
            Fleet::Off => {}
            Fleet::Docker => stage.note(&format!(
                "  computers: Docker fleet `{DOCKER_HOST_NAME}` ({DOCKER_IMAGE}) on {}",
                self.instance.network_services()
            )),
        }
    }
}

fn in_network(env: &BTreeMap<String, String>, name: &str) -> Result<String> {
    env.get(name)
        .cloned()
        .with_context(|| format!("computers need {name}, which the local env does not set"))
}

/// The store path and image id the last `docker load` used, shared by every
/// instance (they share one daemon).
#[derive(Debug, PartialEq, Eq)]
pub struct LoadedImage {
    pub store_path: String,
    pub image_id: String,
}

impl LoadedImage {
    pub fn parse(raw: &str) -> Option<Self> {
        let (store_path, image_id) = raw.trim().split_once(' ')?;
        Some(Self {
            store_path: store_path.to_owned(),
            image_id: image_id.to_owned(),
        })
    }

    pub fn render(&self) -> String {
        format!("{} {}\n", self.store_path, self.image_id)
    }
}

/// A guest image the Docker fleet runs: the flake output that builds it, the
/// tag it loads as, and the marker recording what was loaded.
struct GuestBuild {
    attribute: &'static str,
    tag: &'static str,
    marker: &'static str,
}

const REGULAR_BUILD: GuestBuild = GuestBuild {
    attribute: "macro-box-docker",
    tag: DOCKER_IMAGE,
    marker: ".macro-box-image",
};

const AGENT_BUILD: GuestBuild = GuestBuild {
    attribute: "macro-box-agent-docker",
    tag: DOCKER_AGENT_IMAGE,
    marker: ".macro-box-agent-image",
};

fn loaded_image_marker(build: &GuestBuild) -> PathBuf {
    repo_root().join("infra/local/generated").join(build.marker)
}

/// Build `build`'s image with Nix and load it into Docker unless the daemon
/// already has it, each as its own step so telemetry shows which one is slow.
fn load_image(stage: &Stage, build: &GuestBuild) -> Result<()> {
    let mut built = None;
    stage.run_step("Building the image with Nix", || {
        built = Some(nix_build_image(build)?);
        Ok(())
    })?;
    let store_path = built.context("nix build printed no output path")?;

    let marker = loaded_image_marker(build);
    let recorded = std::fs::read_to_string(&marker)
        .ok()
        .and_then(|raw| LoadedImage::parse(&raw));
    if let (Some(recorded), Some(current)) = (&recorded, image_id(build.tag)?)
        && recorded.store_path == store_path
        && recorded.image_id == current
    {
        return Ok(());
    }
    stage.run_step("Loading the image into Docker", || {
        docker_load_image(build, &marker, store_path)
    })
}

/// The image's store path, built if it isn't yet.
fn nix_build_image(build: &GuestBuild) -> Result<String> {
    let attribute = format!(".#{}", build.attribute);
    let output = Command::new("nix")
        .args(["build", "--no-link", "--print-out-paths", &attribute])
        .current_dir(repo_root())
        .output()
        .with_context(|| format!("running nix build {attribute}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let tail: Vec<&str> = stderr.lines().rev().take(20).collect();
        bail!(
            "nix build {attribute} failed (pass --no-computers to skip computers):\n{}",
            tail.into_iter().rev().collect::<Vec<_>>().join("\n")
        );
    }
    let store_path = String::from_utf8_lossy(&output.stdout)
        .lines()
        .last()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .context("nix build printed no output path")?
        .to_owned();
    Ok(store_path)
}

/// Load the image at `store_path` and remember which store path it came from.
fn docker_load_image(build: &GuestBuild, marker: &Path, store_path: String) -> Result<()> {
    let load = Command::new("docker")
        .args(["load", "--quiet", "--input", &store_path])
        .output()
        .context("running docker load")?;
    if !load.status.success() {
        bail!(
            "docker load {store_path} failed: {}",
            String::from_utf8_lossy(&load.stderr).trim()
        );
    }
    let image_id = image_id(build.tag)?
        .with_context(|| format!("docker load {store_path} did not produce {}", build.tag))?;
    if let Some(parent) = marker.parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("creating {}", parent.display()))?;
    }
    std::fs::write(
        marker,
        LoadedImage {
            store_path,
            image_id,
        }
        .render(),
    )
    .with_context(|| format!("writing {}", marker.display()))
}

/// The daemon's id for `tag`, `None` when it has none.
fn image_id(tag: &str) -> Result<Option<String>> {
    let output = Command::new("docker")
        .args(["image", "inspect", "--format", "{{.Id}}", tag])
        .output()
        .context("running docker image inspect")?;
    Ok(output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).trim().to_owned()))
}

/// Remove this instance's Docker computers and their data volumes: a fresh
/// stack has no rows for them, and they would hold its `services` network open.
pub fn remove_containers(instance: &Instance) {
    let Ok(listed) = Command::new("docker")
        .args(["ps", "--all", "--quiet"])
        .args(["--filter", &format!("label={COMPUTER_ID_LABEL}")])
        .args([
            "--filter",
            &format!("network={}", instance.network_services()),
        ])
        .output()
    else {
        return;
    };
    let ids: Vec<String> = String::from_utf8_lossy(&listed.stdout)
        .split_whitespace()
        .map(str::to_owned)
        .collect();
    if ids.is_empty() {
        return;
    }
    let _ = Command::new("docker")
        .args(["rm", "--force", "--volumes"])
        .args(&ids)
        .output();
    remove_volumes(instance);
}

/// The data volumes DockerFleet labels with this instance's control plane.
fn remove_volumes(instance: &Instance) {
    let Ok(listed) = Command::new("docker")
        .args(["volume", "ls", "--quiet"])
        .args([
            "--filter",
            &format!("label=macro.control_plane=local-{}", instance.name()),
        ])
        .output()
    else {
        return;
    };
    let volumes: Vec<String> = String::from_utf8_lossy(&listed.stdout)
        .split_whitespace()
        .map(str::to_owned)
        .collect();
    if volumes.is_empty() {
        return;
    }
    let _ = Command::new("docker")
        .args(["volume", "rm", "--force"])
        .args(&volumes)
        .output();
}
