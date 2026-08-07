use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use agent_runtime_protocol::domain::ports::{Transport, TransportError};
use agent_runtime_protocol::domain::schema::v0::{ToRuntimeMessage, ToServerMessage};
use agent_session::domain::model::AgentSessionId;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;

use super::client::DaytonaClient;
use super::errors::DaytonaError;
use super::types::{DaytonaSettings, Env, GithubToken, Labels, PortPreview, Snapshot};
use crate::domain::error::{HarnessError, Result};
use crate::domain::model::SpawnContainer;
use crate::domain::ports::ContainerManager;
use crate::outbound::provision;
use crate::outbound::sidecar::SidecarTransport;

const LOG_FETCH_TIMEOUT: Duration = Duration::from_secs(15);
const SESSION_LABEL: &str = "macro.agent_session_id";

/// Hands out Daytona sandboxes.
pub struct DaytonaContainerManager {
    client: DaytonaClient,
    snapshot: Snapshot,
    github_token: GithubToken,
}

impl DaytonaContainerManager {
    /// Build the manager from its settings.
    #[must_use]
    pub fn new(settings: DaytonaSettings) -> Self {
        let DaytonaSettings {
            api_url,
            api_key,
            snapshot,
            github_token,
        } = settings;
        Self {
            client: DaytonaClient::new(api_url, api_key),
            snapshot,
            github_token,
        }
    }

    async fn bring_up(&self, id: &str) -> Result<DaytonaContainer> {
        self.client
            .wait_for_started(id, provision::ENSURE_TIMEOUT)
            .await
            .map_err(unavailable)?;
        let output = self
            .client
            .exec(
                id,
                &provision::ensure_ready_command(),
                provision::ENSURE_TIMEOUT,
            )
            .await
            .map_err(unavailable)?;
        tracing::info!(sandbox_id = %id, %output, "readiness recipe finished");

        let preview = self
            .client
            .port_preview(id, provision::SIDECAR_PORT)
            .await
            .map_err(unavailable)?;
        self.client
            .wait_for_ping(
                &format!("{}/ping", preview.url),
                preview.token.as_deref(),
                provision::PING_TIMEOUT,
            )
            .await
            .map_err(unavailable)?;
        let socket = dial_sidecar(&preview).await.map_err(unavailable)?;

        Ok(DaytonaContainer {
            id: id.to_owned(),
            client: self.client.clone(),
            wire: Arc::new(SidecarTransport::connect(socket)),
        })
    }

    async fn discard(&self, id: &str) {
        if let Ok(log) = self
            .client
            .exec(
                id,
                &format!("tail -50 {} 2>&1 || true", provision::SIDECAR_LOG),
                LOG_FETCH_TIMEOUT,
            )
            .await
        {
            tracing::error!(sandbox_id = %id, sidecar_log = %log, "sidecar log");
        }

        if let Err(error) = self.client.delete(id).await {
            tracing::error!(
                error = ?error,
                sandbox_id = %id,
                "failed to delete a sandbox that never came up"
            );
        }
    }
}

impl ContainerManager for DaytonaContainerManager {
    type Transport = DaytonaContainer;

    #[tracing::instrument(err, skip(self))]
    async fn spawn(&self, command: SpawnContainer) -> Result<DaytonaContainer> {
        let SpawnContainer {
            session_id,
            repo_url,
        } = command;
        let env = Env::from(HashMap::from([
            ("REPO_URL".to_owned(), repo_url),
            (
                "GITHUB_TOKEN".to_owned(),
                self.github_token.expose().to_owned(),
            ),
        ]));
        let labels = Labels::from(HashMap::from([(
            SESSION_LABEL.to_owned(),
            session_id.to_string(),
        )]));
        let id = self
            .client
            .create(&self.snapshot, env, labels)
            .await
            .map_err(unavailable)?;
        tracing::info!(sandbox_id = %id, session = %session_id, "sandbox created");

        match self.bring_up(&id).await {
            Ok(container) => Ok(container),
            Err(error) => {
                self.discard(&id).await;
                Err(error)
            }
        }
    }

    #[tracing::instrument(err, skip(self))]
    async fn resume(&self, session: AgentSessionId) -> Result<DaytonaContainer> {
        let id = self
            .client
            .find_by_label(SESSION_LABEL, &session.to_string())
            .await
            .map_err(unavailable)?
            .ok_or_else(|| {
                HarnessError::Container(format!("session {session} has no sandbox to resume"))
            })?;
        self.client.start(&id).await.map_err(unavailable)?;
        self.bring_up(&id).await
    }
}

/// One Daytona sandbox and the live protocol connection to its sidecar.
#[derive(Clone)]
pub struct DaytonaContainer {
    id: String,
    client: DaytonaClient,
    wire: Arc<SidecarTransport>,
}

impl DaytonaContainer {
    /// Destroy the sandbox, logging a provider failure rather than masking the run result.
    pub async fn release(&self) {
        let _ = self.client.delete(&self.id).await.inspect_err(|error| {
            tracing::error!(error = ?error, sandbox_id = %self.id, "sandbox delete failed");
        });
    }
}

impl Transport<ToRuntimeMessage, ToServerMessage> for DaytonaContainer {
    async fn send(&self, message: ToRuntimeMessage) -> std::result::Result<(), TransportError> {
        self.wire.send(message).await
    }

    async fn recv(&self) -> std::result::Result<Option<ToServerMessage>, TransportError> {
        self.wire.recv().await
    }
}

async fn dial_sidecar(
    preview: &PortPreview,
) -> std::result::Result<
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>,
    DaytonaError,
> {
    let mut ws_url =
        url::Url::parse(&preview.url).map_err(|source| DaytonaError::InvalidPreviewUrl {
            url: preview.url.clone(),
            source,
        })?;
    let websocket_scheme = match ws_url.scheme() {
        "http" => "ws",
        "https" => "wss",
        scheme => {
            return Err(DaytonaError::UnsupportedPreviewScheme {
                scheme: scheme.to_owned(),
            });
        }
    };
    ws_url
        .set_scheme(websocket_scheme)
        .map_err(|()| DaytonaError::UnsupportedPreviewScheme {
            scheme: websocket_scheme.to_owned(),
        })?;
    let mut request = ws_url
        .as_str()
        .into_client_request()
        .map_err(DaytonaError::WebSocketRequest)?;
    if let Some(token) = &preview.token {
        request.headers_mut().insert(
            "x-daytona-preview-token",
            token.parse().map_err(DaytonaError::InvalidPreviewToken)?,
        );
    }

    let (socket, _) = tokio_tungstenite::connect_async(request)
        .await
        .map_err(DaytonaError::WebSocketConnect)?;
    Ok(socket)
}

fn unavailable(error: DaytonaError) -> HarnessError {
    HarnessError::Container(error.to_string())
}
