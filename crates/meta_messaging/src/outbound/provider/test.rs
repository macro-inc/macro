use super::*;
use axum::{
    Json, Router,
    body::Bytes,
    extract::State,
    http::{HeaderMap, StatusCode, Uri},
    response::{IntoResponse, Response},
    routing::any,
};
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, AtomicU16, AtomicU32, Ordering},
};
use uuid::Uuid;

#[derive(Default)]
struct Scenario {
    coexistence: AtomicBool,
    status: AtomicU16,
    registered: AtomicBool,
    registration_error: AtomicU32,
    registration_http: AtomicU16,
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
    ) -> Response {
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
                json!({"data":[{"id":"phone","display_phone_number":"+15550000001","is_on_biz_app":s.coexistence.load(Ordering::SeqCst),"platform_type":"CLOUD_API","status":if s.registered.load(Ordering::SeqCst) {"CONNECTED"}else{"PENDING"}}]})
            }
            "/v26.0/phone" => {
                json!({"id":"phone","is_on_biz_app":s.coexistence.load(Ordering::SeqCst),"platform_type":"CLOUD_API","status":if s.registered.load(Ordering::SeqCst) {"CONNECTED"}else{"PENDING"}})
            }
            "/v26.0/phone/register" => {
                let status = s.registration_http.load(Ordering::SeqCst);
                if status != 0 {
                    return (StatusCode::from_u16(status).unwrap(), "non-JSON response")
                        .into_response();
                }
                let request: Value = serde_json::from_slice(&body).unwrap();
                assert_eq!(
                    request,
                    json!({"messaging_product":"whatsapp","pin":"123456"})
                );
                let code = s.registration_error.load(Ordering::SeqCst);
                if code != 0 {
                    return (
                        StatusCode::BAD_REQUEST,
                        Json(json!({"error":{"code":code}})),
                    )
                        .into_response();
                }
                s.registered.store(true, Ordering::SeqCst);
                json!({"success":true})
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
                    )
                        .into_response();
                }
                if data["messaging_product"] == "whatsapp" {
                    json!({"messages":[{"id":"accepted-wa"}]})
                } else {
                    json!({"message_id":"accepted-ig"})
                }
            }
            _ => {
                return (StatusCode::NOT_FOUND, Json(json!({"error":{"code":100}})))
                    .into_response();
            }
        };
        (StatusCode::OK, Json(data)).into_response()
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
        whatsapp_mode: None,
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
        whatsapp_mode: None,
        registration_status: None,
        registration_attempted_at: None,
        developer_account: false,

        health_error: None,
    }
}
fn conversation(c: &Connection, customer: &str) -> Conversation {
    Conversation {
        kind: crate::domain::groups::ConversationKind::Direct,
        group_status: None,
        channel_id: Uuid::now_v7(),
        connection_id: c.id,
        customer_id: customer.to_owned().try_into().unwrap(),
        customer_display_name: None,
        customer_phone: None,
        customer_handle: None,
        last_customer_message_at: Some(Utc::now()),
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
async fn production_signup_verifies_the_selected_mode_and_preserves_the_developer_path() {
    let server = server().await;
    let client = client(&server);
    let input = CompleteAuthorization {
        browser_transaction: None,
        state: "fixture".into(),
        code: "fixture-code".into(),
        business_account_id: Some("waba".to_owned().try_into().unwrap()),
        phone_number_id: Some("phone".to_owned().try_into().unwrap()),
        whatsapp_mode: None,
    };
    let rejected = client
        .authorize(Provider::Whatsapp, &input)
        .await
        .err()
        .unwrap();
    assert!(matches!(
        rejected.current_context(),
        MessagingError::WhatsappModeMismatch
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
            .prepare_reply(&c, &token, &conversation(&c, "15551234567"), &text(), None)
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
            assert_eq!(captured["to"], "15551234567");
            assert_eq!(captured["text"]["body"], "Deliberate reply");
        } else {
            assert_eq!(captured["recipient"]["id"], "15551234567");
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
        .prepare_reply(&c, &token, &conversation(&c, "15551234567"), &request, None)
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

#[tokio::test]
async fn platform_signup_verifies_mode_and_registration_uses_only_the_documented_pin_request() {
    let server = server().await;
    let client = client(&server);
    let input = CompleteAuthorization {
        state: "fixture".into(),
        browser_transaction: None,
        code: "fixture".into(),
        business_account_id: Some("waba".to_owned().try_into().unwrap()),
        phone_number_id: Some("phone".to_owned().try_into().unwrap()),
        whatsapp_mode: Some(WhatsappMode::Platform),
    };
    let account = client.authorize(Provider::Whatsapp, &input).await.unwrap();
    assert_eq!(account.whatsapp_mode, Some(WhatsappMode::Platform));
    assert_eq!(
        account.registration_status,
        Some(RegistrationStatus::Unavailable)
    );
    let mut c = connection(Provider::Whatsapp);
    c.whatsapp_mode = Some(WhatsappMode::Platform);
    let pin = RegistrationPin::try_from("123456".to_owned()).unwrap();
    assert_eq!(
        client.phone_registration(&c, &account.token).await.unwrap(),
        PhoneRegistration::Unavailable
    );
    for (code, expected) in [
        (133005, "registration_pin_incorrect"),
        (133006, "registration_pin_attempts_exceeded"),
        (133016, "registration_rate_limited"),
    ] {
        server
            .state
            .registration_error
            .store(code, Ordering::SeqCst);
        let RegistrationResult::Rejected(reason) =
            client.register_whatsapp(&c, &account.token, &pin).await
        else {
            panic!("expected rejection")
        };
        assert_eq!(reason.code(), expected);
    }
    server.state.registration_error.store(0, Ordering::SeqCst);
    assert!(matches!(
        client.register_whatsapp(&c, &account.token, &pin).await,
        RegistrationResult::Accepted
    ));
    assert_eq!(
        client.phone_registration(&c, &account.token).await.unwrap(),
        PhoneRegistration::Registered
    );
    server.state.coexistence.store(true, Ordering::SeqCst);
    assert!(client.authorize(Provider::Whatsapp, &input).await.is_err());
    assert!(client.phone_registration(&c, &account.token).await.is_err());
    assert!(RegistrationPin::try_from("12 456".to_owned()).is_err());
}

#[tokio::test]
async fn bsuid_and_phone_destinations_are_distinct_and_both_require_the_developer_allowlist() {
    let server = server().await;
    let client = client(&server)
        .with_developer_account(WhatsappDeveloperAccount {
            business_account_id: "waba".to_owned().try_into().unwrap(),
            phone_number_id: "phone".to_owned().try_into().unwrap(),
            token: AccessToken::new("fixture".into()).unwrap(),
            recipients: vec![
                "US.A".to_owned().try_into().unwrap(),
                "15550000001".to_owned().try_into().unwrap(),
            ],
        })
        .unwrap();
    let mut c = connection(Provider::Whatsapp);
    c.developer_account = true;
    let token = AccessToken::new("fixture".into()).unwrap();
    let mut conversation = conversation(&c, "US.A");
    let prepared = client
        .prepare_reply(&c, &token, &conversation, &text(), None)
        .await
        .unwrap();
    assert_eq!(prepared.provider_document["recipient"], "US.A");
    assert!(prepared.provider_document.get("to").is_none());
    conversation.customer_phone = Some("+15550000001".into());
    c.developer_account = false;
    let prepared = client
        .prepare_reply(&c, &token, &conversation, &text(), None)
        .await
        .unwrap();
    assert_eq!(prepared.provider_document["recipient"], "US.A");
    assert!(prepared.provider_document.get("to").is_none());
    conversation.customer_phone = Some(String::new());
    for developer in [false, true] {
        c.developer_account = developer;
        let prepared = client
            .prepare_reply(&c, &token, &conversation, &text(), None)
            .await
            .unwrap();
        assert_eq!(prepared.provider_document["recipient"], "US.A");
        assert!(prepared.provider_document.get("to").is_none());
    }
    conversation.customer_phone = Some("+15550000001".into());
    c.developer_account = true;
    let prepared = client
        .prepare_reply(&c, &token, &conversation, &text(), None)
        .await
        .unwrap();
    assert_eq!(prepared.provider_document["to"], "15550000001");
    assert!(prepared.provider_document.get("recipient").is_none());
    conversation.customer_id = "15550000001".to_owned().try_into().unwrap();
    let prepared = client
        .prepare_reply(&c, &token, &conversation, &text(), None)
        .await
        .unwrap();
    assert_eq!(prepared.provider_document["to"], "15550000001");
    conversation.customer_phone = Some("15550000002".into());
    assert!(
        client
            .prepare_reply(&c, &token, &conversation, &text(), None)
            .await
            .is_err()
    );
    // Authorizing a phone permits only that phone, not a different BSUID.
    conversation.customer_phone = Some("15550000001".into());
    conversation.customer_id = "US.OTHER".to_owned().try_into().unwrap();
    let prepared = client
        .prepare_reply(&c, &token, &conversation, &text(), None)
        .await
        .unwrap();
    assert_eq!(prepared.provider_document["to"], "15550000001");
    assert!(prepared.provider_document.get("recipient").is_none());
    conversation.customer_phone = Some("15550000002".into());
    assert!(
        client
            .prepare_reply(&c, &token, &conversation, &text(), None)
            .await
            .is_err()
    );
    conversation.customer_phone = None;
    assert!(
        client
            .prepare_reply(&c, &token, &conversation, &text(), None)
            .await
            .is_err()
    );
    conversation.customer_phone = Some("15550000001".into());
    c.account_id = "different-sender".to_owned().try_into().unwrap();
    assert!(
        client
            .prepare_reply(&c, &token, &conversation, &text(), None)
            .await
            .is_err()
    );
}

#[test]
fn invalid_pin_types_never_echo_secret_values_in_deserialization_errors() {
    let error = serde_json::from_str::<RegistrationPin>("123456")
        .err()
        .unwrap();
    assert!(!error.to_string().contains("123456"));
}

#[tokio::test]
async fn registration_http_rejection_does_not_depend_on_json_but_uncertainty_is_preserved() {
    let server = server().await;
    let client = client(&server);
    let c = connection(Provider::Whatsapp);
    let token = AccessToken::new("fixture".into()).unwrap();
    let pin = RegistrationPin::try_from("123456".to_owned()).unwrap();
    for status in [400, 401, 403] {
        server
            .state
            .registration_http
            .store(status, Ordering::SeqCst);
        assert!(matches!(
            client.register_whatsapp(&c, &token, &pin).await,
            RegistrationResult::Rejected(_)
        ));
    }
    for status in [200, 408, 503] {
        server
            .state
            .registration_http
            .store(status, Ordering::SeqCst);
        assert!(matches!(
            client.register_whatsapp(&c, &token, &pin).await,
            RegistrationResult::Unknown
        ));
    }
    for status in ["FLAGGED", "RESTRICTED", "UNKNOWN_FUTURE_STATUS"] {
        assert_eq!(
            registration::phone_registration(&json!({"status":status,"platform_type":"CLOUD_API"}))
                .unwrap(),
            PhoneRegistration::Unavailable
        );
    }
}
