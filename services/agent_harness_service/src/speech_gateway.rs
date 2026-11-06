//! Agent-key proxy for LiveKit Inference; project credentials stay on the server.

use ai_billing::{AiAdmissionError, AiAdmissionService};
use ai_usage::{AiFeature, UsageAmount, UsageContext, UsageRecorder};
use axum::{
    Router,
    body::{Body, to_bytes},
    extract::{
        Request, State, WebSocketUpgrade,
        ws::{Message, WebSocket},
    },
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
    routing::get,
};
use axum_extra::headers::{Authorization, HeaderMapExt, authorization::Bearer};
use base64::{Engine, engine::general_purpose::STANDARD};
use futures::{SinkExt, StreamExt};
use jsonwebtoken::{Algorithm, EncodingKey, Header};
use macro_user_id::cowlike::CowLike;
use serde::{Deserialize, Serialize};
use std::{sync::Arc, time::Duration};
use team_agents::domain::{
    gateway::{BrainGatewayAccess, BrainGatewayError, BrainGatewayIdentity},
    models::AgentApiKey,
    voice::{AgentVoice, Voice, VoiceProvider},
};
use tokio_tungstenite::{
    connect_async_with_config,
    tungstenite::{
        Message as UpstreamMessage, client::IntoClientRequest, protocol::WebSocketConfig,
    },
};
use tracing::Instrument;

const MAX_BYTES: usize = 1024 * 1024;
const MAX_CALL: Duration = Duration::from_secs(3600);
const STT_MODEL: &str = "livekit-inference-deepgram-nova-3";
const TTS_MODEL: &str = "livekit-inference-deepgram-aura-2";
#[cfg(test)]
mod test;

pub(crate) struct SpeechGateway {
    access: Arc<dyn BrainGatewayAccess>,
    admission: Arc<dyn AiAdmissionService>,
    recorder: Arc<dyn UsageRecorder>,
    client: reqwest::Client,
    credentials: Option<(String, EncodingKey)>,
    upstream: String,
    catalog_url: String,
    catalog: tokio::sync::Mutex<Option<(std::time::Instant, Vec<Voice>)>>,
    samples: tokio::sync::Mutex<std::collections::BTreeMap<String, Vec<u8>>>,
}
impl SpeechGateway {
    pub(crate) fn new(
        access: Arc<dyn BrainGatewayAccess>,
        admission: Arc<dyn AiAdmissionService>,
        recorder: Arc<dyn UsageRecorder>,
        api_key: &str,
        api_secret: &str,
        upstream: &str,
        catalog_url: &str,
    ) -> anyhow::Result<Self> {
        if api_key.is_empty() != api_secret.is_empty() {
            anyhow::bail!("LiveKit API key and secret must be configured together");
        }
        let credentials = (!api_key.is_empty()).then(|| {
            (
                api_key.to_owned(),
                EncodingKey::from_secret(api_secret.as_bytes()),
            )
        });
        Ok(Self {
            access,
            admission,
            recorder,
            credentials,
            upstream: upstream.trim_end_matches('/').to_owned(),
            catalog_url: catalog_url.to_owned(),
            client: reqwest::Client::builder()
                .connect_timeout(Duration::from_secs(10))
                .timeout(Duration::from_secs(15))
                .build()?,
            catalog: tokio::sync::Mutex::new(None),
            samples: tokio::sync::Mutex::new(std::collections::BTreeMap::new()),
        })
    }
    async fn authorize(&self, headers: &HeaderMap) -> Result<BrainGatewayIdentity, StatusCode> {
        let credential = headers
            .typed_get::<Authorization<Bearer>>()
            .ok_or(StatusCode::UNAUTHORIZED)?;
        let key = AgentApiKey::parse(credential.token().to_owned())
            .map_err(|_| StatusCode::UNAUTHORIZED)?;
        let identity = self
            .access
            .authorize(&key)
            .await
            .map_err(|error| match error {
                BrainGatewayError::Unauthorized => StatusCode::UNAUTHORIZED,
                BrainGatewayError::Forbidden => StatusCode::FORBIDDEN,
                BrainGatewayError::Unavailable => StatusCode::SERVICE_UNAVAILABLE,
            })?;
        self.admission
            .admit(&identity.user_id, AiFeature::AgentSession)
            .await
            .map_err(|error| match error {
                AiAdmissionError::Denied(_) => StatusCode::FORBIDDEN,
                AiAdmissionError::Unavailable => StatusCode::SERVICE_UNAVAILABLE,
            })?;
        Ok(identity)
    }
    fn provider_authorization(&self) -> Result<HeaderValue, StatusCode> {
        let (key, secret) = self
            .credentials
            .as_ref()
            .ok_or(StatusCode::SERVICE_UNAVAILABLE)?;
        let now = chrono::Utc::now().timestamp();
        let claims = InferenceClaims {
            iss: key,
            sub: "agent",
            nbf: now,
            exp: now + 60,
            inference: InferenceGrant { perform: true },
        };
        let token = jsonwebtoken::encode(&Header::new(Algorithm::HS256), &claims, secret)
            .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;
        let mut header = HeaderValue::from_str(&format!("Bearer {token}"))
            .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;
        header.set_sensitive(true);
        Ok(header)
    }
    async fn connect(
        &self,
        operation: Operation,
    ) -> Result<
        tokio_tungstenite::WebSocketStream<
            tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
        >,
        StatusCode,
    > {
        let base = self
            .upstream
            .replacen("https:", "wss:", 1)
            .replacen("http:", "ws:", 1);
        let endpoint = format!("{base}/{}?model={}", operation.path(), operation.model());
        let mut request = endpoint
            .into_client_request()
            .map_err(|_| StatusCode::BAD_GATEWAY)?;
        request
            .headers_mut()
            .insert(header::AUTHORIZATION, self.provider_authorization()?);
        macro_tower_layers::inject_trace_headers(request.headers_mut());
        tokio::time::timeout(
            Duration::from_secs(10),
            connect_async_with_config(
                request,
                Some(
                    WebSocketConfig::default()
                        .max_message_size(Some(MAX_BYTES))
                        .max_frame_size(Some(MAX_BYTES)),
                ),
                false,
            ),
        )
        .await
        .map_err(|_| StatusCode::BAD_GATEWAY)?
        .map(|(stream, _)| stream)
        .map_err(|_| StatusCode::BAD_GATEWAY)
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
#[derive(Clone, Copy, PartialEq, Eq)]
enum Operation {
    Stt,
    Tts,
}
impl Operation {
    fn path(self) -> &'static str {
        match self {
            Self::Stt => "stt",
            Self::Tts => "tts",
        }
    }
    fn model(self) -> &'static str {
        match self {
            Self::Stt => "deepgram/nova-3",
            Self::Tts => "deepgram/aura-2",
        }
    }
}
pub(crate) fn router(state: Arc<SpeechGateway>) -> Router {
    Router::new()
        .route("/brain/inference/stt", get(stt))
        .route("/brain/inference/tts", get(tts))
        .with_state(state)
        .layer(
            macro_tower_layers::MacroRequestIdAndTracingLayer::new(Duration::from_millis(200))
                .into_inner(),
        )
}
fn query(raw: Option<&str>, operation: Operation) -> Result<(), StatusCode> {
    let pairs: Vec<_> = url::form_urlencoded::parse(raw.unwrap_or_default().as_bytes()).collect();
    if pairs.len() != 1 || pairs[0].0 != "model" || pairs[0].1 != operation.model() {
        return Err(StatusCode::BAD_REQUEST);
    }
    Ok(())
}
async fn stt(
    State(state): State<Arc<SpeechGateway>>,
    upgrade: WebSocketUpgrade,
    request: Request,
) -> Response {
    socket(state, upgrade, request, Operation::Stt).await
}
async fn tts(
    State(state): State<Arc<SpeechGateway>>,
    upgrade: WebSocketUpgrade,
    request: Request,
) -> Response {
    socket(state, upgrade, request, Operation::Tts).await
}
async fn socket(
    state: Arc<SpeechGateway>,
    upgrade: WebSocketUpgrade,
    request: Request,
    operation: Operation,
) -> Response {
    let identity = match state.authorize(request.headers()).await {
        Ok(value) => value,
        Err(status) => return status.into_response(),
    };
    if let Err(status) = query(request.uri().query(), operation) {
        return status.into_response();
    }
    let upstream = match state.connect(operation).await {
        Ok(value) => value,
        Err(status) => return status.into_response(),
    };
    let span = tracing::info_span!("speech_gateway.inference", team_id = %identity.team_id, computer_id = %identity.computer_id, operation = operation.path());
    let meter = Meter {
        recorder: state.recorder.clone(),
        context: UsageContext::new(AiFeature::AgentSession, identity.user_id)
            .with_entity(Some(identity.team_id)),
        operation,
        audio_bytes: 0,
        characters: 0,
    };
    upgrade
        .max_message_size(MAX_BYTES)
        .on_upgrade(move |client| {
            async move {
                let _ = tokio::time::timeout(MAX_CALL, relay(client, upstream, meter, state)).await;
            }
            .instrument(span)
        })
        .into_response()
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SttExtra {
    endpointing: u32,
    interim_results: bool,
    smart_format: bool,
    utterance_end: bool,
    keyterm: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SttSettings {
    sample_rate: String,
    encoding: String,
    extra: SttExtra,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct GenerationConfig {
    model: String,
    voice: String,
    language: String,
}
#[derive(Deserialize)]
#[serde(tag = "type", deny_unknown_fields)]
enum ClientEvent {
    #[serde(rename = "session.create")]
    Create {
        model: String,
        language: String,
        voice: Option<String>,
        encoding: Option<String>,
        sample_rate: Option<String>,
        settings: Option<SttSettings>,
        extra: Option<serde_json::Map<String, serde_json::Value>>,
    },
    #[serde(rename = "input_audio")]
    Audio { audio: String },
    #[serde(rename = "input_transcript")]
    Text {
        transcript: String,
        generation_config: GenerationConfig,
        extra: serde_json::Map<String, serde_json::Value>,
    },
    #[serde(rename = "session.flush")]
    Flush,
    #[serde(rename = "session.finalize")]
    Finalize,
    #[serde(rename = "session.close")]
    Close,
}
fn validate(
    event: &ClientEvent,
    operation: Operation,
    selection: &mut Option<(String, String)>,
) -> Result<(u64, u64), StatusCode> {
    match event {
        ClientEvent::Create {
            model,
            language,
            voice,
            encoding,
            sample_rate,
            settings,
            extra,
        } if selection.is_none() => {
            if model != operation.model()
                || language.len() != 2
                || !language.bytes().all(|c| c.is_ascii_lowercase())
            {
                return Err(StatusCode::BAD_REQUEST);
            }
            match operation {
                Operation::Stt => {
                    let settings = settings.as_ref().ok_or(StatusCode::BAD_REQUEST)?;
                    let extra = &settings.extra;
                    if language != "en"
                        || voice.is_some()
                        || encoding.is_some()
                        || sample_rate.is_some()
                        || extra.keyterm.is_empty()
                        || extra.keyterm.chars().count() > 100
                        || extra.keyterm.chars().any(char::is_control)
                        || extra.endpointing != 300
                        || !extra.interim_results
                        || !extra.smart_format
                        || !extra.utterance_end
                        || settings.encoding != "pcm_s16le"
                        || settings.sample_rate != "16000"
                    {
                        return Err(StatusCode::BAD_REQUEST);
                    }
                }
                Operation::Tts => {
                    let voice = voice.as_ref().ok_or(StatusCode::BAD_REQUEST)?;
                    if settings.is_some()
                        || encoding.as_deref() != Some("pcm_s16le")
                        || sample_rate.as_deref() != Some("24000")
                        || voice.is_empty()
                        || !voice.bytes().all(|c| c.is_ascii_lowercase())
                    {
                        return Err(StatusCode::BAD_REQUEST);
                    }
                }
            }
            if extra.as_ref().is_some_and(|extra| !extra.is_empty()) {
                return Err(StatusCode::BAD_REQUEST);
            }
            *selection = Some((voice.clone().unwrap_or_default(), language.clone()));
            Ok((0, 0))
        }
        ClientEvent::Audio { audio } if operation == Operation::Stt && selection.is_some() => {
            let pcm = STANDARD
                .decode(audio)
                .map_err(|_| StatusCode::BAD_REQUEST)?;
            if pcm.is_empty() || pcm.len() % 2 != 0 || pcm.len() > MAX_BYTES {
                return Err(StatusCode::BAD_REQUEST);
            }
            Ok((pcm.len() as u64, 0))
        }
        ClientEvent::Text {
            transcript,
            generation_config,
            extra,
        } if operation == Operation::Tts => {
            let (voice, language) = selection.as_ref().ok_or(StatusCode::BAD_REQUEST)?;
            if generation_config.model != operation.model()
                || &generation_config.voice != voice
                || &generation_config.language != language
                || !extra.is_empty()
                || transcript.chars().count() > 10000
            {
                return Err(StatusCode::BAD_REQUEST);
            }
            Ok((0, transcript.chars().count() as u64))
        }
        ClientEvent::Close if selection.is_some() => Ok((0, 0)),
        ClientEvent::Finalize if operation == Operation::Stt && selection.is_some() => Ok((0, 0)),
        ClientEvent::Flush if operation == Operation::Tts && selection.is_some() => Ok((0, 0)),
        _ => Err(StatusCode::BAD_REQUEST),
    }
}
async fn relay<S>(
    mut client: WebSocket,
    mut upstream: tokio_tungstenite::WebSocketStream<S>,
    mut meter: Meter,
    state: Arc<SpeechGateway>,
) where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin,
{
    let mut selection = None;
    loop {
        tokio::select! {
            incoming = client.next() => {
                let Some(Ok(message)) = incoming else { break; };
                let text = match message {
                    Message::Text(text) => text,
                    Message::Ping(bytes) => { if client.send(Message::Pong(bytes)).await.is_err() { break; } continue; },
                    Message::Pong(_) => continue,
                    _ => break,
                };
                let Ok(event) = serde_json::from_str::<ClientEvent>(&text) else { break; };
                let Ok((bytes, characters)) = validate(&event, meter.operation, &mut selection) else { break; };
                if matches!(event, ClientEvent::Create { .. }) && meter.operation == Operation::Tts {
                    let Some((voice, language)) = &selection else { break; };
                    let model = format!("aura-2-{voice}-{language}");
                    let Ok(voices) = VoiceCatalog(state.clone()).catalog().await else { break; };
                    if !voices.iter().any(|voice| voice.model == model) { break; }
                }
                if upstream.send(UpstreamMessage::Text(text.to_string().into())).await.is_err() { break; }
                meter.audio_bytes += bytes; meter.characters += characters;
            },
            outgoing = upstream.next() => {
                let Some(Ok(message)) = outgoing else { break; };
                let forwarded = match message {
                    UpstreamMessage::Text(text) => {
                        let Ok(event) = serde_json::from_str::<serde_json::Value>(&text) else { break; };
                        if event["type"] == "error" { Message::Text("{\"type\":\"error\",\"code\":502,\"message\":\"Speech inference request failed\"}".into()) }
                        else { Message::Text(text.to_string().into()) }
                    },
                    UpstreamMessage::Ping(bytes) => { if upstream.send(UpstreamMessage::Pong(bytes)).await.is_err() { break; } continue; },
                    UpstreamMessage::Pong(_) => continue,
                    _ => break,
                };
                if client.send(forwarded).await.is_err() { break; }
            }
        }
    }
    let _ = upstream.close(None).await;
    let _ = client.close().await;
}
struct Meter {
    recorder: Arc<dyn UsageRecorder>,
    context: UsageContext,
    operation: Operation,
    audio_bytes: u64,
    characters: u64,
}
impl Drop for Meter {
    fn drop(&mut self) {
        let (model, amount) = match self.operation {
            Operation::Stt if self.audio_bytes > 0 => (
                STT_MODEL,
                UsageAmount::Audio {
                    duration: Duration::from_secs_f64(self.audio_bytes as f64 / 32000.0),
                },
            ),
            Operation::Tts if self.characters > 0 => (
                TTS_MODEL,
                UsageAmount::ProviderCredits {
                    credits: self.characters,
                },
            ),
            _ => return,
        };
        self.recorder
            .record(self.context.clone().into_event(model.to_owned(), amount));
    }
}
#[derive(Deserialize)]
struct ProviderModels {
    tts: Vec<ProviderVoice>,
}
#[derive(Deserialize)]
struct ProviderVoice {
    name: String,
    canonical_name: String,
    languages: Vec<String>,
    metadata: VoiceMetadata,
}
#[derive(Deserialize)]
struct VoiceMetadata {
    accent: String,
    tags: Vec<String>,
}
#[derive(Deserialize)]
#[serde(tag = "type")]
enum SampleEvent {
    #[serde(rename = "output_audio")]
    Audio { audio: String },
    #[serde(rename = "done")]
    Done,
    #[serde(rename = "error")]
    Error,
    #[serde(other)]
    Other,
}
pub(crate) struct VoiceCatalog(pub Arc<SpeechGateway>);

impl VoiceProvider for VoiceCatalog {
    #[tracing::instrument(skip_all, err)]
    async fn catalog(&self) -> Result<Vec<Voice>, team_agents::domain::models::TeamAgentError> {
        use team_agents::domain::models::TeamAgentError;
        let mut cached = self.0.catalog.lock().await;
        if let Some((time, voices)) = cached.as_ref()
            && time.elapsed() < Duration::from_secs(86400)
        {
            return Ok(voices.clone());
        }
        let mut headers = HeaderMap::new();
        macro_tower_layers::inject_trace_headers(&mut headers);
        let response = self
            .0
            .client
            .get(&self.0.catalog_url)
            .headers(headers)
            .send()
            .await
            .and_then(reqwest::Response::error_for_status)
            .map_err(TeamAgentError::internal)?;
        let bytes = to_bytes(Body::from_stream(response.bytes_stream()), MAX_BYTES)
            .await
            .map_err(TeamAgentError::internal)?;
        let models: ProviderModels =
            serde_json::from_slice(&bytes).map_err(TeamAgentError::internal)?;
        let mut voices: Vec<_> = models
            .tts
            .into_iter()
            .filter(|voice| {
                AgentVoice {
                    model: voice.canonical_name.clone(),
                }
                .validate()
                .is_ok()
            })
            .map(|voice| Voice {
                model: voice.canonical_name,
                name: voice.name,
                accent: voice.metadata.accent,
                tags: voice.metadata.tags,
                languages: voice.languages,
            })
            .collect();
        voices.sort_by(|a, b| a.name.cmp(&b.name));
        *cached = Some((std::time::Instant::now(), voices.clone()));
        Ok(voices)
    }
    #[tracing::instrument(skip_all, err)]
    async fn sample(
        &self,
        actor: &macro_user_id::user_id::MacroUserIdStr<'_>,
        team: uuid::Uuid,
        model: &str,
    ) -> Result<Vec<u8>, team_agents::domain::models::TeamAgentError> {
        use team_agents::domain::models::TeamAgentError;
        let mut cached = self.0.samples.lock().await;
        if let Some(audio) = cached.get(model) {
            return Ok(audio.clone());
        }
        AgentVoice {
            model: model.to_owned(),
        }
        .validate()?;
        let (voice, language) = model
            .strip_prefix("aura-2-")
            .and_then(|name| name.rsplit_once('-'))
            .ok_or_else(|| TeamAgentError::BadRequest("invalid voice".to_owned()))?;
        self.0
            .admission
            .admit(actor, AiFeature::AgentSession)
            .await
            .map_err(TeamAgentError::internal)?;
        const LINE: &str =
            "Hi, I'm your teammate. You can call me when you want to talk something through.";
        let mut stream = self
            .0
            .connect(Operation::Tts)
            .await
            .map_err(|_| TeamAgentError::internal_message("voice inference unavailable"))?;
        let mut meter = Meter {
            recorder: self.0.recorder.clone(),
            context: UsageContext::new(AiFeature::AgentSession, actor.clone().into_owned())
                .with_entity(Some(team)),
            operation: Operation::Tts,
            audio_bytes: 0,
            characters: 0,
        };
        let receive = async {
            for event in [
                serde_json::json!({"type":"session.create", "model":"deepgram/aura-2", "voice":voice, "language":language, "sample_rate":"24000", "encoding":"pcm_s16le", "extra":{}}),
                serde_json::json!({"type":"input_transcript", "transcript":LINE, "generation_config":{"model":"deepgram/aura-2","voice":voice,"language":language}, "extra":{}}),
                serde_json::json!({"type":"session.flush"}),
            ] {
                stream
                    .send(UpstreamMessage::Text(event.to_string().into()))
                    .await
                    .map_err(TeamAgentError::internal)?;
                if event["type"] == "input_transcript" {
                    meter.characters += LINE.chars().count() as u64;
                }
            }
            let mut pcm = Vec::new();
            while let Some(message) = stream.next().await {
                let message = message.map_err(TeamAgentError::internal)?;
                let UpstreamMessage::Text(text) = message else {
                    continue;
                };
                match serde_json::from_str::<SampleEvent>(&text)
                    .map_err(TeamAgentError::internal)?
                {
                    SampleEvent::Audio { audio } => {
                        let bytes = STANDARD.decode(audio).map_err(TeamAgentError::internal)?;
                        if pcm.len() + bytes.len() > MAX_BYTES {
                            return Err(TeamAgentError::internal_message("voice sample too large"));
                        }
                        pcm.extend(bytes);
                    }
                    SampleEvent::Done => return Ok(pcm),
                    SampleEvent::Error => {
                        return Err(TeamAgentError::internal_message("voice inference failed"));
                    }
                    SampleEvent::Other => {}
                }
            }
            Err(TeamAgentError::internal_message("voice sample ended early"))
        };
        let pcm = tokio::time::timeout(Duration::from_secs(15), receive)
            .await
            .map_err(|_| TeamAgentError::internal_message("voice sample timed out"))??;
        let _ = stream.close(None).await;
        if pcm.is_empty() || pcm.len() % 2 != 0 {
            return Err(TeamAgentError::internal_message(
                "invalid voice sample audio",
            ));
        }
        let audio = sample_wav(&pcm);
        if cached.len() >= 128 {
            cached.pop_first();
        }
        cached.insert(model.to_owned(), audio.clone());
        Ok(audio)
    }
}
fn sample_wav(pcm: &[u8]) -> Vec<u8> {
    let mut wav = b"RIFF".to_vec();
    wav.extend((pcm.len() as u32 + 36).to_le_bytes());
    wav.extend(b"WAVEfmt \x10\0\0\0\x01\0\x01\0\xc0\x5d\0\0\x80\xbb\0\0\x02\0\x10\0data");
    wav.extend((pcm.len() as u32).to_le_bytes());
    wav.extend(pcm);
    wav
}
