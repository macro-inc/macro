//! The one client of the host agent (feature `client`): mTLS through
//! `pinned_tls` (our certificate, only the agent's pinned one accepted), one
//! `firecracker_host.request` span per call, the caller's trace context on
//! every request, and the exec WebSocket.

use std::sync::Arc;
use std::time::Duration;

use futures::{SinkExt, StreamExt};
use reqwest::Method;
use rustls::ClientConfig;
use serde::Serialize;
use serde::de::DeserializeOwned;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tracing::Instrument;
use zeroize::Zeroizing;

use crate::exec::{ExecRequest, Frame, FrameError};

mod moves;
use crate::{
    Action, Computer, ComputerId, CreateComputer, ErrorCode, ErrorResponse, GoldenImage, GoldenKey,
    HostInfo, HostLimits, SetEnrollment,
};

/// Where the agent is and how to authenticate to it.
#[derive(Clone)]
pub struct HostEndpoint {
    /// Base URL, e.g. `https://10.150.0.17:8444`.
    pub url: String,
    /// PEM certificate the agent pins.
    pub client_certificate_pem: String,
    /// Its PEM private key.
    pub client_key_pem: Zeroizing<String>,
    /// The agent's own PEM certificate; the only one accepted.
    pub server_certificate_pem: String,
    /// Deadline of a TCP and TLS connect.
    pub connect_timeout: Duration,
    /// Deadline of each REST request (a create waits for a restore).
    pub request_timeout: Duration,
}

impl std::fmt::Debug for HostEndpoint {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("HostEndpoint")
            .field("url", &self.url)
            .finish_non_exhaustive()
    }
}

/// A request that failed.
#[derive(Debug, thiserror::Error)]
pub enum ClientError {
    /// The agent answered an error.
    #[error("host agent answered {status}: {response}")]
    Api {
        /// HTTP status.
        status: reqwest::StatusCode,
        /// The error body.
        response: ErrorResponse,
    },
    /// The certificates or key could not be used.
    #[error("host agent TLS credentials: {0}")]
    Credentials(#[from] pinned_tls::InvalidCredentials),
    /// Transport, or an answer that is not the contract.
    #[error("host agent request: {0}")]
    Transport(#[from] reqwest::Error),
    /// The exec WebSocket failed.
    #[error("host agent exec: {0}")]
    WebSocket(#[from] tokio_tungstenite::tungstenite::Error),
    /// An exec frame did not decode.
    #[error(transparent)]
    Frame(#[from] FrameError),
}

impl ClientError {
    /// The agent's error code, when it answered one.
    pub fn code(&self) -> Option<ErrorCode> {
        match self {
            Self::Api { response, .. } => Some(response.code),
            _ => None,
        }
    }

    /// For the span's `error.type`: the agent's code, or the failure kind.
    fn kind(&self) -> &'static str {
        match self {
            Self::Api { response, .. } => response.code.into(),
            Self::Credentials(_) => "credentials",
            Self::Transport(_) => "transport",
            Self::WebSocket(_) => "websocket",
            Self::Frame(_) => "frame",
        }
    }
}

/// The host agent's API.
#[derive(Debug, Clone)]
pub struct HostClient {
    http: reqwest::Client,
    /// `None` only over plain HTTP in tests.
    tls: Option<Arc<ClientConfig>>,
    url: String,
}

impl HostClient {
    /// A client for `endpoint`.
    pub fn new(endpoint: &HostEndpoint) -> Result<Self, ClientError> {
        let tls = Arc::new(pinned_tls::client_config(
            &endpoint.client_certificate_pem,
            &endpoint.client_key_pem,
            &endpoint.server_certificate_pem,
        )?);
        let http = reqwest::Client::builder()
            .use_preconfigured_tls((*tls).clone())
            .connect_timeout(endpoint.connect_timeout)
            .timeout(endpoint.request_timeout)
            .build()?;
        Ok(Self {
            http,
            tls: Some(tls),
            url: endpoint.url.trim_end_matches('/').to_owned(),
        })
    }

    /// A client over plain HTTP, for tests against a local listener or a
    /// mock server.
    #[cfg(feature = "test-support")]
    pub fn over_plain_http(url: &str) -> Result<Self, ClientError> {
        Ok(Self {
            http: reqwest::Client::builder().build()?,
            tls: None,
            url: url.trim_end_matches('/').to_owned(),
        })
    }

    /// One call: `template` is the route as the agent declares it (the
    /// span's `url.template`), `path` the concrete one.
    async fn call<Body: Serialize + Sync + ?Sized>(
        &self,
        method: Method,
        template: &'static str,
        path: &str,
        body: Option<&Body>,
    ) -> Result<reqwest::Response, ClientError> {
        let span = tracing::info_span!(
            "firecracker_host.request",
            otel.kind = "client",
            operation.name = %format!("{method} {template}"),
            http.request.method = %method,
            url.template = template,
            http.response.status_code = tracing::field::Empty,
            error.type = tracing::field::Empty,
            otel.status_code = tracing::field::Empty,
        );
        async {
            let mut headers = reqwest::header::HeaderMap::new();
            macro_tower_layers::inject_trace_headers(&mut headers);
            let mut request = self
                .http
                .request(method, format!("{}{path}", self.url))
                .headers(headers);
            if let Some(body) = body {
                request = request.json(body);
            }
            let result = async {
                let response = request.send().await?;
                let status = response.status();
                tracing::Span::current()
                    .record("http.response.status_code", i64::from(status.as_u16()));
                if status.is_success() {
                    return Ok(response);
                }
                let response = response.json::<ErrorResponse>().await?;
                Err(ClientError::Api { status, response })
            }
            .await;
            if let Err(error) = &result {
                let span = tracing::Span::current();
                span.record("error.type", error.kind());
                span.record("otel.status_code", "ERROR");
            }
            result
        }
        .instrument(span)
        .await
    }

    async fn json<Answer: DeserializeOwned, Body: Serialize + Sync + ?Sized>(
        &self,
        method: Method,
        template: &'static str,
        path: &str,
        body: Option<&Body>,
    ) -> Result<Answer, ClientError> {
        Ok(self
            .call(method, template, path, body)
            .await?
            .json()
            .await?)
    }

    /// The host: capacity, memory, goldens.
    pub async fn host(&self) -> Result<HostInfo, ClientError> {
        self.json(Method::GET, "/v1/host", "/v1/host", NO_BODY)
            .await
    }

    /// Set the host's memory limits.
    pub async fn set_host_limits(&self, limits: &HostLimits) -> Result<(), ClientError> {
        self.call(
            Method::PUT,
            "/v1/host/limits",
            "/v1/host/limits",
            Some(limits),
        )
        .await
        .map(drop)
    }

    /// Every golden.
    pub async fn goldens(&self) -> Result<Vec<GoldenImage>, ClientError> {
        self.json(Method::GET, "/v1/goldens", "/v1/goldens", NO_BODY)
            .await
    }

    /// Build a golden unless it exists.
    pub async fn build_golden(&self, key: &GoldenKey) -> Result<GoldenImage, ClientError> {
        self.json(Method::POST, "/v1/goldens", "/v1/goldens", Some(key))
            .await
    }

    /// Every computer.
    pub async fn computers(&self) -> Result<Vec<Computer>, ClientError> {
        self.json(Method::GET, "/v1/computers", "/v1/computers", NO_BODY)
            .await
    }

    /// One computer.
    pub async fn computer(&self, computer_id: ComputerId) -> Result<Computer, ClientError> {
        let path = format!("/v1/computers/{computer_id}");
        self.json(Method::GET, COMPUTER, &path, NO_BODY).await
    }

    /// Create a computer unless it exists.
    pub async fn create(
        &self,
        computer_id: ComputerId,
        request: &CreateComputer,
    ) -> Result<Computer, ClientError> {
        let path = format!("/v1/computers/{computer_id}");
        self.json(Method::PUT, COMPUTER, &path, Some(request)).await
    }

    /// Destroy a computer and its disks; absent is fine.
    pub async fn destroy(&self, computer_id: ComputerId) -> Result<(), ClientError> {
        let path = format!("/v1/computers/{computer_id}");
        self.call(Method::DELETE, COMPUTER, &path, NO_BODY)
            .await
            .map(drop)
    }

    /// Replace the enrollment.
    pub async fn set_enrollment(
        &self,
        computer_id: ComputerId,
        request: &SetEnrollment,
    ) -> Result<Computer, ClientError> {
        let path = format!("/v1/computers/{computer_id}/enrollment");
        self.json(Method::PUT, ENROLLMENT, &path, Some(request))
            .await
    }

    /// Remove the enrollment.
    pub async fn clear_enrollment(&self, computer_id: ComputerId) -> Result<(), ClientError> {
        let path = format!("/v1/computers/{computer_id}/enrollment");
        self.call(Method::DELETE, ENROLLMENT, &path, NO_BODY)
            .await
            .map(drop)
    }

    /// Run a power action.
    pub async fn power(
        &self,
        computer_id: ComputerId,
        action: Action,
    ) -> Result<Computer, ClientError> {
        let path = format!("/v1/computers/{computer_id}/{action}");
        self.json(Method::POST, ACTION, &path, NO_BODY).await
    }

    /// Start `request` in the guest over the exec WebSocket.
    pub async fn exec(
        &self,
        computer_id: ComputerId,
        request: ExecRequest,
    ) -> Result<ExecSession, ClientError> {
        let url = format!("{}/v1/computers/{computer_id}/exec", self.url)
            .replacen("https://", "wss://", 1)
            .replacen("http://", "ws://", 1);
        let mut upgrade = url.into_client_request()?;
        macro_tower_layers::inject_trace_headers(upgrade.headers_mut());
        let connector = match &self.tls {
            Some(tls) => tokio_tungstenite::Connector::Rustls(tls.clone()),
            None => tokio_tungstenite::Connector::Plain,
        };
        let (mut socket, _) =
            tokio_tungstenite::connect_async_tls_with_config(upgrade, None, false, Some(connector))
                .instrument(tracing::info_span!(
                    "firecracker_host.request",
                    otel.kind = "client",
                    operation.name = "GET /v1/computers/{computer_id}/exec",
                    http.request.method = "GET",
                    url.template = "/v1/computers/{computer_id}/exec",
                ))
                .await
                .map_err(upgrade_refused)?;
        socket
            .send(Message::Binary(Frame::Start(request).encode()?.into()))
            .await?;
        Ok(ExecSession { socket })
    }
}

/// An HTTP answer instead of the WebSocket upgrade is the agent's error
/// (its JSON body when present), so [`ClientError::code`] covers exec too.
fn upgrade_refused(error: tokio_tungstenite::tungstenite::Error) -> ClientError {
    let tokio_tungstenite::tungstenite::Error::Http(answer) = error else {
        return ClientError::WebSocket(error);
    };
    let status = reqwest::StatusCode::from_u16(answer.status().as_u16())
        .unwrap_or(reqwest::StatusCode::INTERNAL_SERVER_ERROR);
    let decoded = answer
        .body()
        .as_deref()
        .and_then(|body| serde_json::from_slice::<ErrorResponse>(body).ok());
    let response = decoded.unwrap_or_else(|| ErrorResponse {
        code: if status == reqwest::StatusCode::NOT_FOUND {
            ErrorCode::NotFound
        } else {
            ErrorCode::Internal
        },
        message: format!("the exec upgrade was answered {status}"),
    });
    ClientError::Api { status, response }
}

/// No request body.
const NO_BODY: Option<&()> = None;

/// Route templates the agent declares, for `url.template`.
const COMPUTER: &str = "/v1/computers/{computer_id}";
const ENROLLMENT: &str = "/v1/computers/{computer_id}/enrollment";
const ACTION: &str = "/v1/computers/{computer_id}/{action}";

type Socket =
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

/// A program running in a guest. Dropping the session kills it.
pub struct ExecSession {
    socket: Socket,
}

impl std::fmt::Debug for ExecSession {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ExecSession")
            .finish_non_exhaustive()
    }
}

impl ExecSession {
    /// Send bytes to the program's stdin.
    pub async fn write_stdin(&mut self, bytes: Vec<u8>) -> Result<(), ClientError> {
        self.send(Frame::Stdin(bytes)).await
    }

    /// End the program's stdin.
    pub async fn close_stdin(&mut self) -> Result<(), ClientError> {
        self.send(Frame::CloseStdin).await
    }

    async fn send(&mut self, frame: Frame) -> Result<(), ClientError> {
        self.socket
            .send(Message::Binary(frame.encode()?.into()))
            .await?;
        Ok(())
    }

    /// The next frame from the program (`Stdout`, `Stderr`, then one
    /// `Exited` or `Failed`); `None` once the agent closed the session.
    pub async fn next(&mut self) -> Result<Option<Frame>, ClientError> {
        while let Some(message) = self.socket.next().await {
            match message? {
                Message::Binary(bytes) => return Ok(Some(Frame::decode(&bytes)?)),
                Message::Close(_) => return Ok(None),
                _ => {}
            }
        }
        Ok(None)
    }

    /// Split into a stdin half and an output half, for callers that write
    /// and read at the same time.
    pub fn split(self) -> (ExecInput, ExecOutput) {
        let (sink, stream) = self.socket.split();
        (ExecInput { sink }, ExecOutput { stream })
    }
}

/// The stdin half of an [`ExecSession`].
pub struct ExecInput {
    sink: futures::stream::SplitSink<Socket, Message>,
}

impl ExecInput {
    /// Send bytes to the program's stdin.
    pub async fn write_stdin(&mut self, bytes: Vec<u8>) -> Result<(), ClientError> {
        self.sink
            .send(Message::Binary(Frame::Stdin(bytes).encode()?.into()))
            .await?;
        Ok(())
    }

    /// End the program's stdin.
    pub async fn close_stdin(&mut self) -> Result<(), ClientError> {
        self.sink
            .send(Message::Binary(Frame::CloseStdin.encode()?.into()))
            .await?;
        Ok(())
    }
}

/// The output half of an [`ExecSession`].
pub struct ExecOutput {
    stream: futures::stream::SplitStream<Socket>,
}

impl ExecOutput {
    /// See [`ExecSession::next`].
    pub async fn next(&mut self) -> Result<Option<Frame>, ClientError> {
        while let Some(message) = self.stream.next().await {
            match message? {
                Message::Binary(bytes) => return Ok(Some(Frame::decode(&bytes)?)),
                Message::Close(_) => return Ok(None),
                _ => {}
            }
        }
        Ok(None)
    }
}
