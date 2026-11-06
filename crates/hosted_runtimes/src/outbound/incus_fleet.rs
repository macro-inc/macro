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

use crate::domain::enrollment::{Enrollment, INCUS_ENROLLMENT_KEY};
use crate::domain::ids::ComputerId;
use crate::domain::models::{Computer, ControlPlaneId, HostRegistration};
use crate::domain::ports::{Fleet, FleetError, FleetInstance, InstanceStatus};
use crate::domain::size::ComputerSize;

#[cfg(test)]
mod test;

/// Instance config key carrying the control-plane owner.
pub const CONTROL_PLANE_KEY: &str = "user.macro.control_plane";
const CREATED_AT_KEY: &str = "user.macro.created_at";

/// Instance config key carrying the computer id.
pub const COMPUTER_ID_KEY: &str = "user.macro.computer_id";

const BYTES_PER_GIB: u64 = 1024 * 1024 * 1024;

/// The Incus host and what computers are created from.
#[derive(Debug, Clone)]
pub struct IncusFleetConfig {
    pub control_plane_id: ControlPlaneId,
    pub endpoint: IncusEndpoint,
    /// Usually the local alias `macro-box`.
    pub image: ImageSource,
    /// Profile carrying the NIC, `migration.stateful` and `security.guestapi`.
    pub profile: ProfileName,
    /// Storage pool of the root disk override; Incus requires it.
    pub storage_pool: StoragePoolName,
    pub host_name: String,
    pub reserve_gb: u32,
    pub oversell_factor: u32,
    /// Deadline for clean shutdown before forcibly stopping the VM.
    pub shutdown_grace: Duration,
}

#[derive(Debug, thiserror::Error)]
pub enum IncusFleetError {
    #[error("instance {computer_id} is missing")]
    Missing { computer_id: ComputerId },
    #[error(transparent)]
    Incus(#[from] IncusError),
    #[error("could not encode the enrollment: {0}")]
    Encode(#[from] serde_json::Error),
    #[error("instance {name} has an invalid {COMPUTER_ID_KEY} {value:?}")]
    BadComputerId { name: String, value: String },
    #[error("instance {name} is in a state this fleet does not know: {status:?}")]
    UnknownStatus {
        name: String,
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
        match self.client.stop(name, false, true).await {
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
        enrollment: &Enrollment,
        start: bool,
    ) -> Result<(), IncusFleetError> {
        let name = instance_name(computer.id);
        let enrollment_json = serde_json::to_string(enrollment)?;
        match self.find(computer.id).await? {
            // A retried create re-keys the pairing, so the enrollment changes.
            Some(_) => {
                self.client
                    .set_config_key(&name, INCUS_ENROLLMENT_KEY, &enrollment_json)
                    .await?;
            }
            None => {
                let body = instance_body(
                    &self.config,
                    computer.id,
                    computer.size,
                    &enrollment_json,
                    Utc::now(),
                );
                let started = self
                    .client
                    .api()
                    .instances_post(None, None, &body)
                    .await
                    .map_err(IncusError::from)?;
                self.client.run_operation(started.into_inner()).await?;
            }
        }
        if start {
            self.start(computer.id).await?;
        }
        Ok(())
    }

    #[tracing::instrument(name = "incus_fleet.start", skip(self), err)]
    async fn start(&self, computer_id: ComputerId) -> Result<(), IncusFleetError> {
        let name = instance_name(computer_id);
        match self.status(computer_id).await? {
            Some(InstanceStatus::Running) => {}
            Some(InstanceStatus::Frozen) => self.client.unfreeze(&name).await?,
            _ => self.client.start(&name).await?,
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
                Some(InstanceStatus::Frozen) => self.client.unfreeze(&name).await?,
                _ => {}
            }
            match tokio::time::timeout(
                self.config.shutdown_grace,
                self.client.stop(&name, false, false),
            )
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
            Some(InstanceStatus::Frozen) => {
                self.client.unfreeze(&name).await?;
                self.client.restart(&name, true).await?;
            }
            _ => self.client.start(&name).await?,
        }
        Ok(())
    }

    #[tracing::instrument(name = "incus_fleet.freeze", skip(self), err)]
    async fn freeze(&self, computer_id: ComputerId) -> Result<(), IncusFleetError> {
        if self.status(computer_id).await? != Some(InstanceStatus::Frozen) {
            self.client.freeze(&instance_name(computer_id)).await?;
        }
        Ok(())
    }

    #[tracing::instrument(name = "incus_fleet.unfreeze", skip(self), err)]
    async fn unfreeze(&self, computer_id: ComputerId) -> Result<(), IncusFleetError> {
        match self.status(computer_id).await? {
            None => return Err(IncusFleetError::Missing { computer_id }),
            Some(InstanceStatus::Frozen) => {
                self.client.unfreeze(&instance_name(computer_id)).await?
            }
            _ => {}
        }
        Ok(())
    }

    /// Stateful stop: RAM goes to the root volume's `size.state` space.
    #[tracing::instrument(name = "incus_fleet.suspend", skip(self), err)]
    async fn suspend(&self, computer_id: ComputerId) -> Result<(), IncusFleetError> {
        let name = instance_name(computer_id);
        match self.status(computer_id).await? {
            Some(InstanceStatus::Stopped) => return Ok(()),
            Some(InstanceStatus::Frozen) => self.client.unfreeze(&name).await?,
            _ => {}
        }
        self.client.stop(&name, true, false).await?;
        Ok(())
    }

    /// Starting a statefully stopped VM restores its RAM.
    async fn resume(&self, computer_id: ComputerId) -> Result<(), IncusFleetError> {
        self.start(computer_id).await
    }

    #[tracing::instrument(name = "incus_fleet.destroy", skip(self), err)]
    async fn destroy(&self, computer_id: ComputerId) -> Result<(), IncusFleetError> {
        let name = instance_name(computer_id);
        match self.status(computer_id).await? {
            None => return Ok(()),
            Some(InstanceStatus::Stopped) => {}
            Some(InstanceStatus::Running | InstanceStatus::Frozen) => {
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

    #[tracing::instrument(name = "incus_fleet.instances", skip(self), err)]
    async fn instances(&self) -> Result<Vec<FleetInstance>, IncusFleetError> {
        let instances = self.client.list_instances().await?;
        computer_instances(&instances, &self.config.control_plane_id)
    }

    #[tracing::instrument(name = "incus_fleet.host", skip(self), err)]
    async fn host(&self) -> Result<HostRegistration, IncusFleetError> {
        let resources = self.client.resources().await?;
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
    InstanceName::from_uuid(computer_id.into_inner())
}

/// The instance config: identity, enrollment and limits.
fn instance_config(
    control_plane_id: &ControlPlaneId,
    created_at: DateTime<Utc>,
    computer_id: ComputerId,
    size: ComputerSize,
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
        ("limits.cpu".to_owned(), size.spec().incus_cpu.to_owned()),
        (
            "limits.memory".to_owned(),
            size.spec().incus_memory.to_owned(),
        ),
    ])
}

/// The root disk, sized to the computer, with `size.state` room for a
/// stateful stop's RAM image (RAM plus 1 GiB of device state).
fn root_device(pool: &str, size: ComputerSize) -> BTreeMap<String, String> {
    BTreeMap::from([
        ("type".to_owned(), "disk".to_owned()),
        ("path".to_owned(), "/".to_owned()),
        ("pool".to_owned(), pool.to_owned()),
        ("size".to_owned(), size.spec().incus_root_size.to_owned()),
        (
            "size.state".to_owned(),
            size.spec().incus_state_size.to_owned(),
        ),
    ])
}

/// `POST /1.0/instances` for one computer, created stopped. Built here rather
/// than through `IncusClient::create_instance`, whose root disk has no
/// `size.state`.
fn instance_body(
    config: &IncusFleetConfig,
    computer_id: ComputerId,
    size: ComputerSize,
    enrollment_json: &str,
    created_at: DateTime<Utc>,
) -> types::InstancesPost {
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
            size,
            enrollment_json,
        ))),
        devices: Some(types::DevicesMap(BTreeMap::from([(
            "root".to_owned(),
            root_device(config.storage_pool.as_str(), size),
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
        Incus::Frozen | Incus::Freezing => Ok(InstanceStatus::Frozen),
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
