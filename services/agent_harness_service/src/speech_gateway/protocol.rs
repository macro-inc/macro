//! The LiveKit Inference session contract the gateway lets through: Nova-3
//! speech-to-text over mono PCM16 at 16 kHz and Aura-2 text-to-speech as
//! PCM16 at 24 kHz. Anything else closes the socket.

use axum::http::StatusCode;
use base64::{Engine, engine::general_purpose::STANDARD};
use serde::Deserialize;

/// Largest client message, and largest decoded audio chunk.
pub(super) const MAX_MESSAGE_BYTES: usize = 1024 * 1024;
/// Longest text one synthesis request may carry, in characters.
const MAX_TRANSCRIPT_CHARS: usize = 10_000;
/// Longest STT key term, in characters.
const MAX_KEYTERM_CHARS: usize = 100;
/// Bytes of 16 kHz mono PCM16 per second.
pub(super) const STT_BYTES_PER_SECOND: f64 = 32_000.0;
const STT_MODEL: &str = "deepgram/nova-3";
const TTS_MODEL: &str = "deepgram/aura-2";
const PCM_ENCODING: &str = "pcm_s16le";
const STT_SAMPLE_RATE: &str = "16000";
pub(super) const TTS_SAMPLE_RATE: &str = "24000";
const STT_ENDPOINTING_MS: u32 = 300;

/// Which LiveKit Inference socket a session uses.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Operation {
    /// Speech to text.
    Stt,
    /// Text to speech.
    Tts,
}

impl Operation {
    /// The upstream path segment, also the span's `speech.operation`.
    pub(super) fn path(self) -> &'static str {
        match self {
            Self::Stt => "stt",
            Self::Tts => "tts",
        }
    }

    /// The only model the operation may name.
    pub(super) fn model(self) -> &'static str {
        match self {
            Self::Stt => STT_MODEL,
            Self::Tts => TTS_MODEL,
        }
    }
}

/// The upgrade request's query must be exactly `model=<the operation's model>`.
pub(super) fn check_query(raw: Option<&str>, operation: Operation) -> Result<(), StatusCode> {
    let pairs: Vec<_> = url::form_urlencoded::parse(raw.unwrap_or_default().as_bytes()).collect();
    match pairs.as_slice() {
        [(name, value)] if name == "model" && value == operation.model() => Ok(()),
        _ => Err(StatusCode::BAD_REQUEST),
    }
}

/// Nova-3 options a session must pin.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct SttExtra {
    pub(super) endpointing: u32,
    pub(super) interim_results: bool,
    pub(super) smart_format: bool,
    pub(super) utterance_end: bool,
    /// A word to listen for, such as the agent's name.
    pub(super) keyterm: String,
}

/// STT audio settings.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct SttSettings {
    pub(super) sample_rate: String,
    pub(super) encoding: String,
    pub(super) extra: SttExtra,
}

/// What one TTS request synthesizes with; must match the session.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct GenerationConfig {
    pub(super) model: String,
    pub(super) voice: String,
    pub(super) language: String,
}

/// A message the runtime sends.
#[derive(Debug, Deserialize)]
#[serde(tag = "type", deny_unknown_fields)]
pub(super) enum ClientEvent {
    /// Opens the session; must come first, once.
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
    /// Base64 PCM16 for STT.
    #[serde(rename = "input_audio")]
    Audio { audio: String },
    /// Text to synthesize.
    #[serde(rename = "input_transcript")]
    Text {
        transcript: String,
        generation_config: GenerationConfig,
        extra: serde_json::Map<String, serde_json::Value>,
    },
    /// TTS: synthesize what was sent so far.
    #[serde(rename = "session.flush")]
    Flush,
    /// STT: finish the current utterance.
    #[serde(rename = "session.finalize")]
    Finalize,
    #[serde(rename = "session.close")]
    Close,
}

/// What `session.create` fixed for the rest of the session.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct Session {
    /// The Aura-2 voice name (`thalia`); `None` for STT.
    pub(super) voice: Option<String>,
    /// Two-letter language.
    pub(super) language: String,
}

/// What one accepted message costs, in each operation's billing unit.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub(super) struct Usage {
    /// Decoded PCM bytes sent for transcription.
    pub(super) audio_bytes: u64,
    /// Characters sent for synthesis.
    pub(super) characters: u64,
}

fn is_language(language: &str) -> bool {
    language.len() == 2 && language.bytes().all(|byte| byte.is_ascii_lowercase())
}

fn check_create_stt(
    language: &str,
    voice: Option<&String>,
    encoding: Option<&String>,
    sample_rate: Option<&String>,
    settings: Option<&SttSettings>,
) -> Result<(), StatusCode> {
    let settings = settings.ok_or(StatusCode::BAD_REQUEST)?;
    let extra = &settings.extra;
    let keyterm_ok = !extra.keyterm.is_empty()
        && extra.keyterm.chars().count() <= MAX_KEYTERM_CHARS
        && !extra.keyterm.chars().any(char::is_control);
    let pinned = extra.endpointing == STT_ENDPOINTING_MS
        && extra.interim_results
        && extra.smart_format
        && extra.utterance_end
        && settings.encoding == PCM_ENCODING
        && settings.sample_rate == STT_SAMPLE_RATE;
    // Nova-3 monolingual is the priced model, so only English.
    let top_level_unset = voice.is_none() && encoding.is_none() && sample_rate.is_none();

    if language == "en" && keyterm_ok && pinned && top_level_unset {
        Ok(())
    } else {
        Err(StatusCode::BAD_REQUEST)
    }
}

fn check_create_tts(
    voice: Option<&String>,
    encoding: Option<&String>,
    sample_rate: Option<&String>,
    settings: Option<&SttSettings>,
) -> Result<(), StatusCode> {
    let voice = voice.ok_or(StatusCode::BAD_REQUEST)?;
    let voice_ok = !voice.is_empty() && voice.bytes().all(|byte| byte.is_ascii_lowercase());
    let pinned = encoding.map(String::as_str) == Some(PCM_ENCODING)
        && sample_rate.map(String::as_str) == Some(TTS_SAMPLE_RATE);

    if voice_ok && pinned && settings.is_none() {
        Ok(())
    } else {
        Err(StatusCode::BAD_REQUEST)
    }
}

/// Check `event` against the session so far, opening it on `session.create`.
pub(super) fn check_event(
    event: &ClientEvent,
    operation: Operation,
    session: &mut Option<Session>,
) -> Result<Usage, StatusCode> {
    match (event, session.as_ref()) {
        (
            ClientEvent::Create {
                model,
                language,
                voice,
                encoding,
                sample_rate,
                settings,
                extra,
            },
            None,
        ) => {
            if model != operation.model()
                || !is_language(language)
                || extra.as_ref().is_some_and(|extra| !extra.is_empty())
            {
                return Err(StatusCode::BAD_REQUEST);
            }
            match operation {
                Operation::Stt => check_create_stt(
                    language,
                    voice.as_ref(),
                    encoding.as_ref(),
                    sample_rate.as_ref(),
                    settings.as_ref(),
                )?,
                Operation::Tts => check_create_tts(
                    voice.as_ref(),
                    encoding.as_ref(),
                    sample_rate.as_ref(),
                    settings.as_ref(),
                )?,
            }
            *session = Some(Session {
                voice: voice.clone(),
                language: language.clone(),
            });
            Ok(Usage::default())
        }
        (ClientEvent::Audio { audio }, Some(_)) if operation == Operation::Stt => {
            let pcm = STANDARD
                .decode(audio)
                .map_err(|_| StatusCode::BAD_REQUEST)?;
            if pcm.is_empty() || pcm.len() % 2 != 0 || pcm.len() > MAX_MESSAGE_BYTES {
                return Err(StatusCode::BAD_REQUEST);
            }
            Ok(Usage {
                audio_bytes: pcm.len() as u64,
                characters: 0,
            })
        }
        (
            ClientEvent::Text {
                transcript,
                generation_config,
                extra,
            },
            Some(open),
        ) if operation == Operation::Tts => {
            let characters = transcript.chars().count();
            let same_session = generation_config.model == operation.model()
                && open.voice.as_ref() == Some(&generation_config.voice)
                && generation_config.language == open.language;
            if !same_session || !extra.is_empty() || characters > MAX_TRANSCRIPT_CHARS {
                return Err(StatusCode::BAD_REQUEST);
            }
            Ok(Usage {
                audio_bytes: 0,
                characters: characters as u64,
            })
        }
        (ClientEvent::Close, Some(_)) => Ok(Usage::default()),
        (ClientEvent::Finalize, Some(_)) if operation == Operation::Stt => Ok(Usage::default()),
        (ClientEvent::Flush, Some(_)) if operation == Operation::Tts => Ok(Usage::default()),
        _ => Err(StatusCode::BAD_REQUEST),
    }
}
