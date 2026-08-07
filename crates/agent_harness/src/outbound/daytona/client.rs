use std::collections::HashMap;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use super::errors::{DaytonaError, Result};
use super::types::{DaytonaApiKey, Env, Labels, PortPreview, Snapshot};

#[cfg(test)]
mod test;

const POLL_INTERVAL: Duration = Duration::from_millis(250);

#[derive(Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum SandboxState {
    Started,
    Error,
    BuildFailed,
    #[serde(other)]
    Other,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SandboxDto {
    id: String,
    state: SandboxState,
    error_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
struct SandboxListDto {
    items: Vec<SandboxDto>,
}

#[derive(Debug, Deserialize)]
struct ToolboxProxyUrlDto {
    url: String,
}

#[derive(Debug, Deserialize)]
struct PortPreviewUrlDto {
    url: String,
    token: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExecuteResponseDto {
    exit_code: Option<i32>,
    result: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CreateSandboxRequest<'a> {
    snapshot: &'a Snapshot,
    env: Env,
    labels: Labels,
    auto_stop_interval: u8,
}

#[derive(Serialize)]
struct ExecuteRequest<'a> {
    command: &'a str,
    timeout: u64,
}

fn configuration_parameters(
    snapshot: &Snapshot,
    env: Env,
    labels: Labels,
) -> CreateSandboxRequest<'_> {
    CreateSandboxRequest {
        snapshot,
        env,
        labels,
        auto_stop_interval: 0,
    }
}

/// Thin client for the Daytona REST endpoints used by the harness.
#[derive(Clone)]
pub struct DaytonaClient {
    http: reqwest::Client,
    base: String,
    api_key: DaytonaApiKey,
}

impl DaytonaClient {
    /// Build a client against the Daytona API URL.
    #[must_use]
    pub fn new(api_url: String, api_key: DaytonaApiKey) -> Self {
        Self {
            http: reqwest::Client::new(),
            base: api_url.trim_end_matches('/').to_owned(),
            api_key,
        }
    }

    /// Create a sandbox and return its Daytona id.
    #[tracing::instrument(err, skip(self, env))]
    pub async fn create(&self, snapshot: &Snapshot, env: Env, labels: Labels) -> Result<String> {
        let request = configuration_parameters(snapshot, env, labels);
        let sandbox: SandboxDto = self
            .json(
                self.http
                    .post(format!("{}/sandbox", self.base))
                    .json(&request),
                "create sandbox",
            )
            .await?;

        Ok(sandbox.id)
    }

    /// Find one sandbox carrying the supplied label.
    #[tracing::instrument(err, skip(self))]
    pub async fn find_by_label(&self, label: &str, value: &str) -> Result<Option<String>> {
        let labels = Labels::from(HashMap::from([(label.to_owned(), value.to_owned())]));
        let filter = serde_json::to_string(&labels).map_err(DaytonaError::EncodeLabelFilter)?;
        let response: SandboxListDto = self
            .json(
                self.http
                    .get(format!("{}/sandbox", self.base))
                    .query(&[("labels", filter.as_str())]),
                "list sandboxes",
            )
            .await?;
        let sandboxes = response.items;

        if sandboxes.len() > 1 {
            tracing::warn!(
                label,
                value,
                count = sandboxes.len(),
                "more than one sandbox carries this label; picking one arbitrarily"
            );
        }

        Ok(sandboxes.into_iter().next().map(|sandbox| sandbox.id))
    }

    /// Poll a sandbox until it has started or the deadline passes.
    #[tracing::instrument(err, skip(self))]
    pub async fn wait_for_started(&self, sandbox_id: &str, timeout: Duration) -> Result<()> {
        let deadline = Instant::now() + timeout;
        loop {
            let sandbox: SandboxDto = self
                .json(
                    self.http.get(format!("{}/sandbox/{sandbox_id}", self.base)),
                    "get sandbox",
                )
                .await?;

            match sandbox.state {
                SandboxState::Started => return Ok(()),
                SandboxState::Error | SandboxState::BuildFailed => {
                    return Err(DaytonaError::SandboxStart {
                        sandbox_id: sandbox_id.to_owned(),
                        state: format!("{:?}", sandbox.state),
                        reason: sandbox
                            .error_reason
                            .unwrap_or_else(|| "no reason given".to_owned()),
                    });
                }
                SandboxState::Other => {}
            }

            if Instant::now() >= deadline {
                return Err(DaytonaError::SandboxStartTimeout {
                    sandbox_id: sandbox_id.to_owned(),
                    timeout,
                });
            }
            tokio::time::sleep(POLL_INTERVAL).await;
        }
    }

    /// Start a stopped or archived sandbox.
    #[tracing::instrument(err, skip(self))]
    pub async fn start(&self, sandbox_id: &str) -> Result<()> {
        let operation = "start sandbox";
        let response = self
            .http
            .post(format!("{}/sandbox/{sandbox_id}/start", self.base))
            .bearer_auth(self.api_key.expose())
            .send()
            .await
            .map_err(|source| DaytonaError::Request { operation, source })?;
        let status = response.status();
        if status.is_success() {
            return Ok(());
        }
        let body = response
            .text()
            .await
            .map_err(|source| DaytonaError::ReadResponse { operation, source })?;
        Err(DaytonaError::Api {
            operation,
            status,
            body,
        })
    }

    /// Execute one command in a sandbox.
    #[tracing::instrument(err, skip(self))]
    pub async fn exec(&self, sandbox_id: &str, command: &str, timeout: Duration) -> Result<String> {
        let toolbox: ToolboxProxyUrlDto = self
            .json(
                self.http.get(format!(
                    "{}/sandbox/{sandbox_id}/toolbox-proxy-url",
                    self.base
                )),
                "get toolbox proxy url",
            )
            .await?;
        let toolbox_url = toolbox.url.trim_end_matches('/');
        let request = ExecuteRequest {
            command,
            timeout: timeout.as_secs(),
        };
        let response: ExecuteResponseDto = self
            .json(
                self.http
                    .post(format!("{toolbox_url}/{sandbox_id}/process/execute"))
                    .json(&request),
                "execute command",
            )
            .await?;

        match response.exit_code {
            Some(0) | None => Ok(response.result),
            Some(code) => Err(DaytonaError::Command {
                code,
                sandbox_id: sandbox_id.to_owned(),
                command: command.to_owned(),
                output: response.result,
            }),
        }
    }

    /// Resolve the externally reachable URL for a sandbox port.
    #[tracing::instrument(err, skip(self))]
    pub async fn preview_url(&self, sandbox_id: &str, port: u16) -> Result<String> {
        let preview = self.preview(sandbox_id, port).await?;
        Ok(preview.url.trim_end_matches('/').to_owned())
    }

    /// Resolve a sandbox port's URL and preview token.
    #[tracing::instrument(err, skip(self))]
    pub async fn port_preview(&self, sandbox_id: &str, port: u16) -> Result<PortPreview> {
        let preview = self.preview(sandbox_id, port).await?;
        Ok(PortPreview {
            url: preview.url.trim_end_matches('/').to_owned(),
            token: preview.token,
        })
    }

    async fn preview(&self, sandbox_id: &str, port: u16) -> Result<PortPreviewUrlDto> {
        self.json(
            self.http.get(format!(
                "{}/sandbox/{sandbox_id}/ports/{port}/preview-url",
                self.base
            )),
            "get port preview url",
        )
        .await
    }

    /// Destroy a sandbox.
    #[tracing::instrument(err, skip(self))]
    pub async fn delete(&self, sandbox_id: &str) -> Result<()> {
        let _: serde::de::IgnoredAny = self
            .json(
                self.http
                    .delete(format!("{}/sandbox/{sandbox_id}", self.base)),
                "delete sandbox",
            )
            .await?;
        Ok(())
    }

    /// Poll the sidecar readiness endpoint until it succeeds.
    #[tracing::instrument(err, skip(self))]
    pub async fn wait_for_ping(
        &self,
        ping_url: &str,
        preview_token: Option<&str>,
        timeout: Duration,
    ) -> Result<()> {
        let deadline = Instant::now() + timeout;
        loop {
            let mut request = self.http.get(ping_url);
            if let Some(token) = preview_token {
                request = request.header("x-daytona-preview-token", token);
            }
            if let Ok(response) = request.send().await
                && response.status().is_success()
            {
                return Ok(());
            }

            if Instant::now() >= deadline {
                return Err(DaytonaError::PingTimeout {
                    ping_url: ping_url.to_owned(),
                    timeout,
                });
            }
            tokio::time::sleep(POLL_INTERVAL).await;
        }
    }

    async fn json<T: serde::de::DeserializeOwned>(
        &self,
        request: reqwest::RequestBuilder,
        operation: &'static str,
    ) -> Result<T> {
        let response = request
            .bearer_auth(self.api_key.expose())
            .send()
            .await
            .map_err(|source| DaytonaError::Request { operation, source })?;
        let status = response.status();
        let body = response
            .text()
            .await
            .map_err(|source| DaytonaError::ReadResponse { operation, source })?;

        if !status.is_success() {
            return Err(DaytonaError::Api {
                operation,
                status,
                body,
            });
        }

        serde_json::from_str(&body).map_err(|source| DaytonaError::Decode {
            operation,
            source,
            body,
        })
    }
}
