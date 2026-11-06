use super::*;
use ai_billing::domain::admission::AdmissionFuture;
use ai_usage::UsageEvent;
use hosted_runtimes::domain::ids::ComputerId;
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use std::sync::{
    Mutex,
    atomic::{AtomicUsize, Ordering},
};
use team_agents::domain::gateway::BrainGatewayFuture;
use tokio_tungstenite::connect_async;
use uuid::Uuid;

struct Access;
impl BrainGatewayAccess for Access {
    fn authorize<'a>(&'a self, key: &'a AgentApiKey) -> BrainGatewayFuture<'a> {
        Box::pin(async move {
            match key.expose() {
                value if value == format!("mak_{}", "a".repeat(64)) => Ok(BrainGatewayIdentity {
                    user_id: MacroUserIdStr::parse_from_str("macro|agent@example.com")
                        .unwrap()
                        .into_owned(),
                    team_id: Uuid::from_u128(1),
                    computer_id: ComputerId::new(Uuid::from_u128(2)),
                }),
                value
                    if value == format!("mak_{}", "b".repeat(64))
                        || value == format!("mak_{}", "c".repeat(64)) =>
                {
                    Err(BrainGatewayError::Forbidden)
                }
                value if value == format!("mak_{}", "d".repeat(64)) => {
                    Err(BrainGatewayError::Unavailable)
                }
                _ => Err(BrainGatewayError::Unauthorized),
            }
        })
    }
}

#[derive(Default)]
struct Admission(AtomicUsize);
impl AiAdmissionService for Admission {
    fn admit<'a>(
        &'a self,
        _user: &'a MacroUserIdStr<'_>,
        feature: AiFeature,
    ) -> AdmissionFuture<'a> {
        assert_eq!(feature, AiFeature::AgentSession);
        self.0.fetch_add(1, Ordering::SeqCst);
        Box::pin(async { Ok(()) })
    }
}

#[derive(Default)]
struct Recorder(Mutex<Vec<UsageEvent>>, tokio::sync::Notify);
impl UsageRecorder for Recorder {
    fn record(&self, event: UsageEvent) {
        self.0.lock().unwrap().push(event);
        self.1.notify_one();
    }
}

#[tokio::test]
async fn authorization_rejects_ordinary_revoked_stopped_and_other_team_keys_before_admission() {
    for (key, status) in [
        (format!("mak_{}", "f".repeat(64)), StatusCode::UNAUTHORIZED),
        (format!("mak_{}", "e".repeat(64)), StatusCode::UNAUTHORIZED),
        (format!("mak_{}", "b".repeat(64)), StatusCode::FORBIDDEN),
        (format!("mak_{}", "c".repeat(64)), StatusCode::FORBIDDEN),
        (
            format!("mak_{}", "d".repeat(64)),
            StatusCode::SERVICE_UNAVAILABLE,
        ),
    ] {
        let admission = Arc::new(Admission::default());
        let recorder = Arc::new(Recorder::default());
        let gateway = SpeechGateway::new(
            Arc::new(Access),
            admission.clone(),
            recorder.clone(),
            Some(
                LiveKitCredentials::new("project-key".to_owned(), "project-secret".to_owned())
                    .unwrap(),
            ),
            "http://127.0.0.1:1",
            "http://127.0.0.1:1/models",
        )
        .unwrap();
        let mut headers = HeaderMap::new();
        headers.insert(
            header::AUTHORIZATION,
            HeaderValue::from_str(&format!("Bearer {key}")).unwrap(),
        );
        assert_eq!(gateway.authorize(&headers).await.unwrap_err(), status);
        assert_eq!(admission.0.load(Ordering::SeqCst), 0);
        assert!(recorder.0.lock().unwrap().is_empty());
    }
}

#[test]
fn provider_tokens_are_short_lived_inference_only_and_contain_no_project_secret() {
    use jsonwebtoken::{DecodingKey, Validation};
    let gateway = SpeechGateway::new(
        Arc::new(Access),
        Arc::new(Admission::default()),
        Arc::new(Recorder::default()),
        Some(
            LiveKitCredentials::new("project-key".to_owned(), "project-secret".to_owned()).unwrap(),
        ),
        "http://localhost",
        "http://localhost/models",
    )
    .unwrap();
    let header = gateway.provider_authorization().unwrap();
    assert!(header.is_sensitive());
    let token = header.to_str().unwrap().strip_prefix("Bearer ").unwrap();
    let claims = jsonwebtoken::decode::<serde_json::Value>(
        token,
        &DecodingKey::from_secret(b"project-secret"),
        &Validation::new(Algorithm::HS256),
    )
    .unwrap()
    .claims;
    assert_eq!(claims["iss"], "project-key");
    assert_eq!(claims["inference"]["perform"], true);
    assert!(claims.get("video").is_none());
    assert!(claims.get("sip").is_none());
    assert_eq!(
        claims["exp"].as_i64().unwrap() - claims["nbf"].as_i64().unwrap(),
        60
    );
    assert!(!claims.to_string().contains("project-secret"));
}

#[test]
fn inference_contract_rejects_unpriced_models_encoded_audio_and_model_changes() {
    assert!(query(Some("model=deepgram%2Fnova-3"), Operation::Stt).is_ok());
    for raw in [
        "model=other",
        "model=deepgram%2Fnova-3&model=deepgram%2Fnova-3",
        "model=deepgram%2Fnova-3&callback=example",
    ] {
        assert_eq!(
            query(Some(raw), Operation::Stt),
            Err(StatusCode::BAD_REQUEST)
        );
    }
    let create = serde_json::json!({"type":"session.create","model":"deepgram/nova-3","language":"en","settings":{"sample_rate":"16000","encoding":"pcm_s16le","extra":{"endpointing":300,"interim_results":true,"smart_format":true,"utterance_end":true,"keyterm":"Agent"}}});
    let mut selection = None;
    assert!(
        validate(
            &serde_json::from_value(create.clone()).unwrap(),
            Operation::Stt,
            &mut selection
        )
        .is_ok()
    );
    assert!(
        validate(
            &serde_json::from_value(create.clone()).unwrap(),
            Operation::Stt,
            &mut selection
        )
        .is_err()
    );
    for (field, value) in [("encoding", "mp3"), ("sample_rate", "8000")] {
        let mut invalid = create.clone();
        invalid["settings"][field] = value.into();
        assert!(
            validate(
                &serde_json::from_value(invalid).unwrap(),
                Operation::Stt,
                &mut None
            )
            .is_err()
        );
    }
    assert!(
        validate(
            &ClientEvent::Audio {
                audio: STANDARD.encode([0_u8; 640])
            },
            Operation::Stt,
            &mut None
        )
        .is_err()
    );
    assert!(
        validate(
            &ClientEvent::Audio {
                audio: "not-base64".to_owned()
            },
            Operation::Stt,
            &mut selection
        )
        .is_err()
    );
    let text = ClientEvent::Text {
        transcript: "hello".to_owned(),
        generation_config: GenerationConfig {
            model: "other".to_owned(),
            voice: "thalia".to_owned(),
            language: "en".to_owned(),
        },
        extra: Default::default(),
    };
    assert!(
        validate(
            &text,
            Operation::Tts,
            &mut Some(("thalia".to_owned(), "en".to_owned()))
        )
        .is_err()
    );
}

#[test]
fn disconnected_streams_record_native_units_once_against_agent_and_team() {
    let recorder = Arc::new(Recorder::default());
    let user = MacroUserIdStr::parse_from_str("macro|agent@example.com")
        .unwrap()
        .into_owned();
    for (operation, audio_bytes, characters) in [(Operation::Stt, 32000, 0), (Operation::Tts, 0, 5)]
    {
        let _meter = Meter {
            recorder: recorder.clone(),
            context: UsageContext::new(AiFeature::AgentSession, user.clone())
                .with_entity(Some(Uuid::from_u128(1))),
            operation,
            audio_bytes,
            characters,
        };
    }
    let events = recorder.0.lock().unwrap();
    assert_eq!(events.len(), 2);
    assert_eq!(events[0].model, STT_MODEL);
    assert_eq!(events[0].entity, Some(Uuid::from_u128(1)));
    assert!(
        matches!(events[0].amount, UsageAmount::Audio { duration } if duration == Duration::from_secs(1))
    );
    assert_eq!(events[1].model, TTS_MODEL);
    assert!(matches!(
        events[1].amount,
        UsageAmount::ProviderCredits { credits: 5 }
    ));
}

#[tokio::test]
async fn websocket_proxy_replaces_agent_auth_and_relays_inference_events_with_metering() {
    async fn provider(headers: HeaderMap, upgrade: WebSocketUpgrade) -> Response {
        let token = headers[header::AUTHORIZATION]
            .to_str()
            .unwrap()
            .strip_prefix("Bearer ")
            .unwrap();
        let claims = jsonwebtoken::decode::<serde_json::Value>(
            token,
            &jsonwebtoken::DecodingKey::from_secret(b"project-secret"),
            &jsonwebtoken::Validation::new(Algorithm::HS256),
        )
        .unwrap()
        .claims;
        assert_eq!(claims["inference"]["perform"], true);
        upgrade
            .on_upgrade(|mut socket| async move {
                while let Some(Ok(Message::Text(text))) = socket.next().await {
                    let event: serde_json::Value = serde_json::from_str(&text).unwrap();
                    if event["type"] == "session.create" {
                        socket
                            .send(Message::Text(
                                "{\"type\":\"session.created\",\"session_id\":\"test\"}".into(),
                            ))
                            .await
                            .unwrap();
                    }
                    if event["type"] == "input_audio" {
                        assert_eq!(
                            STANDARD
                                .decode(event["audio"].as_str().unwrap())
                                .unwrap()
                                .len(),
                            32000
                        );
                        socket
                            .send(Message::Text(
                                "{\"type\":\"final_transcript\",\"transcript\":\"heard\"}".into(),
                            ))
                            .await
                            .unwrap();
                    }
                }
            })
            .into_response()
    }
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let upstream = format!("http://{}", listener.local_addr().unwrap());
    let provider_server = tokio::spawn(async move {
        axum::serve(listener, Router::new().route("/stt", get(provider)))
            .await
            .unwrap();
    });
    let recorder = Arc::new(Recorder::default());
    let state = Arc::new(
        SpeechGateway::new(
            Arc::new(Access),
            Arc::new(Admission::default()),
            recorder.clone(),
            Some(
                LiveKitCredentials::new("project-key".to_owned(), "project-secret".to_owned())
                    .unwrap(),
            ),
            &upstream,
            &format!("{upstream}/models"),
        )
        .unwrap(),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let endpoint = format!(
        "ws://{}/brain/inference/stt?model=deepgram%2Fnova-3",
        listener.local_addr().unwrap()
    );
    let gateway_server = tokio::spawn(async move {
        axum::serve(listener, router(state)).await.unwrap();
    });
    for (key, expected) in [
        (format!("mak_{}", "f".repeat(64)), StatusCode::UNAUTHORIZED),
        (format!("mak_{}", "e".repeat(64)), StatusCode::UNAUTHORIZED),
        (format!("mak_{}", "b".repeat(64)), StatusCode::FORBIDDEN),
        (format!("mak_{}", "c".repeat(64)), StatusCode::FORBIDDEN),
    ] {
        let mut denied = endpoint.clone().into_client_request().unwrap();
        denied.headers_mut().insert(
            header::AUTHORIZATION,
            HeaderValue::from_str(&format!("Bearer {key}")).unwrap(),
        );
        match connect_async(denied).await.unwrap_err() {
            tokio_tungstenite::tungstenite::Error::Http(response) => {
                assert_eq!(response.status(), expected)
            }
            error => panic!("unexpected error: {error}"),
        }
    }
    let mut request = endpoint.into_client_request().unwrap();
    request.headers_mut().insert(
        header::AUTHORIZATION,
        HeaderValue::from_str(&format!("Bearer mak_{}", "a".repeat(64))).unwrap(),
    );
    let (mut client, _) = connect_async(request).await.unwrap();
    client.send(UpstreamMessage::Text(serde_json::json!({"type":"session.create","model":"deepgram/nova-3","language":"en","settings":{"sample_rate":"16000","encoding":"pcm_s16le","extra":{"endpointing":300,"interim_results":true,"smart_format":true,"utterance_end":true,"keyterm":"Agent"}}}).to_string().into())).await.unwrap();
    assert!(matches!(
        client.next().await.unwrap().unwrap(),
        UpstreamMessage::Text(_)
    ));
    client
        .send(UpstreamMessage::Text(
            serde_json::json!({"type":"input_audio","audio":STANDARD.encode(vec![0_u8; 32000])})
                .to_string()
                .into(),
        ))
        .await
        .unwrap();
    let message = client.next().await.unwrap().unwrap();
    assert!(matches!(message, UpstreamMessage::Text(text) if text.contains("heard")));
    client.close(None).await.unwrap();
    tokio::time::timeout(Duration::from_secs(5), recorder.1.notified())
        .await
        .unwrap();
    assert_eq!(recorder.0.lock().unwrap().len(), 1);
    gateway_server.abort();
    provider_server.abort();
}

#[test]
fn sample_wav_preserves_the_inference_pcm_format() {
    let wav = sample_wav(&[1, 0, 2, 0]);
    assert_eq!(&wav[..4], b"RIFF");
    assert_eq!(&wav[24..28], &24000_u32.to_le_bytes());
    assert_eq!(&wav[44..], &[1, 0, 2, 0]);
}

#[tokio::test]
async fn supported_aura_catalog_and_fixed_inference_samples_are_cached() {
    let catalog_requests = Arc::new(AtomicUsize::new(0));
    let sample_requests = Arc::new(AtomicUsize::new(0));
    let catalogs = catalog_requests.clone();
    let samples = sample_requests.clone();
    let provider = Router::new().route("/models", get(move || {
        let catalogs = catalogs.clone(); async move {
            catalogs.fetch_add(1, Ordering::SeqCst);
            axum::Json(serde_json::json!({"tts":[
                {"name":"Thalia","canonical_name":"aura-2-thalia-en","languages":["en"],"metadata":{"accent":"American","tags":["female","warm"]}},
                {"name":"Legacy","canonical_name":"aura-legacy-en","languages":["en"],"metadata":{"accent":"American","tags":[]}}
            ]}))
        }
    })).route("/tts", get(move |upgrade: WebSocketUpgrade| {
        let samples = samples.clone(); async move {
            upgrade.on_upgrade(move |mut socket| async move {
                while let Some(Ok(Message::Text(text))) = socket.next().await {
                    let event: serde_json::Value = serde_json::from_str(&text).unwrap();
                    if event["type"] == "input_transcript" { assert_eq!(event["transcript"], "Hi, I'm your teammate. You can call me when you want to talk something through."); samples.fetch_add(1, Ordering::SeqCst); }
                    if event["type"] == "session.flush" {
                        if samples.load(Ordering::SeqCst) > 1 {
                            socket.send(Message::Text("{\"type\":\"error\",\"message\":\"synthesis failed\"}".into())).await.unwrap();
                            continue;
                        }
                        socket.send(Message::Text(serde_json::json!({"type":"output_audio","audio":STANDARD.encode([1,0,2,0]),"session_id":"sample"}).to_string().into())).await.unwrap();
                        socket.send(Message::Text("{\"type\":\"done\",\"session_id\":\"sample\"}".into())).await.unwrap();
                    }
                }
            })
        }
    }));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let endpoint = format!("http://{}", listener.local_addr().unwrap());
    let server = tokio::spawn(async move {
        axum::serve(listener, provider).await.unwrap();
    });
    let admission = Arc::new(Admission::default());
    let recorder = Arc::new(Recorder::default());
    let state = Arc::new(
        SpeechGateway::new(
            Arc::new(Access),
            admission.clone(),
            recorder.clone(),
            Some(
                LiveKitCredentials::new("project-key".to_owned(), "project-secret".to_owned())
                    .unwrap(),
            ),
            &endpoint,
            &format!("{endpoint}/models"),
        )
        .unwrap(),
    );
    let provider = VoiceCatalog(state.clone());
    let voices = provider.catalog().await.unwrap();
    assert_eq!(voices.len(), 1);
    assert_eq!(voices[0].tags, ["female", "warm"]);
    assert_eq!(provider.catalog().await.unwrap(), voices);
    assert_eq!(catalog_requests.load(Ordering::SeqCst), 1);
    let user = MacroUserIdStr::parse_from_str("macro|admin@example.com").unwrap();
    let first = provider
        .sample(&user, Uuid::from_u128(1), "aura-2-thalia-en")
        .await
        .unwrap();
    let second = provider
        .sample(&user, Uuid::from_u128(1), "aura-2-thalia-en")
        .await
        .unwrap();
    assert_eq!(first, second);
    assert_eq!(&first[44..], &[1, 0, 2, 0]);
    assert_eq!(sample_requests.load(Ordering::SeqCst), 1);
    assert_eq!(admission.0.load(Ordering::SeqCst), 1);
    assert_eq!(recorder.0.lock().unwrap().len(), 1);
    state.samples.lock().await.clear();
    assert!(
        provider
            .sample(&user, Uuid::from_u128(1), "aura-2-thalia-en")
            .await
            .is_err()
    );
    assert_eq!(sample_requests.load(Ordering::SeqCst), 2);
    assert_eq!(recorder.0.lock().unwrap().len(), 2);
    assert!(state.samples.lock().await.is_empty());
    server.abort();
}

#[tokio::test]
async fn absent_credentials_disable_both_inference_connections() {
    let gateway = SpeechGateway::new(
        Arc::new(Access),
        Arc::new(Admission::default()),
        Arc::new(Recorder::default()),
        None,
        "http://127.0.0.1:1",
        "http://127.0.0.1:1/models",
    )
    .unwrap();
    assert_eq!(
        gateway.provider_authorization().unwrap_err(),
        StatusCode::SERVICE_UNAVAILABLE
    );
    for operation in [Operation::Stt, Operation::Tts] {
        assert_eq!(
            gateway.connect(operation).await.err().unwrap(),
            StatusCode::SERVICE_UNAVAILABLE
        );
    }
}
