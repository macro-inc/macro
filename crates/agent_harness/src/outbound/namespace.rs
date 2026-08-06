//! Namespace sandbox provider: a thin client over the Compute API calls this
//! harness needs, plus the [`SandboxProvider`]/[`AgentSandbox`] adapters.
//!
//! Deliberately not the Buf-generated Rust SDK. Namespace's API is Connect,
//! and a Connect *unary* call is an ordinary `POST /package.Service/Method`
//! with a JSON body - so `reqwest` and `serde_json` cover every call here,
//! while the generated SDK would mean wiring buf.build's Cargo registry into
//! the workspace and pulling tonic and prost into workspace-hack for five
//! round trips. Namespace's own no-SDK examples take the same route. Note
//! that this only holds for unary: Connect *streams* are a framed envelope,
//! not plain JSON, and nothing here is streaming.
//!
//! Two differences from the Daytona adapter shape the code:
//!
//! - Instances boot from an `imageRef` - an ordinary OCI registry reference -
//!   rather than a provider-side snapshot. Whatever image we run has to be
//!   pushed somewhere Namespace can pull it from.
//! - Instances are deadline-bound at creation. There is no "runs until
//!   deleted" mode, so the deadline is a real ceiling on a session and
//!   [`NamespaceClient::destroy_instance`] is an early release, not the only
//!   way an instance ever goes away.
//!
//! The client's methods are `pub` so one-off binaries can drive them without
//! going through the (still unimplemented) [`SandboxProvider`] adapter - see
//! `src/bin/namespace_hello.rs`.

use std::time::Duration;

use base64::Engine as _;
use serde::Deserialize;

use anyhow::Context;

use crate::domain::ports::{AcpFrames, AgentSandbox, ContainerId, SandboxProvider};
use crate::outbound::provision;
use crate::outbound::daytona::GithubToken;
use crate::outbound::sidecar_pump;

/// Name the sidecar container is addressed by when running commands in it.
const CONTAINER_NAME: &str = "harness";

/// An instance is torn down with its container, so the entrypoint has to
/// outlive the readiness recipe that starts the sidecar. The recipe backgrounds
/// the sidecar, so nothing else holds the container open.
const HOLD_OPEN: [&str; 2] = ["sleep", "infinity"];

/// Compute API service every instance call is addressed to.
const COMPUTE_SERVICE: &str = "namespace.cloud.compute.v1beta.ComputeService";

/// Service that runs commands inside an instance. Unlike the others it is not
/// addressed at the regional API host but at the per-instance endpoint
/// `CreateInstance` hands back.
const COMMAND_SERVICE: &str = "namespace.cloud.compute.v1beta.CommandService";

/// A created instance, and the endpoints for talking to it.
#[derive(Debug)]
pub struct Instance {
    /// Namespace's identifier for the instance.
    pub id: String,
    /// Console URL for a human looking at this instance.
    pub url: String,
    /// Base URL of the [`COMMAND_SERVICE`] serving this instance.
    pub command_endpoint: String,
}

/// Response of `ComputeService/CreateInstance`.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateInstanceResponse {
    metadata: InstanceMetadata,
    instance_url: String,
    extended_metadata: Option<ExtendedMetadata>,
}

/// The identifying half of a created instance.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct InstanceMetadata {
    instance_id: String,
}

/// Endpoints that only exist once an instance has been placed on a runner.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExtendedMetadata {
    command_service_endpoint: Option<String>,
}

/// Response of `CommandService/RunCommandSync`.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RunCommandResponse {
    /// Base64 in the JSON encoding, because proto `bytes` is base64 over
    /// Connect's JSON codec.
    stdout: Option<String>,
    stderr: Option<String>,
    exit_code: Option<i32>,
}

/// Response of `ComputeService/CreateIngress`.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateIngressResponse {
    allocated_ingresses: Vec<AllocatedIngress>,
}

/// One publicly reachable name fronting an exported port.
#[derive(Debug, Deserialize)]
struct AllocatedIngress {
    fqdn: String,
}

/// What a command left behind. Held together because a non-zero exit is
/// usually only diagnosable with the output next to it.
#[derive(Debug)]
pub struct CommandOutput {
    /// The command's standard output.
    pub stdout: String,
    /// The command's standard error.
    pub stderr: String,
    /// Exit status; `0` when the command succeeded.
    pub exit_code: i32,
}

/// The machine an instance runs on.
#[derive(Debug, Clone, Copy)]
pub struct Shape {
    /// Virtual CPUs.
    pub virtual_cpu: u32,
    /// Memory, in megabytes.
    pub memory_megabytes: u32,
    /// Machine architecture, e.g. `amd64`.
    pub machine_arch: &'static str,
}

impl Default for Shape {
    /// The shape Namespace's own examples use.
    fn default() -> Self {
        Self {
            virtual_cpu: 2,
            memory_megabytes: 4096,
            machine_arch: "amd64",
        }
    }
}

/// Everything about the container an instance is created around.
#[derive(Debug, Clone)]
pub struct ContainerSpec {
    /// Name the container is addressed by, including by
    /// [`NamespaceClient::run_command`].
    pub name: String,
    /// OCI reference the image is pulled from. A private registry needs to be
    /// declared to Namespace out of band.
    pub image_ref: String,
    /// Entrypoint arguments. An instance is torn down when its container
    /// exits, so anything long-lived needs a command that does not return.
    pub args: Vec<String>,
    /// Environment variables set inside the container.
    pub env: Vec<(String, String)>,
    /// Ports the container exports, which [`NamespaceClient::create_ingress`]
    /// can then front.
    pub exported_ports: Vec<u16>,
}

/// Bearer token the Namespace client authenticates with.
///
/// Neither `Debug` nor `Display`, so it cannot reach a log or an error
/// message without an explicit [`NamespaceToken::expose`].
///
/// Unlike Daytona's API key these expire, so a long-running service needs to
/// re-mint rather than hold one for its lifetime.
#[derive(Clone)]
pub struct NamespaceToken(String);

crate::outbound::secret!(NamespaceToken);

/// Thin Namespace Compute API client: create, wait, exec, ingress, destroy.
#[derive(Clone)]
pub struct NamespaceClient {
    http: reqwest::Client,
    base: String,
    token: NamespaceToken,
}

impl NamespaceClient {
    /// Build a client against a region's compute API, e.g.
    /// `https://us.compute.namespaceapis.com`.
    #[must_use]
    pub fn new(api_url: String, token: NamespaceToken) -> Self {
        Self {
            http: reqwest::Client::new(),
            base: api_url.trim_end_matches('/').to_owned(),
            token,
        }
    }

    /// Create an instance running `container`, and return its ids and
    /// endpoints.
    ///
    /// `lifetime` becomes the instance's deadline: Namespace tears it down
    /// when that passes, whether or not anything is still using it.
    ///
    /// `purpose` is what shows up next to the instance in Namespace's
    /// console, so it should say who created it and why.
    ///
    /// The instance is still booting when this returns; wait for it with
    /// [`NamespaceClient::wait_until_ready`].
    #[tracing::instrument(err, skip(self))]
    pub async fn create_instance(
        &self,
        container: &ContainerSpec,
        shape: Shape,
        lifetime: Duration,
        purpose: &str,
    ) -> anyhow::Result<Instance> {
        let deadline = chrono::Utc::now()
            + chrono::TimeDelta::from_std(lifetime)
                .map_err(|error| anyhow::anyhow!("lifetime is out of range: {error}"))?;

        let env: Vec<_> = container
            .env
            .iter()
            .map(|(name, value)| serde_json::json!({ "name": name, "value": value }))
            .collect();
        let exported_ports: Vec<_> = container
            .exported_ports
            .iter()
            .map(|port| {
                serde_json::json!({
                    "name": format!("port-{port}"),
                    "containerPort": port,
                    "proto": "TCP",
                })
            })
            .collect();

        let response: CreateInstanceResponse = self
            .call(
                &self.base,
                COMPUTE_SERVICE,
                "CreateInstance",
                &serde_json::json!({
                    "shape": {
                        "virtualCpu": shape.virtual_cpu,
                        "memoryMegabytes": shape.memory_megabytes,
                        "machineArch": shape.machine_arch,
                    },
                    "documentedPurpose": purpose,
                    "deadline": deadline.to_rfc3339(),
                    "containers": [{
                        "name": container.name,
                        "imageRef": container.image_ref,
                        "args": container.args,
                        "env": env,
                        "exportPorts": exported_ports,
                    }],
                }),
            )
            .await?;

        let command_endpoint = response
            .extended_metadata
            .and_then(|metadata| metadata.command_service_endpoint)
            .ok_or_else(|| {
                anyhow::anyhow!(
                    "instance {} came back without a command service endpoint",
                    response.metadata.instance_id
                )
            })?;

        Ok(Instance {
            id: response.metadata.instance_id,
            url: response.instance_url,
            command_endpoint,
        })
    }

    /// Block until the instance is ready to take commands.
    ///
    /// Server-side: `WaitInstanceSync` holds the request open rather than
    /// making the caller poll, so unlike the Daytona adapter there is no
    /// polling loop here - only a client timeout bounding the wait.
    #[tracing::instrument(err, skip(self))]
    pub async fn wait_until_ready(
        &self,
        instance_id: &str,
        timeout: Duration,
    ) -> anyhow::Result<()> {
        let body = serde_json::json!({ "instanceId": instance_id });
        let wait = self.call::<serde::de::IgnoredAny>(
            &self.base,
            COMPUTE_SERVICE,
            "WaitInstanceSync",
            &body,
        );

        tokio::time::timeout(timeout, wait)
            .await
            .map_err(|_| {
                anyhow::anyhow!("instance {instance_id} was not ready within {timeout:?}")
            })?
            .map(|_| ())
    }

    /// Run one command in a container and wait for it to finish.
    ///
    /// Returns the output whatever the exit status: a caller that treats
    /// non-zero as fatal has the stderr it needs to say why.
    #[tracing::instrument(err, skip(self))]
    pub async fn run_command(
        &self,
        instance: &Instance,
        container_name: &str,
        command: &[&str],
    ) -> anyhow::Result<CommandOutput> {
        let response: RunCommandResponse = self
            .call(
                &instance.command_endpoint,
                COMMAND_SERVICE,
                "RunCommandSync",
                &serde_json::json!({
                    "instanceId": instance.id,
                    "targetContainerName": container_name,
                    "command": { "command": command },
                }),
            )
            .await?;

        Ok(CommandOutput {
            stdout: decode_stream(response.stdout.as_deref(), "stdout")?,
            stderr: decode_stream(response.stderr.as_deref(), "stderr")?,
            exit_code: response.exit_code.unwrap_or_default(),
        })
    }

    /// Publish an exported port and return the URL it is reachable at.
    ///
    /// Ingresses terminate TLS and speak HTTP, so the URL is always `https`.
    #[tracing::instrument(err, skip(self))]
    pub async fn create_ingress(&self, instance_id: &str, port: u16) -> anyhow::Result<String> {
        let response: CreateIngressResponse = self
            .call(
                &self.base,
                COMPUTE_SERVICE,
                "CreateIngress",
                &serde_json::json!({
                    "instanceId": instance_id,
                    "ingresses": [{
                        "name": format!("port-{port}"),
                        "exportedPortBackend": { "port": port },
                    }],
                }),
            )
            .await?;

        let ingress = response
            .allocated_ingresses
            .into_iter()
            .next()
            .ok_or_else(|| anyhow::anyhow!("no ingress was allocated for port {port}"))?;

        Ok(format!("https://{}", ingress.fqdn))
    }

    /// Release an instance before its deadline.
    #[tracing::instrument(err, skip(self))]
    pub async fn destroy_instance(&self, instance_id: &str) -> anyhow::Result<()> {
        self.call::<serde::de::IgnoredAny>(
            &self.base,
            COMPUTE_SERVICE,
            "DestroyInstance",
            &serde_json::json!({ "instanceId": instance_id }),
        )
        .await
        .map(|_| ())
    }

    /// Make one Connect unary call: `POST {host}/{service}/{method}` with a
    /// JSON body, a bearer token, and a JSON reply.
    ///
    /// Connect reports failures as a non-200 whose body is a JSON error
    /// object, so the body is carried into the error - that is where the
    /// reason lives.
    async fn call<T: serde::de::DeserializeOwned>(
        &self,
        host: &str,
        service: &str,
        method: &str,
        body: &serde_json::Value,
    ) -> anyhow::Result<T> {
        let url = format!("{}/{service}/{method}", host.trim_end_matches('/'));
        let response = self
            .http
            .post(&url)
            .bearer_auth(self.token.expose())
            .json(body)
            .send()
            .await
            .map_err(|error| anyhow::anyhow!("{method} failed: {error}"))?;

        let status = response.status();
        let body = response
            .text()
            .await
            .map_err(|error| anyhow::anyhow!("failed to read the {method} response: {error}"))?;

        if !status.is_success() {
            anyhow::bail!("{method} failed: namespace returned {status}: {body}");
        }

        serde_json::from_str(&body).map_err(|error| {
            anyhow::anyhow!("failed to parse the {method} response: {error}: {body}")
        })
    }
}

/// Decode one base64 output stream, which Connect's JSON codec uses for proto
/// `bytes`. Absent means the command wrote nothing.
fn decode_stream(encoded: Option<&str>, which: &str) -> anyhow::Result<String> {
    let Some(encoded) = encoded else {
        return Ok(String::new());
    };

    let bytes = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .map_err(|error| anyhow::anyhow!("{which} was not valid base64: {error}"))?;

    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

/// What the Namespace provider needs to talk to Namespace and to stamp out
/// sandboxes.
///
/// Deliberately not the service's `Config`: reading the environment and
/// mapping it onto adapter arguments is the composition root's job, so this
/// crate never learns how those values are sourced.
///
/// No `Debug`: it holds credentials, and the newtypes are the only thing
/// stopping a derive here from printing them.
pub struct NamespaceSettings {
    /// Base URL of the region's compute API.
    pub api_url: String,
    /// Bearer token the client authenticates with.
    pub token: NamespaceToken,
    /// OCI reference sandboxes are created from. Unlike Daytona's snapshot
    /// this is an ordinary registry reference, so the image has to be pushed
    /// somewhere Namespace can pull it - including credentials for a private
    /// registry, which are declared to Namespace out of band.
    pub image_ref: String,
    /// How long an instance may live before Namespace reclaims it.
    pub lifetime: Duration,
    /// Token with read access to the repo cloned into instances.
    pub github_token: GithubToken,
}

/// Hands out Namespace sandboxes.
pub struct NamespaceProvider {
    client: NamespaceClient,
    image_ref: String,
    lifetime: Duration,
    github_token: GithubToken,
}

impl NamespaceProvider {
    /// Build the provider from its settings.
    #[must_use]
    pub fn new(settings: NamespaceSettings) -> Self {
        let NamespaceSettings {
            api_url,
            token,
            image_ref,
            lifetime,
            github_token,
        } = settings;
        Self {
            client: NamespaceClient::new(api_url, token),
            image_ref,
            lifetime,
            github_token,
        }
    }

    /// Wait for the instance to boot, run the readiness recipe, and front the
    /// sidecar with an ingress.
    ///
    /// Split out of `spawn` so every failure past `create_instance` shares one
    /// cleanup path.
    async fn bring_up(&self, instance: Instance) -> anyhow::Result<NamespaceSandbox> {
        self.client
            .wait_until_ready(&instance.id, provision::ENSURE_TIMEOUT)
            .await?;

        let output = self
            .client
            .run_command(
                &instance,
                CONTAINER_NAME,
                &["bash", "-lc", &provision::ensure_ready_command()],
            )
            .await
            .context("running the readiness recipe")?;
        anyhow::ensure!(
            output.exit_code == 0,
            "readiness recipe exited {} in instance {}:\n{}\n{}",
            output.exit_code,
            instance.id,
            output.stdout,
            output.stderr
        );

        let sidecar_url = self
            .client
            .create_ingress(&instance.id, provision::SIDECAR_PORT)
            .await
            .context("fronting the sidecar with an ingress")?;

        Ok(NamespaceSandbox {
            id: ContainerId::new(instance.id.clone()),
            instance,
            client: self.client.clone(),
            sidecar_url: sidecar_url.trim_end_matches('/').to_owned(),
        })
    }
}

impl SandboxProvider for NamespaceProvider {
    type Sandbox = NamespaceSandbox;

    async fn resume(&self, _id: &ContainerId) -> anyhow::Result<Self::Sandbox> {
        todo!("re-resolve the sidecar ingress; fails once the instance deadline has passed")
    }

    #[tracing::instrument(err, skip(self))]
    async fn spawn(&self) -> anyhow::Result<Self::Sandbox> {
        // An instance dies with its container, so the container has to run
        // something that stays up. The sidecar is that something in production;
        // the readiness recipe starts it, so the entrypoint only has to outlive
        // the recipe.
        let container = ContainerSpec {
            name: CONTAINER_NAME.to_owned(),
            image_ref: self.image_ref.clone(),
            args: HOLD_OPEN.iter().map(|arg| (*arg).to_owned()).collect(),
            // The repo url and token ride in the instance environment so the
            // ensure script takes no arguments, and so a credential never lands
            // in a command line.
            env: vec![
                ("REPO_URL".to_owned(), provision::REPO_URL.to_owned()),
                (
                    "GITHUB_TOKEN".to_owned(),
                    self.github_token.expose().to_owned(),
                ),
            ],
            exported_ports: vec![provision::SIDECAR_PORT],
        };

        let instance = self
            .client
            .create_instance(
                &container,
                Shape::default(),
                self.lifetime,
                "agent_harness agent session",
            )
            .await
            .context("creating namespace instance")?;
        tracing::info!(instance_id = %instance.id, url = %instance.url, "instance created");

        // Everything past create runs against an instance we are paying for, so
        // failures destroy it rather than leaking it - though the deadline would
        // reclaim it eventually either way.
        let id = instance.id.clone();
        match self.bring_up(instance).await {
            Ok(sandbox) => Ok(sandbox),
            Err(error) => {
                if let Err(destroy_error) = self.client.destroy_instance(&id).await {
                    tracing::error!(
                        error = ?destroy_error,
                        instance_id = %id,
                        "failed to destroy an instance that never came up"
                    );
                }
                Err(error)
            }
        }
    }
}

/// One Namespace instance running the ACP sidecar.
pub struct NamespaceSandbox {
    /// The instance id, as the stable container identifier.
    id: ContainerId,
    instance: Instance,
    client: NamespaceClient,
    /// Externally reachable base URL of the sidecar, allocated at spawn.
    sidecar_url: String,
}

impl AgentSandbox for NamespaceSandbox {
    fn id(&self) -> &ContainerId {
        &self.id
    }

    /// UNVERIFIED: ingresses terminate TLS and speak HTTP, so this dials `wss`,
    /// but that the upgrade survives the ingress has not been observed.
    #[tracing::instrument(err, skip(self), fields(instance_id = %self.instance.id))]
    async fn connect(&self) -> anyhow::Result<AcpFrames> {
        let ws_url = self.sidecar_url.replacen("http", "ws", 1);
        let (socket, _) = tokio_tungstenite::connect_async(ws_url.as_str())
            .await
            .context("dialing the sidecar websocket through the ingress")?;

        Ok(sidecar_pump::spawn(socket))
    }

    async fn release(&self) {
        // Reported rather than propagated - a leaked instance should not mask
        // why the run ended, and its deadline reclaims it regardless.
        let _ = self
            .client
            .destroy_instance(&self.instance.id)
            .await
            .inspect_err(|error| {
                tracing::error!(
                    error = ?error,
                    instance_id = %self.instance.id,
                    "instance destroy failed"
                );
            });
    }
}
