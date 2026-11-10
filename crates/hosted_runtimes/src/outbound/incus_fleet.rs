//! [`Fleet`] on one Incus host: each computer is a VM from a versioned
//! `macro-box/<version>` image, carrying its [`Enrollment`] in the
//! [`INCUS_ENROLLMENT_KEY`] config key that macrod reads through `/dev/incus`.
//!
//! Each VM has a root disk of [`ROOT_DISK_GIB`] rebuilt by image updates, and
//! a custom block volume `<instance>-data` (disk device `data`, the rest of
//! the quota) that the guest mounts at `/home` and that survives updates.
//! Incus does not delete custom volumes with their instance, so destroy
//! deletes it afterwards.
//!
//! Verbs check the instance's status first so a retried effect is a no-op
//! instead of an Incus "already running" error.

use std::collections::BTreeMap;
use std::time::Duration;

use chrono::{DateTime, Utc};
use incus_client::generated::types;
use incus_client::{
    ImageAlias, ImageReference, ImageSource, IncusClient, IncusEndpoint, IncusError, InstanceInfo,
    InstanceKind, InstanceName, InvalidName, ProfileName, StoragePoolName, StorageVolumeName,
};

use crate::domain::enrollment::{EnrollmentGeneration, EnrollmentIssueError, INCUS_ENROLLMENT_KEY};
use crate::domain::ids::{ComputerId, PairingId};
use crate::domain::image::{GuestImage, ROOT_DISK_GIB, data_disk_gib};
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
/// The image the root disk was last built from, set at create and rebuild.
const IMAGE_KEY: &str = "user.macro.image";
/// Disk device of the data volume; the guest finds it by this name.
const DATA_DEVICE: &str = "data";

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
    /// Image new computers are created from: a versioned local alias such
    /// as `macro-box/2026-11-10`.
    pub image: ImageSource,
    /// Profile carrying the NIC and `security.guestapi`.
    pub profile: ProfileName,
    /// Storage pool of the root disk override and the data volumes.
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
    /// An Incus resource name could not be built.
    #[error(transparent)]
    Name(#[from] InvalidName),
    /// The configured or requested image is not a valid image name.
    #[error(transparent)]
    Image(#[from] crate::domain::image::InvalidGuestImage),
    /// The requested image alias is not on the host.
    #[error("image {image} is not on the Incus host")]
    ImageMissing {
        /// The image that was requested.
        image: GuestImage,
    },
    /// The instance does not record the image it runs.
    #[error("instance {name} has no {IMAGE_KEY}")]
    UnknownImage {
        /// Incus instance name.
        name: String,
    },
    /// The disk quota leaves no room for a data disk beside the root disk.
    #[error("a {disk_gib} GiB disk quota leaves no data disk beside the {ROOT_DISK_GIB} GiB root")]
    DiskTooSmall {
        /// The recorded disk quota.
        disk_gib: u32,
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
    image: GuestImage,
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
        let image = GuestImage::try_new(match &config.image.reference {
            ImageReference::Alias(alias) => alias.as_str(),
            ImageReference::Fingerprint(fingerprint) => fingerprint,
        })?;
        Ok(Self {
            client,
            config: Box::new(config),
            image,
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

    /// Delete the computer's data volume; a missing one is not an error.
    async fn delete_data_volume(&self, computer_id: ComputerId) -> Result<(), IncusFleetError> {
        match self
            .client
            .delete_volume(&self.config.storage_pool, &volume_name(computer_id)?)
            .await
        {
            Ok(()) | Err(IncusError::NotFound { .. }) => Ok(()),
            Err(error) => Err(error.into()),
        }
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
    ) -> Result<GuestImage, IncusFleetError> {
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
                let image = running_image(&instance)?;
                if enrollment.claimed(pairing).await? {
                    return Ok(image);
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
                Ok(image)
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
                let data_gib =
                    data_disk_gib(computer.resources).ok_or(IncusFleetError::DiskTooSmall {
                        disk_gib: computer.resources.disk_gib.get(),
                    })?;
                let volume = volume_name(computer.id)?;
                // A volume left by a lost guest (or by an attempt that failed
                // before creating the instance) is replaced: its enrollment
                // marker would skip the new pairing.
                self.delete_data_volume(computer.id).await?;
                self.client
                    .create_block_volume(
                        &self.config.storage_pool,
                        &volume,
                        &format!("{data_gib}GiB"),
                    )
                    .await?;
                let enrollment = enrollment.issue().await?;
                let enrollment_json = zeroize::Zeroizing::new(serde_json::to_string(&enrollment)?);
                let mut body = instance_body(
                    &self.config,
                    &self.image,
                    computer,
                    &enrollment_json,
                    Utc::now(),
                )?;
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
                Ok(self.image.clone())
            }
        }
    }

    #[tracing::instrument(name = "incus_fleet.rebuild", skip_all, fields(computer_id = %computer.id, image = %image, start), err)]
    async fn rebuild(
        &self,
        computer: &Computer,
        image: &GuestImage,
        start: bool,
    ) -> Result<(), IncusFleetError> {
        let computer_id = computer.id;
        let name = instance_name(computer_id);
        let instance = self
            .find(computer_id)
            .await?
            .ok_or(IncusFleetError::Missing { computer_id })?;
        // The key is set only after a rebuild succeeds, so a retry after it
        // does not rebuild (and reboot) the guest again.
        if instance.config.get(IMAGE_KEY).map(String::as_str) != Some(image.as_str()) {
            let alias = ImageAlias::try_new(image.as_str())?;
            // A missing alias must not read as a lost instance.
            match self.client.image_alias(&alias).await {
                Ok(_) => {}
                Err(IncusError::NotFound { .. }) => {
                    return Err(IncusFleetError::ImageMissing {
                        image: image.clone(),
                    });
                }
                Err(error) => return Err(error.into()),
            }
            self.stop(computer_id).await?;
            self.client.rebuild(&name, &alias).await?;
            self.client
                .set_config_key(&name, IMAGE_KEY, image.as_str())
                .await?;
        }
        if start {
            self.start(computer_id).await
        } else {
            self.stop(computer_id).await
        }
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
            None => {}
            Some(status) => {
                if status == InstanceStatus::Running {
                    self.force_stop(&name).await?;
                }
                match self.client.delete(&name).await {
                    Ok(()) | Err(IncusError::NotFound { .. }) => {}
                    Err(error) => return Err(error.into()),
                }
            }
        }
        // Only once the instance is gone: an attached volume cannot be deleted.
        self.delete_data_volume(computer_id).await
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

/// The computer's data volume.
fn volume_name(computer_id: ComputerId) -> Result<StorageVolumeName, InvalidName> {
    StorageVolumeName::try_new(&format!("{}-data", instance_name(computer_id)))
}

/// The image an existing instance's root disk was built from.
fn running_image(instance: &InstanceInfo) -> Result<GuestImage, IncusFleetError> {
    let image = instance
        .config
        .get(IMAGE_KEY)
        .ok_or_else(|| IncusFleetError::UnknownImage {
            name: instance.name.clone(),
        })?;
    Ok(GuestImage::try_new(image)?)
}

/// The instance config: identity, image, enrollment and limits.
fn instance_config(
    control_plane_id: &ControlPlaneId,
    created_at: DateTime<Utc>,
    computer_id: ComputerId,
    image: &GuestImage,
    resources: ComputerResources,
    enrollment_json: &str,
) -> BTreeMap<String, String> {
    BTreeMap::from([
        (IMAGE_KEY.to_owned(), image.as_str().to_owned()),
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

/// The root disk: the image's share of the disk quota.
fn root_device(pool: &str) -> BTreeMap<String, String> {
    BTreeMap::from([
        ("type".to_owned(), "disk".to_owned()),
        ("path".to_owned(), "/".to_owned()),
        ("pool".to_owned(), pool.to_owned()),
        ("size".to_owned(), format!("{ROOT_DISK_GIB}GiB")),
    ])
}

/// The data volume as a disk device with no path: the guest formats and
/// mounts it itself.
fn data_device(pool: &str, volume: &StorageVolumeName) -> BTreeMap<String, String> {
    BTreeMap::from([
        ("type".to_owned(), "disk".to_owned()),
        ("pool".to_owned(), pool.to_owned()),
        ("source".to_owned(), volume.as_str().to_owned()),
    ])
}

/// `POST /1.0/instances` for one computer, created stopped with its data
/// volume attached, so no instance exists without it. Built here rather
/// than through `IncusClient::create_instance` so creation can stamp the
/// enrollment generation and pairing before posting.
fn instance_body(
    config: &IncusFleetConfig,
    image: &GuestImage,
    computer: &Computer,
    enrollment_json: &str,
    created_at: DateTime<Utc>,
) -> Result<types::InstancesPost, InvalidName> {
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

    let volume = volume_name(computer_id)?;
    Ok(types::InstancesPost {
        name: Some(instance_name(computer_id).into_inner()),
        type_: Some(types::InstanceType(
            InstanceKind::VirtualMachine.as_ref().to_owned(),
        )),
        profiles: Some(vec![config.profile.as_str().to_owned()]),
        config: Some(types::ConfigMap(instance_config(
            &config.control_plane_id,
            created_at,
            computer_id,
            image,
            resources,
            enrollment_json,
        ))),
        devices: Some(types::DevicesMap(BTreeMap::from([
            ("root".to_owned(), root_device(config.storage_pool.as_str())),
            (
                DATA_DEVICE.to_owned(),
                data_device(config.storage_pool.as_str(), &volume),
            ),
        ]))),
        source: Some(types::InstanceSource {
            type_: Some("image".to_owned()),
            alias,
            fingerprint,
            server,
            protocol,
            ..Default::default()
        }),
        ..Default::default()
    })
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
        && instance
            .devices
            .get("root")
            .is_some_and(|root| root.get("size") == Some(&format!("{ROOT_DISK_GIB}GiB")))
}
