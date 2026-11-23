//! [`Fleet`] on one Firecracker host, through its host agent's
//! [`HostClient`] (mTLS REST and the exec WebSocket): each computer is a
//! microVM restored from the host's golden snapshot of its image and shape,
//! carrying its [`Enrollment`](crate::domain::enrollment::Enrollment) in MMDS
//! ([`firecracker_host_api::mmds::ENROLLMENT_POINTER`]) until macrod has used it.
//!
//! The agent makes every request idempotent; this adapter adds the
//! control-plane checks: an existing guest must belong to this control plane
//! and generation, and a claimed pairing completes creation without issuing
//! a new enrollment. The client spans each request; this adapter spans each
//! fleet verb.
//!
//! A paused or hibernated guest is awake to the lifecycle (its team turned it
//! on); `start` brings it back.

use std::collections::BTreeMap;
use std::sync::Arc;
use std::time::Duration;

use firecracker_host_api::client::{ClientError, ExecOutput, HostClient, HostEndpoint};
use firecracker_host_api::exec::{ExecRequest, Frame};
use firecracker_host_api::{
    Action, Computer as HostComputer, ComputerResources as HostResources, CreateComputer,
    EnrollmentDocument, ErrorCode, HostLimits, PowerState, SetEnrollment,
};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

use crate::domain::enrollment::{EnrollmentGeneration, EnrollmentIssueError};
use crate::domain::ids::ComputerId;
use crate::domain::image::{GuestImage, GuestImages, ROOT_DISK_GIB, data_disk_gib};
use crate::domain::models::{Computer, ControlPlaneId, HostRegistration};
use crate::domain::overcommit::{HostAgentLimits, MemoryReport};
use crate::domain::ports::{
    Fleet, FleetEnrollment, FleetError, FleetInstance, GUEST_USER, GuestProcess, GuestUsage,
    HostLimitsState, HostMemory, InstanceStatus,
};
use crate::domain::size::ComputerResources;
use crate::outbound::stderr_tail::{STDERR_TAIL_BYTES, log_failure};

mod moves;
#[cfg(test)]
mod test;

/// Time to connect to a host agent.
pub const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
/// Time for a whole request: a create from a cold golden takes seconds.
pub const REQUEST_TIMEOUT: Duration = Duration::from_secs(120);
const BYTES_PER_GIB: u64 = 1024 * 1024 * 1024;
const BYTES_PER_MIB: u64 = 1024 * 1024;
const MIB_PER_GIB: u32 = 1024;
/// How much each exec pipe buffers before its writer waits.
const PIPE_BYTES: usize = 64 * 1024;
/// The guest's root account, which restarts macrod.
const ROOT: u32 = 0;
const MACROD_RESTART: [&str; 3] = ["systemctl", "restart", "macrod"];

/// One Firecracker host and what computers are created from.
#[derive(Debug, Clone)]
pub struct FirecrackerFleetConfig {
    /// Owner identity shared by control-plane replicas.
    pub control_plane_id: ControlPlaneId,
    /// Image names the host has goldens for, such as `macro-box/2026-11-17`.
    pub images: GuestImages<GuestImage>,
    /// The host row's name, which registration keeps.
    pub host_name: crate::domain::models::HostName,
}

/// Failure while operating a Firecracker host.
#[derive(Debug, thiserror::Error)]
pub enum FirecrackerFleetError {
    /// The host agent refused the request, or could not be reached.
    #[error(transparent)]
    Client(#[from] ClientError),
    /// Guest enrollment could not be prepared.
    #[error(transparent)]
    Enrollment(#[from] EnrollmentIssueError),
    /// The guest belongs to another control plane or generation.
    #[error("computer {computer_id} belongs to another control plane or generation")]
    EnrollmentMismatch {
        /// Computer this operation addresses.
        computer_id: ComputerId,
    },
    /// The addressed guest does not exist.
    #[error("computer {computer_id} is missing")]
    Missing {
        /// Computer this operation addresses.
        computer_id: ComputerId,
    },
    /// Enrollment JSON could not be encoded.
    #[error("could not encode the enrollment")]
    Encode(#[from] serde_json::Error),
    /// The recorded resources do not fit the host API.
    #[error("computer {0:?} out of the host API's range")]
    Resources(ResourceOutOfRange),
    /// The host reports more memory than this control plane counts.
    #[error("host memory of {bytes} bytes")]
    HostMemory {
        /// What the host reported.
        bytes: u64,
    },
    /// The program in the guest could not run to its end.
    #[error("guest program: {0}")]
    Exec(#[from] ExecFailure),
}

/// Why a guest program ended without the exit it needed.
#[derive(Debug, thiserror::Error)]
pub enum ExecFailure {
    /// The session ended before the program did.
    #[error("the exec session ended before the program")]
    SessionEnded,
    /// The host sent a frame only a caller sends.
    #[error("the host sent a caller frame")]
    CallerFrame,
    /// The guest agent could not run the program, or lost it.
    #[error("{message}")]
    Failed {
        /// The guest agent's reason.
        message: String,
    },
    /// The program exited with a failure where success was required.
    #[error("exited with {code}")]
    ExitCode {
        /// Its exit code.
        code: i32,
    },
}

impl FleetError for FirecrackerFleetError {
    fn is_missing(&self) -> bool {
        match self {
            Self::Missing { .. } => true,
            Self::Client(error) => error.code() == Some(ErrorCode::NotFound),
            _ => false,
        }
    }

    fn is_permanent(&self) -> bool {
        match self {
            Self::Client(ClientError::Credentials(_)) => true,
            Self::Client(error) => error.code().is_some_and(ErrorCode::is_permanent),
            Self::Encode(_) | Self::Resources(_) | Self::HostMemory { .. } => true,
            Self::Enrollment(_)
            | Self::EnrollmentMismatch { .. }
            | Self::Missing { .. }
            | Self::Exec(_) => false,
        }
    }
}

/// Which recorded resource does not fit the host API.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ResourceOutOfRange {
    /// More vCPUs than the API counts.
    Vcpus,
    /// More memory than the API counts.
    Memory,
    /// A disk quota that leaves no `/home` beside the root disk.
    Disk,
}

/// Computers as microVMs on one Firecracker host.
#[derive(Debug, Clone)]
pub struct FirecrackerFleet {
    client: HostClient,
    config: Arc<FirecrackerFleetConfig>,
}

impl FirecrackerFleet {
    /// A fleet over the agent at `endpoint`. Makes no request.
    pub fn new(
        endpoint: &HostEndpoint,
        config: FirecrackerFleetConfig,
    ) -> Result<Self, FirecrackerFleetError> {
        Ok(Self {
            client: HostClient::new(endpoint)?,
            config: Arc::new(config),
        })
    }

    /// A fleet over plain HTTP, for tests against a fake agent.
    #[cfg(test)]
    pub(crate) fn over_plain_http(
        url: &str,
        config: FirecrackerFleetConfig,
    ) -> Result<Self, FirecrackerFleetError> {
        Ok(Self {
            client: HostClient::over_plain_http(url)?,
            config: Arc::new(config),
        })
    }

    /// The computer, `None` when the host has no such VM.
    async fn find(
        &self,
        computer_id: ComputerId,
    ) -> Result<Option<HostComputer>, FirecrackerFleetError> {
        match self.client.computer(computer_id).await {
            Ok(computer) => Ok(Some(computer)),
            Err(error) if error.code() == Some(ErrorCode::NotFound) => Ok(None),
            Err(error) => Err(error.into()),
        }
    }

    async fn act(
        &self,
        computer_id: ComputerId,
        action: Action,
    ) -> Result<(), FirecrackerFleetError> {
        self.client.power(computer_id, action).await?;
        Ok(())
    }

    /// Pause the guest's vCPUs, keeping its memory.
    #[tracing::instrument(name = "firecracker_fleet.freeze", skip_all, fields(%computer_id, host = %self.config.host_name), err)]
    pub async fn freeze(&self, computer_id: ComputerId) -> Result<(), FirecrackerFleetError> {
        self.act(computer_id, Action::Freeze).await
    }

    /// Resume a frozen guest.
    #[tracing::instrument(name = "firecracker_fleet.unfreeze", skip_all, fields(%computer_id, host = %self.config.host_name), err)]
    pub async fn unfreeze(&self, computer_id: ComputerId) -> Result<(), FirecrackerFleetError> {
        self.act(computer_id, Action::Unfreeze).await
    }

    /// Save the guest's memory to its disk and end its process; `start` restores it.
    #[tracing::instrument(name = "firecracker_fleet.hibernate", skip_all, fields(%computer_id, host = %self.config.host_name), err)]
    pub async fn hibernate(&self, computer_id: ComputerId) -> Result<(), FirecrackerFleetError> {
        self.act(computer_id, Action::Hibernate).await
    }

    /// Run `argv` in the guest as root, for operator tools (the fleet port
    /// runs programs as [`GUEST_USER`]).
    #[tracing::instrument(name = "firecracker_fleet.exec_as_root", skip_all, fields(%computer_id, host = %self.config.host_name), err)]
    pub async fn exec_as_root(
        &self,
        computer_id: ComputerId,
        argv: &[&str],
    ) -> Result<GuestProcess<FirecrackerFleetError>, FirecrackerFleetError> {
        self.exec_as(computer_id, argv, ROOT).await
    }

    /// Run `argv` in the guest as `user`.
    async fn exec_as(
        &self,
        computer_id: ComputerId,
        argv: &[&str],
        user: u32,
    ) -> Result<GuestProcess<FirecrackerFleetError>, FirecrackerFleetError> {
        let session = match self
            .client
            .exec(computer_id, exec_request(argv, user))
            .await
        {
            Ok(session) => session,
            Err(error) if error.code() == Some(ErrorCode::NotFound) => {
                return Err(FirecrackerFleetError::Missing { computer_id });
            }
            Err(error) => return Err(error.into()),
        };
        let (mut input, output) = session.split();
        let (stdin, mut stdin_source) = tokio::io::duplex(PIPE_BYTES);
        let (stdout_sink, stdout) = tokio::io::duplex(PIPE_BYTES);
        // The session outlives this call: its stdin pump and its exit wait run
        // under one span parented on the exec call.
        let session_span = tracing::info_span!(
            "firecracker_fleet.exec.session",
            %computer_id,
            exit_code = tracing::field::Empty,
            otel.status_code = tracing::field::Empty,
        );
        let (ended, mut end) = tokio::sync::oneshot::channel::<()>();
        // Not on a TaskTracker (CS-61): both pumps belong to this one
        // GuestProcess and never outlive it. It ends when the program does
        // or the process is dropped (the oneshot closes), dropping the
        // session's input half.
        tokio::spawn(tracing::Instrument::instrument(
            async move {
                let mut buffer = vec![0_u8; PIPE_BYTES];
                loop {
                    tokio::select! {
                        _ = &mut end => return,
                        read = stdin_source.read(&mut buffer) => match read {
                            Ok(0) | Err(_) => break,
                            Ok(read) => {
                                if input.write_stdin(buffer[..read].to_vec()).await.is_err() {
                                    return;
                                }
                            }
                        },
                    }
                }
                if input.close_stdin().await.is_ok() {
                    // Keep the input half until the program ends: closing it
                    // kills the program.
                    end.await.ok();
                }
            },
            session_span.clone(),
        ));
        // stdout is pumped on its own task, so a caller can read the answer
        // before it waits for the exit. Dropping the exit future stops the
        // pump, which drops the session's output half and ends the program.
        let (stop, stopped) = tokio::sync::oneshot::channel::<()>();
        let pump = tokio::spawn(tracing::Instrument::instrument(
            async move {
                tokio::select! {
                    result = wait_for_exit(computer_id, output, stdout_sink) => Some(result),
                    _ = stopped => None,
                }
            },
            session_span.clone(),
        ));
        let exit = tracing::Instrument::instrument(
            async move {
                let _stop = stop;
                let result = match pump.await {
                    Ok(Some(result)) => result,
                    Ok(None) | Err(_) => Err(ExecFailure::SessionEnded.into()),
                };
                drop(ended);
                let span = tracing::Span::current();
                match &result {
                    Ok(code) => span.record("exit_code", code),
                    Err(_) => span.record("otel.status_code", "ERROR"),
                };
                result
            },
            session_span,
        );
        Ok(GuestProcess {
            stdin: Box::pin(stdin),
            stdout: Box::pin(stdout),
            exit: Box::pin(exit),
        })
    }
}

/// Pump stdout to its pipe and keep a stderr tail until the program exits.
async fn wait_for_exit(
    computer_id: ComputerId,
    mut output: ExecOutput,
    mut stdout_sink: tokio::io::DuplexStream,
) -> Result<i32, FirecrackerFleetError> {
    let mut stderr_tail = Vec::new();
    let code = loop {
        let Some(frame) = output.next().await? else {
            return Err(ExecFailure::SessionEnded.into());
        };
        match frame {
            Frame::Stdout(bytes) => {
                // A reader that went away does not stop the program.
                stdout_sink.write_all(&bytes).await.ok();
            }
            Frame::Stderr(bytes) => {
                let room = STDERR_TAIL_BYTES.saturating_sub(stderr_tail.len());
                stderr_tail.extend_from_slice(&bytes[..bytes.len().min(room)]);
            }
            Frame::Exited(code) => break code,
            Frame::Failed(message) => return Err(ExecFailure::Failed { message }.into()),
            Frame::Start(_) | Frame::Stdin(_) | Frame::CloseStdin => {
                return Err(ExecFailure::CallerFrame.into());
            }
        }
    };
    drop(stdout_sink);
    log_failure(computer_id, code, &stderr_tail);
    Ok(code)
}

/// `argv` as `user`, with the guest user's environment and home.
fn exec_request(argv: &[&str], user: u32) -> ExecRequest {
    let gid = if user == ROOT { ROOT } else { GUEST_USER.gid };
    ExecRequest {
        argv: argv.iter().map(|arg| (*arg).to_owned()).collect(),
        uid: user,
        gid,
        env: BTreeMap::from([
            ("HOME".to_owned(), GUEST_USER.home.to_owned()),
            ("PATH".to_owned(), GUEST_USER.path.to_owned()),
        ]),
        cwd: GUEST_USER.home.to_owned(),
        // The host agent stamps its own; the trace joins by `traceparent`.
        trace_id: None,
    }
}

/// The sold limits as the host API counts them.
fn host_resources(resources: ComputerResources) -> Result<HostResources, FirecrackerFleetError> {
    Ok(HostResources {
        vcpus: u8::try_from(resources.vcpus.get())
            .map_err(|_| FirecrackerFleetError::Resources(ResourceOutOfRange::Vcpus))?,
        memory_mib: resources
            .memory_gib
            .get()
            .checked_mul(MIB_PER_GIB)
            .ok_or(FirecrackerFleetError::Resources(ResourceOutOfRange::Memory))?,
        root_disk_gib: ROOT_DISK_GIB,
        home_disk_gib: data_disk_gib(resources)
            .ok_or(FirecrackerFleetError::Resources(ResourceOutOfRange::Disk))?,
    })
}

/// Paused and hibernated guests are on: the team powered them on.
fn observed_status(state: PowerState) -> InstanceStatus {
    match state {
        PowerState::Running | PowerState::Paused | PowerState::Hibernated => {
            InstanceStatus::Running
        }
        PowerState::Stopped => InstanceStatus::Stopped,
    }
}

/// What the agent was asked for, for the reachability gauge.
#[derive(Debug, Clone, Copy, strum::IntoStaticStr)]
#[strum(serialize_all = "snake_case")]
enum Inventory {
    Host,
    Computers,
}

/// Whether the agent answered, per call, so a healthy registration never
/// hides a failing inventory.
fn reachable(host: &str, call: Inventory, reachable: bool) {
    opentelemetry::global::meter("hosted_runtimes")
        .f64_gauge("computer.firecracker.reachable")
        .build()
        .record(
            if reachable { 1.0 } else { 0.0 },
            &[
                opentelemetry::KeyValue::new("host", host.to_owned()),
                opentelemetry::KeyValue::new("call", <&'static str>::from(call)),
            ],
        );
}

impl Fleet for FirecrackerFleet {
    type Err = FirecrackerFleetError;

    fn control_plane_id(&self) -> &ControlPlaneId {
        &self.config.control_plane_id
    }

    #[tracing::instrument(name = "firecracker_fleet.create", skip_all, fields(computer_id = %computer.id, host = %self.config.host_name, generation = i64::from(generation.get()), start = start, existed = tracing::field::Empty), err)]
    async fn create(
        &self,
        computer: &Computer,
        generation: EnrollmentGeneration,
        enrollment: &impl FleetEnrollment,
        start: bool,
    ) -> Result<GuestImage, FirecrackerFleetError> {
        let existing = self.find(computer.id).await?;
        tracing::Span::current().record("existed", existing.is_some());
        if let Some(existing) = existing {
            if existing.control_plane_id != self.config.control_plane_id
                || existing.generation != generation
            {
                return Err(FirecrackerFleetError::EnrollmentMismatch {
                    computer_id: computer.id,
                });
            }
            let image = existing.image;
            if enrollment.claimed(existing.pairing_id).await? {
                return Ok(image);
            }
            let enrollment = enrollment.issue().await?;
            // The agent restarts the enrollment of a running guest itself.
            self.client
                .set_enrollment(
                    computer.id,
                    &SetEnrollment {
                        generation,
                        pairing_id: enrollment.pairing_id,
                        enrollment: EnrollmentDocument(serde_json::to_value(&enrollment)?),
                    },
                )
                .await?;
            if start {
                self.start(computer.id).await?;
            } else {
                self.stop(computer.id).await?;
            }
            return Ok(image);
        }
        if !matches!(
            computer.state.phase,
            crate::domain::lifecycle::Phase::Provisioning { .. }
        ) {
            return Err(FirecrackerFleetError::Missing {
                computer_id: computer.id,
            });
        }
        let resources = host_resources(computer.resources)?;
        let enrollment = enrollment.issue().await?;
        let image = self.config.images.for_enrollment(&enrollment).clone();
        let created = self
            .client
            .create(
                computer.id,
                &CreateComputer {
                    control_plane_id: self.config.control_plane_id.clone(),
                    generation,
                    pairing_id: enrollment.pairing_id,
                    image: image.clone(),
                    // An agent teammate's computer gets no sudo or Docker for its user.
                    role: enrollment.role,
                    resources,
                    enrollment: EnrollmentDocument(serde_json::to_value(&enrollment)?),
                    start,
                    return_when_resumed: false,
                },
            )
            .await?;
        Ok(created.image)
    }

    #[tracing::instrument(name = "firecracker_fleet.start", skip_all, fields(%computer_id, host = %self.config.host_name), err)]
    async fn start(&self, computer_id: ComputerId) -> Result<(), FirecrackerFleetError> {
        self.act(computer_id, Action::Start).await
    }

    #[tracing::instrument(name = "firecracker_fleet.stop", skip_all, fields(%computer_id, host = %self.config.host_name), err)]
    async fn stop(&self, computer_id: ComputerId) -> Result<(), FirecrackerFleetError> {
        match self.act(computer_id, Action::Stop).await {
            Err(error) if error.is_missing() => Ok(()),
            result => result,
        }
    }

    #[tracing::instrument(name = "firecracker_fleet.restart", skip_all, fields(%computer_id, host = %self.config.host_name), err)]
    async fn restart(&self, computer_id: ComputerId) -> Result<(), FirecrackerFleetError> {
        self.act(computer_id, Action::Restart).await
    }

    #[tracing::instrument(name = "firecracker_fleet.restart_macrod", skip_all, fields(%computer_id, host = %self.config.host_name), err)]
    async fn restart_macrod(&self, computer_id: ComputerId) -> Result<(), FirecrackerFleetError> {
        let process = self.exec_as_root(computer_id, &MACROD_RESTART).await?;
        drop(process.stdin);
        match process.exit.await? {
            0 => Ok(()),
            code => Err(ExecFailure::ExitCode { code }.into()),
        }
    }

    #[tracing::instrument(name = "firecracker_fleet.destroy", skip_all, fields(%computer_id, host = %self.config.host_name), err)]
    async fn destroy(&self, computer_id: ComputerId) -> Result<(), FirecrackerFleetError> {
        match self.client.destroy(computer_id).await {
            Err(error) if error.code() == Some(ErrorCode::NotFound) => Ok(()),
            result => Ok(result?),
        }
    }

    #[tracing::instrument(name = "firecracker_fleet.clear_enrollment", skip_all, fields(%computer_id, host = %self.config.host_name), err)]
    async fn clear_enrollment(&self, computer_id: ComputerId) -> Result<(), FirecrackerFleetError> {
        match self.client.clear_enrollment(computer_id).await {
            Err(error) if error.code() == Some(ErrorCode::NotFound) => Ok(()),
            result => Ok(result?),
        }
    }

    #[tracing::instrument(name = "firecracker_fleet.resources_match", skip_all, fields(computer_id = %computer.id, host = %self.config.host_name), err)]
    async fn resources_match(&self, computer: &Computer) -> Result<bool, FirecrackerFleetError> {
        let expected = host_resources(computer.resources)?;
        Ok(self
            .find(computer.id)
            .await?
            .is_some_and(|guest| guest.resources == expected))
    }

    #[tracing::instrument(name = "firecracker_fleet.instances", skip_all, fields(host = %self.config.host_name, count = tracing::field::Empty), err)]
    async fn instances(&self) -> Result<Vec<FleetInstance>, FirecrackerFleetError> {
        let result = self.client.computers().await;
        reachable(
            self.config.host_name.as_str(),
            Inventory::Computers,
            result.is_ok(),
        );
        let instances: Vec<FleetInstance> = result?
            .into_iter()
            .filter(|guest| guest.control_plane_id == self.config.control_plane_id)
            .map(|guest| FleetInstance {
                computer_id: guest.computer_id,
                status: observed_status(guest.state),
                control_plane_id: self.config.control_plane_id.clone(),
                created_at: Some(guest.created_at),
            })
            .collect();
        tracing::Span::current()
            .record("count", i64::try_from(instances.len()).unwrap_or(i64::MAX));
        Ok(instances)
    }

    #[tracing::instrument(name = "firecracker_fleet.host", skip_all, fields(host = %self.config.host_name), err)]
    async fn host(&self) -> Result<HostRegistration, FirecrackerFleetError> {
        let result = self.client.host().await;
        reachable(
            self.config.host_name.as_str(),
            Inventory::Host,
            result.is_ok(),
        );
        let info = result?;
        let memory_gb = u32::try_from(info.memory_total_bytes / BYTES_PER_GIB).map_err(|_| {
            FirecrackerFleetError::HostMemory {
                bytes: info.memory_total_bytes,
            }
        })?;
        Ok(HostRegistration {
            name: self.config.host_name.clone(),
            vcpus: info.cpus,
            memory_gb,
        })
    }

    /// Host-wide resident memory (`MemTotal - MemAvailable`: guests, the
    /// agent and the kernel, without reclaimable cache), the limits the host
    /// enforces and each of this control plane's guests' use.
    #[tracing::instrument(name = "firecracker_fleet.memory", skip_all, fields(host = %self.config.host_name, resident_memory_mib = tracing::field::Empty, guests = tracing::field::Empty), err)]
    async fn memory(&self) -> Result<HostMemory, FirecrackerFleetError> {
        let host = self.client.host().await;
        reachable(
            self.config.host_name.as_str(),
            Inventory::Host,
            host.is_ok(),
        );
        let host = host?;
        let measured_at = chrono::Utc::now();
        let computers = self.client.computers().await;
        reachable(
            self.config.host_name.as_str(),
            Inventory::Computers,
            computers.is_ok(),
        );
        let guests: Vec<GuestUsage> = computers?
            .into_iter()
            .filter(|guest| guest.control_plane_id == self.config.control_plane_id)
            .map(|guest| GuestUsage {
                computer_id: guest.computer_id,
                hibernated: guest.state == PowerState::Hibernated,
                private_memory_bytes: guest.usage.map(|usage| usage.private_memory_bytes),
                swap_bytes: guest.usage.and_then(|usage| usage.swap_bytes),
                cpu_usage_microseconds: guest.usage.map(|usage| usage.cpu_usage_microseconds),
            })
            .collect();
        let resident_memory_mib = host
            .memory_total_bytes
            .saturating_sub(host.memory_available_bytes)
            / BYTES_PER_MIB;
        let span = tracing::Span::current();
        span.record("resident_memory_mib", resident_memory_mib);
        span.record("guests", guests.len());
        Ok(HostMemory {
            report: MemoryReport {
                resident_memory_mib,
                reported_at: measured_at,
            },
            // Set only as a whole; anything less is resent.
            limits: HostLimitsState::Enforced(match host.limits {
                Some(HostLimits {
                    guest_memory_max_bytes,
                    squeeze_above_bytes: Some(above),
                    squeeze_below_bytes: Some(below),
                    home_disk_gib,
                }) => Some(HostAgentLimits {
                    guest_memory_max_mib: guest_memory_max_bytes / BYTES_PER_MIB,
                    squeeze_above_mib: above / BYTES_PER_MIB,
                    squeeze_below_mib: below / BYTES_PER_MIB,
                    home_disk_gib,
                }),
                _ => None,
            }),
            guests,
        })
    }

    #[tracing::instrument(name = "firecracker_fleet.set_host_limits", skip_all, fields(host = %self.config.host_name), err)]
    async fn set_host_limits(&self, limits: HostAgentLimits) -> Result<(), FirecrackerFleetError> {
        let bytes = |mib: u64| mib.saturating_mul(BYTES_PER_MIB);
        self.client
            .set_host_limits(&HostLimits {
                guest_memory_max_bytes: bytes(limits.guest_memory_max_mib),
                squeeze_above_bytes: Some(bytes(limits.squeeze_above_mib)),
                squeeze_below_bytes: Some(bytes(limits.squeeze_below_mib)),
                home_disk_gib: limits.home_disk_gib,
            })
            .await?;
        Ok(())
    }

    async fn hibernate(&self, computer_id: ComputerId) -> Result<(), FirecrackerFleetError> {
        FirecrackerFleet::hibernate(self, computer_id).await
    }

    #[tracing::instrument(name = "firecracker_fleet.exec", skip_all, fields(%computer_id, host = %self.config.host_name), err)]
    async fn exec(
        &self,
        computer_id: ComputerId,
        argv: &[&str],
    ) -> Result<GuestProcess<FirecrackerFleetError>, FirecrackerFleetError> {
        self.exec_as(computer_id, argv, GUEST_USER.uid).await
    }
}
