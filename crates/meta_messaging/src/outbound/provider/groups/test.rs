use super::*;
use crate::domain::groups::{ConversationKind, GroupStatus};
use axum::{
    Json, Router,
    body::Bytes,
    extract::State,
    http::{Method as HttpMethod, StatusCode, Uri},
    response::{IntoResponse, Response},
    routing::any,
};
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicU8, AtomicUsize, Ordering},
};

#[derive(Default)]
struct Scenario {
    mode: AtomicU8,
    creates: AtomicUsize,
    removed: Mutex<Vec<Value>>,
}

#[tokio::test]
async fn group_preflight_fails_closed_and_recovers_without_restarting() {
    async fn respond(State(mode): State<Arc<AtomicU8>>, method: HttpMethod, uri: Uri) -> Response {
        assert_eq!(
            method,
            HttpMethod::GET,
            "eligibility never mutates provider state"
        );
        let mode = mode.load(Ordering::SeqCst);
        let body = match uri.path() {
            "/v26.0/phone" => {
                json!({"id":"phone","status":if mode==3{"PENDING"}else{"CONNECTED"},"platform_type":if mode==4{"ON_PREMISE"}else{"CLOUD_API"},"is_on_biz_app":mode==2,"is_official_business_account":mode!=1})
            }
            "/v26.0/debug_token" => {
                json!({"data":{"is_valid":true,"app_id":"123","scopes":if mode==8{vec!["whatsapp_business_management"]}else{vec!["whatsapp_business_management","whatsapp_business_messaging"]}}})
            }
            "/v26.0/123/subscriptions" => {
                if mode == 9 {
                    return StatusCode::SERVICE_UNAVAILABLE.into_response();
                }
                let fields = [
                    "messages",
                    "group_lifecycle_update",
                    "group_participants_update",
                    "group_settings_update",
                    "group_status_update",
                ]
                .into_iter()
                .filter(|f| mode != 5 || *f != "group_status_update")
                .map(|name| json!({"name":name}))
                .collect::<Vec<_>>();
                json!({"data":[{"object":"whatsapp_business_account","fields":fields}]})
            }
            "/v26.0/waba/subscribed_apps" => {
                json!({"data":[{"whatsapp_business_api_data":{"id":if mode==6{"other-app"}else{"123"}}}]})
            }
            "/v26.0/phone/groups" => {
                if mode == 7 {
                    return (StatusCode::FORBIDDEN, Json(json!({"error":{"code":200}})))
                        .into_response();
                }
                assert_eq!(uri.query(), Some("limit=1"));
                json!({"data":[]})
            }
            _ => panic!("unexpected eligibility endpoint"),
        };
        Json(body).into_response()
    }
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let mode = Arc::new(AtomicU8::new(0));
    let app = Router::new()
        .fallback(any(respond))
        .with_state(mode.clone());
    let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let mut provider = HttpMetaProvider::new(
        "v26.0".into(),
        Some(WhatsappCredentials {
            app_id: "123".into(),
            app_secret: AccessToken::new("secret".into()).unwrap(),
        }),
        None,
    )
    .unwrap();
    provider.test_origin = Some(format!("http://{address}/").parse().unwrap());
    let c = super::super::test::connection(Provider::Whatsapp);
    let token = AccessToken::new("token".into()).unwrap();
    provider
        .require_group_eligibility(&c, &token)
        .await
        .unwrap();
    for failure in [1, 2, 3, 4, 5, 7, 9] {
        mode.store(failure, Ordering::SeqCst);
        assert!(
            provider
                .require_group_eligibility(&c, &token)
                .await
                .is_err(),
            "preflight mode {failure}"
        );
    }
    // Same provider instance recovers from missing subscriptions and transient I/O.
    mode.store(0, Ordering::SeqCst);
    provider
        .require_group_eligibility(&c, &token)
        .await
        .unwrap();
    server.abort();
}

#[tokio::test]
async fn group_http_requires_request_id_and_positive_delete_success_and_uses_bsuid_removal() {
    async fn respond(
        State(s): State<Arc<Scenario>>,
        method: HttpMethod,
        uri: Uri,
        body: Bytes,
    ) -> Response {
        let mode = s.mode.load(Ordering::SeqCst);
        if uri.path().ends_with("/phone/groups") {
            assert_eq!(method, HttpMethod::POST);
            s.creates.fetch_add(1, Ordering::SeqCst);
            let body: Value = serde_json::from_slice(&body).unwrap();
            assert_eq!(body["join_approval_mode"], "auto_approve");
            return match mode {
                0 => (StatusCode::OK, Json(json!({"request_id":"request-123"}))).into_response(),
                1 => (
                    StatusCode::BAD_REQUEST,
                    Json(json!({"error":{"code":131204}})),
                )
                    .into_response(),
                2 => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({}))).into_response(),
                _ => (StatusCode::OK, Json(json!({"id":"not-correlation"}))).into_response(),
            };
        }
        if uri.path().ends_with("/participants") {
            assert_eq!(method, HttpMethod::DELETE);
            s.removed
                .lock()
                .unwrap()
                .push(serde_json::from_slice(&body).unwrap());
            return Json(json!({"request_id":"remove-123"})).into_response();
        }
        assert_eq!(uri.path(), "/v26.0/opaque-group");
        assert_eq!(method, HttpMethod::DELETE);
        match mode {
            0 => Json(json!({"success":true})).into_response(),
            1 => Json(json!({"success":false})).into_response(),
            2 => Json(json!({})).into_response(),
            3 => (
                StatusCode::NOT_FOUND,
                Json(json!({"error":{"code":131041}})),
            )
                .into_response(),
            4 => (StatusCode::REQUEST_TIMEOUT, Json(json!({}))).into_response(),
            _ => (StatusCode::FORBIDDEN, Json(json!({"error":{"code":200}}))).into_response(),
        }
    }
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let state = Arc::new(Scenario::default());
    let app = Router::new()
        .fallback(any(respond))
        .with_state(state.clone());
    let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let mut provider = HttpMetaProvider::new("v26.0".into(), None, None).unwrap();
    provider.test_origin = Some(format!("http://{address}/").parse().unwrap());
    let c = super::super::test::connection(Provider::Whatsapp);
    let token = AccessToken::new("fixture-token".into()).unwrap();
    let group: ProviderId = "opaque-group".to_owned().try_into().unwrap();
    assert!(
        matches!(provider.create_group(&c,&token,"subject").await,GroupCreateResult::Pending(id) if id.as_str()=="request-123")
    );
    state.mode.store(1, Ordering::SeqCst);
    assert!(matches!(
        provider.create_group(&c, &token, "subject").await,
        GroupCreateResult::Rejected(_)
    ));
    for mode in [2, 3] {
        state.mode.store(mode, Ordering::SeqCst);
        assert!(matches!(
            provider.create_group(&c, &token, "subject").await,
            GroupCreateResult::Unknown
        ));
    }
    assert_eq!(
        state.creates.load(Ordering::SeqCst),
        4,
        "unknown outcomes never retry automatically"
    );
    state.mode.store(0, Ordering::SeqCst);
    provider.delete_group(&c, &token, &group).await.unwrap();
    for mode in 1..=5 {
        state.mode.store(mode, Ordering::SeqCst);
        assert!(
            provider.delete_group(&c, &token, &group).await.is_err(),
            "only success:true confirms deletion"
        );
    }
    provider
        .remove_group_participant(&c, &token, &group, &"US.A".to_owned().try_into().unwrap())
        .await
        .unwrap();
    assert_eq!(
        state.removed.lock().unwrap()[0],
        json!({"messaging_product":"whatsapp","participants":[{"user_id":"US.A"}]})
    );
    let conversation = Conversation {
        kind: ConversationKind::Group,
        group_status: Some(GroupStatus::Active),
        channel_id: uuid::Uuid::now_v7(),
        connection_id: c.id,
        customer_id: group,
        customer_phone: None,
        customer_handle: None,
        customer_display_name: None,
        last_customer_message_at: Some(Utc::now()),
    };
    let request = SendReply {
        idempotency_key: uuid::Uuid::now_v7(),
        message: ReplyContent::Text {
            text: "Hello group".into(),
        },
        reply_to: None,
        human_support: false,
    };
    let prepared = provider
        .prepare_reply(&c, &token, &conversation, &request, None)
        .await
        .unwrap();
    assert_eq!(prepared.provider_document["recipient_type"], "group");
    assert_eq!(prepared.provider_document["to"], "opaque-group");
    assert!(prepared.provider_document.get("recipient").is_none());
    server.abort();
}
