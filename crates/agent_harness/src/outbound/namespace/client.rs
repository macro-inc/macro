use std::time::Duration;

use base64::Engine as _;
use serde::{Deserialize, Serialize};

use super::errors::{NamespaceError, Result};
use super::types::{CommandOutput, ContainerSpec, Instance, InstanceId, NamespaceToken};
use crate::domain::sandbox::SandboxResources;

const COMPUTE_SERVICE: &str = "namespace.cloud.compute.v1beta.ComputeService";
const COMMAND_SERVICE: &str = "namespace.cloud.compute.v1beta.CommandService";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateInstanceResponse {
    metadata: InstanceMetadata,
    instance_url: String,
    extended_metadata: Option<ExtendedMetadata>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct InstanceMetadata {
    instance_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExtendedMetadata {
    command_service_endpoint: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RunCommandResponse {
    stdout: Option<String>,
    stderr: Option<String>,
    exit_code: Option<i32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateIngressResponse {
    allocated_ingresses: Vec<AllocatedIngress>,
}

#[derive(Debug, Deserialize)]
struct AllocatedIngress {
    fqdn: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CreateInstanceRequest<'a> {
    shape: ShapeRequest,
    documented_purpose: &'static str,
    deadline: String,
    containers: [ContainerRequest<'a>; 1],
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ShapeRequest {
    virtual_cpu: u32,
    memory_megabytes: u32,
    machine_arch: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ContainerRequest<'a> {
    name: &'static str,
    image_ref: &'a str,
    args: [&'static str; 2],
    env: Vec<EnvironmentVariableRequest<'a>>,
    export_ports: Vec<ExportPortRequest>,
}

#[derive(Serialize)]
struct EnvironmentVariableRequest<'a> {
    name: &'a str,
    value: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ExportPortRequest {
    name: String,
    container_port: u16,
    proto: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct InstanceIdRequest<'a> {
    instance_id: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RunCommandRequest<'a> {
    instance_id: &'a str,
    target_container_name: &'a str,
    command: CommandRequest<'a>,
}

#[derive(Serialize)]
struct CommandRequest<'a> {
    command: &'a [&'a str],
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CreateIngressRequest<'a> {
    instance_id: &'a str,
    ingresses: [IngressRequest; 1],
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct IngressRequest {
    name: String,
    exported_port_backend: ExportedPortBackendRequest,
}

#[derive(Serialize)]
struct ExportedPortBackendRequest {
    port: u16,
}

fn configuration_parameters<'a>(
    container: &'a ContainerSpec,
    deadline: String,
    resources: SandboxResources,
) -> CreateInstanceRequest<'a> {
    let env = container
        .env
        .iter()
        .map(|(name, value)| EnvironmentVariableRequest { name, value })
        .collect();
    let export_ports = container
        .exported_ports
        .iter()
        .map(|port| ExportPortRequest {
            name: format!("port-{port}"),
            container_port: *port,
            proto: "TCP",
        })
        .collect();

    CreateInstanceRequest {
        shape: ShapeRequest {
            virtual_cpu: resources.cpu,
            memory_megabytes: resources.memory_gib * 1024,
            machine_arch: "amd64",
        },
        documented_purpose: "agent_harness agent session",
        deadline,
        containers: [ContainerRequest {
            name: "harness",
            image_ref: container.image_ref.as_str(),
            args: ["sleep", "infinity"],
            env,
            export_ports,
        }],
    }
}

/// Thin client for the Namespace Connect endpoints used by the harness.
#[derive(Clone)]
pub struct NamespaceClient {
    http: reqwest::Client,
    base: String,
    token: NamespaceToken,
}

impl NamespaceClient {
    /// Build a client against a regional Namespace Compute API.
    #[must_use]
    pub fn new(api_url: String, token: NamespaceToken) -> Self {
        Self {
            http: reqwest::Client::new(),
            base: api_url.trim_end_matches('/').to_owned(),
            token,
        }
    }

    /// Create an instance and return its identifiers and endpoints.
    #[tracing::instrument(err, skip(self, container))]
    pub async fn create_instance(
        &self,
        container: &ContainerSpec,
        lifetime: Duration,
        resources: SandboxResources,
    ) -> Result<Instance> {
        let deadline = chrono::Utc::now()
            + chrono::TimeDelta::from_std(lifetime).map_err(NamespaceError::LifetimeOutOfRange)?;
        let request = configuration_parameters(container, deadline.to_rfc3339(), resources);
        let response: CreateInstanceResponse = self
            .call(&self.base, COMPUTE_SERVICE, "CreateInstance", &request)
            .await?;
        let instance_id = response.metadata.instance_id;
        let command_endpoint = response
            .extended_metadata
            .and_then(|metadata| metadata.command_service_endpoint)
            .ok_or_else(|| NamespaceError::MissingCommandServiceEndpoint {
                instance_id: instance_id.clone(),
            })?;

        Ok(Instance {
            id: InstanceId::new(instance_id),
            url: response.instance_url,
            command_endpoint,
        })
    }

    /// Wait until an instance can accept commands.
    #[tracing::instrument(err, skip(self))]
    pub async fn wait_until_ready(
        &self,
        instance_id: &InstanceId,
        timeout: Duration,
    ) -> Result<()> {
        let request = InstanceIdRequest {
            instance_id: instance_id.as_str(),
        };
        let wait = self.call::<serde::de::IgnoredAny, _>(
            &self.base,
            COMPUTE_SERVICE,
            "WaitInstanceSync",
            &request,
        );
        tokio::time::timeout(timeout, wait).await.map_err(|_| {
            NamespaceError::InstanceReadyTimeout {
                instance_id: instance_id.to_string(),
                timeout,
            }
        })??;
        Ok(())
    }

    /// Run one command inside an instance.
    #[tracing::instrument(err, skip(self, command))]
    pub async fn run_command(
        &self,
        instance: &Instance,
        command: &[&str],
    ) -> Result<CommandOutput> {
        let request = RunCommandRequest {
            instance_id: instance.id.as_str(),
            target_container_name: "harness",
            command: CommandRequest { command },
        };
        let response: RunCommandResponse = self
            .call(
                &instance.command_endpoint,
                COMMAND_SERVICE,
                "RunCommandSync",
                &request,
            )
            .await?;

        Ok(CommandOutput {
            stdout: decode_stream(response.stdout.as_deref(), "stdout")?,
            stderr: decode_stream(response.stderr.as_deref(), "stderr")?,
            exit_code: response.exit_code.unwrap_or_default(),
        })
    }

    /// Publish an exported port and return its public URL.
    #[tracing::instrument(err, skip(self))]
    pub async fn create_ingress(&self, instance_id: &InstanceId, port: u16) -> Result<String> {
        let request = CreateIngressRequest {
            instance_id: instance_id.as_str(),
            ingresses: [IngressRequest {
                name: format!("port-{port}"),
                exported_port_backend: ExportedPortBackendRequest { port },
            }],
        };
        let response: CreateIngressResponse = self
            .call(&self.base, COMPUTE_SERVICE, "CreateIngress", &request)
            .await?;
        let ingress = response
            .allocated_ingresses
            .into_iter()
            .next()
            .ok_or(NamespaceError::NoIngressAllocated { port })?;
        Ok(format!("https://{}", ingress.fqdn))
    }

    /// Release an instance before its deadline.
    #[tracing::instrument(err, skip(self))]
    pub async fn destroy_instance(&self, instance_id: &InstanceId) -> Result<()> {
        let request = InstanceIdRequest {
            instance_id: instance_id.as_str(),
        };
        self.call::<serde::de::IgnoredAny, _>(
            &self.base,
            COMPUTE_SERVICE,
            "DestroyInstance",
            &request,
        )
        .await
        .map(|_| ())
    }

    async fn call<T, B>(
        &self,
        host: &str,
        service: &str,
        method: &'static str,
        body: &B,
    ) -> Result<T>
    where
        T: serde::de::DeserializeOwned,
        B: Serialize + ?Sized,
    {
        let url = format!("{}/{service}/{method}", host.trim_end_matches('/'));
        let response = self
            .http
            .post(url)
            .bearer_auth(self.token.expose())
            .json(body)
            .send()
            .await
            .map_err(|source| NamespaceError::Request { method, source })?;
        let status = response.status();
        let body = response
            .text()
            .await
            .map_err(|source| NamespaceError::ReadResponse { method, source })?;
        if !status.is_success() {
            return Err(NamespaceError::Api {
                method,
                status,
                body,
            });
        }
        serde_json::from_str(&body).map_err(|source| NamespaceError::Decode {
            method,
            source,
            body,
        })
    }
}

fn decode_stream(encoded: Option<&str>, stream: &'static str) -> Result<String> {
    let Some(encoded) = encoded else {
        return Ok(String::new());
    };
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .map_err(|source| NamespaceError::InvalidBase64 { stream, source })?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}
