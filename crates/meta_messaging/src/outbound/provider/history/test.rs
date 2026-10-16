use super::*;
use crate::outbound::provider::test::connection;

#[test]
fn original_participants_timestamps_media_and_cursors_are_preserved() {
    let c = connection(Provider::Instagram);
    let page = json!({"data":[{"id":"thread","messages":{"data":[
        {"id":"outgoing","created_time":"2026-10-01T12:01:00+0000","from":{"id":c.account_id},"to":{"data":[{"id":"customer","username":"old_name"}]},"message":"reply"},
        {"id":"incoming","created_time":"2026-10-01T12:00:00+0000","from":{"id":"customer","username":"old_name"},"to":{"data":[{"id":c.account_id}]},"message":"hello","attachments":{"data":[{"image_data":{"url":"https://lookaside.fbsbx.com/test"}}]}},
        {"id":"deleted","created_time":"2026-10-01T11:00:00+0000","from":null,"to":null}
    ]}}],"paging":{"cursors":{"after":"cursor-two"},"next":"https://evil.invalid/never-follow"}});
    let parsed = decode_page(&c, &page).unwrap();
    assert_eq!(parsed.next.as_deref(), Some("cursor-two"));
    assert_eq!(parsed.messages.len(), 2);
    let m = &parsed.messages[0];
    assert_eq!(m.message_id.as_str(), "incoming");
    assert_eq!(m.customer_id.as_str(), "customer");
    assert_eq!(m.direction, Direction::Inbound);
    assert_eq!(m.provenance, Provenance::OnboardingHistory);
    assert_eq!(m.media.len(), 1);
    assert_eq!(parsed.messages[1].direction, Direction::Outbound);
    assert_eq!(parsed.messages[1].customer_id, m.customer_id);
    let mut wrong = page.clone();
    wrong["data"][0]["messages"]["data"][0]["from"]["id"] = json!("another-business");
    assert!(decode_page(&c, &wrong).is_err());
}
#[test]
fn unavailable_content_is_explicit_and_malformed_pagination_fails() {
    let c = connection(Provider::Instagram);
    let m = json!({"id":"unsupported","created_time":"2026-10-01T12:00:00Z","from":{"id":"customer"},"to":{"data":[{"id":c.account_id}]},"attachments":{"data":[{"type":"share"}]}});
    let parsed = decode_message(&c, &m).unwrap();
    assert!(parsed.content.contains("not provided by Instagram"));
    let page = json!({"data":[],"paging":{"next":"https://example.test"}});
    assert!(decode_page(&c, &page).is_err());
}

#[tokio::test]
async fn official_history_requests_are_bounded_and_do_not_follow_next_urls() {
    use axum::{Json, Router, body::Bytes, extract::State, http::Uri, routing::any};
    use std::sync::{Arc, Mutex};
    let seen = Arc::new(Mutex::new(Vec::<String>::new()));
    async fn respond(
        State(seen): State<Arc<Mutex<Vec<String>>>>,
        uri: Uri,
        body: Bytes,
    ) -> Json<Value> {
        seen.lock().unwrap().push(uri.to_string());
        if uri.path().ends_with("/smb_app_data") {
            let data: Value = serde_json::from_slice(&body).unwrap();
            assert_eq!(data["messaging_product"], "whatsapp");
            assert!(matches!(
                data["sync_type"].as_str(),
                Some("history" | "smb_app_state_sync")
            ));
            Json(json!({"request_id":"provider-request"}))
        } else {
            let query: std::collections::HashMap<String, String> =
                url::form_urlencoded::parse(uri.query().unwrap().as_bytes())
                    .into_owned()
                    .collect();
            assert_eq!(query["limit"], "1");
            assert_eq!(query["platform"], "instagram");
            assert!(query["fields"].contains("messages.limit(20)"));
            assert_eq!(query["after"], "opaque+cursor");
            Json(
                json!({"data":[],"paging":{"next":"https://untrusted.invalid/?access_token=never-used","cursors":{"after":"next-cursor"}}}),
            )
        }
    }
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let origin = Url::parse(&format!("http://{}/", listener.local_addr().unwrap())).unwrap();
    let app = Router::new()
        .fallback(any(respond))
        .with_state(seen.clone());
    let task = tokio::spawn(async { axum::serve(listener, app).await.unwrap() });
    let mut provider = HttpMetaProvider::new("v26.0".into(), None, None).unwrap();
    provider.test_origin = Some(origin);
    let token = AccessToken::new("fixture-token".into()).unwrap();
    assert_eq!(
        provider
            .request_whatsapp_history(&connection(Provider::Whatsapp), &token, true)
            .await
            .unwrap(),
        "provider-request"
    );
    assert_eq!(
        provider
            .request_whatsapp_history(&connection(Provider::Whatsapp), &token, false)
            .await
            .unwrap(),
        "provider-request"
    );
    assert_eq!(
        provider
            .instagram_history(
                &connection(Provider::Instagram),
                &token,
                Some("opaque+cursor")
            )
            .await
            .unwrap()
            .next
            .as_deref(),
        Some("next-cursor")
    );
    assert_eq!(seen.lock().unwrap().len(), 3);
    task.abort();
}
