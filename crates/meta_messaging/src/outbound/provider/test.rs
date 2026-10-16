use super::*;
use axum::{
    Json, Router,
    body::Bytes,
    extract::State,
    http::{HeaderMap, StatusCode, Uri},
    routing::any,
};
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, AtomicU16, Ordering},
};
use uuid::Uuid;

#[derive(Default)]
struct Scenario {
    coexistence: AtomicBool,
    status: AtomicU16,
    messages: Mutex<Vec<Value>>,
    instagram_permissions_array: AtomicBool,
    instagram_missing_messaging: AtomicBool,
}
struct Server {
    url: Url,
    state: Arc<Scenario>,
    task: tokio::task::JoinHandle<()>,
}
impl Drop for Server {
    fn drop(&mut self) {
        self.task.abort();
    }
}
async fn server() -> Server {
    async fn respond(
        State(s): State<Arc<Scenario>>,
        uri: Uri,
        headers: HeaderMap,
        body: Bytes,
    ) -> (StatusCode, Json<Value>) {
        assert_eq!(headers["user-agent"], "MacroMessaging/1.0");
        let path = uri.path();
        let data = match path {
            "/oauth/access_token" => {
                let fields: std::collections::HashMap<String, String> =
                    url::form_urlencoded::parse(&body).into_owned().collect();
                assert_eq!(fields["client_id"], "456");
                assert_eq!(fields["grant_type"], "authorization_code");
                assert_eq!(fields["redirect_uri"], "https://macro.example/callback");
                let mut scopes = vec!["instagram_business_basic"];
                if !s.instagram_missing_messaging.load(Ordering::SeqCst) {
                    scopes.push("instagram_business_manage_messages");
                }
                let permissions = if s.instagram_permissions_array.load(Ordering::SeqCst) {
                    json!(scopes)
                } else {
                    json!(scopes.join(","))
                };
                json!({"data":[{"access_token":"short-fixture", "user_id":"app-scoped", "permissions":permissions}]})
            }
            "/access_token" => json!({"access_token":"long-fixture", "expires_in":5184000}),
            "/v26.0/me" => {
                json!({"data":[{"user_id":"professional-id", "username":"test-business"}]})
            }
            "/v26.0/professional-id/subscribed_apps" => {
                let data: Value = serde_json::from_slice(&body).unwrap();
                assert_eq!(
                    data["subscribed_fields"],
                    "messages,messaging_seen,messaging_postbacks,message_reactions,messaging_referral"
                );
                json!({"success":true})
            }
            "/v26.0/oauth/access_token" => json!({"access_token":"fixture-grant"}),
            "/v26.0/debug_token" => {
                json!({"data":{"is_valid":true,"app_id":"123","scopes":["whatsapp_business_management","whatsapp_business_messaging"],"expires_at":0}})
            }
            "/v26.0/waba/phone_numbers" => {
                json!({"data":[{"id":"phone","display_phone_number":"+15550000001","is_on_biz_app":s.coexistence.load(Ordering::SeqCst),"platform_type":"CLOUD_API"}]})
            }
            "/v26.0/waba/message_templates" => {
                json!({"data":[{"id":"approved","name":"order_update","language":"en_US","status":"APPROVED","components":[{"type":"BODY","text":"Hi {{first_name}}"}]}]})
            }
            "/v26.0/phone/messages" => {
                let data: Value = serde_json::from_slice(&body).unwrap();
                s.messages.lock().unwrap().push(data.clone());
                let status = s.status.load(Ordering::SeqCst);
                if status != 0 {
                    return (
                        StatusCode::from_u16(status).unwrap(),
                        Json(json!({"error":{"code":if status==429 {130429}else{2}}})),
                    );
                }
                if data["messaging_product"] == "whatsapp" {
                    json!({"messages":[{"id":"accepted-wa"}]})
                } else {
                    json!({"message_id":"accepted-ig"})
                }
            }
            _ => return (StatusCode::NOT_FOUND, Json(json!({"error":{"code":100}}))),
        };
        (StatusCode::OK, Json(data))
    }
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = Url::parse(&format!("http://{}/", listener.local_addr().unwrap())).unwrap();
    let state = Arc::new(Scenario::default());
    let app = Router::new()
        .fallback(any(respond))
        .with_state(state.clone());
    let task = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    Server { url, state, task }
}
fn client(server: &Server) -> HttpMetaProvider {
    let mut client = HttpMetaProvider::new(
        "v26.0".into(),
        Some(WhatsappCredentials {
            app_id: "123".into(),
            app_secret: AccessToken::new("fixture-secret".into()).unwrap(),
        }),
        Some(InstagramCredentials {
            app_id: "456".into(),
            app_secret: AccessToken::new("instagram-fixture-secret".into()).unwrap(),
            redirect_uri: "https://macro.example/callback".into(),
        }),
    )
    .unwrap();
    client.test_origin = Some(server.url.clone());
    client
}

#[tokio::test]
async fn instagram_oauth_exchanges_tokens_and_requires_both_scopes() {
    let server = server().await;
    let client = client(&server);
    let input = CompleteAuthorization {
        browser_transaction: None,
        state: "fixture".into(),
        code: "fixture-code".into(),
        business_account_id: None,
        phone_number_id: None,
    };
    for array in [false, true] {
        server
            .state
            .instagram_permissions_array
            .store(array, Ordering::SeqCst);
        let account = client.authorize(Provider::Instagram, &input).await.unwrap();
        assert_eq!(account.account_id.as_str(), "professional-id");
        assert_eq!(account.display_name, "test-business");
        assert_eq!(account.token.expose(), "long-fixture");
        assert!(account.expires_at.unwrap() > Utc::now() + chrono::Duration::days(59));
        let mut connected = connection(Provider::Instagram);
        connected.account_id = account.account_id;
        connected.business_account_id = None;
        client.subscribe(&connected, &account.token).await.unwrap();
        server
            .state
            .instagram_missing_messaging
            .store(true, Ordering::SeqCst);
        assert!(client.authorize(Provider::Instagram, &input).await.is_err());
        server
            .state
            .instagram_missing_messaging
            .store(false, Ordering::SeqCst);
    }
}

#[test]
fn instagram_profile_rejects_ambiguous_accounts_and_accepts_direct_object() {
    assert!(single_account_response(&json!({"data":[]})).is_err());
    assert!(single_account_response(&json!({"data":[{},{}]})).is_err());
    let direct = json!({"user_id":"professional-id", "username":"test"});
    assert_eq!(single_account_response(&direct).unwrap(), &direct);
}

#[test]
fn gateway_pages_and_throttling_are_temporary_not_rejections() {
    use reqwest::StatusCode as S;
    let error = |code: i64| json!({"error":{"code":code}});
    assert_eq!(rejection(S::BAD_GATEWAY, None), MessagingError::Unavailable);
    assert_eq!(
        rejection(S::SERVICE_UNAVAILABLE, None),
        MessagingError::Unavailable
    );
    assert_eq!(
        rejection(S::BAD_REQUEST, Some(&error(80007))),
        MessagingError::Unavailable
    );
    assert_eq!(
        rejection(S::BAD_REQUEST, Some(&error(100))),
        MessagingError::ProviderRejected
    );
    assert_eq!(rejection(S::OK, None), MessagingError::ProviderRejected);
    assert_eq!(
        rejection(S::UNAUTHORIZED, Some(&error(190))),
        MessagingError::Disconnected
    );
}
pub(super) fn connection(provider: Provider) -> Connection {
    Connection {
        id: Uuid::now_v7(),
        team_id: Uuid::now_v7(),
        user_id: "macro|fixture@example.test".into(),
        provider,
        account_id: "phone".to_owned().try_into().unwrap(),
        business_account_id: Some("waba".to_owned().try_into().unwrap()),
        display_name: "Fixture business".into(),
        status: ConnectionStatus::Connected,
        connected_at: Some(Utc::now()),
        credential_expires_at: None,
        human_agent_approved: false,
        developer_account: false,
        history_status: HistoryStatus::NotRequested,
        history_progress: None,
        health_error: None,
    }
}
fn conversation(c: &Connection, customer: &str) -> Conversation {
    Conversation {
        channel_id: Uuid::now_v7(),
        connection_id: c.id,
        customer_id: customer.to_owned().try_into().unwrap(),
        customer_display_name: None,
        customer_phone: None,
        customer_handle: None,
        last_customer_message_at: Some(Utc::now()),
        standard_window_until: Some(Utc::now() + chrono::Duration::hours(24)),
    }
}
fn text() -> SendReply {
    SendReply {
        idempotency_key: Uuid::now_v7(),
        message: ReplyContent::Text {
            text: "Deliberate reply".into(),
        },
        reply_to: None,
        human_support: false,
    }
}

#[tokio::test]
async fn production_requires_coexistence_but_explicit_test_number_does_not() {
    let server = server().await;
    let client = client(&server);
    let input = CompleteAuthorization {
        browser_transaction: None,
        state: "fixture".into(),
        code: "fixture-code".into(),
        business_account_id: Some("waba".to_owned().try_into().unwrap()),
        phone_number_id: Some("phone".to_owned().try_into().unwrap()),
    };
    let rejected = client
        .authorize(Provider::Whatsapp, &input)
        .await
        .err()
        .unwrap();
    assert!(matches!(
        rejected.current_context(),
        MessagingError::Invalid(_)
    ));
    let client = client
        .with_developer_account(WhatsappDeveloperAccount {
            business_account_id: "waba".to_owned().try_into().unwrap(),
            phone_number_id: "phone".to_owned().try_into().unwrap(),
            token: AccessToken::new("fixture-token".into()).unwrap(),
            recipients: vec!["allowed".to_owned().try_into().unwrap()],
        })
        .unwrap();
    assert!(client.developer_account().await.unwrap().developer_account);
    // The developer path does not change production authorization eligibility.
    assert!(client.authorize(Provider::Whatsapp, &input).await.is_err());
    server.state.coexistence.store(true, Ordering::SeqCst);
    assert!(
        !client
            .authorize(Provider::Whatsapp, &input)
            .await
            .unwrap()
            .developer_account
    );
    let mut c = connection(Provider::Whatsapp);
    c.developer_account = true;
    let token = AccessToken::new("fixture-token".into()).unwrap();
    assert!(
        client
            .prepare_reply(&c, &token, &conversation(&c, "unapproved"), &text(), None)
            .await
            .is_err()
    );
    assert!(server.state.messages.lock().unwrap().is_empty());
}

#[tokio::test]
async fn both_transports_send_the_prepared_text_and_classify_uncertain_outcomes() {
    let server = server().await;
    let client = client(&server);
    let token = AccessToken::new("fixture-token".into()).unwrap();
    for provider in [Provider::Whatsapp, Provider::Instagram] {
        let c = connection(provider);
        let prepared = client
            .prepare_reply(&c, &token, &conversation(&c, "customer"), &text(), None)
            .await
            .unwrap();
        assert_eq!(prepared.rendered_text, "Deliberate reply");
        assert!(matches!(
            client.send(&c, &token, &prepared).await,
            ProviderSendResult::Accepted(_)
        ));
        let captured = server
            .state
            .messages
            .lock()
            .unwrap()
            .last()
            .cloned()
            .unwrap();
        if provider == Provider::Whatsapp {
            assert_eq!(captured["to"], "customer");
            assert_eq!(captured["text"]["body"], "Deliberate reply");
        } else {
            assert_eq!(captured["recipient"]["id"], "customer");
            assert_eq!(captured["message"]["text"], "Deliberate reply");
        }
        server.state.status.store(429, Ordering::SeqCst);
        assert!(matches!(
            client.send(&c, &token, &prepared).await,
            ProviderSendResult::RetryAfter(_)
        ));
        server.state.status.store(500, Ordering::SeqCst);
        assert!(matches!(
            client.send(&c, &token, &prepared).await,
            ProviderSendResult::Unknown
        ));
        server.state.status.store(0, Ordering::SeqCst);
    }
}

#[tokio::test]
async fn approved_named_template_uses_verified_account_and_exact_rendered_text() {
    let server = server().await;
    let client = client(&server);
    let c = connection(Provider::Whatsapp);
    let token = AccessToken::new("fixture-token".into()).unwrap();
    let mut request = text();
    request.message = ReplyContent::Template {
        template_id: "approved".to_owned().try_into().unwrap(),
        language: "en_US".into(),
        parameters: vec!["Sam".into()],
    };
    let prepared = client
        .prepare_reply(&c, &token, &conversation(&c, "customer"), &request, None)
        .await
        .unwrap();
    assert_eq!(prepared.rendered_text, "Hi Sam");
    assert!(matches!(
        client.send(&c, &token, &prepared).await,
        ProviderSendResult::Accepted(_)
    ));
    let body = server.state.messages.lock().unwrap()[0].clone();
    assert_eq!(body["template"]["name"], "order_update");
    assert_eq!(
        body["template"]["components"][0]["parameters"][0],
        json!({"type":"text","parameter_name":"first_name","text":"Sam"})
    );
}
