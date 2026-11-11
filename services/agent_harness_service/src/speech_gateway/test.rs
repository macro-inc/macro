use std::sync::Mutex;
use std::sync::atomic::{AtomicUsize, Ordering};

use ai_billing::domain::admission::AdmissionFuture;
use ai_usage::UsageEvent;
use base64::{Engine, engine::general_purpose::STANDARD};
use jsonwebtoken::{DecodingKey, Validation};
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use team_agents::domain::voice::VoiceProvider;
use tokio_tungstenite::connect_async;
use uuid::Uuid;

use super::*;
use crate::anthropic_gateway::brain::BrainLookup;
use super::protocol::{GenerationConfig, check_event, check_query};

const AGENT: &str = "macro|sam-rivera-abc123@agents.macro.invalid";
const AGENT_KEY: &str = "mak_agent";
const TEAM: Uuid = Uuid::from_u128(0x0193_a1b2_0000_7000_8000_0000_0000_00aa);

/// Knows one agent key; `mak_down` fails the lookup.
struct OneAgent;

impl BrainAuthenticator for OneAgent {
    fn authenticate<'a>(&'a self, key: &'a str) -> BrainLookup<'a> {
        Box::pin(async move {
            if key == "mak_down" {
                return Err(rootcause::report!("database down"));
            }
            Ok((key == AGENT_KEY).then(|| BrainCaller {
                user_id: MacroUserIdStr::parse_from_str(AGENT).unwrap().into_owned(),
                team_id: TEAM,
            }))
        })
    }
}

/// Admits everyone, counting.
#[derive(Default)]
struct CountingAdmission(AtomicUsize);

impl AiAdmissionService for CountingAdmission {
    fn admit<'a>(&'a self, _: &'a MacroUserIdStr<'_>, feature: AiFeature) -> AdmissionFuture<'a> {
        assert_eq!(feature, AiFeature::AgentSession);
        self.0.fetch_add(1, Ordering::SeqCst);
        Box::pin(async { Ok(()) })
    }
}

/// Keeps every event and wakes a waiter per event.
#[derive(Default)]
struct Recorder {
    events: Mutex<Vec<UsageEvent>>,
    recorded: tokio::sync::Notify,
}

impl UsageRecorder for Recorder {
    fn record(&self, event: UsageEvent) {
        self.events.lock().unwrap().push(event);
        self.recorded.notify_one();
    }
}

fn gateway(
    admission: Arc<CountingAdmission>,
    recorder: Arc<Recorder>,
    upstream: &str,
) -> SpeechGateway {
    SpeechGateway::new(
        Arc::new(OneAgent),
        admission,
        recorder,
        "project-key",
        "project-secret",
        upstream,
        &format!("{upstream}/models"),
    )
    .unwrap()
}

fn bearer(key: &str) -> HeaderMap {
    let mut headers = HeaderMap::new();
    headers.insert(
        header::AUTHORIZATION,
        HeaderValue::from_str(&format!("Bearer {key}")).unwrap(),
    );
    headers
}

fn stt_create() -> serde_json::Value {
    serde_json::json!({
        "type": "session.create",
        "model": "deepgram/nova-3",
        "language": "en",
        "settings": {
            "sample_rate": "16000",
            "encoding": "pcm_s16le",
            "extra": {
                "endpointing": 300,
                "interim_results": true,
                "smart_format": true,
                "utterance_end": true,
                "keyterm": "Sam",
            },
        },
    })
}

#[tokio::test]
async fn only_agent_keys_are_admitted() {
    for (headers, status) in [
        (HeaderMap::new(), StatusCode::UNAUTHORIZED),
        (bearer("mak_someone_else"), StatusCode::UNAUTHORIZED),
        (bearer("mak_down"), StatusCode::SERVICE_UNAVAILABLE),
    ] {
        let admission = Arc::new(CountingAdmission::default());
        let gateway = gateway(
            admission.clone(),
            Arc::new(Recorder::default()),
            "http://127.0.0.1:1",
        );

        assert_eq!(gateway.authorize(&headers).await.unwrap_err(), status);
        assert_eq!(admission.0.load(Ordering::SeqCst), 0);
    }

    let admission = Arc::new(CountingAdmission::default());
    let gateway = gateway(
        admission.clone(),
        Arc::new(Recorder::default()),
        "http://127.0.0.1:1",
    );
    let brain = gateway.authorize(&bearer(AGENT_KEY)).await.unwrap();
    assert_eq!(brain.team_id, TEAM);
    assert_eq!(admission.0.load(Ordering::SeqCst), 1);
}

#[test]
fn credentials_come_in_pairs() {
    for (key, secret) in [("project-key", ""), ("", "project-secret")] {
        assert!(
            SpeechGateway::new(
                Arc::new(OneAgent),
                Arc::new(CountingAdmission::default()),
                Arc::new(Recorder::default()),
                key,
                secret,
                "http://localhost",
                "http://localhost/models",
            )
            .is_err()
        );
    }
    let disabled = SpeechGateway::new(
        Arc::new(OneAgent),
        Arc::new(CountingAdmission::default()),
        Arc::new(Recorder::default()),
        "",
        "",
        "http://localhost",
        "http://localhost/models",
    )
    .unwrap();
    assert_eq!(
        disabled.provider_authorization().unwrap_err(),
        StatusCode::SERVICE_UNAVAILABLE
    );
}

#[test]
fn upstream_tokens_only_perform_inference_for_a_minute() {
    let gateway = gateway(Arc::default(), Arc::default(), "http://localhost");
    let header = gateway.provider_authorization().unwrap();
    assert!(header.is_sensitive());
    let token = header.to_str().unwrap().strip_prefix("Bearer ").unwrap();
    let validation = Validation::new(Algorithm::HS256);
    let claims = jsonwebtoken::decode::<serde_json::Value>(
        token,
        &DecodingKey::from_secret(b"project-secret"),
        &validation,
    )
    .unwrap()
    .claims;

    assert_eq!(claims["iss"], "project-key");
    assert_eq!(claims["inference"], serde_json::json!({ "perform": true }));
    assert!(claims.get("video").is_none());
    assert_eq!(
        claims["exp"].as_i64().unwrap() - claims["nbf"].as_i64().unwrap(),
        60
    );
}

#[test]
fn sessions_are_pinned_to_the_priced_models_and_formats() {
    assert!(check_query(Some("model=deepgram%2Fnova-3"), Operation::Stt).is_ok());
    for raw in [
        "",
        "model=other",
        "model=deepgram%2Fnova-3&model=deepgram%2Fnova-3",
        "model=deepgram%2Fnova-3&callback=https%3A%2F%2Fexample.com",
        "model=deepgram%2Faura-2",
    ] {
        assert_eq!(
            check_query(Some(raw), Operation::Stt),
            Err(StatusCode::BAD_REQUEST),
            "{raw}"
        );
    }

    let mut session = None;
    let create: ClientEvent = serde_json::from_value(stt_create()).unwrap();
    assert!(check_event(&create, Operation::Stt, &mut session).is_ok());
    // A second create could switch models or formats mid-call.
    assert!(check_event(&create, Operation::Stt, &mut session).is_err());

    for (field, value) in [("encoding", "mp3"), ("sample_rate", "8000")] {
        let mut changed = stt_create();
        changed["settings"][field] = value.into();
        let changed: ClientEvent = serde_json::from_value(changed).unwrap();
        assert!(check_event(&changed, Operation::Stt, &mut None).is_err());
    }
    let mut unknown_field = stt_create();
    unknown_field["callback"] = "https://example.com".into();
    assert!(serde_json::from_value::<ClientEvent>(unknown_field).is_err());

    let audio = ClientEvent::Audio {
        audio: STANDARD.encode([0_u8; 640]),
    };
    // Audio before the session opens, odd PCM and bad base64 are refused.
    assert!(check_event(&audio, Operation::Stt, &mut None).is_err());
    assert_eq!(
        check_event(&audio, Operation::Stt, &mut session)
            .unwrap()
            .audio_bytes,
        640
    );
    for audio in [STANDARD.encode([0_u8; 3]), "not base64".to_owned()] {
        assert!(check_event(&ClientEvent::Audio { audio }, Operation::Stt, &mut session).is_err());
    }

    let mut tts = Some(Session {
        voice: Some("thalia".to_owned()),
        language: "en".to_owned(),
    });
    let text = |voice: &str| ClientEvent::Text {
        transcript: "hello".to_owned(),
        generation_config: GenerationConfig {
            model: "deepgram/aura-2".to_owned(),
            voice: voice.to_owned(),
            language: "en".to_owned(),
        },
        extra: serde_json::Map::new(),
    };
    assert_eq!(
        check_event(&text("thalia"), Operation::Tts, &mut tts)
            .unwrap()
            .characters,
        5
    );
    assert!(check_event(&text("arcas"), Operation::Tts, &mut tts).is_err());
    assert!(check_event(&text("thalia"), Operation::Stt, &mut tts).is_err());
}

#[test]
fn a_session_records_its_forwarded_usage_once_against_the_agent() {
    let recorder = Arc::new(Recorder::default());
    let agent = MacroUserIdStr::parse_from_str(AGENT).unwrap().into_owned();
    for (operation, audio_bytes, characters) in [
        (Operation::Stt, 32_000, 0),
        (Operation::Tts, 0, 5),
        (Operation::Tts, 0, 0),
    ] {
        drop(Meter {
            recorder: recorder.clone(),
            context: UsageContext::new(AiFeature::AgentSession, agent.clone()),
            operation,
            audio_bytes,
            characters,
            span: Span::none(),
        });
    }

    let events = recorder.events.lock().unwrap();
    assert_eq!(events.len(), 2);
    assert_eq!(events[0].model, "livekit-inference-deepgram-nova-3");
    assert_eq!(events[0].user.as_ref(), AGENT);
    assert!(matches!(
        events[0].amount,
        UsageAmount::Audio { duration } if duration == Duration::from_secs(1)
    ));
    assert_eq!(events[1].model, "livekit-inference-deepgram-aura-2");
    assert!(matches!(
        events[1].amount,
        UsageAmount::ProviderCredits { credits: 5 }
    ));
}

/// A LiveKit stand-in: checks the minted token, answers `session.create`,
/// and transcribes each audio chunk as "heard".
async fn fake_inference(headers: HeaderMap, upgrade: WebSocketUpgrade) -> Response {
    let token = headers[header::AUTHORIZATION]
        .to_str()
        .unwrap()
        .strip_prefix("Bearer ")
        .unwrap()
        .to_owned();
    let validation = Validation::new(Algorithm::HS256);
    let claims = jsonwebtoken::decode::<serde_json::Value>(
        &token,
        &DecodingKey::from_secret(b"project-secret"),
        &validation,
    )
    .unwrap()
    .claims;
    assert_eq!(claims["inference"]["perform"], true);

    upgrade.on_upgrade(|mut socket| async move {
        while let Some(Ok(Message::Text(text))) = socket.next().await {
            let event: serde_json::Value = serde_json::from_str(text.as_str()).unwrap();
            let reply = match event["type"].as_str() {
                Some("session.create") => r#"{"type":"session.created","session_id":"test"}"#,
                Some("input_audio") => r#"{"type":"final_transcript","transcript":"heard"}"#,
                _ => continue,
            };
            socket.send(Message::Text(reply.into())).await.unwrap();
        }
    })
}

#[tokio::test]
async fn the_proxy_swaps_the_agent_key_for_a_project_token_and_meters_the_call() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let upstream = format!("http://{}", listener.local_addr().unwrap());
    let inference = tokio::spawn(async move {
        axum::serve(listener, Router::new().route("/stt", get(fake_inference)))
            .await
            .unwrap();
    });
    let recorder = Arc::new(Recorder::default());
    let speech = Arc::new(gateway(Arc::default(), recorder.clone(), &upstream));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let endpoint = format!(
        "ws://{}/brain/inference/stt?model=deepgram%2Fnova-3",
        listener.local_addr().unwrap()
    );
    let proxy = tokio::spawn(async move {
        axum::serve(listener, router(speech)).await.unwrap();
    });

    let mut refused = endpoint.clone().into_client_request().unwrap();
    refused.headers_mut().insert(
        header::AUTHORIZATION,
        bearer("mak_someone_else")[header::AUTHORIZATION].clone(),
    );
    match connect_async(refused).await.unwrap_err() {
        tokio_tungstenite::tungstenite::Error::Http(response) => {
            assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
        }
        error => panic!("unexpected error: {error}"),
    }

    let mut request = endpoint.into_client_request().unwrap();
    request.headers_mut().insert(
        header::AUTHORIZATION,
        bearer(AGENT_KEY)[header::AUTHORIZATION].clone(),
    );
    let (mut client, _) = connect_async(request).await.unwrap();
    client
        .send(UpstreamMessage::Text(stt_create().to_string().into()))
        .await
        .unwrap();
    assert!(matches!(
        client.next().await.unwrap().unwrap(),
        UpstreamMessage::Text(text) if text.as_str().contains("session.created")
    ));
    let audio = serde_json::json!({
        "type": "input_audio",
        "audio": STANDARD.encode(vec![0_u8; 32_000]),
    });
    client
        .send(UpstreamMessage::Text(audio.to_string().into()))
        .await
        .unwrap();
    assert!(matches!(
        client.next().await.unwrap().unwrap(),
        UpstreamMessage::Text(text) if text.as_str().contains("heard")
    ));
    client.close(None).await.unwrap();

    tokio::time::timeout(Duration::from_secs(5), recorder.recorded.notified())
        .await
        .unwrap();
    let events = recorder.events.lock().unwrap();
    assert_eq!(events.len(), 1);
    assert!(matches!(
        events[0].amount,
        UsageAmount::Audio { duration } if duration == Duration::from_secs(1)
    ));
    drop(events);
    proxy.abort();
    inference.abort();
}

#[test]
fn samples_are_mono_pcm16_wav_at_24_khz() {
    let wav = voices::wav(&[1, 0, 2, 0]);

    assert_eq!(&wav[..4], b"RIFF");
    assert_eq!(&wav[4..8], &40_u32.to_le_bytes());
    assert_eq!(&wav[22..24], &1_u16.to_le_bytes());
    assert_eq!(&wav[24..28], &24_000_u32.to_le_bytes());
    assert_eq!(&wav[34..36], &16_u16.to_le_bytes());
    assert_eq!(&wav[40..44], &4_u32.to_le_bytes());
    assert_eq!(&wav[44..], &[1, 0, 2, 0]);
}

#[tokio::test]
async fn the_catalog_keeps_aura_two_voices_and_each_sample_is_billed_once() {
    let catalog_requests = Arc::new(AtomicUsize::new(0));
    let syntheses = Arc::new(AtomicUsize::new(0));
    let catalogs = catalog_requests.clone();
    let synthesized = syntheses.clone();
    let provider = Router::new()
        .route(
            "/models",
            get(move || {
                let catalogs = catalogs.clone();
                async move {
                    catalogs.fetch_add(1, Ordering::SeqCst);
                    axum::Json(serde_json::json!({ "tts": [
                        {
                            "name": "Thalia",
                            "canonical_name": "aura-2-thalia-en",
                            "languages": ["en"],
                            "metadata": { "accent": "American", "tags": ["feminine", "warm"] },
                        },
                        {
                            "name": "Legacy",
                            "canonical_name": "aura-asteria-en",
                            "languages": ["en"],
                            "metadata": { "accent": "American", "tags": [] },
                        },
                    ]}))
                }
            }),
        )
        .route(
            "/tts",
            get(move |upgrade: WebSocketUpgrade| {
                let synthesized = synthesized.clone();
                async move {
                    upgrade.on_upgrade(move |mut socket| async move {
                        while let Some(Ok(Message::Text(text))) = socket.next().await {
                            let event: serde_json::Value =
                                serde_json::from_str(text.as_str()).unwrap();
                            if event["type"] != "session.flush" {
                                continue;
                            }
                            synthesized.fetch_add(1, Ordering::SeqCst);
                            let audio = serde_json::json!({
                                "type": "output_audio",
                                "audio": STANDARD.encode([1, 0, 2, 0]),
                            });
                            socket
                                .send(Message::Text(audio.to_string().into()))
                                .await
                                .unwrap();
                            socket
                                .send(Message::Text(r#"{"type":"done"}"#.into()))
                                .await
                                .unwrap();
                        }
                    })
                }
            }),
        );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let upstream = format!("http://{}", listener.local_addr().unwrap());
    let server = tokio::spawn(async move {
        axum::serve(listener, provider).await.unwrap();
    });
    let admission = Arc::new(CountingAdmission::default());
    let recorder = Arc::new(Recorder::default());
    let catalog = VoiceCatalog(Arc::new(gateway(
        admission.clone(),
        recorder.clone(),
        &upstream,
    )));

    let voices = catalog.catalog().await.unwrap();
    assert_eq!(voices.len(), 1);
    assert_eq!(voices[0].model.as_str(), "aura-2-thalia-en");
    assert_eq!(catalog.catalog().await.unwrap(), voices);
    assert_eq!(catalog_requests.load(Ordering::SeqCst), 1);

    let admin = MacroUserIdStr::parse_from_str("macro|admin@example.com").unwrap();
    let thalia = VoiceModel::parse("aura-2-thalia-en").unwrap();
    let first = catalog.sample(&admin, TEAM, &thalia).await.unwrap();
    let second = catalog.sample(&admin, TEAM, &thalia).await.unwrap();
    assert_eq!(first, second);
    assert_eq!(&first[44..], &[1, 0, 2, 0]);
    assert_eq!(syntheses.load(Ordering::SeqCst), 1);
    assert_eq!(admission.0.load(Ordering::SeqCst), 1);
    let events = recorder.events.lock().unwrap();
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].entity, Some(TEAM));
    assert!(matches!(
        events[0].amount,
        UsageAmount::ProviderCredits { credits: 79 }
    ));
    drop(events);
    server.abort();
}
