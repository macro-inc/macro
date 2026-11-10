//! [`Fleet`] on one Incus host: each computer is a VM from the `macro-box`
//! image, carrying its [`Enrollment`] in the [`INCUS_ENROLLMENT_KEY`] config
//! key that macrod reads through `/dev/incus`.
//!
//! Verbs check the instance's status first so a retried effect is a no-op
//! instead of an Incus "already running" error.

use std::collections::BTreeMap;
use std::time::Duration;

use chrono::{DateTime, Utc};
use incus_client::generated::types;
use incus_client::{
    ImageReference, ImageSource, IncusClient, IncusEndpoint, IncusError, InstanceInfo,
    InstanceKind, InstanceName, ProfileName, StoragePoolName,
};

use crate::domain::enrollment::{EnrollmentGeneration, EnrollmentIssueError, INCUS_ENROLLMENT_KEY};
use crate::domain::ids::{ComputerId, PairingId};
use crate::domain::models::{Computer, ControlPlaneId, HostRegistration};
use crate::domain::ports::{Fleet, FleetEnrollment, FleetError, FleetInstance, InstanceStatus};
use crate::domain::size::ComputerResources;

#[cfg(test)]
mod test;

/// Instance config key carrying the control-plane owner.
pub const CONTROL_PLANE_KEY: &str = "user.macro.control_plane";
const CREATED_AT_KEY: &str = "user.macro.created_at";
const GENERATION_KEY: &str = "user.macro.enrollment_generation";
const PAIRING_KEY: &str = "user.macro.pairing_id";

/// Instance config key carrying the computer id.
pub const COMPUTER_ID_KEY: &str = "user.macro.computer_id";

const BYTES_PER_GIB: u64 = 1024 * 1024 * 1024;

/// The Incus host and what computers are created from.
#[derive(Debug, Clone)]
pub struct IncusFleetConfig {
    /// Owner identity shared by control-plane replicas.
    pub control_plane_id: ControlPlaneId,
    /// Incus endpoint and request limits.
    pub endpoint: IncusEndpoint,
    /// Usually the local alias `macro-box`.
    pub image: ImageSource,
    /// Profile carrying the NIC and `security.guestapi`.
    pub profile: ProfileName,
    /// Storage pool of the root disk override; Incus requires it.
    pub storage_pool: StoragePoolName,
    /// Name used to register host capacity.
    pub host_name: String,
    /// Memory in GiB reserved for the host.
    pub reserve_gb: u32,
    /// Sold units per awake unit.
    pub oversell_factor: u32,
    /// Deadline for clean shutdown before forcibly stopping the VM.
    pub shutdown_grace: Duration,
}

/// Failure while operating the Incus fleet.
#[derive(Debug, thiserror::Error)]
pub enum IncusFleetError {
    /// Guest enrollment could not be prepared.
    #[error(transparent)]
    Enrollment(#[from] EnrollmentIssueError),
    /// Guest enrollment belongs to another pairing or generation.
    #[error("instance enrollment identity does not match the Create generation")]
    EnrollmentMismatch,
    /// The addressed guest does not exist.
    #[error("instance {computer_id} is missing")]
    Missing {
        /// Computer this operation addresses.
        computer_id: ComputerId,
    },
    /// Incus API operation failed.
    #[error(transparent)]
    Incus(#[from] IncusError),
    /// Enrollment JSON could not be encoded.
    #[error("could not encode the enrollment: {0}")]
    Encode(#[from] serde_json::Error),
    /// Instance metadata contains an invalid computer identity.
    #[error("instance {name} has an invalid {COMPUTER_ID_KEY} {value:?}")]
    BadComputerId {
        /// Incus instance name.
        name: String,
        /// Invalid computer identity from instance metadata.
        value: String,
    },
    /// Incus returned an unsupported guest status.
    #[error("instance {name} is in a state this fleet does not know: {status:?}")]
    UnknownStatus {
        /// Incus instance name.
        name: String,
        /// Observed guest status.
        status: incus_client::InstanceStatus,
    },
}

/// Computers as VMs on one Incus host.
#[derive(Debug, Clone)]
pub struct IncusFleet {
    client: IncusClient,
    config: Box<IncusFleetConfig>,
}

impl IncusFleet {
    /// Validate fleet configuration and build the Incus client.
    pub fn new(config: IncusFleetConfig) -> Result<Self, IncusFleetError> {
        if config.shutdown_grace.is_zero() {
            return Err(IncusError::MalformedResponse(
                "Incus shutdown grace must be positive".to_owned(),
            )
            .into());
        }
        let client = IncusClient::new(config.endpoint.clone())?;
        Ok(Self {
            client,
            config: Box::new(config),
        })
    }

    /// The instance, `None` when it does not exist.
    async fn find(&self, computer_id: ComputerId) -> Result<Option<InstanceInfo>, IncusFleetError> {
        match self.client.instance(&instance_name(computer_id)).await {
            Ok(instance) => Ok(Some(instance)),
            Err(IncusError::NotFound { .. }) => Ok(None),
            Err(error) => Err(error.into()),
        }
    }

    async fn status(
        &self,
        computer_id: ComputerId,
    ) -> Result<Option<InstanceStatus>, IncusFleetError> {
        self.find(computer_id)
            .await?
            .map(|instance| observed_status(&instance))
            .transpose()
    }

    async fn force_stop(&self, name: &InstanceName) -> Result<(), IncusFleetError> {
        match self.client.stop(name, true).await {
            Ok(()) | Err(IncusError::NotFound { .. }) => Ok(()),
            Err(error) => Err(error.into()),
        }
    }
}

impl FleetError for IncusFleetError {
    fn is_missing(&self) -> bool {
        matches!(
            self,
            Self::Missing { .. } | Self::Incus(IncusError::NotFound { .. })
        )
    }
}

impl Fleet for IncusFleet {
    type Err = IncusFleetError;

    fn control_plane_id(&self) -> &ControlPlaneId {
        &self.config.control_plane_id
    }

    #[tracing::instrument(name = "incus_fleet.create", skip_all, fields(computer_id = %computer.id, start), err)]
    async fn create(
        &self,
        computer: &Computer,
        generation: EnrollmentGeneration,
        enrollment: &impl FleetEnrollment,
        start: bool,
    ) -> Result<(), IncusFleetError> {
        let name = instance_name(computer.id);
        match self.find(computer.id).await? {
            Some(instance) => {
                if instance.config.get(CONTROL_PLANE_KEY).map(String::as_str)
                    != Some(self.config.control_plane_id.as_str())
                    || instance.config.get(GENERATION_KEY) != Some(&generation.get().to_string())
                {
                    return Err(IncusFleetError::EnrollmentMismatch);
                }
                let pairing = instance
                    .config
                    .get(PAIRING_KEY)
                    .and_then(|value| value.parse::<PairingId>().ok())
                    .ok_or(IncusFleetError::EnrollmentMismatch)?;
                if enrollment.claimed(pairing).await? {
                    return Ok(());
                }
                let enrollment = enrollment.issue().await?;
                let enrollment_json = zeroize::Zeroizing::new(serde_json::to_string(&enrollment)?);
                self.client
                    .set_config_key(&name, INCUS_ENROLLMENT_KEY, &enrollment_json)
                    .await?;
                if !start {
                    self.stop(computer.id).await?;
                } else {
                    let status = observed_status(&instance)?;
                    self.start(computer.id).await?;
                    if status != InstanceStatus::Stopped {
                        // Refresh the enrollment without resetting a booting guest.
                        self.client
                            .exec(
                                &name,
                                &[
                                    "systemctl",
                                    "restart",
                                    "macrod-enroll.service",
                                    "macrod.service",
                                ],
                            )
                            .await?;
                    }
                }
            }
            None => {
                if !matches!(
                    computer.state.phase,
                    crate::domain::lifecycle::Phase::Provisioning { .. }
                ) {
                    return Err(IncusFleetError::Missing {
                        computer_id: computer.id,
                    });
                }
                let enrollment = enrollment.issue().await?;
                let enrollment_json = zeroize::Zeroizing::new(serde_json::to_string(&enrollment)?);
                let mut body = instance_body(&self.config, computer, &enrollment_json, Utc::now());
                {
                    let config = body
                        .config
                        .as_mut()
                        .ok_or(IncusFleetError::EnrollmentMismatch)?;
                    config
                        .0
                        .insert(GENERATION_KEY.to_owned(), generation.get().to_string());
                    config
                        .0
                        .insert(PAIRING_KEY.to_owned(), enrollment.pairing_id.to_string());
                }
                let started = self
                    .client
                    .api()
                    .instances_post(None, None, &body)
                    .await
                    .map_err(IncusError::from)?;
                self.client.run_operation(started.into_inner()).await?;
                if start {
                    self.start(computer.id).await?;
                }
            }
        }
        Ok(())
    }

    #[tracing::instrument(name = "incus_fleet.start", skip(self), err)]
    async fn start(&self, computer_id: ComputerId) -> Result<(), IncusFleetError> {
        let name = instance_name(computer_id);
        if self.status(computer_id).await? != Some(InstanceStatus::Running) {
            self.client.start(&name).await?;
        }
        Ok(())
    }

    /// A clean shutdown, killed after the configured grace period.
    #[tracing::instrument(name = "incus_fleet.stop", skip(self), err)]
    async fn stop(&self, computer_id: ComputerId) -> Result<(), IncusFleetError> {
        let result: Result<(), IncusFleetError> = async {
            let name = instance_name(computer_id);
            match self.status(computer_id).await? {
                None | Some(InstanceStatus::Stopped) => return Ok(()),
                Some(InstanceStatus::Running) => {}
            }
            match tokio::time::timeout(self.config.shutdown_grace, self.client.stop(&name, false))
                .await
            {
                Ok(result) => result?,
                Err(_) => {
                    tracing::warn!(computer_id = %computer_id, "clean shutdown timed out, forcing");
                    self.force_stop(&name).await?;
                }
            }
            Ok(())
        }
        .await;
        match result {
            Err(error) if error.is_missing() => Ok(()),
            result => result,
        }
    }

    #[tracing::instrument(name = "incus_fleet.restart", skip(self), err)]
    async fn restart(&self, computer_id: ComputerId) -> Result<(), IncusFleetError> {
        let name = instance_name(computer_id);
        match self.status(computer_id).await? {
            Some(InstanceStatus::Running) => self.client.restart(&name, true).await?,
            _ => self.client.start(&name).await?,
        }
        Ok(())
    }

    #[tracing::instrument(name = "incus_fleet.restart_macrod", skip(self), err)]
    async fn restart_macrod(&self, computer_id: ComputerId) -> Result<(), IncusFleetError> {
        self.client
            .exec(
                &instance_name(computer_id),
                &["systemctl", "restart", "macrod"],
            )
            .await?;
        Ok(())
    }

    #[tracing::instrument(name = "incus_fleet.destroy", skip(self), err)]
    async fn destroy(&self, computer_id: ComputerId) -> Result<(), IncusFleetError> {
        let name = instance_name(computer_id);
        match self.status(computer_id).await? {
            None => return Ok(()),
            Some(InstanceStatus::Stopped) => {}
            Some(InstanceStatus::Running) => {
                self.force_stop(&name).await?;
            }
        }
        match self.client.delete(&name).await {
            Ok(()) | Err(IncusError::NotFound { .. }) => Ok(()),
            Err(error) => Err(error.into()),
        }
    }

    #[tracing::instrument(name = "incus_fleet.clear_enrollment", skip(self), err)]
    async fn clear_enrollment(&self, computer_id: ComputerId) -> Result<(), IncusFleetError> {
        match self
            .client
            .remove_config_key(&instance_name(computer_id), INCUS_ENROLLMENT_KEY)
            .await
        {
            Ok(()) | Err(IncusError::NotFound { .. }) => Ok(()),
            Err(error) => Err(error.into()),
        }
    }

    #[tracing::instrument(name = "incus_fleet.resources_match", skip_all, fields(computer_id = %computer.id), err)]
    async fn resources_match(&self, computer: &Computer) -> Result<bool, Self::Err> {
        Ok(self
            .find(computer.id)
            .await?
            .is_some_and(|instance| limits_match(&instance, computer.resources)))
    }

    #[tracing::instrument(name = "incus_fleet.instances", skip(self), err)]
    async fn instances(&self) -> Result<Vec<FleetInstance>, IncusFleetError> {
        let result = self.client.list_instances().await;
        opentelemetry::global::meter("hosted_runtimes")
            .f64_gauge("computer.incus.reachable")
            .build()
            .record(if result.is_ok() { 1.0 } else { 0.0 }, &[]);
        let instances = result?;
        computer_instances(&instances, &self.config.control_plane_id)
    }

    #[tracing::instrument(name = "incus_fleet.host", skip(self), err)]
    async fn host(&self) -> Result<HostRegistration, IncusFleetError> {
        let result = self.client.resources().await;
        opentelemetry::global::meter("hosted_runtimes")
            .f64_gauge("computer.incus.reachable")
            .build()
            .record(if result.is_ok() { 1.0 } else { 0.0 }, &[]);
        let resources = result?;
        let memory_gb =
            u32::try_from(resources.memory_total_bytes / BYTES_PER_GIB).map_err(|_| {
                IncusError::MalformedResponse(format!(
                    "host memory of {} bytes",
                    resources.memory_total_bytes
                ))
            })?;
        Ok(HostRegistration {
            name: self.config.host_name.clone(),
            memory_gb,
            reserve_gb: self.config.reserve_gb,
            oversell_factor: self.config.oversell_factor,
        })
    }
}

/// Incus names are hostname labels: a leading letter, at most 63 characters.
pub fn instance_name(computer_id: ComputerId) -> InstanceName {
    InstanceName::from_uuid(computer_id.as_uuid())
}

/// The instance config: identity, enrollment and limits.
fn instance_config(
    control_plane_id: &ControlPlaneId,
    created_at: DateTime<Utc>,
    computer_id: ComputerId,
    resources: ComputerResources,
    enrollment_json: &str,
) -> BTreeMap<String, String> {
    BTreeMap::from([
        (COMPUTER_ID_KEY.to_owned(), computer_id.to_string()),
        (
            CONTROL_PLANE_KEY.to_owned(),
            control_plane_id.as_str().to_owned(),
        ),
        (CREATED_AT_KEY.to_owned(), created_at.to_rfc3339()),
        (INCUS_ENROLLMENT_KEY.to_owned(), enrollment_json.to_owned()),
        ("limits.cpu".to_owned(), resources.vcpus.get().to_string()),
        (
            "limits.memory".to_owned(),
            format!("{}GiB", resources.memory_gib.get()),
        ),
    ])
}

/// The root disk, sized to the computer.
fn root_device(pool: &str, resources: ComputerResources) -> BTreeMap<String, String> {
    BTreeMap::from([
        ("type".to_owned(), "disk".to_owned()),
        ("path".to_owned(), "/".to_owned()),
        ("pool".to_owned(), pool.to_owned()),
        (
            "size".to_owned(),
            format!("{}GiB", resources.disk_gib.get()),
        ),
    ])
}

/// `POST /1.0/instances` for one computer, created stopped. Built here rather
/// than through `IncusClient::create_instance` so creation can stamp the
/// enrollment generation and pairing before posting.
fn instance_body(
    config: &IncusFleetConfig,
    computer: &Computer,
    enrollment_json: &str,
    created_at: DateTime<Utc>,
) -> types::InstancesPost {
    let computer_id = computer.id;
    let resources = computer.resources;
    let (alias, fingerprint) = match &config.image.reference {
        ImageReference::Alias(alias) => (Some(alias.as_str().to_owned()), None),
        ImageReference::Fingerprint(fingerprint) => (None, Some(fingerprint.clone())),
    };
    let (server, protocol) = match &config.image.remote {
        Some(remote) => (
            Some(remote.server.clone()),
            Some(remote.protocol.as_ref().to_owned()),
        ),
        None => (None, None),
    };

    types::InstancesPost {
        name: Some(instance_name(computer_id).into_inner()),
        type_: Some(types::InstanceType(
            InstanceKind::VirtualMachine.as_ref().to_owned(),
        )),
        profiles: Some(vec![config.profile.as_str().to_owned()]),
        config: Some(types::ConfigMap(instance_config(
            &config.control_plane_id,
            created_at,
            computer_id,
            resources,
            enrollment_json,
        ))),
        devices: Some(types::DevicesMap(BTreeMap::from([(
            "root".to_owned(),
            root_device(config.storage_pool.as_str(), resources),
        )]))),
        source: Some(types::InstanceSource {
            type_: Some("image".to_owned()),
            alias,
            fingerprint,
            server,
            protocol,
            ..Default::default()
        }),
        ..Default::default()
    }
}

/// Transitional states count as where they are heading.
fn observed_status(instance: &InstanceInfo) -> Result<InstanceStatus, IncusFleetError> {
    use incus_client::InstanceStatus as Incus;
    match &instance.status {
        Incus::Running | Incus::Starting => Ok(InstanceStatus::Running),
        Incus::Stopped | Incus::Stopping | Incus::Aborting | Incus::Error => {
            Ok(InstanceStatus::Stopped)
        }
        status @ Incus::Unknown { .. } => Err(IncusFleetError::UnknownStatus {
            name: instance.name.clone(),
            status: status.clone(),
        }),
    }
}

/// The instances that belong to computers; others on the host are ignored.
fn computer_instances(
    instances: &[InstanceInfo],
    control_plane_id: &ControlPlaneId,
) -> Result<Vec<FleetInstance>, IncusFleetError> {
    instances
        .iter()
        .filter(|instance| {
            instance.config.get(CONTROL_PLANE_KEY).map(String::as_str)
                == Some(control_plane_id.as_str())
        })
        .filter_map(|instance| {
            instance
                .config
                .get(COMPUTER_ID_KEY)
                .map(|value| (instance, value))
        })
        .map(|(instance, value)| {
            let computer_id =
                value
                    .parse::<ComputerId>()
                    .map_err(|_| IncusFleetError::BadComputerId {
                        name: instance.name.clone(),
                        value: value.clone(),
                    })?;
            Ok(FleetInstance {
                computer_id,
                status: observed_status(instance)?,
                control_plane_id: control_plane_id.clone(),
                created_at: instance
                    .config
                    .get(CREATED_AT_KEY)
                    .and_then(|value| DateTime::parse_from_rfc3339(value).ok())
                    .map(|at| at.with_timezone(&Utc)),
            })
        })
        .collect()
}

fn limits_match(instance: &InstanceInfo, resources: ComputerResources) -> bool {
    instance.config.get("limits.cpu") == Some(&resources.vcpus.get().to_string())
        && instance.config.get("limits.memory")
            == Some(&format!("{}GiB", resources.memory_gib.get()))
        && instance.devices.get("root").is_some_and(|root| {
            root.get("size") == Some(&format!("{}GiB", resources.disk_gib.get()))
        })
}
