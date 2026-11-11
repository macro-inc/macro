//! The Aura-2 voice catalog and the fixed-line samples admins preview.

use std::sync::Arc;
use std::time::{Duration, Instant};

use ai_usage::{AiFeature, UsageContext};
use base64::{Engine, engine::general_purpose::STANDARD};
use futures::{SinkExt, StreamExt};
use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use serde::Deserialize;
use team_agents::domain::models::TeamAgentError;
use team_agents::domain::voice::{Voice, VoiceModel, VoiceProvider};
use tokio_tungstenite::tungstenite::Message as UpstreamMessage;
use tracing::Span;
use uuid::Uuid;

use super::protocol::{MAX_MESSAGE_BYTES, Operation, TTS_SAMPLE_RATE};
use super::{Meter, SpeechGateway};

/// How long the provider catalog is reused.
const CATALOG_TTL: Duration = Duration::from_secs(24 * 60 * 60);
/// How many voices' samples are kept.
const MAX_CACHED_SAMPLES: usize = 128;
/// Longest one synthesis of the sample may take.
const SAMPLE_TIMEOUT: Duration = Duration::from_secs(15);
/// Every sample says this.
const SAMPLE_LINE: &str =
    "Hi, I'm your teammate. You can call me when you want to talk something through.";

/// `GET /v1/models`, reduced to the TTS voices.
#[derive(Deserialize)]
struct ProviderModels {
    tts: Vec<ProviderVoice>,
}

#[derive(Deserialize)]
struct ProviderVoice {
    name: String,
    canonical_name: String,
    languages: Vec<String>,
    metadata: ProviderVoiceMetadata,
}

#[derive(Deserialize)]
struct ProviderVoiceMetadata {
    accent: String,
    tags: Vec<String>,
}

/// The TTS events a sample reads.
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

fn unavailable(error: impl std::error::Error + Send + Sync + 'static) -> TeamAgentError {
    TeamAgentError::VoiceUnavailable(rootcause::Report::new(error).into_dynamic())
}

fn unavailable_because(reason: &'static str) -> TeamAgentError {
    TeamAgentError::VoiceUnavailable(rootcause::report!("{reason}"))
}

/// [`VoiceProvider`] over the gateway's provider connection and caches.
pub(crate) struct VoiceCatalog(pub(crate) Arc<SpeechGateway>);

impl VoiceCatalog {
    /// The cached catalog, fetched again once a day.
    pub(super) async fn voices(&self) -> Result<Vec<Voice>, TeamAgentError> {
        let mut cached = self.0.catalog.lock().await;
        if let Some((fetched, voices)) = cached.as_ref()
            && fetched.elapsed() < CATALOG_TTL
        {
            return Ok(voices.clone());
        }

        let mut headers = reqwest::header::HeaderMap::new();
        macro_tower_layers::inject_trace_headers(&mut headers);
        let response = self
            .0
            .client
            .get(&self.0.catalog_url)
            .headers(headers)
            .send()
            .await
            .and_then(reqwest::Response::error_for_status)
            .map_err(unavailable)?;
        if response
            .content_length()
            .is_some_and(|length| length > MAX_MESSAGE_BYTES as u64)
        {
            return Err(unavailable_because("the voice catalog is too large"));
        }
        let body = response.bytes().await.map_err(unavailable)?;
        if body.len() > MAX_MESSAGE_BYTES {
            return Err(unavailable_because("the voice catalog is too large"));
        }
        let models: ProviderModels = serde_json::from_slice(&body).map_err(unavailable)?;

        // Older Aura voices and anything else unpriced are left out.
        let mut voices: Vec<Voice> = models
            .tts
            .into_iter()
            .filter_map(|voice| {
                Some(Voice {
                    model: VoiceModel::parse(voice.canonical_name).ok()?,
                    name: voice.name,
                    accent: voice.metadata.accent,
                    tags: voice.metadata.tags,
                    languages: voice.languages,
                })
            })
            .collect();
        voices.sort_by(|a, b| a.name.cmp(&b.name));
        Span::current().record("voices", voices.len());
        *cached = Some((Instant::now(), voices.clone()));
        Ok(voices)
    }

    /// Synthesize the sample line as PCM16 at 24 kHz.
    async fn synthesize(
        &self,
        meter: &mut Meter,
        model: &VoiceModel,
    ) -> Result<Vec<u8>, TeamAgentError> {
        let mut socket = self
            .0
            .connect(Operation::Tts)
            .await
            .map_err(|_| unavailable_because("speech inference is unreachable"))?;
        let events = [
            serde_json::json!({
                "type": "session.create",
                "model": Operation::Tts.model(),
                "voice": model.voice(),
                "language": model.language(),
                "sample_rate": TTS_SAMPLE_RATE,
                "encoding": "pcm_s16le",
                "extra": {},
            }),
            serde_json::json!({
                "type": "input_transcript",
                "transcript": SAMPLE_LINE,
                "generation_config": {
                    "model": Operation::Tts.model(),
                    "voice": model.voice(),
                    "language": model.language(),
                },
                "extra": {},
            }),
            serde_json::json!({ "type": "session.flush" }),
        ];
        for event in events {
            socket
                .send(UpstreamMessage::Text(event.to_string().into()))
                .await
                .map_err(unavailable)?;
        }
        meter.characters = SAMPLE_LINE.chars().count() as u64;

        let mut pcm = Vec::new();
        let result = loop {
            let Some(message) = socket.next().await else {
                break Err(unavailable_because("the voice sample ended early"));
            };
            let UpstreamMessage::Text(text) = message.map_err(unavailable)? else {
                continue;
            };
            match serde_json::from_str::<SampleEvent>(text.as_str()).map_err(unavailable)? {
                SampleEvent::Audio { audio } => {
                    let bytes = STANDARD.decode(audio).map_err(unavailable)?;
                    if pcm.len() + bytes.len() > MAX_MESSAGE_BYTES {
                        break Err(unavailable_because("the voice sample is too large"));
                    }
                    pcm.extend(bytes);
                }
                SampleEvent::Done => break Ok(pcm),
                SampleEvent::Error => break Err(unavailable_because("voice synthesis failed")),
                SampleEvent::Other => {}
            }
        };
        let _ = socket.close(None).await;
        result
    }
}

impl VoiceProvider for VoiceCatalog {
    #[tracing::instrument(name = "speech_gateway.voice_catalog", skip_all, fields(voices = tracing::field::Empty), err)]
    async fn catalog(&self) -> Result<Vec<Voice>, TeamAgentError> {
        self.voices().await
    }

    /// Cached per voice, so each voice is synthesized and billed once per
    /// process.
    #[tracing::instrument(name = "speech_gateway.voice_sample", skip_all, fields(voice = %model, cached = tracing::field::Empty), err)]
    async fn sample(
        &self,
        actor: &MacroUserIdStr<'_>,
        team: Uuid,
        model: &VoiceModel,
    ) -> Result<Vec<u8>, TeamAgentError> {
        let mut cached = self.0.samples.lock().await;
        Span::current().record("cached", cached.contains_key(model));
        if let Some(audio) = cached.get(model) {
            return Ok(audio.clone());
        }

        self.0
            .admission
            .admit(actor, AiFeature::AgentSession)
            .await
            .map_err(unavailable)?;
        let mut meter = Meter {
            recorder: self.0.recorder.clone(),
            context: UsageContext::new(AiFeature::AgentSession, actor.clone().into_owned())
                .with_entity(Some(team)),
            operation: Operation::Tts,
            audio_bytes: 0,
            characters: 0,
            span: Span::current(),
        };
        let pcm = tokio::time::timeout(SAMPLE_TIMEOUT, self.synthesize(&mut meter, model))
            .await
            .map_err(|_| unavailable_because("the voice sample timed out"))??;
        if pcm.is_empty() || pcm.len() % 2 != 0 {
            return Err(unavailable_because("the voice sample is not PCM16"));
        }

        let audio = wav(&pcm);
        if cached.len() >= MAX_CACHED_SAMPLES {
            cached.pop_first();
        }
        cached.insert(model.clone(), audio.clone());
        Ok(audio)
    }
}

/// A mono PCM16 24 kHz WAV file around `pcm`.
pub(super) fn wav(pcm: &[u8]) -> Vec<u8> {
    const SAMPLE_RATE: u32 = 24_000;
    const BYTES_PER_SAMPLE: u16 = 2;
    let data_len = pcm.len() as u32;

    let mut wav = Vec::with_capacity(44 + pcm.len());
    wav.extend(b"RIFF");
    wav.extend((36 + data_len).to_le_bytes());
    wav.extend(b"WAVEfmt ");
    wav.extend(16_u32.to_le_bytes()); // fmt chunk size
    wav.extend(1_u16.to_le_bytes()); // PCM
    wav.extend(1_u16.to_le_bytes()); // mono
    wav.extend(SAMPLE_RATE.to_le_bytes());
    wav.extend((SAMPLE_RATE * u32::from(BYTES_PER_SAMPLE)).to_le_bytes()); // byte rate
    wav.extend(BYTES_PER_SAMPLE.to_le_bytes()); // block align
    wav.extend(16_u16.to_le_bytes()); // bits per sample
    wav.extend(b"data");
    wav.extend(data_len.to_le_bytes());
    wav.extend(pcm);
    wav
}
