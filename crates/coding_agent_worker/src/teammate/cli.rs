//! The engine port over the `docker` or `podman` command line. Both take the
//! same arguments for everything macrod does; detection picks whichever is
//! installed and answers, Docker first.

use std::ffi::{OsStr, OsString};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Mutex;
use std::time::Duration;

use agent_runtime_protocol::domain::schema::v0::ContainerEngineKind;
use serde::Deserialize;

use super::egress::NetworkFacts;
use super::engine::{
    ContainerState, DELIVERY_LABEL, Delivery, Engine, EngineError, EngineInfo, EngineUnavailable,
    GENERATION_LABEL, GuardError, HolderSpec, RunSpec, guard_arguments, holder_arguments,
    run_arguments,
};
use super::netfacts;
use crate::config::EngineChoice;

/// How long a quick engine command (info, inspect, create) may take.
const QUICK_COMMAND: Duration = Duration::from_secs(30);

/// How long a pull may take.
const PULL_COMMAND: Duration = Duration::from_secs(30 * 60);

/// The longest engine message kept in an error.
const LONGEST_MESSAGE: usize = 500;

/// The engine found by the last [`Engine::info`].
#[derive(Debug, Clone)]
struct Found {
    kind: ContainerEngineKind,
    program: PathBuf,
}

/// Docker or Podman, through its command line.
#[derive(Debug, Default)]
pub struct CliEngine {
    found: Mutex<Option<Found>>,
    choice: EngineChoice,
}

impl CliEngine {
    /// An engine not yet found; [`Engine::info`] finds it (`auto`).
    pub fn new() -> Self {
        Self::default()
    }

    /// An engine of the configured choice.
    pub fn with_choice(choice: EngineChoice) -> Self {
        Self {
            choice,
            ..Self::default()
        }
    }

    /// Whether `kind` may run teammates now.
    pub(crate) fn wanted(&self, kind: ContainerEngineKind) -> bool {
        match (self.choice, kind) {
            (EngineChoice::Auto, _)
            | (EngineChoice::Docker, ContainerEngineKind::Docker)
            | (EngineChoice::Podman, ContainerEngineKind::Podman) => true,
            (EngineChoice::Docker, ContainerEngineKind::Podman)
            | (EngineChoice::Podman, ContainerEngineKind::Docker) => false,
        }
    }

    /// The engine command, for `macrod teammate` to run interactively.
    pub async fn command(&self) -> Result<tokio::process::Command, EngineUnavailable> {
        self.info().await?;
        let found = self.found().map_err(|_| EngineUnavailable::Unreachable)?;
        Ok(tokio::process::Command::new(found.program))
    }

    fn found(&self) -> Result<Found, EngineError> {
        self.found
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone()
            .ok_or_else(|| EngineError("no container engine was found".to_owned()))
    }

    async fn output(
        &self,
        arguments: impl IntoIterator<Item = impl AsRef<OsStr>>,
        timeout: Duration,
    ) -> Result<std::process::Output, EngineError> {
        let found = self.found()?;
        run(&found.program, arguments, timeout).await
    }

    /// Run a command whose success is all that matters.
    async fn succeed(
        &self,
        arguments: impl IntoIterator<Item = impl AsRef<OsStr>>,
        timeout: Duration,
    ) -> Result<String, EngineError> {
        let output = self.output(arguments, timeout).await?;
        if output.status.success() {
            Ok(String::from_utf8_lossy(&output.stdout).trim().to_owned())
        } else {
            Err(failure(&output))
        }
    }

    /// Whether `inspect` finds the object (`container`, `volume`, `network`).
    async fn exists(&self, object: &str, name: &str) -> Result<bool, EngineError> {
        let output = self
            .output(
                [object, "inspect", "--format", "{{json .Name}}", name],
                QUICK_COMMAND,
            )
            .await?;
        Ok(output.status.success())
    }

    async fn detect_docker(&self, program: PathBuf) -> Result<EngineInfo, EngineUnavailable> {
        let output = run(&program, ["info", "--format", "{{json .}}"], QUICK_COMMAND)
            .await
            .map_err(|_| EngineUnavailable::Unreachable)?;
        let info: DockerInfo =
            serde_json::from_slice(&output.stdout).map_err(|_| EngineUnavailable::Unreachable)?;
        let answered = output.status.success()
            && info.server_errors.as_ref().is_none_or(Vec::is_empty)
            && !info.server_version.is_empty();
        if !answered {
            return Err(EngineUnavailable::Unreachable);
        }
        *self
            .found
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(Found {
            kind: ContainerEngineKind::Docker,
            program,
        });
        let rootless = info
            .security_options
            .iter()
            .any(|option| option.split(',').any(|part| part == "name=rootless"));
        Ok(EngineInfo {
            kind: ContainerEngineKind::Docker,
            supported_version: version_at_least(&info.server_version, (24, 0)),
            version: info.server_version,
            rootless,
            cpus: info.cpus,
            memory_mib: info.mem_total / (1024 * 1024),
            disk_free_mib: disk_free_mib(&info.docker_root_dir).await,
        })
    }

    async fn detect_podman(&self, program: PathBuf) -> Result<EngineInfo, EngineUnavailable> {
        let output = run(&program, ["info", "--format", "json"], QUICK_COMMAND)
            .await
            .map_err(|_| EngineUnavailable::Unreachable)?;
        if !output.status.success() {
            return Err(EngineUnavailable::Unreachable);
        }
        let info: PodmanInfo =
            serde_json::from_slice(&output.stdout).map_err(|_| EngineUnavailable::Unreachable)?;
        *self
            .found
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(Found {
            kind: ContainerEngineKind::Podman,
            program,
        });
        Ok(EngineInfo {
            kind: ContainerEngineKind::Podman,
            supported_version: version_at_least(&info.version.version, (4, 4)),
            version: info.version.version,
            rootless: info.host.security.rootless,
            cpus: info.host.cpus,
            memory_mib: info.host.mem_total / (1024 * 1024),
            disk_free_mib: disk_free_mib(&info.store.graph_root).await,
        })
    }
}

impl Engine for CliEngine {
    async fn info(&self) -> Result<EngineInfo, EngineUnavailable> {
        let paths = crate::executable::search_paths();
        let docker = crate::executable::find(&paths, "docker")
            .filter(|_| self.wanted(ContainerEngineKind::Docker));
        let podman = crate::executable::find(&paths, "podman")
            .filter(|_| self.wanted(ContainerEngineKind::Podman));
        if docker.is_none() && podman.is_none() {
            return Err(EngineUnavailable::NotInstalled);
        }
        if let Some(docker) = docker
            && let Ok(info) = self.detect_docker(docker).await
        {
            return Ok(info);
        }
        if let Some(podman) = podman
            && let Ok(info) = self.detect_podman(podman).await
        {
            return Ok(info);
        }
        Err(EngineUnavailable::Unreachable)
    }

    async fn user_namespaces(
        &self,
        image: &str,
        seccomp_profile: &Path,
    ) -> Result<bool, EngineError> {
        // The teammate's own confinement, minus mounts and network, running
        // bubblewrap (in the image) as muppet does: a new user namespace.
        let mut arguments: Vec<OsString> = [
            "run",
            "--rm",
            "--network",
            "none",
            "--user",
            "1000:1000",
            "--read-only",
            "--cap-drop=ALL",
            "--security-opt=no-new-privileges",
        ]
        .into_iter()
        .map(OsString::from)
        .collect();
        let mut seccomp = OsString::from("seccomp=");
        seccomp.push(seccomp_profile);
        arguments.push("--security-opt".into());
        arguments.push(seccomp);
        arguments.extend(
            [
                "--entrypoint",
                "bwrap",
                image,
                "--unshare-user",
                "--dev-bind",
                "/",
                "/",
                "true",
            ]
            .into_iter()
            .map(OsString::from),
        );
        let output = self.output(arguments, QUICK_COMMAND).await?;
        Ok(output.status.success())
    }

    async fn image_id(&self, reference: &str) -> Result<Option<String>, EngineError> {
        let output = self
            .output(
                ["image", "inspect", "--format", "{{.Id}}", reference],
                QUICK_COMMAND,
            )
            .await?;
        if !output.status.success() {
            return Ok(None);
        }
        let id = String::from_utf8_lossy(&output.stdout).trim().to_owned();
        // Podman prints the id without its algorithm.
        let id = if id.starts_with("sha256:") {
            id
        } else {
            format!("sha256:{id}")
        };
        Ok(Some(id))
    }

    async fn pull(&self, reference: &str) -> Result<(), EngineError> {
        self.succeed(["pull", "--quiet", reference], PULL_COMMAND)
            .await
            .map(drop)
    }

    async fn create_network(&self, name: &str) -> Result<(), EngineError> {
        if self.exists("network", name).await? {
            return Ok(());
        }
        self.succeed(
            ["network", "create", "--driver", "bridge", name],
            QUICK_COMMAND,
        )
        .await
        .map(drop)
    }

    async fn remove_network(&self, name: &str) -> Result<(), EngineError> {
        if !self.exists("network", name).await? {
            return Ok(());
        }
        self.succeed(["network", "rm", name], QUICK_COMMAND)
            .await
            .map(drop)
    }

    async fn create_volume(&self, name: &str) -> Result<(), EngineError> {
        if self.exists("volume", name).await? {
            return Ok(());
        }
        self.succeed(["volume", "create", name], QUICK_COMMAND)
            .await
            .map(drop)
    }

    async fn remove_volume(&self, name: &str) -> Result<(), EngineError> {
        if !self.exists("volume", name).await? {
            return Ok(());
        }
        self.succeed(["volume", "rm", name], QUICK_COMMAND)
            .await
            .map(drop)
    }

    async fn container(&self, name: &str) -> Result<Option<ContainerState>, EngineError> {
        let output = self
            .output(
                ["container", "inspect", "--format", "{{json .}}", name],
                QUICK_COMMAND,
            )
            .await?;
        if !output.status.success() {
            return Ok(None);
        }
        let inspected: InspectedContainer = serde_json::from_slice(&output.stdout)
            .map_err(|error| EngineError(error.to_string()))?;
        let labels = inspected.config.labels.unwrap_or_default();
        let label = |name: &str| labels.get(name).and_then(|value| value.parse().ok());
        let delivery =
            label(GENERATION_LABEL)
                .zip(label(DELIVERY_LABEL))
                .map(|(generation, delivery)| Delivery {
                    generation,
                    delivery,
                });
        // Podman names the image by its bare hex, Docker with the prefix.
        let image_id = inspected.image.map(|image| {
            if image.starts_with("sha256:") {
                image
            } else {
                format!("sha256:{image}")
            }
        });
        Ok(Some(ContainerState {
            id: inspected.id,
            running: inspected.state.running,
            delivery,
            image_id,
        }))
    }

    async fn run(&self, spec: &RunSpec) -> Result<(), EngineError> {
        let arguments = run_arguments(spec).map_err(|error| EngineError(error.to_string()))?;
        self.succeed(arguments, QUICK_COMMAND).await.map(drop)
    }

    async fn stop(&self, name: &str, grace: Duration) -> Result<(), EngineError> {
        let seconds = grace.as_secs().to_string();
        self.succeed(["stop", "--time", &seconds, name], grace + QUICK_COMMAND)
            .await
            .map(drop)
    }

    async fn remove_container(&self, name: &str) -> Result<(), EngineError> {
        if !self.exists("container", name).await? {
            return Ok(());
        }
        self.succeed(["rm", "--force", name], QUICK_COMMAND)
            .await
            .map(drop)
    }

    async fn wait(&self, name: &str) -> Result<i64, EngineError> {
        let found = self.found()?;
        // No timeout: the container runs as long as the agent does. The
        // child is killed when the supervisor is dropped.
        let output = tokio::process::Command::new(&found.program)
            .args(["wait", name])
            .stdin(Stdio::null())
            .kill_on_drop(true)
            .output()
            .await
            .map_err(|error| EngineError(error.to_string()))?;
        if !output.status.success() {
            return Err(failure(&output));
        }
        String::from_utf8_lossy(&output.stdout)
            .trim()
            .parse()
            .map_err(|_| EngineError("the engine's exit code is not a number".to_owned()))
    }

    fn installed(&self) -> Vec<ContainerEngineKind> {
        let paths = crate::executable::search_paths();
        [
            ("docker", ContainerEngineKind::Docker),
            ("podman", ContainerEngineKind::Podman),
        ]
        .into_iter()
        .filter(|(program, kind)| {
            self.wanted(*kind) && crate::executable::find(&paths, program).is_some()
        })
        .map(|(_, kind)| kind)
        .collect()
    }

    async fn select(&self, kind: ContainerEngineKind) -> Result<EngineInfo, EngineUnavailable> {
        let paths = crate::executable::search_paths();
        match kind {
            ContainerEngineKind::Docker => {
                let program = crate::executable::find(&paths, "docker")
                    .ok_or(EngineUnavailable::NotInstalled)?;
                self.detect_docker(program).await
            }
            ContainerEngineKind::Podman => {
                let program = crate::executable::find(&paths, "podman")
                    .ok_or(EngineUnavailable::NotInstalled)?;
                self.detect_podman(program).await
            }
        }
    }

    async fn run_holder(&self, spec: &HolderSpec) -> Result<String, EngineError> {
        self.succeed(holder_arguments(spec), QUICK_COMMAND).await
    }

    async fn network_facts(
        &self,
        holder_id: &str,
        networks: &[String],
    ) -> Result<NetworkFacts, EngineError> {
        let found = self.found()?;
        let resolv_conf = self
            .succeed(
                ["exec", holder_id, "cat", "/etc/resolv.conf"],
                QUICK_COMMAND,
            )
            .await?;
        let mut resolvers = netfacts::nameservers(&resolv_conf);
        if found.kind == ContainerEngineKind::Docker {
            // Docker's embedded resolver (127.0.0.11, on lo) forwards from
            // inside the namespace to the daemon's upstreams.
            resolvers.extend(netfacts::docker_upstream_resolvers());
        }
        resolvers.retain(|resolver| !resolver.is_loopback());
        resolvers.sort();
        resolvers.dedup();

        let mut facts = NetworkFacts {
            resolvers,
            ..NetworkFacts::default()
        };
        for network in networks {
            let inspected = self
                .succeed(
                    ["network", "inspect", "--format", "{{json .}}", network],
                    QUICK_COMMAND,
                )
                .await?;
            let (prefixes, gateways) = netfacts::network_subnets(&inspected)
                .map_err(|error| EngineError(format!("network {network}: {error}")))?;
            facts.network_prefixes.extend(prefixes);
            facts.gateways.extend(gateways);
        }
        // Every other network the engine has: rootless Podman routes between
        // its networks inside its rootless namespace, where neither the
        // host's routes nor the holder's own networks show them. Networks
        // without subnets (host, none) have nothing to add.
        let others = self
            .succeed(["network", "ls", "--format", "{{.Name}}"], QUICK_COMMAND)
            .await?;
        for network in others
            .lines()
            .map(str::trim)
            .filter(|name| !name.is_empty())
        {
            if networks.iter().any(|own| own == network) {
                continue;
            }
            let Ok(inspected) = self
                .succeed(
                    ["network", "inspect", "--format", "{{json .}}", network],
                    QUICK_COMMAND,
                )
                .await
            else {
                continue;
            };
            if let Ok((prefixes, _)) = netfacts::network_subnets(&inspected) {
                facts.network_prefixes.extend(prefixes);
            }
        }
        Ok(facts)
    }

    async fn resolve(
        &self,
        holder_id: &str,
        name: &str,
    ) -> Result<Vec<std::net::IpAddr>, EngineError> {
        let printed = self
            .succeed(["exec", holder_id, "getent", "ahosts", name], QUICK_COMMAND)
            .await?;
        Ok(netfacts::resolved_addresses(&printed))
    }

    async fn host_network(&self) -> Result<super::engine::HostNetwork, EngineError> {
        let output = run(Path::new("ip"), ["-j", "address", "show"], QUICK_COMMAND).await?;
        if !output.status.success() {
            return Err(failure(&output));
        }
        let prefixes = netfacts::host_prefixes(&String::from_utf8_lossy(&output.stdout))
            .map_err(|error| EngineError(format!("the host's addresses: {error}")))?;
        let mut host = super::engine::HostNetwork {
            prefixes,
            to_the_internet: false,
        };
        // And every route's destination but the defaults, v4 and v6.
        for family in [None, Some("-6")] {
            let mut arguments = vec!["-j"];
            arguments.extend(family);
            arguments.extend(["route", "show", "table", "all"]);
            let output = run(Path::new("ip"), arguments, QUICK_COMMAND).await?;
            if !output.status.success() {
                return Err(failure(&output));
            }
            let routes = netfacts::routes(&String::from_utf8_lossy(&output.stdout))
                .map_err(|error| EngineError(format!("the host's routes: {error}")))?;
            host.prefixes.extend(routes.destinations);
            host.to_the_internet |= routes.to_the_internet;
        }
        Ok(host)
    }

    async fn guard(
        &self,
        holder_id: &str,
        image_id: &str,
        ruleset: Option<&str>,
    ) -> Result<String, GuardError> {
        use tokio::io::AsyncWriteExt as _;

        let found = self.found().map_err(GuardError::Engine)?;
        let mut child = tokio::process::Command::new(&found.program)
            .args(guard_arguments(holder_id, image_id, ruleset.is_some()))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .map_err(|error| GuardError::Engine(EngineError(error.to_string())))?;
        let mut stdin = child
            .stdin
            .take()
            .ok_or_else(|| GuardError::Engine(EngineError("the guard's stdin".to_owned())))?;
        let ruleset = ruleset.unwrap_or_default().to_owned();
        let written = async move {
            let written = stdin.write_all(ruleset.as_bytes()).await;
            drop(stdin);
            written
        };
        let (written, output) = tokio::time::timeout(QUICK_COMMAND * 2, async {
            tokio::join!(written, child.wait_with_output())
        })
        .await
        .map_err(|_| GuardError::Engine(EngineError("the guard took too long".to_owned())))?;
        let output = output.map_err(|error| GuardError::Engine(EngineError(error.to_string())))?;
        if let Err(error) = written {
            return Err(GuardError::Engine(EngineError(format!(
                "the ruleset: {error}"
            ))));
        }
        if !output.status.success() {
            return Err(GuardError::Refused(failure(&output).0));
        }
        Ok(String::from_utf8_lossy(&output.stdout).into_owned())
    }
}

async fn run(
    program: &Path,
    arguments: impl IntoIterator<Item = impl AsRef<OsStr>>,
    timeout: Duration,
) -> Result<std::process::Output, EngineError> {
    let child = tokio::process::Command::new(program)
        .args(arguments)
        .stdin(Stdio::null())
        .kill_on_drop(true)
        .output();
    match tokio::time::timeout(timeout, child).await {
        Ok(Ok(output)) => Ok(output),
        Ok(Err(error)) => Err(EngineError(error.to_string())),
        Err(_) => Err(EngineError(format!(
            "the engine took longer than {} s",
            timeout.as_secs()
        ))),
    }
}

fn failure(output: &std::process::Output) -> EngineError {
    let message = String::from_utf8_lossy(&output.stderr);
    let message: String = message.trim().chars().take(LONGEST_MESSAGE).collect();
    EngineError(format!("{} ({})", message, output.status))
}

/// Whether a `major.minor[.patch][-suffix]` version is at least `minimum`.
pub fn version_at_least(version: &str, minimum: (u64, u64)) -> bool {
    let mut parts = version
        .split(['.', '-', '+'])
        .map(|part| part.parse::<u64>().ok());
    match (parts.next().flatten(), parts.next().flatten()) {
        (Some(major), Some(minor)) => (major, minor) >= minimum,
        (Some(major), None) => major > minimum.0,
        _ => false,
    }
}

/// Free space under `directory` in MiB, from `df`, when the host can see the
/// directory (a Docker Desktop root is inside its VM).
async fn disk_free_mib(directory: &str) -> Option<u64> {
    if directory.is_empty() {
        return None;
    }
    let output = run(Path::new("df"), ["-Pk", directory], QUICK_COMMAND)
        .await
        .ok()?;
    if !output.status.success() {
        return None;
    }
    parse_df_available_kib(&String::from_utf8_lossy(&output.stdout)).map(|kib| kib / 1024)
}

/// The available KiB in POSIX `df -Pk` output: the fourth column of its
/// second line.
pub fn parse_df_available_kib(output: &str) -> Option<u64> {
    output
        .lines()
        .nth(1)?
        .split_whitespace()
        .nth(3)?
        .parse()
        .ok()
}

#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct DockerInfo {
    #[serde(default)]
    server_version: String,
    #[serde(default)]
    server_errors: Option<Vec<String>>,
    #[serde(default)]
    security_options: Vec<String>,
    #[serde(default, rename = "NCPU")]
    cpus: u32,
    #[serde(default)]
    mem_total: u64,
    #[serde(default)]
    docker_root_dir: String,
}

#[derive(Deserialize)]
struct PodmanInfo {
    host: PodmanHost,
    store: PodmanStore,
    version: PodmanVersion,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PodmanHost {
    cpus: u32,
    mem_total: u64,
    security: PodmanSecurity,
}

#[derive(Deserialize)]
struct PodmanSecurity {
    rootless: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PodmanStore {
    graph_root: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct PodmanVersion {
    version: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct InspectedContainer {
    #[serde(default)]
    id: Option<String>,
    state: InspectedState,
    config: InspectedConfig,
    #[serde(default)]
    image: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct InspectedState {
    running: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct InspectedConfig {
    labels: Option<std::collections::BTreeMap<String, String>>,
}
