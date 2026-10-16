//! Real Axum routes, access checks, database and native adapters; Meta alone is simulated.
use super::*;
mod content;
mod history;
mod lifecycle;
mod oauth;
mod recovery;
use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode},
};
use hmac::{Hmac, Mac};
use macro_authorization::{
    InternalIdentityClaims, MacroAuthorizationError, MacroAuthorizationService,
    MacroAuthorizationState,
};
use meta_messaging::{
    domain::meta::MetaService,
    inbound::{
        router::{self, MessagingRouterState, WebhookConfiguration, WebhookCredentials},
        webhook,
    },
};
use serde_json::{Value, json};
use sha2::Sha256;
use std::sync::atomic::{AtomicUsize, Ordering};
use tower::ServiceExt;

#[derive(Clone)]
struct Authentication {
    owner: String,
    outsider: String,
}
impl MacroAuthorizationService for Authentication {
    async fn authorize(
        &self,
        jwt: &str,
    ) -> Result<model_user::UserContext, rootcause::Report<MacroAuthorizationError>> {
        let user = match jwt {
            "owner" => &self.owner,
            "outsider" => &self.outsider,
            _ => return Err(MacroAuthorizationError::InvalidCredentials.into()),
        };
        Ok(model_user::UserContext {
            user_id: user.clone(),
            ..Default::default()
        })
    }
    async fn authorize_internal(
        &self,
        _: &str,
        _: InternalIdentityClaims,
    ) -> Result<Option<model_user::UserContext>, rootcause::Report<MacroAuthorizationError>> {
        Err(MacroAuthorizationError::InvalidCredentials.into())
    }
    async fn authorize_user_api_key(
        &self,
        _: &str,
    ) -> Result<model_user::UserContext, rootcause::Report<MacroAuthorizationError>> {
        self.authorize("owner").await
    }
}
struct TestCipher;
#[async_trait]
impl CredentialCipher for TestCipher {
    async fn encrypt(&self, _: Uuid, _: Uuid, t: &AccessToken) -> PortResult<Vec<u8>> {
        Ok(t.expose().as_bytes().to_vec())
    }
    async fn decrypt(&self, _: Uuid, _: Uuid, b: &[u8]) -> PortResult<AccessToken> {
        Ok(AccessToken::new(String::from_utf8(b.to_vec()).unwrap())?)
    }
}
struct ProviderFixture {
    connection: Connection,
    authorizations: AtomicUsize,
    sends: AtomicUsize,
    subscriptions: AtomicUsize,
    unsubscriptions: AtomicUsize,
    subscribe_error: std::sync::Mutex<Option<MessagingError>>,
    pause_subscribe: std::sync::atomic::AtomicBool,
    pause_unsubscribe: std::sync::atomic::AtomicBool,
    operation_entered: tokio::sync::Notify,
    operation_release: tokio::sync::Notify,
    history_requests: AtomicUsize,
    history_pages: std::sync::Mutex<
        std::collections::VecDeque<PortResult<meta_messaging::domain::history::HistoryPage>>,
    >,
}
#[async_trait]
impl MetaProvider for ProviderFixture {
    async fn request_whatsapp_history(
        &self,
        _: &Connection,
        _: &AccessToken,
        _: bool,
    ) -> PortResult<String> {
        self.history_requests.fetch_add(1, Ordering::SeqCst);
        Ok("fixture-history-request".into())
    }
    async fn instagram_history(
        &self,
        _: &Connection,
        _: &AccessToken,
        _: Option<&str>,
    ) -> PortResult<meta_messaging::domain::history::HistoryPage> {
        self.history_pages
            .lock()
            .unwrap()
            .pop_front()
            .expect("unexpected history read")
    }

    async fn customer_profile(
        &self,
        _: &Connection,
        _: &AccessToken,
        _: &ProviderId,
    ) -> PortResult<CustomerProfile> {
        Ok(CustomerProfile {
            name: Some("Customer".into()),
            handle: Some("customer_handle".into()),
        })
    }

    async fn authorize(
        &self,
        p: Provider,
        _: &CompleteAuthorization,
    ) -> PortResult<AuthorizedAccount> {
        self.authorizations.fetch_add(1, Ordering::SeqCst);
        assert_eq!(p, self.connection.provider);
        Ok(AuthorizedAccount {
            developer_account: false,
            account_id: self.connection.account_id.clone(),
            business_account_id: None,
            display_name: "Fixture business".into(),
            token: AccessToken::new("test-only".into())?,
            expires_at: None,
        })
    }
    async fn developer_account(&self) -> PortResult<AuthorizedAccount> {
        panic!("not the developer flow")
    }
    async fn subscribe(&self, _: &Connection, _: &AccessToken) -> PortResult<()> {
        self.subscriptions.fetch_add(1, Ordering::SeqCst);
        if self.pause_subscribe.load(Ordering::SeqCst) {
            self.operation_entered.notify_one();
            self.operation_release.notified().await;
        }
        if let Some(error) = self.subscribe_error.lock().unwrap().clone() {
            return Err(error.into());
        }
        Ok(())
    }
    async fn unsubscribe(&self, _: &Connection, _: &AccessToken) -> PortResult<()> {
        self.unsubscriptions.fetch_add(1, Ordering::SeqCst);
        if self.pause_unsubscribe.load(Ordering::SeqCst) {
            self.operation_entered.notify_one();
            self.operation_release.notified().await;
        }
        Ok(())
    }
    async fn refresh(&self, _: &AccessToken) -> PortResult<(AccessToken, chrono::DateTime<Utc>)> {
        panic!("no expiring credential")
    }
    async fn templates(&self, _: &Connection, _: &AccessToken) -> PortResult<Vec<Template>> {
        Ok(vec![])
    }
    async fn prepare_reply(
        &self,
        _: &Connection,
        _: &AccessToken,
        _: &Conversation,
        r: &SendReply,
        _: Option<&OutboundMedia>,
    ) -> PortResult<PreparedReply> {
        let ReplyContent::Text { text } = &r.message else {
            panic!("text workflow")
        };
        Ok(PreparedReply {
            rendered_text: text.clone(),
            provider_document: json!({"fixture":true}),
        })
    }
    async fn send(&self, _: &Connection, _: &AccessToken, _: &PreparedReply) -> ProviderSendResult {
        self.sends.fetch_add(1, Ordering::SeqCst);
        ProviderSendResult::Accepted("fixture-accepted".to_owned().try_into().unwrap())
    }
    async fn download(
        &self,
        _: &Connection,
        _: &AccessToken,
        media: &IncomingMedia,
    ) -> PortResult<MediaBytes> {
        if media
            .id
            .as_ref()
            .is_some_and(|id| id.as_str() == "slow-test-media")
        {
            self.operation_entered.notify_one();
            self.operation_release.notified().await;
            return Err(MessagingError::ProviderRejected.into());
        }
        if media
            .id
            .as_ref()
            .is_some_and(|id| id.as_str() == "unavailable-history-media")
        {
            return Err(MessagingError::ProviderRejected.into());
        }
        if media.url.as_deref() == Some("https://scontent.cdninstagram.com/healthy-test.png") {
            return Ok(MediaBytes {
                filename: "healthy.png".into(),
                mime_type: "image/png".into(),
                bytes: b"\x89PNG\r\n\x1a\nfixture".to_vec(),
            });
        }
        panic!("text workflow")
    }
}
async fn request(
    app: &Router,
    method: &str,
    path: &str,
    token: Option<&str>,
    body: Value,
) -> (StatusCode, Value) {
    let mut request = Request::builder()
        .method(method)
        .uri(path)
        .header("content-type", "application/json");
    if let Some(token) = token {
        request = request.header("authorization", format!("Bearer {token}"));
    }
    let response = app
        .clone()
        .oneshot(request.body(Body::from(body.to_string())).unwrap())
        .await
        .unwrap();
    let status = response.status();
    let bytes = to_bytes(response.into_body(), 1024 * 1024).await.unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or_else(|_| json!(String::from_utf8_lossy(&bytes))),
    )
}
async fn signed(app: &Router, provider: Provider, payload: Value, valid: bool) -> StatusCode {
    let body = payload.to_string();
    let mut mac = Hmac::<Sha256>::new_from_slice(b"fixture-signature-secret").unwrap();
    mac.update(body.as_bytes());
    let signature = if valid {
        format!(
            "sha256={}",
            mac.finalize()
                .into_bytes()
                .iter()
                .map(|b| format!("{b:02x}"))
                .collect::<String>()
        )
    } else {
        "sha256=invalid".into()
    };
    app.clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/webhooks/{}", provider.as_str()))
                .header("x-hub-signature-256", signature)
                .body(Body::from(body))
                .unwrap(),
        )
        .await
        .unwrap()
        .status()
}
async fn drain(service: &MetaService) {
    while let Some(receipt) = service.repository.claim_receipt().await.unwrap() {
        let events = webhook::decode(receipt.provider, &receipt.payload).unwrap();
        service.process_receipt(&receipt, events).await.unwrap();
        service
            .repository
            .settle_receipt(&receipt.lease, None, None)
            .await
            .unwrap();
    }
}
async fn connected_time(repo: &PgMessagingRepository, connection: Uuid) -> chrono::DateTime<Utc> {
    // PostgreSQL can run in a VM a fraction of a second ahead of the host.
    // Model a customer message after connection, not one before that DB clock.
    let connected_at = repo
        .connection(connection)
        .await
        .unwrap()
        .unwrap()
        .connected_at
        .unwrap();
    if let Ok(delay) = (connected_at - Utc::now()).to_std() {
        assert!(
            delay < std::time::Duration::from_secs(5),
            "test database clock is out of sync"
        );
        tokio::time::sleep(delay).await;
    }
    Utc::now()
}

struct Fixture {
    app: Router,
    service: Arc<MetaService>,
    repo: Arc<PgMessagingRepository>,
    remote: Arc<ProviderFixture>,
    c: Connection,
}

async fn fixture(pool: &PgPool, provider: Provider, new_account: Option<&str>) -> Fixture {
    fixture_with_files(pool, provider, new_account, None).await
}

async fn fixture_with_files(
    pool: &PgPool,
    provider: Provider,
    new_account: Option<&str>,
    files: Option<Arc<dyn super::super::super::files::MessageFiles>>,
) -> Fixture {
    let (mut native, c, outsider) = setup(pool, provider).await;
    if let Some(files) = files {
        native.files = files;
    }
    let native = Arc::new(native);
    let repo = Arc::new(PgMessagingRepository::new(pool.clone()));
    let remote = Arc::new(ProviderFixture {
        connection: Connection {
            account_id: new_account
                .map(|id| id.to_owned().try_into().unwrap())
                .unwrap_or_else(|| c.account_id.clone()),
            ..c.clone()
        },
        authorizations: AtomicUsize::new(0),
        sends: AtomicUsize::new(0),
        subscriptions: AtomicUsize::new(0),
        unsubscriptions: AtomicUsize::new(0),
        subscribe_error: Default::default(),
        pause_subscribe: Default::default(),
        pause_unsubscribe: Default::default(),
        operation_entered: Default::default(),
        operation_release: Default::default(),
        history_requests: AtomicUsize::new(0),
        history_pages: Default::default(),
    });
    let service = Arc::new(MetaService::new(
        repo.clone(),
        remote.clone(),
        Arc::new(TestCipher),
        native.clone(),
        PublicConfiguration {
            whatsapp_developer_available: false,
            whatsapp_app_id: Some("123".into()),
            whatsapp_configuration_id: Some("123".into()),
            instagram_app_id: Some("456".into()),
            instagram_redirect_uri: Some("https://example.test/callback".into()),
            instagram_human_agent_approved: false,
            graph_version: "v26.0".into(),
        },
    ));
    let credentials = || {
        Some(WebhookCredentials {
            signature_secret: "fixture-signature-secret".into(),
            verify_token: "fixture-verify".into(),
        })
    };
    let state = MessagingRouterState {
        service: service.clone(),
        entity_access_service: native.access.clone(),
        authorization_state: MacroAuthorizationState::new(Arc::new(Authentication {
            owner: c.user_id.clone(),
            outsider,
        })),
        webhooks: Arc::new(WebhookConfiguration {
            whatsapp: credentials(),
            instagram: credentials(),
        }),
    };
    let app = router::router(state.clone()).merge(router::webhook_router(state));
    Fixture {
        app,
        service,
        repo,
        remote,
        c,
    }
}

async fn workflow(pool: PgPool, provider: Provider) {
    let Fixture {
        app,
        service,
        repo,
        remote,
        c,
    } = fixture(&pool, provider, None).await;
    let (status, begin) = request(
        &app,
        "POST",
        "/authorize",
        Some("owner"),
        json!({"provider":provider,"reconnect_id":c.id}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{begin}");
    let (status, complete) = request(
        &app,
        "POST",
        "/authorize/complete",
        Some("owner"),
        json!({"state":begin["state"],"browser_transaction":begin["browser_transaction"],"code":"fixture-code"}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{complete}");
    service.maintain().await.unwrap();
    let timestamp = connected_time(&repo, c.id).await;
    let inbound = match provider {
        Provider::Whatsapp => {
            json!({"object":"whatsapp_business_account","entry":[{"id":"fixture-waba","changes":[{"field":"messages","value":{"metadata":{"phone_number_id":c.account_id},"contacts":[{"wa_id":"customer","profile":{"name":"Customer"}}],"messages":[{"from":"customer","id":"fixture-inbound","timestamp":timestamp.timestamp().to_string(),"type":"text","text":{"body":"Customer text"}}]}}]}]})
        }
        Provider::Instagram => {
            json!({"object":"instagram","entry":[{"id":c.account_id,"messaging":[{"sender":{"id":"customer"},"recipient":{"id":c.account_id},"timestamp":timestamp.timestamp_millis(),"message":{"mid":"fixture-inbound","text":"Customer text"}}]}]})
        }
    };
    assert_eq!(
        signed(&app, provider, inbound.clone(), false).await,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        signed(&app, provider, inbound.clone(), true).await,
        StatusCode::OK
    );
    assert_eq!(signed(&app, provider, inbound, true).await, StatusCode::OK);
    drain(&service).await;
    let (channel, id) = repo.message_target(c.id, "fixture-inbound").await.unwrap();
    let original = PgMessageRepository::new(pool.clone())
        .get(&MessageParent::Channel(channel), id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(original.content, "Customer text");
    assert!(original.sender_id.as_user().is_none());
    let path = format!("/channels/{channel}/replies");
    let reply = json!({"idempotency_key":Uuid::now_v7(),"message":{"type":"text","text":"Deliberate customer reply"}});
    assert_eq!(
        request(&app, "POST", &path, Some("outsider"), reply.clone())
            .await
            .0,
        StatusCode::UNAUTHORIZED
    );
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(&path)
                .header("content-type", "application/json")
                .header(macro_authorization::USER_API_KEY_HEADER, "fixture-key")
                .body(Body::from(reply.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    let (status, intent) = request(&app, "POST", &path, Some("owner"), reply.clone()).await;
    assert_eq!(status, StatusCode::OK, "{intent}");
    let (_, duplicate) = request(&app, "POST", &path, Some("owner"), reply).await;
    assert_eq!(intent["id"], duplicate["id"]);
    let work = repo.claim_send().await.unwrap().unwrap();
    service.messaging.process_send(&work).await.unwrap();
    assert!(repo.claim_send().await.unwrap().is_none());
    assert_eq!(remote.sends.load(Ordering::SeqCst), 1);
    repo.record_status(
        c.id,
        &"fixture-accepted".to_owned().try_into().unwrap(),
        DeliveryState::Read,
        Utc::now(),
        None,
    )
    .await
    .unwrap();
    repo.record_status(
        c.id,
        &"fixture-accepted".to_owned().try_into().unwrap(),
        DeliveryState::Sent,
        Utc::now(),
        None,
    )
    .await
    .unwrap();
    let (status, view) = request(
        &app,
        "GET",
        &format!("/channels/{channel}"),
        Some("owner"),
        Value::Null,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(view["messaging"]["sends"][0]["state"], "read");
    let messaging = &view["messaging"];
    let expected_modes = match provider {
        Provider::Whatsapp => json!(["free_form", "approved_template"]),
        Provider::Instagram => json!(["free_form", "human_support"]),
    };
    assert_eq!(messaging["capabilities"]["modes"], expected_modes);
    assert_eq!(
        messaging["capabilities"]["text_limit"],
        messaging["text_limit"]
    );
    assert_eq!(messaging["capabilities"]["media"], messaging["media"]);
    assert_eq!(messaging["eligibility"]["modes"][0]["allowed"], true);
    assert!(messaging["eligibility"]["evaluated_at"].is_string());

    assert_eq!(
        view["messaging"]["conversation"]["customer_display_name"],
        "Customer"
    );
    let sent = repo.sends(channel).await.unwrap();
    let sent = PgMessageRepository::new(pool)
        .get(
            &MessageParent::Channel(channel),
            sent[0].message_id.unwrap(),
        )
        .await
        .unwrap()
        .unwrap();
    assert_eq!(sent.content, "Deliberate customer reply");
    let delivery_path = format!("/channels/{channel}/delivery");
    let (status, delivery) = request(
        &app,
        "POST",
        &delivery_path,
        Some("owner"),
        json!([sent.id, id]),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{delivery}");
    assert_eq!(delivery.as_array().unwrap().len(), 1);
    assert_eq!(delivery[0]["message_id"], sent.id.to_string());
    assert_eq!(delivery[0]["state"], "read");
    assert_eq!(
        request(
            &app,
            "POST",
            &delivery_path,
            Some("outsider"),
            json!([sent.id])
        )
        .await
        .0,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        request(
            &app,
            "POST",
            &delivery_path,
            Some("owner"),
            json!(vec![sent.id; 101])
        )
        .await
        .0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
}
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn whatsapp_http_connect_receive_reply_and_status(pool: PgPool) {
    workflow(pool, Provider::Whatsapp).await;
}
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn instagram_http_connect_receive_reply_and_status(pool: PgPool) {
    workflow(pool, Provider::Instagram).await;
}
