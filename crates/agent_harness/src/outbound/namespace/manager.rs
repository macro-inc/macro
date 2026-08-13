use std::sync::Arc;

use agent_runtime_protocol::domain::ports::{Transport, TransportError};
use agent_runtime_protocol::domain::schema::v0::{ToRuntimeMessage, ToServerMessage};
use agent_session::domain::model::AgentSessionId;

use super::client::NamespaceClient;
use super::errors::NamespaceError;
use super::types::{ContainerSpec, Instance, NamespaceSettings};
use crate::domain::error::{HarnessError, Result};
use crate::domain::model::SpawnContainer;
use crate::domain::ports::ContainerManager;
use crate::outbound::daytona::GithubToken;
use crate::outbound::provision;
use crate::outbound::sidecar::SidecarTransport;

/// Hands out Namespace instances.
pub struct NamespaceContainerManager {
    client: NamespaceClient,
    image_ref: super::types::ImageRef,
    lifetime: std::time::Duration,
    github_token: GithubToken,
}

impl NamespaceContainerManager {
    /// Build the manager from its settings.
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

    async fn bring_up(&self, instance: Instance) -> Result<NamespaceContainer> {
        self.client
            .wait_until_ready(&instance.id, provision::ENSURE_TIMEOUT)
            .await
            .map_err(unavailable)?;
        let output = self
            .client
            .run_command(
                &instance,
                &["bash", "-lc", &provision::ensure_ready_command()],
            )
            .await
            .map_err(unavailable)?;
        if output.exit_code != 0 {
            return Err(unavailable(NamespaceError::ReadinessRecipe {
                instance_id: instance.id.to_string(),
                exit_code: output.exit_code,
                stdout: output.stdout,
                stderr: output.stderr,
            }));
        }

        let sidecar_url = self
            .client
            .create_ingress(&instance.id, provision::SIDECAR_PORT)
            .await
            .map_err(unavailable)?;
        let socket = dial_sidecar(&sidecar_url).await.map_err(unavailable)?;

        Ok(NamespaceContainer {
            instance: Arc::new(instance),
            client: self.client.clone(),
            wire: Arc::new(SidecarTransport::connect(socket)),
        })
    }
}

impl ContainerManager for NamespaceContainerManager {
    type Transport = NamespaceContainer;

    #[tracing::instrument(err, skip(self))]
    async fn spawn(&self, command: SpawnContainer) -> Result<Self::Transport> {
        let container = ContainerSpec {
            image_ref: self.image_ref.clone(),
            env: vec![
                ("REPO_URL".to_owned(), command.repo_url),
                (
                    "GITHUB_TOKEN".to_owned(),
                    self.github_token.expose().to_owned(),
                ),
            ],
            exported_ports: vec![provision::SIDECAR_PORT],
        };
        let instance = self
            .client
            .create_instance(&container, self.lifetime)
            .await
            .map_err(unavailable)?;
        tracing::info!(instance_id = %instance.id, url = %instance.url, "instance created");
        let instance_id = instance.id.clone();

        match self.bring_up(instance).await {
            Ok(container) => Ok(container),
            Err(error) => {
                if let Err(destroy_error) = self.client.destroy_instance(&instance_id).await {
                    tracing::error!(
                        error = ?destroy_error,
                        instance_id = %instance_id,
                        "failed to destroy an instance that never came up"
                    );
                }
                Err(error)
            }
        }
    }

    async fn resume(&self, _session: AgentSessionId) -> Result<Self::Transport> {
        todo!("resuming Namespace instances is not implemented yet")
    }

    async fn teardown(&self, _session: AgentSessionId) -> Result<()> {
        // Tearing down needs the instance id for a session, which is the same
        // lookup `resume` is waiting on.
        todo!("tearing down Namespace instances is not implemented yet")
    }
}

/// One Namespace instance and its live sidecar transport.
#[derive(Clone)]
pub struct NamespaceContainer {
    instance: Arc<Instance>,
    client: NamespaceClient,
    wire: Arc<SidecarTransport>,
}

impl NamespaceContainer {
    /// Destroy the instance, logging a provider failure rather than masking the run result.
    pub async fn release(&self) {
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

impl Transport<ToRuntimeMessage, ToServerMessage> for NamespaceContainer {
    async fn send(&self, message: ToRuntimeMessage) -> std::result::Result<(), TransportError> {
        self.wire.send(message).await
    }

    async fn recv(&self) -> std::result::Result<Option<ToServerMessage>, TransportError> {
        self.wire.recv().await
    }
}

async fn dial_sidecar(
    ingress_url: &str,
) -> std::result::Result<
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>,
    NamespaceError,
> {
    let mut ws_url =
        url::Url::parse(ingress_url).map_err(|source| NamespaceError::InvalidIngressUrl {
            url: ingress_url.to_owned(),
            source,
        })?;
    let websocket_scheme = match ws_url.scheme() {
        "http" => "ws",
        "https" => "wss",
        scheme => {
            return Err(NamespaceError::UnsupportedIngressScheme {
                scheme: scheme.to_owned(),
            });
        }
    };
    ws_url
        .set_scheme(websocket_scheme)
        .map_err(|()| NamespaceError::UnsupportedIngressScheme {
            scheme: websocket_scheme.to_owned(),
        })?;
    let (socket, _) = tokio_tungstenite::connect_async(ws_url.as_str())
        .await
        .map_err(NamespaceError::WebSocketConnect)?;
    Ok(socket)
}

fn unavailable(error: NamespaceError) -> HarnessError {
    HarnessError::Container(error.to_string())
}
