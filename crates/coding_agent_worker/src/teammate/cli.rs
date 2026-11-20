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

use super::engine::{
    ContainerState, DELIVERY_LABEL, Delivery, Engine, EngineError, EngineInfo, EngineUnavailable,
    GENERATION_LABEL, RunSpec, run_arguments,
};

/// How long a quick engine command (info, inspect, create) may take.
const QUICK_COMMAND: Duration = Duration::from_secs(30);

/// How long a pull may take.
const PULL_COMMAND: Duration = Duration::from_secs(30 * 60);

/// The longest engine message kept in an error.
const LONGEST_MESSAGE: usize = 500;

/// The engine found by the last [`Engine::info`].
#[derive(Debug, Clone)]
struct Found {
    program: PathBuf,
}

/// Docker or Podman, through its command line.
#[derive(Debug, Default)]
pub struct CliEngine {
    found: Mutex<Option<Found>>,
}

impl CliEngine {
    /// An engine not yet found; [`Engine::info`] finds it.
    pub fn new() -> Self {
        Self::default()
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
            .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(Found { program });
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
            .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(Found { program });
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
        let docker = crate::executable::find(&paths, "docker");
        let podman = crate::executable::find(&paths, "podman");
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
            running: inspected.state.running,
            delivery,
            image_id,
        }))
    }

    async fn run(&self, spec: &RunSpec) -> Result<(), EngineError> {
        self.succeed(run_arguments(spec), QUICK_COMMAND)
            .await
            .map(drop)
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
