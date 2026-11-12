//! `/brain/inference/{stt,tts}`: agent teammates' call speech, proxied to
//! LiveKit Inference on Macro's project credentials.
//!
//! The runtime opens a WebSocket with its agent's own Macro API key as the
//! bearer token. The gateway authenticates the agent, admits it against
//! Macro credits, opens the upstream socket with a short-lived
//! `inference.perform` token, and relays events both ways. Client events are
//! checked against a fixed session contract ([`protocol`]) and every
//! forwarded second of audio or character of text is metered against the
//! agent when the socket closes.

use std::collections::BTreeMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use ai_billing::{AiAdmissionError, AiAdmissionService};
use ai_usage::{AiFeature, UsageAmount, UsageContext, UsageRecorder};
use axum::{
    Router,
    extract::{
        Request, State, WebSocketUpgrade,
        ws::{Message, WebSocket},
    },
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
    routing::get,
};
use axum_extra::headers::{Authorization, HeaderMapExt, authorization::Bearer};
use futures::{SinkExt, StreamExt};
use jsonwebtoken::{Algorithm, EncodingKey, Header};
use serde::Serialize;
use team_agents::domain::models::VoiceModel;
use team_agents::domain::voice::Voice;
use tokio_tungstenite::{
    MaybeTlsStream, WebSocketStream, connect_async_with_config,
    tungstenite::{
        Message as UpstreamMessage, client::IntoClientRequest, protocol::WebSocketConfig,
    },
};
use tracing::{Instrument, Span, field::Empty};

use crate::anthropic_gateway::brain::{BrainAuthenticator, BrainCaller, BrainRollout};
use protocol::{ClientEvent, MAX_MESSAGE_BYTES, Operation, STT_BYTES_PER_SECOND, Session};

mod protocol;
mod voices;

pub(crate) use voices::VoiceCatalog;

#[cfg(test)]
mod test;

/// LiveKit Inference.
pub(crate) const LIVEKIT_INFERENCE_URL: &str = "https://agent-gateway.livekit.cloud/v1";
/// Deepgram's public model catalog, for Aura-2 voice metadata.
pub(crate) const DEEPGRAM_MODELS_URL: &str = "https://api.deepgram.com/v1/models";

/// Longest call one socket may stay open.
const MAX_SESSION: Duration = Duration::from_secs(60 * 60);
/// How long a minted upstream token is valid; it only opens the socket.
const PROVIDER_TOKEN_SECONDS: i64 = 60;
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);
/// Pricing rows (`ai_pricing.model`) for metered usage.
const STT_PRICING_MODEL: &str = "livekit-inference-deepgram-nova-3";
const TTS_PRICING_MODEL: &str = "livekit-inference-deepgram-aura-2";
/// What the runtime sees instead of an upstream error's details.
const UPSTREAM_ERROR_EVENT: &str =
    r#"{"type":"error","code":502,"message":"Speech inference request failed"}"#;

type UpstreamSocket = WebSocketStream<MaybeTlsStream<tokio::net::TcpStream>>;

/// LiveKit project credentials; the secret never leaves the gateway.
struct ProviderCredentials {
    api_key: String,
    secret: EncodingKey,
}

/// The speech proxy and the voice catalog it serves admins from.
pub(crate) struct SpeechGateway {
    brains: Arc<dyn BrainAuthenticator>,
    /// `enable-agent-teammates` for the calling agent; off refuses with 403.
    rollout: BrainRollout,
    admission: Arc<dyn AiAdmissionService>,
    recorder: Arc<dyn UsageRecorder>,
    client: reqwest::Client,
    credentials: ProviderCredentials,
    upstream_url: String,
    catalog_url: String,
    catalog: tokio::sync::Mutex<Option<(Instant, Vec<Voice>)>>,
    samples: tokio::sync::Mutex<BTreeMap<VoiceModel, Vec<u8>>>,
}

impl SpeechGateway {
    /// Both credentials are required: a gateway without them fails at boot.
    pub(crate) fn new(
        brains: Arc<dyn BrainAuthenticator>,
        rollout: BrainRollout,
        admission: Arc<dyn AiAdmissionService>,
        recorder: Arc<dyn UsageRecorder>,
        api_key: &str,
        api_secret: &str,
        upstream_url: &str,
        catalog_url: &str,
    ) -> anyhow::Result<Self> {
        let (api_key, secret) = (api_key.trim(), api_secret.trim());
        if api_key.is_empty() || secret.is_empty() {
            anyhow::bail!("LIVEKIT_API_KEY and LIVEKIT_API_SECRET must both be set");
        }
        let credentials = ProviderCredentials {
            api_key: api_key.to_owned(),
            secret: EncodingKey::from_secret(secret.as_bytes()),
        };
        Ok(Self {
            brains,
            rollout,
            admission,
            recorder,
            client: reqwest::Client::builder()
                .connect_timeout(CONNECT_TIMEOUT)
                .timeout(REQUEST_TIMEOUT)
                .build()?,
            credentials,
            upstream_url: upstream_url.trim_end_matches('/').to_owned(),
            catalog_url: catalog_url.to_owned(),
            catalog: tokio::sync::Mutex::new(None),
            samples: tokio::sync::Mutex::new(BTreeMap::new()),
        })
    }

    /// The agent behind the bearer key, admitted to spend Macro credits.
    async fn authorize(&self, headers: &HeaderMap) -> Result<BrainCaller, StatusCode> {
        let bearer = headers
            .typed_get::<Authorization<Bearer>>()
            .ok_or(StatusCode::UNAUTHORIZED)?;
        let brain = self
            .brains
            .authenticate(bearer.token())
            .await
            .map_err(|error| {
                tracing::error!(error = ?error, "could not authenticate a brain");
                StatusCode::SERVICE_UNAVAILABLE
            })?
            .ok_or(StatusCode::UNAUTHORIZED)?;
        if !self.rollout.enabled(&brain.user_id).await {
            return Err(StatusCode::FORBIDDEN);
        }

        self.admission
            .admit(&brain.user_id, AiFeature::AgentSession)
            .await
            .map_err(|error| match error {
                AiAdmissionError::Denied(_) => StatusCode::FORBIDDEN,
                AiAdmissionError::Unavailable => StatusCode::SERVICE_UNAVAILABLE,
            })?;
        Ok(brain)
    }

    /// `Bearer <JWT>` that only performs inference, valid for a minute.
    fn provider_authorization(&self) -> Result<HeaderValue, StatusCode> {
        let credentials = &self.credentials;
        let now = chrono::Utc::now().timestamp();
        let claims = InferenceClaims {
            iss: &credentials.api_key,
            sub: "agent",
            nbf: now,
            exp: now + PROVIDER_TOKEN_SECONDS,
            inference: InferenceGrant { perform: true },
        };
        let token =
            jsonwebtoken::encode(&Header::new(Algorithm::HS256), &claims, &credentials.secret)
                .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;

        let mut value = HeaderValue::from_str(&format!("Bearer {token}"))
            .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;
        value.set_sensitive(true);
        Ok(value)
    }

    /// Open the upstream socket for `operation`.
    async fn connect(&self, operation: Operation) -> Result<UpstreamSocket, StatusCode> {
        let base = self
            .upstream_url
            .replacen("https:", "wss:", 1)
            .replacen("http:", "ws:", 1);
        let mut request = format!("{base}/{}?model={}", operation.path(), operation.model())
            .into_client_request()
            .map_err(|_| StatusCode::BAD_GATEWAY)?;
        request
            .headers_mut()
            .insert(header::AUTHORIZATION, self.provider_authorization()?);
        macro_tower_layers::inject_trace_headers(request.headers_mut());

        let config = WebSocketConfig::default()
            .max_message_size(Some(MAX_MESSAGE_BYTES))
            .max_frame_size(Some(MAX_MESSAGE_BYTES));
        let (socket, _) = tokio::time::timeout(
            CONNECT_TIMEOUT,
            connect_async_with_config(request, Some(config), false),
        )
        .await
        .map_err(|_| StatusCode::GATEWAY_TIMEOUT)?
        .map_err(|error| {
            tracing::warn!(error = ?error, "could not open the speech inference socket");
            StatusCode::BAD_GATEWAY
        })?;
        Ok(socket)
    }
}

#[derive(Serialize)]
struct InferenceGrant {
    perform: bool,
}

#[derive(Serialize)]
struct InferenceClaims<'a> {
    iss: &'a str,
    sub: &'a str,
    nbf: i64,
    exp: i64,
    inference: InferenceGrant,
}

/// The speech routes, merged into the egress gateway router.
pub(crate) fn router(gateway: Arc<SpeechGateway>) -> Router {
    Router::new()
        .route("/brain/inference/stt", get(stt))
        .route("/brain/inference/tts", get(tts))
        .with_state(gateway)
        .layer(
            macro_tower_layers::MacroRequestIdAndTracingLayer::new(Duration::from_millis(200))
                .into_inner(),
        )
}

async fn stt(
    State(gateway): State<Arc<SpeechGateway>>,
    upgrade: WebSocketUpgrade,
    request: Request,
) -> Response {
    open(gateway, upgrade, request, Operation::Stt).await
}

async fn tts(
    State(gateway): State<Arc<SpeechGateway>>,
    upgrade: WebSocketUpgrade,
    request: Request,
) -> Response {
    open(gateway, upgrade, request, Operation::Tts).await
}

async fn open(
    gateway: Arc<SpeechGateway>,
    upgrade: WebSocketUpgrade,
    request: Request,
    operation: Operation,
) -> Response {
    let span = tracing::info_span!(
        "speech_gateway.session",
        speech.operation = operation.path(),
        gen_ai.request.model = operation.model(),
        agent.user.id = Empty,
        agent.team.id = Empty,
        speech.outcome = Empty,
        speech.audio_seconds = Empty,
        speech.characters = Empty,
        http.response.status_code = Empty,
        otel.status_code = Empty,
    );
    let refused = |status: StatusCode, outcome: &'static str| {
        span.record("speech.outcome", outcome);
        span.record("http.response.status_code", i64::from(status.as_u16()));
        if status.is_server_error() {
            span.record("otel.status_code", "ERROR");
        }
        status.into_response()
    };

    let brain = match gateway
        .authorize(request.headers())
        .instrument(span.clone())
        .await
    {
        Ok(brain) => brain,
        Err(status) => return refused(status, "unauthorized"),
    };
    span.record(
        "agent.user.id",
        agent_credentials::telemetry_id(brain.user_id.as_ref()),
    );
    span.record("agent.team.id", tracing::field::display(brain.team_id));

    if let Err(status) = protocol::check_query(request.uri().query(), operation) {
        return refused(status, "invalid_request");
    }
    let upstream = match gateway.connect(operation).instrument(span.clone()).await {
        Ok(upstream) => upstream,
        Err(status) => return refused(status, "upstream_unreachable"),
    };

    let meter = Meter {
        recorder: gateway.recorder.clone(),
        context: UsageContext::new(AiFeature::AgentSession, brain.user_id),
        operation,
        audio_bytes: 0,
        characters: 0,
        span: span.clone(),
    };
    upgrade
        .max_message_size(MAX_MESSAGE_BYTES)
        .on_upgrade(move |client| {
            async move {
                let ended =
                    tokio::time::timeout(MAX_SESSION, relay(client, upstream, meter, gateway))
                        .await
                        .unwrap_or(Ended::TimedOut);
                Span::current().record("speech.outcome", ended.as_str());
            }
            .instrument(span)
        })
}

/// Why a relayed session ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Ended {
    /// Either side closed or dropped the socket.
    Closed,
    /// The runtime broke the session contract.
    Rejected,
    /// The upstream socket failed.
    UpstreamFailed,
    /// [`MAX_SESSION`] elapsed.
    TimedOut,
}

impl Ended {
    fn as_str(self) -> &'static str {
        match self {
            Self::Closed => "closed",
            Self::Rejected => "rejected",
            Self::UpstreamFailed => "upstream_failed",
            Self::TimedOut => "timed_out",
        }
    }
}

/// Relay until either side closes; `meter` records usage when dropped.
async fn relay<Upstream>(
    mut client: WebSocket,
    mut upstream: WebSocketStream<Upstream>,
    mut meter: Meter,
    gateway: Arc<SpeechGateway>,
) -> Ended
where
    Upstream: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin,
{
    let mut session = None;
    let ended = loop {
        tokio::select! {
            incoming = client.next() => {
                let text = match incoming {
                    Some(Ok(Message::Text(text))) => text,
                    Some(Ok(Message::Ping(bytes))) => {
                        if client.send(Message::Pong(bytes)).await.is_err() {
                            break Ended::Closed;
                        }
                        continue;
                    }
                    Some(Ok(Message::Pong(_))) => continue,
                    Some(Ok(Message::Binary(_))) => break Ended::Rejected,
                    Some(Ok(Message::Close(_)) | Err(_)) | None => break Ended::Closed,
                };
                let usage = match accept(text.as_str(), meter.operation, &mut session, &gateway).await {
                    Ok(usage) => usage,
                    Err(()) => break Ended::Rejected,
                };
                if upstream.send(UpstreamMessage::Text(text.to_string().into())).await.is_err() {
                    break Ended::UpstreamFailed;
                }
                meter.audio_bytes += usage.audio_bytes;
                meter.characters += usage.characters;
            }
            outgoing = upstream.next() => {
                let forwarded = match outgoing {
                    Some(Ok(UpstreamMessage::Text(text))) => {
                        let Ok(event) = serde_json::from_str::<serde_json::Value>(text.as_str()) else {
                            break Ended::UpstreamFailed;
                        };
                        // Upstream error details can name the project; keep them here.
                        if event["type"] == "error" {
                            tracing::warn!(error = %event["message"], "speech inference reported an error");
                            Message::Text(UPSTREAM_ERROR_EVENT.into())
                        } else {
                            Message::Text(text.to_string().into())
                        }
                    }
                    Some(Ok(UpstreamMessage::Ping(bytes))) => {
                        if upstream.send(UpstreamMessage::Pong(bytes)).await.is_err() {
                            break Ended::UpstreamFailed;
                        }
                        continue;
                    }
                    Some(Ok(UpstreamMessage::Pong(_))) => continue,
                    Some(Ok(UpstreamMessage::Close(_))) | None => break Ended::Closed,
                    Some(Ok(_)) | Some(Err(_)) => break Ended::UpstreamFailed,
                };
                if client.send(forwarded).await.is_err() {
                    break Ended::Closed;
                }
            }
        }
    };

    let _ = upstream.close(None).await;
    let _ = client.close().await;
    ended
}

/// Check one client event; a TTS session's voice must be in the catalog.
async fn accept(
    text: &str,
    operation: Operation,
    session: &mut Option<Session>,
    gateway: &Arc<SpeechGateway>,
) -> Result<protocol::Usage, ()> {
    let event = serde_json::from_str::<ClientEvent>(text).map_err(|_| ())?;
    let usage = protocol::check_event(&event, operation, session).map_err(|_| ())?;

    let ClientEvent::Create { .. } = event else {
        return Ok(usage);
    };
    let Some(Session {
        voice: Some(voice),
        language,
    }) = session.as_ref()
    else {
        return Ok(usage);
    };
    let model = VoiceModel::parse(format!("aura-2-{voice}-{language}")).map_err(|_| ())?;
    let catalog = VoiceCatalog(gateway.clone())
        .voices()
        .await
        .map_err(|error| tracing::warn!(error = ?error, "could not read the voice catalog"))?;
    if catalog.iter().any(|known| known.model == model) {
        Ok(usage)
    } else {
        Err(())
    }
}

/// Records a session's forwarded usage once, when the session ends.
struct Meter {
    recorder: Arc<dyn UsageRecorder>,
    context: UsageContext,
    operation: Operation,
    audio_bytes: u64,
    characters: u64,
    span: Span,
}

impl Drop for Meter {
    fn drop(&mut self) {
        let (model, amount) = match self.operation {
            Operation::Stt if self.audio_bytes > 0 => {
                let seconds = self.audio_bytes as f64 / STT_BYTES_PER_SECOND;
                self.span.record("speech.audio_seconds", seconds);
                (
                    STT_PRICING_MODEL,
                    UsageAmount::Audio {
                        duration: Duration::from_secs_f64(seconds),
                    },
                )
            }
            Operation::Tts if self.characters > 0 => {
                self.span.record("speech.characters", self.characters);
                (
                    TTS_PRICING_MODEL,
                    UsageAmount::ProviderCredits {
                        credits: self.characters,
                    },
                )
            }
            Operation::Stt | Operation::Tts => return,
        };
        self.recorder
            .record(self.context.clone().into_event(model.to_owned(), amount));
    }
}
