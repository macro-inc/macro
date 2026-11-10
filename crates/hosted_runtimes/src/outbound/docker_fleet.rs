//! [`Fleet`] on the local Docker daemon, for dev stacks without an Incus host.
//!
//! Each computer is a `macro-box` container running systemd.
//! The disk size is not enforced (overlayfs has no per-container quota).
//!
//! Like an Incus computer's data disk, two named volumes keep `/home` and
//! `/var/lib/macrod` (the enrollment marker and Claude token store) across
//! an image update, which recreates the container from the new image.
//! Destroy deletes them; a guest recreated after a loss reuses them. They
//! carry the computer and control-plane labels, so a stack reset finds them.
//!
//! Enrollment is a file: `<enrollment_dir>/<computer id>/enrollment.json` on
//! the host. The computer's directory, not the file, is bind-mounted read-only
//! at `/run/macro`, so deleting the file is visible inside the container and a
//! later `docker start` does not trip over a missing bind source.
//!
//! Every verb builds its `docker` arguments in a pure function, tested without
//! a daemon.

use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::Stdio;

use chrono::{DateTime, Utc};
use macro_env::Environment;

use crate::domain::enrollment::{Enrollment, EnrollmentGeneration, EnrollmentIssueError};
use crate::domain::ids::{ComputerId, PairingId};
use crate::domain::image::{GuestImage, InvalidGuestImage};
use crate::domain::models::{Computer, ControlPlaneId, HostRegistration};
use crate::domain::ports::{Fleet, FleetEnrollment, FleetError, FleetInstance, InstanceStatus};

#[cfg(test)]
mod test;

/// Label carrying the control-plane owner.
pub const CONTROL_PLANE_LABEL: &str = "macro.control_plane";
const CREATED_AT_LABEL: &str = "macro.created_at";
const GENERATION_LABEL: &str = "macro.enrollment_generation";
const PAIRING_LABEL: &str = "macro.pairing_id";
const IMAGE_LABEL: &str = "macro.image";

/// Label every computer container carries, valued with its computer id.
pub const COMPUTER_ID_LABEL: &str = "macro.computer_id";

/// Where the enrollment directory is mounted inside the container; the image's
/// `/etc/macro/enroll.env` reads `file:/run/macro/enrollment.json`.
const ENROLLMENT_MOUNT: &str = "/run/macro";
const ENROLLMENT_FILE: &str = "enrollment.json";

#[cfg(test)]
trait DockerCommand: std::fmt::Debug + Send + Sync {
    fn run(&self, command: &str, args: &[String]) -> Result<String, DockerFleetError>;
}

/// What the Docker fleet runs and how it reports its host.
#[derive(Debug, Clone)]
pub struct DockerFleetConfig {
    /// Owner identity shared by control-plane replicas.
    pub control_plane_id: ControlPlaneId,
    /// The image new computers are created from, e.g. `macro-box:latest`
    /// (`nix build .#macro-box-docker`).
    pub image: GuestImage,
    /// The local stack's Docker network, so computers reach its services by name.
    pub network: String,
    /// Host directory holding one enrollment directory per computer.
    pub enrollment_dir: PathBuf,
    /// Name used to register host capacity.
    pub host_name: String,
    /// Memory in GiB.
    pub memory_gb: u32,
    /// Memory in GiB reserved for the host.
    pub reserve_gb: u32,
    /// Sold units per awake unit.
    pub oversell_factor: u32,
}

/// Failure while operating the local Docker fleet.
#[derive(Debug, thiserror::Error)]
pub enum DockerFleetError {
    /// Enrollment issuance failed.
    #[error(transparent)]
    Issue(#[from] EnrollmentIssueError),
    /// Guest enrollment belongs to another pairing or generation.
    #[error("instance enrollment identity does not match the Create generation")]
    EnrollmentMismatch,
    /// The addressed guest does not exist.
    #[error("instance {computer_id} is missing")]
    Missing {
        /// Computer this operation addresses.
        computer_id: ComputerId,
    },
    /// Docker fleet was selected outside the local environment.
    #[error("DockerFleet only runs in the local environment, not {0:?}")]
    NotLocal(Environment),
    /// The Docker process could not be started.
    #[error("could not run docker: {0}")]
    Spawn(#[source] std::io::Error),
    /// The Docker process exited unsuccessfully.
    #[error("docker {command} exited with {status}: {stderr}")]
    Command {
        /// Docker subcommand that failed.
        command: String,
        /// Docker process exit code.
        status: i32,
        /// Diagnostic output from Docker.
        stderr: String,
    },
    /// Guest enrollment could not be prepared.
    #[error("enrollment at {path}: {source}")]
    Enrollment {
        /// Enrollment file that could not be written.
        path: PathBuf,
        /// Underlying filesystem failure.
        #[source]
        source: std::io::Error,
    },
    /// Enrollment JSON could not be encoded.
    #[error("could not encode the enrollment: {0}")]
    Encode(#[from] serde_json::Error),
    /// A container label holds an invalid image name.
    #[error(transparent)]
    Image(#[from] InvalidGuestImage),
    /// Docker returned invalid output.
    #[error("unexpected docker output: {0}")]
    Malformed(String),
}

/// Computers as containers on the local Docker daemon.
#[derive(Debug, Clone)]
pub struct DockerFleet {
    config: DockerFleetConfig,
    #[cfg(test)]
    command: Option<std::sync::Arc<dyn DockerCommand>>,
}

impl DockerFleet {
    /// Refuses any environment but [`Environment::Local`]: containers are not
    /// an isolation boundary for computers that strangers pay for.
    pub fn new(
        config: DockerFleetConfig,
        environment: Environment,
    ) -> Result<Self, DockerFleetError> {
        match environment {
            Environment::Local => Ok(Self {
                config,
                #[cfg(test)]
                command: None,
            }),
            other => Err(DockerFleetError::NotLocal(other)),
        }
    }

    fn enrollment_dir(&self, computer_id: ComputerId) -> PathBuf {
        self.config.enrollment_dir.join(computer_id.to_string())
    }

    /// The container's state, `None` when it does not exist.
    async fn state(
        &self,
        computer_id: ComputerId,
    ) -> Result<Option<ContainerState>, DockerFleetError> {
        let output = self.docker("ps", &state_args(computer_id)).await?;
        output
            .lines()
            .map(str::trim)
            .find(|line| !line.is_empty())
            .map(ContainerState::parse)
            .transpose()
    }

    async fn write_enrollment(
        &self,
        computer_id: ComputerId,
        enrollment: &Enrollment,
    ) -> Result<PathBuf, DockerFleetError> {
        let dir = self.enrollment_dir(computer_id);
        let io_error = |path: &Path| {
            let path = path.to_owned();
            move |source| DockerFleetError::Enrollment { path, source }
        };
        tokio::fs::create_dir_all(&dir)
            .await
            .map_err(io_error(&dir))?;
        tokio::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700))
            .await
            .map_err(io_error(&dir))?;

        let file = dir.join(ENROLLMENT_FILE);
        let body = zeroize::Zeroizing::new(serde_json::to_vec(enrollment)?);
        // Written in place, never renamed over: a running container keeps
        // seeing the same inode through the directory mount either way.
        tokio::fs::write(&file, body.as_slice())
            .await
            .map_err(io_error(&file))?;
        tokio::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o600))
            .await
            .map_err(io_error(&file))?;
        Ok(dir)
    }
    /// The identity labels of an existing container.
    async fn labels(&self, computer_id: ComputerId) -> Result<ContainerLabels, DockerFleetError> {
        let output = self.docker("inspect", &labels_args(computer_id)).await?;
        ContainerLabels::parse(output.trim_end_matches('\n'))
    }

    async fn docker(&self, command: &str, args: &[String]) -> Result<String, DockerFleetError> {
        #[cfg(test)]
        if let Some(runner) = &self.command {
            return runner.run(command, args);
        }
        docker(command, args).await
    }
}

impl FleetError for DockerFleetError {
    fn is_missing(&self) -> bool {
        matches!(self, Self::Missing { .. })
            || matches!(self, Self::Command { stderr, .. } if stderr.contains("No such container"))
    }
}

impl Fleet for DockerFleet {
    type Err = DockerFleetError;

    fn control_plane_id(&self) -> &ControlPlaneId {
        &self.config.control_plane_id
    }

    #[tracing::instrument(name = "docker_fleet.create", skip_all, fields(computer_id = %computer.id, start), err)]
    async fn create(
        &self,
        computer: &Computer,
        generation: EnrollmentGeneration,
        enrollment: &impl FleetEnrollment,
        start: bool,
    ) -> Result<GuestImage, DockerFleetError> {
        if let Some(state) = self.state(computer.id).await? {
            let labels = self.labels(computer.id).await?;
            if labels.control_plane_id != self.config.control_plane_id
                || labels.generation != generation
            {
                return Err(DockerFleetError::EnrollmentMismatch);
            }
            if enrollment.claimed(labels.pairing_id).await? {
                return Ok(labels.image);
            }
            let enrollment = enrollment.issue().await?;
            self.write_enrollment(computer.id, &enrollment).await?;
            if !start {
                self.stop(computer.id).await?;
            } else if state == ContainerState::Exited || state == ContainerState::Created {
                self.start(computer.id).await?;
            } else {
                self.docker(
                    "exec",
                    &[
                        "exec".to_owned(),
                        container_name(computer.id),
                        "systemctl".to_owned(),
                        "restart".to_owned(),
                        "macrod-enroll.service".to_owned(),
                        "macrod.service".to_owned(),
                    ],
                )
                .await?;
            }
            Ok(labels.image)
        } else {
            if !matches!(
                computer.state.phase,
                crate::domain::lifecycle::Phase::Provisioning { .. }
            ) {
                return Err(DockerFleetError::Missing {
                    computer_id: computer.id,
                });
            }
            let enrollment = enrollment.issue().await?;
            let dir = self.write_enrollment(computer.id, &enrollment).await?;
            let spec = CreateSpec {
                image: self.config.image.clone(),
                network: self.config.network.clone(),
                computer_id: computer.id,
                control_plane_id: self.config.control_plane_id.clone(),
                created_at: Utc::now(),
                generation,
                pairing_id: enrollment.pairing_id,
                memory_gb: computer.resources.memory_gib.get(),
                vcpus: computer.resources.vcpus.get(),
                enrollment_dir: dir,
            };
            self.docker("create", &create_args(&spec)).await?;
            if start {
                self.start(computer.id).await?;
            }
            Ok(self.config.image.clone())
        }
    }

    /// Recreates the container from `image` with the same identity, volumes
    /// and enrollment directory; Docker has no in-place rebuild.
    #[tracing::instrument(name = "docker_fleet.rebuild", skip_all, fields(computer_id = %computer.id, image = %image, start), err)]
    async fn rebuild(
        &self,
        computer: &Computer,
        image: &GuestImage,
        start: bool,
    ) -> Result<(), DockerFleetError> {
        if self.state(computer.id).await?.is_none() {
            return Err(DockerFleetError::Missing {
                computer_id: computer.id,
            });
        }
        let labels = self.labels(computer.id).await?;
        if labels.image != *image {
            let spec = CreateSpec {
                image: image.clone(),
                network: self.config.network.clone(),
                computer_id: computer.id,
                control_plane_id: labels.control_plane_id,
                created_at: labels.created_at,
                generation: labels.generation,
                pairing_id: labels.pairing_id,
                memory_gb: computer.resources.memory_gib.get(),
                vcpus: computer.resources.vcpus.get(),
                enrollment_dir: self.enrollment_dir(computer.id),
            };
            self.stop(computer.id).await?;
            self.docker("rm", &remove_args(computer.id)).await?;
            self.docker("create", &create_args(&spec)).await?;
        }
        if start {
            self.start(computer.id).await
        } else {
            self.stop(computer.id).await
        }
    }

    #[tracing::instrument(name = "docker_fleet.start", skip(self), err)]
    async fn start(&self, computer_id: ComputerId) -> Result<(), DockerFleetError> {
        self.docker("start", &verb_args("start", computer_id))
            .await?;
        Ok(())
    }

    #[tracing::instrument(name = "docker_fleet.stop", skip(self), err)]
    async fn stop(&self, computer_id: ComputerId) -> Result<(), DockerFleetError> {
        if self.state(computer_id).await?.is_none() {
            return Ok(());
        }
        if let Err(error) = self.docker("stop", &verb_args("stop", computer_id)).await {
            return if error.is_missing() {
                Ok(())
            } else {
                Err(error)
            };
        }
        Ok(())
    }

    #[tracing::instrument(name = "docker_fleet.restart", skip(self), err)]
    async fn restart(&self, computer_id: ComputerId) -> Result<(), DockerFleetError> {
        self.docker("restart", &verb_args("restart", computer_id))
            .await?;
        Ok(())
    }

    #[tracing::instrument(name = "docker_fleet.restart_macrod", skip(self), err)]
    async fn restart_macrod(&self, computer_id: ComputerId) -> Result<(), DockerFleetError> {
        self.docker(
            "exec",
            &[
                "exec".to_owned(),
                container_name(computer_id),
                "systemctl".to_owned(),
                "restart".to_owned(),
                "macrod".to_owned(),
            ],
        )
        .await?;
        Ok(())
    }

    #[tracing::instrument(name = "docker_fleet.destroy", skip(self), err)]
    async fn destroy(&self, computer_id: ComputerId) -> Result<(), DockerFleetError> {
        if let Err(error) = self.docker("rm", &remove_args(computer_id)).await
            && !error.is_missing()
        {
            return Err(error);
        }
        // Only once the container is gone: Docker keeps volumes in use.
        self.docker("volume", &remove_volumes_args(computer_id))
            .await?;
        let dir = self.enrollment_dir(computer_id);
        match tokio::fs::remove_dir_all(&dir).await {
            Err(source) if source.kind() != std::io::ErrorKind::NotFound => {
                Err(DockerFleetError::Enrollment { path: dir, source })
            }
            _ => Ok(()),
        }
    }

    #[tracing::instrument(name = "docker_fleet.clear_enrollment", skip(self), err)]
    async fn clear_enrollment(&self, computer_id: ComputerId) -> Result<(), DockerFleetError> {
        let file = self.enrollment_dir(computer_id).join(ENROLLMENT_FILE);
        match tokio::fs::remove_file(&file).await {
            Err(source) if source.kind() != std::io::ErrorKind::NotFound => {
                Err(DockerFleetError::Enrollment { path: file, source })
            }
            _ => Ok(()),
        }
    }

    #[tracing::instrument(name = "docker_fleet.resources_match", skip_all, fields(computer_id = %computer.id), err)]
    async fn resources_match(&self, computer: &Computer) -> Result<bool, Self::Err> {
        let output = self
            .docker(
                "inspect",
                &[
                    "inspect".to_owned(),
                    "--format".to_owned(),
                    "{{.HostConfig.Memory}} {{.HostConfig.NanoCpus}}".to_owned(),
                    container_name(computer.id),
                ],
            )
            .await?;
        // Docker overlayfs has no disk quota; only CPU and memory are enforced.
        Ok(output.trim()
            == format!(
                "{} {}",
                u64::from(computer.resources.memory_gib.get()) * 1024 * 1024 * 1024,
                u64::from(computer.resources.vcpus.get()) * 1_000_000_000
            ))
    }

    #[tracing::instrument(name = "docker_fleet.instances", skip(self), err)]
    async fn instances(&self) -> Result<Vec<FleetInstance>, DockerFleetError> {
        let output = self
            .docker(
                "ps",
                &list_args(&self.config.network, &self.config.control_plane_id),
            )
            .await?;
        parse_instances(&output, &self.config.control_plane_id)
    }

    async fn host(&self) -> Result<HostRegistration, DockerFleetError> {
        Ok(HostRegistration {
            name: self.config.host_name.clone(),
            memory_gb: self.config.memory_gb,
            reserve_gb: self.config.reserve_gb,
            oversell_factor: self.config.oversell_factor,
        })
    }
}

/// Docker's `{{.State}}` for a container.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ContainerState {
    Created,
    Running,
    Restarting,
    Removing,
    Exited,
    Dead,
}

impl ContainerState {
    fn parse(state: &str) -> Result<Self, DockerFleetError> {
        match state {
            "created" => Ok(Self::Created),
            "running" => Ok(Self::Running),
            "restarting" => Ok(Self::Restarting),
            "removing" => Ok(Self::Removing),
            "exited" => Ok(Self::Exited),
            "dead" => Ok(Self::Dead),
            other => Err(DockerFleetError::Malformed(format!(
                "container state {other:?}"
            ))),
        }
    }

    fn status(self) -> InstanceStatus {
        match self {
            Self::Running | Self::Restarting => InstanceStatus::Running,
            Self::Created | Self::Removing | Self::Exited | Self::Dead => InstanceStatus::Stopped,
        }
    }
}

/// The identity a container was created with, kept across rebuilds.
#[derive(Debug, Clone, PartialEq, Eq)]
struct ContainerLabels {
    control_plane_id: ControlPlaneId,
    generation: EnrollmentGeneration,
    pairing_id: PairingId,
    created_at: DateTime<Utc>,
    image: GuestImage,
}

impl ContainerLabels {
    /// Parse [`labels_args`]'s tab-separated output.
    fn parse(output: &str) -> Result<Self, DockerFleetError> {
        let malformed = || DockerFleetError::Malformed(format!("container labels {output:?}"));
        let [owner, generation, pairing, created_at, image] = output
            .split('\t')
            .collect::<Vec<_>>()
            .try_into()
            .map_err(|_| malformed())?;
        Ok(Self {
            control_plane_id: ControlPlaneId::parse(owner.to_owned()).map_err(|_| malformed())?,
            generation: EnrollmentGeneration::new(generation.parse().map_err(|_| malformed())?),
            pairing_id: pairing.parse().map_err(|_| malformed())?,
            created_at: DateTime::parse_from_rfc3339(created_at)
                .map_err(|_| malformed())?
                .with_timezone(&Utc),
            image: GuestImage::try_new(image)?,
        })
    }
}

/// What `docker create` needs for one computer.
#[derive(Debug, Clone, PartialEq, Eq)]
struct CreateSpec {
    generation: EnrollmentGeneration,
    pairing_id: PairingId,
    control_plane_id: ControlPlaneId,
    created_at: DateTime<Utc>,
    image: GuestImage,
    network: String,
    computer_id: ComputerId,
    memory_gb: u32,
    vcpus: u32,
    enrollment_dir: PathBuf,
}

fn container_name(computer_id: ComputerId) -> String {
    format!("macro-computer-{computer_id}")
}

/// The named volumes that outlive the container, and where they mount.
fn volumes(computer_id: ComputerId) -> [(String, &'static str); 2] {
    let name = container_name(computer_id);
    [
        (format!("{name}-home"), "/home"),
        (format!("{name}-macrod"), "/var/lib/macrod"),
    ]
}

/// `docker create` for one computer. The image boots systemd as PID 1, which
/// needs `--privileged` (it also runs Docker inside), a private cgroup
/// namespace, and its own `/run` tmpfs, under which the enrollment mount sits.
fn create_args(spec: &CreateSpec) -> Vec<String> {
    vec![
        "create".to_owned(),
        "--name".to_owned(),
        container_name(spec.computer_id),
        "--hostname".to_owned(),
        container_name(spec.computer_id),
        "--label".to_owned(),
        format!("{COMPUTER_ID_LABEL}={}", spec.computer_id),
        "--label".to_owned(),
        format!("{CONTROL_PLANE_LABEL}={}", spec.control_plane_id.as_str()),
        "--label".to_owned(),
        format!("{CREATED_AT_LABEL}={}", spec.created_at.to_rfc3339()),
        "--label".to_owned(),
        format!("{GENERATION_LABEL}={}", spec.generation.get()),
        "--label".to_owned(),
        format!("{PAIRING_LABEL}={}", spec.pairing_id),
        "--label".to_owned(),
        format!("{IMAGE_LABEL}={}", spec.image),
        "--network".to_owned(),
        spec.network.clone(),
        "--memory".to_owned(),
        format!("{}g", spec.memory_gb),
        format!("--cpus={}", spec.vcpus),
        "--privileged".to_owned(),
        "--cgroupns=private".to_owned(),
        "--tmpfs".to_owned(),
        "/run".to_owned(),
        "--tmpfs".to_owned(),
        "/run/lock".to_owned(),
        "--mount".to_owned(),
        format!(
            "type=bind,source={},target={ENROLLMENT_MOUNT},readonly",
            spec.enrollment_dir.display()
        ),
    ]
    .into_iter()
    .chain(volumes(spec.computer_id).into_iter().flat_map(|(volume, target)| {
        [
            "--mount".to_owned(),
            format!(
                "type=volume,source={volume},target={target},volume-label={COMPUTER_ID_LABEL}={},volume-label={CONTROL_PLANE_LABEL}={}",
                spec.computer_id,
                spec.control_plane_id.as_str()
            ),
        ]
    }))
    .chain([spec.image.as_str().to_owned()])
    .collect()
}

/// `volume rm --force` succeeds for missing volumes too.
fn remove_volumes_args(computer_id: ComputerId) -> Vec<String> {
    ["volume".to_owned(), "rm".to_owned(), "--force".to_owned()]
        .into_iter()
        .chain(volumes(computer_id).into_iter().map(|(volume, _)| volume))
        .collect()
}

fn labels_args(computer_id: ComputerId) -> Vec<String> {
    vec![
        "inspect".to_owned(),
        "--format".to_owned(),
        [
            CONTROL_PLANE_LABEL,
            GENERATION_LABEL,
            PAIRING_LABEL,
            CREATED_AT_LABEL,
            IMAGE_LABEL,
        ]
        .map(|label| format!("{{{{index .Config.Labels \"{label}\"}}}}"))
        .join("\t"),
        container_name(computer_id),
    ]
}

/// `docker <verb> macro-computer-<id>`.
fn verb_args(verb: &str, computer_id: ComputerId) -> Vec<String> {
    vec![verb.to_owned(), container_name(computer_id)]
}

/// `rm --force` succeeds for a missing container too, which destroy needs.
fn remove_args(computer_id: ComputerId) -> Vec<String> {
    vec![
        "rm".to_owned(),
        "--force".to_owned(),
        "--volumes".to_owned(),
        container_name(computer_id),
    ]
}

fn state_args(computer_id: ComputerId) -> Vec<String> {
    vec![
        "ps".to_owned(),
        "--all".to_owned(),
        "--filter".to_owned(),
        format!("label={COMPUTER_ID_LABEL}={computer_id}"),
        "--format".to_owned(),
        "{{.State}}".to_owned(),
    ]
}

fn list_args(network: &str, control_plane_id: &ControlPlaneId) -> Vec<String> {
    vec![
        "ps".to_owned(),
        "--all".to_owned(),
        "--filter".to_owned(),
        format!("label={COMPUTER_ID_LABEL}"),
        "--filter".to_owned(),
        format!("network={network}"),
        "--filter".to_owned(),
        format!("label={CONTROL_PLANE_LABEL}={}", control_plane_id.as_str()),
        "--format".to_owned(),
        format!(
            "{{{{.Label \"{COMPUTER_ID_LABEL}\"}}}}\t{{{{.State}}}}\t{{{{.Label \"{CONTROL_PLANE_LABEL}\"}}}}\t{{{{.Label \"{CREATED_AT_LABEL}\"}}}}"
        ),
    ]
}

/// Tab-separated identity, state, owner and creation timestamp from listing.
fn parse_instances(
    output: &str,
    control_plane_id: &ControlPlaneId,
) -> Result<Vec<FleetInstance>, DockerFleetError> {
    output
        .lines()
        .filter(|line| !line.is_empty())
        .filter_map(|line| {
            let fields: Vec<_> = line.split('\t').collect();
            match fields.as_slice() {
                [_, _, owner, _] if *owner != control_plane_id.as_str() => None,
                [id, state, _, created_at] => Some((|| {
                    let computer_id = id
                        .parse::<ComputerId>()
                        .map_err(|_| DockerFleetError::Malformed(format!("computer id {id:?}")))?;
                    Ok(FleetInstance {
                        computer_id,
                        status: ContainerState::parse(state)?.status(),
                        control_plane_id: control_plane_id.clone(),
                        created_at: DateTime::parse_from_rfc3339(created_at)
                            .ok()
                            .map(|at| at.with_timezone(&Utc)),
                    })
                })()),
                _ => Some(Err(DockerFleetError::Malformed(format!(
                    "ps line {line:?}"
                )))),
            }
        })
        .collect()
}

/// Run one `docker` subcommand, failing on a non-zero exit.
async fn docker(command: &str, args: &[String]) -> Result<String, DockerFleetError> {
    let output = tokio::process::Command::new("docker")
        .args(args)
        .stdin(Stdio::null())
        .kill_on_drop(true)
        .output()
        .await
        .map_err(DockerFleetError::Spawn)?;
    if !output.status.success() {
        return Err(DockerFleetError::Command {
            command: command.to_owned(),
            status: output.status.code().unwrap_or(-1),
            stderr: String::from_utf8_lossy(&output.stderr).trim().to_owned(),
        });
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}
