//! Macro computers on a local stack: which fleet `agent_harness_service`'s
//! computer control plane drives, the `COMPUTERS_*` env it reads, and the
//! macro-box image the Docker fleet runs.
//!
//! - `docker`: computers are privileged `macro-box` containers on this
//!   machine's daemon, joined to the instance's `services` network so macrod
//!   dials the stack in-network. The harness already mounts the Docker socket
//!   for local sandboxes; it also gets the enrollment directory at the same
//!   absolute path, because the daemon resolves the bind sources it creates.
//! - `incus`: VMs on `runtime-dev-1`, reached directly over Tailscale.
//!   Resolve the runtime's IPv4 address before generating compose env so
//!   containers do not depend on MagicDNS. Boxes dial the devbox's tailnet IP.
//! - `off`: no control plane; explicitly sets `COMPUTERS_FLEET=disabled`.

use std::collections::BTreeMap;
use std::io::Write;
use std::net::Ipv4Addr;
use std::path::PathBuf;
use std::process::{Command, Stdio};

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
/// Image alias imported on the Incus host (see `nix/macro-box/AGENTS.md`).
pub const INCUS_IMAGE: &str = "macro-box";
pub const DOCKER_HOST_NAME: &str = "local-docker";
pub const INCUS_HOST_NAME: &str = "runtime-dev-1";
/// SHA-256 of the DER certificate `runtime-dev-1`'s Incus API serves.
pub const INCUS_SERVER_FINGERPRINT: &str =
    "7628fcff44f2338383650c2489f38e89a59db5eb951a3de9bf0469f50387d84b";
pub const INCUS_PORT: u16 = 8443;
/// Label `hosted_runtimes::outbound::docker_fleet` puts on every computer.
pub const COMPUTER_ID_LABEL: &str = "macro.computer_id";

/// The `OVERRIDE_*` service URLs macrod's enrollment needs, with the host port
/// a box dials over Tailscale. The app origin has no port: macrod
/// only prints links to it, which open in the developer's browser.
const MACROD_SERVICES: &[(&str, Option<Port>)] = &[
    (
        "OVERRIDE_AGENT_HARNESS_EGRESS_URL",
        Some(Port::AgentHarnessEgress),
    ),
    (
        "OVERRIDE_AGENT_HARNESS_SERVICE_URL",
        Some(Port::AgentHarness),
    ),
    (
        "OVERRIDE_DOCUMENT_STORAGE_SERVICE_URL",
        Some(Port::DocStorage),
    ),
    ("OVERRIDE_AUTH_SERVICE_URL", Some(Port::Auth)),
    ("OVERRIDE_APP_SERVICE_URL", None),
];

/// Which fleet runs a stack's Macro computers.
#[derive(clap::ValueEnum, Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Fleet {
    /// Containers on this machine's Docker daemon.
    Docker,
    /// VMs on the Incus host runtime-dev-1, over Tailscale.
    Incus,
    /// No computer control plane.
    Off,
}

#[derive(Args, Clone, Default)]
pub struct ComputersArgs {
    /// Which fleet runs Macro computers. Defaults to `docker` for
    /// `run_local` and `off` for `stack up`.
    #[arg(long, value_enum)]
    pub computers: Option<Fleet>,
    /// Run no computer control plane and skip the macro-box image build
    /// (`--computers off`).
    #[arg(long, conflicts_with_all = ["computers", "computers_incus"])]
    pub no_computers: bool,
    /// Run computers on runtime-dev-1 instead of local Docker
    /// (`--computers incus`). Needs Tailscale on both hosts.
    #[arg(long, conflicts_with = "computers")]
    pub computers_incus: bool,
}

impl ComputersArgs {
    /// The chosen fleet; `default` when no flag names one.
    pub fn fleet(&self, default: Fleet) -> Fleet {
        if self.no_computers {
            Fleet::Off
        } else if self.computers_incus {
            Fleet::Incus
        } else {
            self.computers.unwrap_or(default)
        }
    }
}

/// One instance's computers setup.
#[derive(Clone, Debug)]
pub struct Computers {
    fleet: Fleet,
    instance: Instance,
}

impl Computers {
    /// Computers run on fully local stacks only: `run_dev` points at shared
    /// dev resources, and the control plane's URL overrides are local-only.
    pub fn new(mode: Mode, fleet: Fleet, instance: &Instance) -> Self {
        let fleet = if mode.spec().runs_local_infra {
            fleet
        } else {
            Fleet::Off
        };
        Self {
            fleet,
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
            Fleet::Incus => {
                let network = IncusNetwork::load()?;
                self.incus_env(env, &IncusCredentials::load(&network)?, &network)?
            }
        };
        env.retain(|key, _| !key.starts_with("COMPUTERS_"));
        env.extend(computers);
        Ok(())
    }

    fn docker_env(&self, env: &BTreeMap<String, String>) -> Result<BTreeMap<String, String>> {
        let overrides = MACROD_SERVICES
            .iter()
            .map(|(name, _)| Ok((name.to_string(), in_network(env, name)?)))
            .collect::<Result<BTreeMap<_, _>>>()?;
        let mut settings = BTreeMap::from([
            ("COMPUTERS_FLEET".into(), "docker".into()),
            (
                "COMPUTERS_CONTROL_PLANE_ID".into(),
                format!("local-{}", self.instance.name()),
            ),
            ("COMPUTERS_HOST_NAME".into(), DOCKER_HOST_NAME.into()),
            ("COMPUTERS_IMAGE".into(), DOCKER_IMAGE.into()),
            ("COMPUTERS_HOST_RESERVE_GB".into(), "7".into()),
            ("COMPUTERS_OVERSELL_FACTOR".into(), "3".into()),
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

    fn incus_env(
        &self,
        env: &BTreeMap<String, String>,
        credentials: &IncusCredentials,
        network: &IncusNetwork,
    ) -> Result<BTreeMap<String, String>> {
        let mut overrides = MACROD_SERVICES
            .iter()
            .map(|(name, port)| {
                let url = match port {
                    Some(port) => {
                        format!(
                            "http://{}:{}",
                            network.control_plane,
                            self.instance.port(*port)
                        )
                    }
                    None => in_network(env, name)?,
                };
                Ok((name.to_string(), url))
            })
            .collect::<Result<BTreeMap<_, _>>>()?;
        for (name, scheme) in [
            ("OVERRIDE_CONNECTION_GATEWAY_URL", "http"),
            ("OVERRIDE_CONNECTION_GATEWAY_WEBSOCKET_URL", "ws"),
        ] {
            overrides.insert(
                name.into(),
                format!(
                    "{scheme}://{}:{}",
                    network.control_plane,
                    self.instance.port(Port::ConnGateway)
                ),
            );
        }
        let mut settings = BTreeMap::from([
            ("COMPUTERS_FLEET".into(), "incus".into()),
            (
                "COMPUTERS_CONTROL_PLANE_ID".into(),
                format!("local-{}", self.instance.name()),
            ),
            ("COMPUTERS_HOST_NAME".into(), INCUS_HOST_NAME.into()),
            ("COMPUTERS_IMAGE".into(), INCUS_IMAGE.into()),
            ("COMPUTERS_HOST_RESERVE_GB".into(), "7".into()),
            ("COMPUTERS_OVERSELL_FACTOR".into(), "3".into()),
            ("COMPUTERS_INCUS_PROFILE".into(), "macro-box".into()),
            ("COMPUTERS_INCUS_STORAGE_POOL".into(), "default".into()),
            ("COMPUTERS_INCUS_REQUEST_TIMEOUT_SECS".into(), "90".into()),
            ("COMPUTERS_INCUS_CONNECT_TIMEOUT_SECS".into(), "10".into()),
            ("COMPUTERS_INCUS_OPERATION_WAIT_SECS".into(), "60".into()),
            ("COMPUTERS_INCUS_OPERATION_WAITS".into(), "15".into()),
            (
                "COMPUTERS_INCUS_STATE_CHANGE_TIMEOUT_SECS".into(),
                "60".into(),
            ),
            ("COMPUTERS_INCUS_SHUTDOWN_GRACE_SECS".into(), "60".into()),
            ("COMPUTERS_INCUS_URL".into(), network.url()),
            (
                "COMPUTERS_INCUS_CLIENT_CERT".into(),
                credentials.client_cert.clone(),
            ),
            (
                "COMPUTERS_INCUS_CLIENT_KEY".into(),
                credentials.client_key.clone(),
            ),
            (
                "COMPUTERS_INCUS_SERVER_CERT".into(),
                credentials.server_cert.clone(),
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
                "computer image: skipping build (--no-build); using {DOCKER_IMAGE}"
            ));
            return Ok(());
        }
        if stage.is_dry_run() {
            stage.note(&format!(
                "computer image: would `nix build .#macro-box-docker` and load {DOCKER_IMAGE}"
            ));
            return Ok(());
        }
        stage.run_step("Building the Macro computer image", load_image)
    }

    /// What the developer must know once the stack is up.
    pub fn print_hint(&self, stage: &Stage) {
        match self.fleet {
            Fleet::Off => {}
            Fleet::Docker => stage.note(&format!(
                "  computers: Docker fleet `{DOCKER_HOST_NAME}` ({DOCKER_IMAGE}) on {}",
                self.instance.network_services()
            )),
            Fleet::Incus => stage.note(&format!(
                "  computers: Incus on {INCUS_HOST_NAME} over Tailscale; \
                 guests dial the devbox tailnet directly; allow this stack's service host ports \
                 (see nix/hosts/README.md)"
            )),
        }
    }
}

/// Addresses are resolved on the host, never through compose's DNS resolver.
struct IncusNetwork {
    runtime: Ipv4Addr,
    control_plane: Ipv4Addr,
}

impl IncusNetwork {
    fn load() -> Result<Self> {
        let runtime = match macro_env_var::maybe_read_env("COMPUTERS_INCUS_ADDRESS") {
            Some(address) => address,
            None => {
                let output = Command::new("tailscale")
                    .args(["ip", "-4", INCUS_HOST_NAME])
                    .output()
                    .context("running tailscale ip -4 runtime-dev-1; join both hosts to the tailnet or set COMPUTERS_INCUS_ADDRESS")?;
                if !output.status.success() {
                    bail!(
                        "runtime-dev-1 is unavailable on Tailscale: {}",
                        String::from_utf8_lossy(&output.stderr).trim()
                    );
                }
                String::from_utf8(output.stdout).context("tailscale returned non-UTF-8 output")?
            }
        };
        let output = Command::new("tailscale")
            .args(["ip", "-4"])
            .output()
            .context("running tailscale ip -4; the devbox must join the tailnet")?;
        if !output.status.success() {
            bail!(
                "devbox is unavailable on Tailscale: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            );
        }
        let control_plane =
            String::from_utf8(output.stdout).context("tailscale returned non-UTF-8 output")?;
        Self::parse(&runtime, &control_plane)
    }

    fn parse(runtime: &str, control_plane: &str) -> Result<Self> {
        let control_plane: Ipv4Addr = control_plane
            .trim()
            .parse()
            .context("tailscale ip -4 must provide one devbox IPv4 address matching macro.computers.controlPlaneAddress")?;
        let [first, second, _, _] = control_plane.octets();
        if first != 100 || !(64..=127).contains(&second) {
            bail!("tailscale ip -4 must provide a devbox address in 100.64.0.0/10");
        }
        Ok(Self {
            runtime: runtime
                .trim()
                .parse()
                .context("COMPUTERS_INCUS_ADDRESS / tailscale ip must provide one IPv4 address")?,
            control_plane,
        })
    }

    fn url(&self) -> String {
        format!("https://{}:{INCUS_PORT}", self.runtime)
    }
}

fn in_network(env: &BTreeMap<String, String>, name: &str) -> Result<String> {
    env.get(name)
        .cloned()
        .with_context(|| format!("computers need {name}, which the local env does not set"))
}

/// The pinned client identity and server certificate the control plane uses
/// for the Incus API, kept outside git in `~/.config/macro-computers`.
pub struct IncusCredentials {
    pub client_cert: String,
    pub client_key: String,
    pub server_cert: String,
}

impl IncusCredentials {
    fn load(network: &IncusNetwork) -> Result<Self> {
        let dir = credentials_dir()?;
        let read = |name: &str| {
            let path = dir.join(name);
            std::fs::read_to_string(&path).with_context(|| {
                format!(
                    "reading {} (the control-plane Incus identity; see nix/hosts/README.md)",
                    path.display()
                )
            })
        };
        let client_cert = read("dev-client.crt")?;
        let client_key = read("dev-client.key")?;
        let server_path = dir.join("dev-server.crt");
        if !server_path.exists() {
            let pem = fetch_server_cert(network)?;
            verify_server_cert(&pem)?;
            std::fs::write(&server_path, &pem)
                .with_context(|| format!("writing {}", server_path.display()))?;
        }
        let server_cert = read("dev-server.crt")?;
        verify_server_cert(&server_cert)?;
        Ok(Self {
            client_cert,
            client_key,
            server_cert,
        })
    }
}

/// Local Incus credentials directory.
fn credentials_dir() -> Result<PathBuf> {
    let config = match macro_env_var::maybe_read_env("XDG_CONFIG_HOME") {
        Some(dir) => PathBuf::from(dir),
        None => PathBuf::from(macro_env_var::maybe_read_env("HOME").context("HOME is not set")?)
            .join(".config"),
    };
    Ok(config.join("macro-computers"))
}

fn verify_server_cert(pem: &str) -> Result<()> {
    let fingerprint = sha256_fingerprint(pem)?;
    if fingerprint != INCUS_SERVER_FINGERPRINT {
        bail!(
            "Incus server certificate fingerprint {fingerprint} differs from pinned {INCUS_SERVER_FINGERPRINT}; verify the endpoint and identity before replacing dev-server.crt"
        );
    }
    Ok(())
}

/// Fetch over Tailscale; the fingerprint is verified before persisting it.
fn fetch_server_cert(network: &IncusNetwork) -> Result<String> {
    let output = Command::new("openssl")
        .args([
            "s_client",
            "-connect",
            &format!("{}:{INCUS_PORT}", network.runtime),
        ])
        .stdin(Stdio::null())
        .output()
        .context("running openssl s_client (run inside nix develop)")?;
    first_pem_certificate(&String::from_utf8_lossy(&output.stdout)).with_context(|| {
        format!(
            "no certificate from {}; check runtime-dev-1's Tailscale login and Incus listener",
            network.url()
        )
    })
}

/// The first PEM certificate block in `text`.
pub fn first_pem_certificate(text: &str) -> Option<String> {
    const BEGIN: &str = "-----BEGIN CERTIFICATE-----";
    const END: &str = "-----END CERTIFICATE-----";
    let start = text.find(BEGIN)?;
    let end = text[start..].find(END)? + start + END.len();
    Some(format!("{}\n", &text[start..end]))
}

/// Lowercase hex SHA-256 of the certificate's DER, as Incus prints it.
fn sha256_fingerprint(pem: &str) -> Result<String> {
    let mut child = Command::new("openssl")
        .args(["x509", "-noout", "-fingerprint", "-sha256"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .context("running openssl x509 (run inside nix develop)")?;
    child
        .stdin
        .take()
        .context("openssl x509 has no stdin")?
        .write_all(pem.as_bytes())
        .context("writing the certificate to openssl")?;
    let output = child.wait_with_output()?;
    if !output.status.success() {
        bail!(
            "openssl could not read the Incus server certificate: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    parse_fingerprint(&String::from_utf8_lossy(&output.stdout))
}

/// `sha256 Fingerprint=76:28:…` → `7628…`.
pub fn parse_fingerprint(openssl_output: &str) -> Result<String> {
    let (_, hex) = openssl_output
        .trim()
        .split_once('=')
        .with_context(|| format!("unexpected openssl fingerprint output: {openssl_output}"))?;
    Ok(hex.replace(':', "").to_ascii_lowercase())
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

fn loaded_image_marker() -> PathBuf {
    repo_root().join("infra/local/generated/.macro-box-image")
}

fn load_image() -> Result<()> {
    let output = Command::new("nix")
        .args([
            "build",
            "--no-link",
            "--print-out-paths",
            ".#macro-box-docker",
        ])
        .current_dir(repo_root())
        .output()
        .context("running nix build .#macro-box-docker")?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let tail: Vec<&str> = stderr.lines().rev().take(20).collect();
        bail!(
            "nix build .#macro-box-docker failed (pass --no-computers to skip computers):\n{}",
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

    let marker = loaded_image_marker();
    let recorded = std::fs::read_to_string(&marker)
        .ok()
        .and_then(|raw| LoadedImage::parse(&raw));
    if let (Some(recorded), Some(current)) = (&recorded, image_id()?)
        && recorded.store_path == store_path
        && recorded.image_id == current
    {
        return Ok(());
    }

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
    let image_id = image_id()?
        .with_context(|| format!("docker load {store_path} did not produce {DOCKER_IMAGE}"))?;
    if let Some(parent) = marker.parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("creating {}", parent.display()))?;
    }
    std::fs::write(
        &marker,
        LoadedImage {
            store_path,
            image_id,
        }
        .render(),
    )
    .with_context(|| format!("writing {}", marker.display()))
}

/// The daemon's id for [`DOCKER_IMAGE`], `None` when it has none.
fn image_id() -> Result<Option<String>> {
    let output = Command::new("docker")
        .args(["image", "inspect", "--format", "{{.Id}}", DOCKER_IMAGE])
        .output()
        .context("running docker image inspect")?;
    Ok(output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).trim().to_owned()))
}

/// Remove this instance's Docker computers: a fresh stack has no rows for
/// them, and they would hold its `services` network open.
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
}
