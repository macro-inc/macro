use std::collections::BTreeMap;
use std::str::FromStr;
use std::time::Duration;

use crate::generated::{self, types};
use crate::model::{
    CreateInstance, HostResources, ImageAliasInfo, ImageInfo, ImageReference, IncusEndpoint,
    InstanceInfo, InstanceKind, InstanceStatus, InstanceUsage, ServerAuth, ServerInfo,
};
use crate::{
    ImageAlias, IncusError, IncusTimeouts, InstanceName, StoragePoolName, StorageVolumeName, tls,
};

/// The storage volume type for volumes created through the API.
const CUSTOM_VOLUME: &str = "custom";

/// The recursion level list endpoints are generated for.
const RECURSION_FULL_OBJECTS: i64 = 1;

const OPERATION_SUCCESS: i64 = 200;
const OPERATION_FAILURE: i64 = 400;
const OPERATION_CANCELLED: i64 = 401;

/// Typed client for one Incus server, in its default project.
#[derive(Debug, Clone)]
pub struct IncusClient {
    api: generated::Client,
    timeouts: IncusTimeouts,
}

/// A state change requested through `PUT /1.0/instances/{name}/state`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, strum::AsRefStr)]
#[strum(serialize_all = "lowercase")]
enum StateAction {
    Start,
    Stop,
    Restart,
}

impl IncusClient {
    /// Builds an mTLS client that presents `client_cert_pem` and trusts only
    /// `server_cert_pem`. Makes no request.
    pub fn new(endpoint: IncusEndpoint) -> Result<Self, IncusError> {
        if endpoint.timeouts.connect.is_zero()
            || endpoint.timeouts.request <= endpoint.timeouts.connect
            || endpoint.timeouts.operation_wait_secs == 0
            || endpoint.timeouts.operation_waits == 0
            || endpoint.timeouts.state_change_secs == 0
            || endpoint.timeouts.request
                <= Duration::from_secs(u64::from(endpoint.timeouts.operation_wait_secs))
        {
            return Err(IncusError::MalformedResponse("Incus timeouts must be positive; request timeout must exceed connect and operation wait timeouts".to_owned()));
        }
        let tls = tls::client_config(
            &endpoint.client_cert_pem,
            &endpoint.client_key_pem,
            &endpoint.server_cert_pem,
        )?;

        let http = reqwest::Client::builder()
            .tls_backend_preconfigured(tls)
            .connect_timeout(endpoint.timeouts.connect)
            .timeout(endpoint.timeouts.request)
            .build()
            .map_err(|error| IncusError::InvalidCredentials(format!("HTTP client: {error}")))?;

        Ok(Self::with_http_client(
            &endpoint.url,
            http,
            endpoint.timeouts,
        ))
    }

    pub(crate) fn with_http_client(
        url: &str,
        http: reqwest::Client,
        timeouts: IncusTimeouts,
    ) -> Self {
        Self {
            api: generated::Client::new_with_client(url, http),
            timeouts,
        }
    }

    /// The generated client, for endpoints without a method here.
    pub fn api(&self) -> &generated::Client {
        &self.api
    }

    /// `GET /1.0`. Check `auth` to confirm the server trusts our certificate.
    #[tracing::instrument(name = "incus.server_info", skip(self), err)]
    pub async fn server_info(&self) -> Result<ServerInfo, IncusError> {
        let server = self
            .api
            .server_get(None, None)
            .await?
            .into_inner()
            .metadata
            .ok_or_else(|| missing("server metadata"))?;

        let auth = server.auth.ok_or_else(|| missing("server auth"))?;
        let auth = ServerAuth::from_str(&auth)
            .map_err(|_| IncusError::MalformedResponse(format!("server auth {auth:?}")))?;

        let environment = server.environment;

        Ok(ServerInfo {
            auth,
            api_version: server.api_version.ok_or_else(|| missing("api_version"))?,
            server_name: environment
                .as_ref()
                .and_then(|environment| environment.server_name.clone()),
            server_version: environment.and_then(|environment| environment.server_version),
        })
    }

    /// `GET /1.0/resources`: host memory and CPU totals.
    #[tracing::instrument(name = "incus.resources", skip(self), err)]
    pub async fn resources(&self) -> Result<HostResources, IncusError> {
        let resources = self
            .api
            .resources_get(None)
            .await?
            .into_inner()
            .metadata
            .ok_or_else(|| missing("resources metadata"))?;

        let memory = resources
            .memory
            .ok_or_else(|| missing("resources memory"))?;
        let cpu = resources.cpu.ok_or_else(|| missing("resources cpu"))?;

        Ok(HostResources {
            memory_total_bytes: memory.total.ok_or_else(|| missing("memory total"))?,
            memory_used_bytes: memory.used.ok_or_else(|| missing("memory used"))?,
            cpu_threads: cpu.total.ok_or_else(|| missing("cpu total"))?,
        })
    }

    /// Creates an instance (stopped) and waits for it, including any image
    /// download from a remote.
    #[tracing::instrument(
        name = "incus.create_instance",
        skip(self, request),
        fields(instance = %request.name, kind = request.kind.as_ref()),
        err
    )]
    pub async fn create_instance(&self, request: CreateInstance) -> Result<(), IncusError> {
        let (alias, fingerprint) = match request.image.reference {
            ImageReference::Alias(alias) => (Some(alias.into_inner()), None),
            ImageReference::Fingerprint(fingerprint) => (None, Some(fingerprint)),
        };

        let (server, protocol) = match request.image.remote {
            Some(remote) => (
                Some(remote.server),
                Some(remote.protocol.as_ref().to_owned()),
            ),
            None => (None, None),
        };

        let devices = request.root_disk.map(|root_disk| {
            let root = BTreeMap::from([
                ("type".to_owned(), "disk".to_owned()),
                ("path".to_owned(), "/".to_owned()),
                ("pool".to_owned(), root_disk.pool.into_inner()),
                ("size".to_owned(), root_disk.size),
            ]);
            types::DevicesMap(BTreeMap::from([("root".to_owned(), root)]))
        });

        let body = types::InstancesPost {
            name: Some(request.name.into_inner()),
            type_: Some(types::InstanceType(request.kind.as_ref().to_owned())),
            profiles: Some(
                request
                    .profiles
                    .into_iter()
                    .map(|profile| profile.into_inner())
                    .collect(),
            ),
            config: Some(types::ConfigMap(request.config)),
            devices,
            source: Some(types::InstanceSource {
                type_: Some("image".to_owned()),
                alias,
                fingerprint,
                server,
                protocol,
                ..Default::default()
            }),
            ..Default::default()
        };

        let started = self
            .api
            .instances_post(None, None, &body)
            .await?
            .into_inner();
        self.run_operation(started).await?;
        Ok(())
    }

    /// Starts a stopped instance.
    #[tracing::instrument(name = "incus.start", skip(self), err)]
    pub async fn start(&self, name: &InstanceName) -> Result<(), IncusError> {
        self.change_state(name, StateAction::Start, false).await
    }

    /// Stops an instance; `force` kills instead of shutting down.
    #[tracing::instrument(name = "incus.stop", skip(self), err)]
    pub async fn stop(&self, name: &InstanceName, force: bool) -> Result<(), IncusError> {
        self.change_state(name, StateAction::Stop, force).await
    }

    /// Restarts a running instance; `force` kills instead of shutting down.
    #[tracing::instrument(name = "incus.restart", skip(self), err)]
    pub async fn restart(&self, name: &InstanceName, force: bool) -> Result<(), IncusError> {
        self.change_state(name, StateAction::Restart, force).await
    }

    /// Deletes a stopped instance with its snapshots and volumes. A missing
    /// instance is [`IncusError::NotFound`]; a running one is rejected.
    #[tracing::instrument(name = "incus.delete", skip(self), err)]
    pub async fn delete(&self, name: &InstanceName) -> Result<(), IncusError> {
        let started = self
            .api
            .instance_delete(name.as_str(), None)
            .await?
            .into_inner();
        self.run_operation(started).await?;
        Ok(())
    }

    /// `GET /1.0/instances/{name}`. A missing instance is
    /// [`IncusError::NotFound`].
    #[tracing::instrument(name = "incus.instance", skip(self), err)]
    pub async fn instance(&self, name: &InstanceName) -> Result<InstanceInfo, IncusError> {
        let instance = self
            .api
            .instance_get(name.as_str(), None)
            .await?
            .into_inner()
            .metadata
            .ok_or_else(|| missing("instance metadata"))?;

        instance_info(instance)
    }

    /// Every instance in the project.
    #[tracing::instrument(name = "incus.list_instances", skip(self), err)]
    pub async fn list_instances(&self) -> Result<Vec<InstanceInfo>, IncusError> {
        self.api
            .instances_get_recursion1(None, None, None, RECURSION_FULL_OBJECTS)
            .await?
            .into_inner()
            .metadata
            .into_iter()
            .map(instance_info)
            .collect()
    }

    /// Memory and CPU usage of a running instance.
    #[tracing::instrument(name = "incus.instance_usage", skip(self), err)]
    pub async fn instance_usage(&self, name: &InstanceName) -> Result<InstanceUsage, IncusError> {
        let state = self
            .api
            .instance_state_get(name.as_str(), None)
            .await?
            .into_inner()
            .metadata
            .ok_or_else(|| missing("instance state metadata"))?;

        let memory = state.memory.ok_or_else(|| missing("instance memory"))?;
        let cpu = state.cpu.ok_or_else(|| missing("instance cpu"))?;

        Ok(InstanceUsage {
            memory_usage_bytes: memory.usage.ok_or_else(|| missing("memory usage"))?,
            cpu_usage_nanoseconds: cpu.usage.ok_or_else(|| missing("cpu usage"))?,
        })
    }

    /// Sets one instance config key, e.g. `user.macro.enrollment`, leaving the
    /// others as they are.
    #[tracing::instrument(name = "incus.set_config_key", skip(self, value), err)]
    pub async fn set_config_key(
        &self,
        name: &InstanceName,
        key: &str,
        value: &str,
    ) -> Result<(), IncusError> {
        let body = types::InstancePut {
            config: Some(types::ConfigMap(BTreeMap::from([(
                key.to_owned(),
                value.to_owned(),
            )]))),
            ..Default::default()
        };

        self.api.instance_patch(name.as_str(), None, &body).await?;
        Ok(())
    }

    /// Removes one instance config key. Incus's PATCH merges keys and cannot
    /// remove one, so this rewrites the instance guarded by its ETag; a
    /// concurrent change makes it fail with a 412 [`IncusError::Rejected`].
    #[tracing::instrument(name = "incus.remove_config_key", skip(self), err)]
    pub async fn remove_config_key(
        &self,
        name: &InstanceName,
        key: &str,
    ) -> Result<(), IncusError> {
        let response = self.api.instance_get(name.as_str(), None).await?;

        let etag = response
            .headers()
            .get(reqwest::header::ETAG)
            .and_then(|etag| etag.to_str().ok())
            .ok_or_else(|| missing("instance ETag"))?
            .to_owned();

        let instance = response
            .into_inner()
            .metadata
            .ok_or_else(|| missing("instance metadata"))?;

        let Some(mut config) = instance.config else {
            return Ok(());
        };

        if config.0.remove(key).is_none() {
            return Ok(());
        }

        let body = types::InstancePut {
            architecture: instance.architecture,
            config: Some(config),
            description: instance.description,
            devices: instance.devices,
            ephemeral: instance.ephemeral,
            profiles: instance.profiles,
            ..Default::default()
        };

        let started = self
            .api
            .instance_put(name.as_str(), None, &etag, &body)
            .await?
            .into_inner();
        self.run_operation(started).await?;
        Ok(())
    }

    /// Creates an empty custom block volume of `size` (e.g. `20GiB`), for a
    /// disk that outlives the instance's root disk.
    #[tracing::instrument(name = "incus.create_block_volume", skip(self), err)]
    pub async fn create_block_volume(
        &self,
        pool: &StoragePoolName,
        volume: &StorageVolumeName,
        size: &str,
    ) -> Result<(), IncusError> {
        let body = types::StorageVolumesPost {
            name: Some(volume.as_str().to_owned()),
            type_: Some(CUSTOM_VOLUME.to_owned()),
            content_type: Some("block".to_owned()),
            config: Some(types::ConfigMap(BTreeMap::from([(
                "size".to_owned(),
                size.to_owned(),
            )]))),
            ..Default::default()
        };

        self.api
            .storage_pool_volumes_type_post(pool.as_str(), CUSTOM_VOLUME, None, None, &body)
            .await?;
        Ok(())
    }

    /// Deletes a custom volume. It must not be attached; deleting the
    /// instance does not delete it.
    #[tracing::instrument(name = "incus.delete_volume", skip(self), err)]
    pub async fn delete_volume(
        &self,
        pool: &StoragePoolName,
        volume: &StorageVolumeName,
    ) -> Result<(), IncusError> {
        self.api
            .storage_pool_volume_type_delete(
                pool.as_str(),
                CUSTOM_VOLUME,
                volume.as_str(),
                None,
                None,
            )
            .await?;
        Ok(())
    }

    /// Attaches a custom block volume to an instance as disk device `device`.
    /// Incus's PATCH merges devices, so the others are left as they are.
    #[tracing::instrument(name = "incus.attach_volume", skip(self), err)]
    pub async fn attach_volume(
        &self,
        name: &InstanceName,
        device: &str,
        pool: &StoragePoolName,
        volume: &StorageVolumeName,
    ) -> Result<(), IncusError> {
        let disk = BTreeMap::from([
            ("type".to_owned(), "disk".to_owned()),
            ("pool".to_owned(), pool.as_str().to_owned()),
            ("source".to_owned(), volume.as_str().to_owned()),
        ]);
        let body = types::InstancePut {
            devices: Some(types::DevicesMap(BTreeMap::from([(
                device.to_owned(),
                disk,
            )]))),
            ..Default::default()
        };

        self.api.instance_patch(name.as_str(), None, &body).await?;
        Ok(())
    }

    /// Replaces a stopped instance's root disk with a fresh copy of `image`,
    /// keeping its config, profiles and other devices (attached volumes).
    #[tracing::instrument(name = "incus.rebuild", skip(self), err)]
    pub async fn rebuild(&self, name: &InstanceName, image: &ImageAlias) -> Result<(), IncusError> {
        let body = types::InstanceRebuildPost {
            source: Some(types::InstanceSource {
                type_: Some("image".to_owned()),
                alias: Some(image.as_str().to_owned()),
                ..Default::default()
            }),
        };

        let started = self
            .api
            .instance_rebuild_post(name.as_str(), None, &body)
            .await?
            .into_inner();
        self.run_operation(started).await?;
        Ok(())
    }

    /// Images in the host's local store.
    #[tracing::instrument(name = "incus.images", skip(self), err)]
    pub async fn images(&self) -> Result<Vec<ImageInfo>, IncusError> {
        self.api
            .images_get_recursion1(None, None, None, RECURSION_FULL_OBJECTS)
            .await?
            .into_inner()
            .metadata
            .into_iter()
            .map(|image| {
                Ok(ImageInfo {
                    fingerprint: image
                        .fingerprint
                        .ok_or_else(|| missing("image fingerprint"))?,
                    aliases: image
                        .aliases
                        .into_iter()
                        .flatten()
                        .filter_map(|alias| alias.name)
                        .map(|alias| {
                            ImageAlias::try_new(&alias)
                                .map_err(|error| IncusError::MalformedResponse(error.to_string()))
                        })
                        .collect::<Result<_, _>>()?,
                    kind: parse_kind(image.type_)?,
                    size_bytes: image.size.ok_or_else(|| missing("image size"))?,
                })
            })
            .collect()
    }

    /// A local image alias. A missing alias is [`IncusError::NotFound`].
    #[tracing::instrument(name = "incus.image_alias", skip(self), err)]
    pub async fn image_alias(&self, alias: &ImageAlias) -> Result<ImageAliasInfo, IncusError> {
        let entry = self
            .api
            .image_alias_get(alias.as_str(), None)
            .await?
            .into_inner()
            .metadata
            .ok_or_else(|| missing("image alias metadata"))?;

        Ok(ImageAliasInfo {
            name: ImageAlias::try_new(&entry.name.ok_or_else(|| missing("alias name"))?)
                .map_err(|error| IncusError::MalformedResponse(error.to_string()))?,
            target_fingerprint: entry.target.ok_or_else(|| missing("alias target"))?,
            kind: parse_kind(entry.type_)?,
        })
    }

    /// Waits for a background operation to finish and returns its final
    /// state, mapping `Failure` and `Cancelled` to errors.
    #[tracing::instrument(
        name = "incus.run_operation",
        skip(self, started),
        fields(operation_id = started.metadata.id.as_deref().unwrap_or_default()),
        err
    )]
    pub async fn run_operation(
        &self,
        started: types::AsyncResponse,
    ) -> Result<types::Operation, IncusError> {
        let operation_id = started
            .metadata
            .id
            .clone()
            .ok_or_else(|| missing("operation id"))?;

        let mut operation = started.metadata;
        for _ in 0..self.timeouts.operation_waits {
            if let Some(finished) = finished_operation(&operation_id, &operation)? {
                return Ok(finished);
            }

            operation = self
                .api
                .operation_wait_get(
                    &operation_id,
                    Some(i64::from(self.timeouts.operation_wait_secs)),
                )
                .await?
                .into_inner()
                .metadata
                .ok_or_else(|| missing("operation metadata"))?;
        }

        match finished_operation(&operation_id, &operation)? {
            Some(finished) => Ok(finished),
            None => Err(IncusError::OperationTimedOut { operation_id }),
        }
    }

    /// Execute a non-interactive command as root and check its exit status.
    #[tracing::instrument(skip(self, command), err)]
    pub async fn exec(&self, name: &InstanceName, command: &[&str]) -> Result<(), IncusError> {
        let body = types::InstanceExecPost {
            command: Some(command.iter().map(|part| (*part).to_owned()).collect()),
            interactive: Some(false),
            wait_for_websocket: Some(false),
            ..Default::default()
        };
        let started = self
            .api
            .instance_exec_post(name.as_str(), None, &body)
            .await?
            .into_inner();
        let operation = self.run_operation(started).await?;
        let exit_code = operation
            .metadata
            .as_ref()
            .and_then(|metadata| metadata.get("return"))
            .and_then(serde_json::Value::as_i64)
            .ok_or_else(|| missing("exec return code"))?;
        if exit_code != 0 {
            return Err(IncusError::ExecFailed { exit_code });
        }
        Ok(())
    }

    async fn change_state(
        &self,
        name: &InstanceName,
        action: StateAction,
        force: bool,
    ) -> Result<(), IncusError> {
        let body = types::InstanceStatePut {
            action: Some(action.as_ref().to_owned()),
            stateful: None,
            force: Some(force),
            timeout: Some(i64::from(self.timeouts.state_change_secs)),
        };

        let started = self
            .api
            .instance_state_put(name.as_str(), None, &body)
            .await?
            .into_inner();
        self.run_operation(started).await?;
        Ok(())
    }
}

/// `Some` once the operation is in a final state, an error if that state is
/// a failure.
pub(crate) fn finished_operation(
    operation_id: &str,
    operation: &types::Operation,
) -> Result<Option<types::Operation>, IncusError> {
    let status_code = operation.status_code.as_ref().map(|code| code.0);

    match status_code {
        Some(OPERATION_SUCCESS) => Ok(Some(operation.clone())),
        Some(OPERATION_FAILURE) => Err(IncusError::OperationFailed {
            operation_id: operation_id.to_owned(),
            message: operation.err.clone().unwrap_or_default(),
        }),
        Some(OPERATION_CANCELLED) => Err(IncusError::OperationCancelled {
            operation_id: operation_id.to_owned(),
        }),
        Some(_) => Ok(None),
        None => Err(missing("operation status_code")),
    }
}

fn instance_info(instance: types::Instance) -> Result<InstanceInfo, IncusError> {
    let code = instance
        .status_code
        .ok_or_else(|| missing("instance status_code"))?
        .0;

    Ok(InstanceInfo {
        name: instance.name.ok_or_else(|| missing("instance name"))?,
        status: InstanceStatus::from_incus(code, instance.status.unwrap_or_default()),
        kind: parse_kind(instance.type_)?,
        config: instance.config.map(|config| config.0).unwrap_or_default(),
        devices: instance
            .devices
            .map(|devices| devices.0)
            .unwrap_or_default(),
    })
}

fn parse_kind(kind: Option<String>) -> Result<InstanceKind, IncusError> {
    let kind = kind.ok_or_else(|| missing("type"))?;
    InstanceKind::from_str(&kind)
        .map_err(|_| IncusError::MalformedResponse(format!("instance type {kind:?}")))
}

fn missing(field: &str) -> IncusError {
    IncusError::MalformedResponse(format!("missing {field}"))
}

#[cfg(test)]
mod test;
