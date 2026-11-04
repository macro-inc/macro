use super::*;
use wiremock::{
    Mock, MockServer, ResponseTemplate,
    matchers::{body_json, header, method, path, query_param},
};
use zeroize::Zeroizing;

fn token() -> AccessToken {
    AccessToken(Zeroizing::new("token".into()))
}

#[tokio::test]
async fn the_subscription_targets_only_the_connected_user() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/subscriptions/call"))
        .and(header("authorization", "Bearer token"))
        .and(body_json(json!({
            "endpoint_id": 11,
            "call_states": ["hangup", "call_transcription", "recap_summary", "recap_action_items"],
            "enabled": true,
            "target_type": "user",
            "target_id": 22,
        })))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"id": "33"})))
        .expect(1)
        .mount(&server)
        .await;
    let api = DialpadApi::new(server.uri()).unwrap();
    let id = api
        .subscribe(&token(), DialpadId(11), DialpadId(22))
        .await
        .unwrap();
    assert_eq!(id, DialpadId(33));
}

#[tokio::test]
async fn missing_transcripts_and_unavailable_recaps_are_absent_not_errors() {
    let server = MockServer::start().await;
    for (call, status) in [(7, 404), (6, 403), (8, 429), (9, 401)] {
        Mock::given(method("GET"))
            .and(path(format!("/transcripts/{call}")))
            .respond_with(ResponseTemplate::new(status))
            .mount(&server)
            .await;
    }
    Mock::given(method("GET"))
        .and(path("/call/7/ai_recap"))
        .respond_with(ResponseTemplate::new(403))
        .mount(&server)
        .await;
    let api = DialpadApi::new(server.uri()).unwrap();
    for call in [7, 6] {
        assert!(
            api.transcript(&token(), DialpadId(call))
                .await
                .unwrap()
                .is_none(),
            "no transcript, or transcripts are off for the company"
        );
    }
    assert!(api.recap(&token(), DialpadId(7)).await.unwrap().is_none());
    assert!(
        matches!(
            api.transcript(&token(), DialpadId(8)).await,
            Err(TranscriptError::Unavailable(_))
        ),
        "a rate limit imports without the transcript"
    );
    assert!(
        matches!(
            api.transcript(&token(), DialpadId(9)).await,
            Err(TranscriptError::Unauthorized)
        ),
        "a rejected token waits for a reconnect"
    );
}

#[tokio::test]
async fn past_calls_are_listed_for_the_user_not_the_company() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/call"))
        .and(query_param("target_type", "user"))
        .and(query_param("target_id", "22"))
        .and(query_param("started_after", "1746469000000"))
        .and(query_param("cursor", "page-2"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "items": [
                {"call_id": 1, "state": "missed", "date_started": 1_746_469_000_000_i64},
                {
                    "call_id": "2", "state": "hangup",
                    // Dialpad's call list sends its dates as strings.
                    "date_started": "1746469100000", "date_connected": "1746469110000",
                    "date_ended": "1746469170000",
                },
            ],
            "cursor": ""
        })))
        .mount(&server)
        .await;
    let api = DialpadApi::new(server.uri()).unwrap();
    let since = DateTime::from_timestamp_millis(1_746_469_000_000).unwrap();
    let page = api
        .calls(&token(), DialpadId(22), since, Some("page-2"))
        .await
        .unwrap();
    let ids: Vec<i64> = page.calls.iter().map(|call| call.call_id.0).collect();
    assert_eq!(ids, vec![1, 2]);
    assert_eq!(page.calls[0].state, CallState::Other);
    assert_eq!(page.calls[0].date_started, Some(1_746_469_000_000));
    assert_eq!(page.calls[1].date_connected, Some(1_746_469_110_000));
    assert_eq!(
        page.calls[1].occurred_at(),
        DateTime::from_timestamp_millis(1_746_469_170_000)
    );
    assert!(page.cursor.is_none(), "an empty cursor ends the listing");
}

#[tokio::test]
async fn an_unreadable_past_call_is_skipped_not_the_page() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/call"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "items": [
                {"call_id": 1, "state": "hangup"},
                {"call_id": 2, "state": "hangup", "target": "not an object"},
                {"call_id": 3, "state": "hangup"},
            ],
            "cursor": "page-2"
        })))
        .mount(&server)
        .await;
    let api = DialpadApi::new(server.uri()).unwrap();
    let page = api
        .calls(&token(), DialpadId(22), Utc::now(), None)
        .await
        .unwrap();
    let ids: Vec<DialpadId> = page.calls.iter().map(|call| call.call_id).collect();
    assert_eq!(ids, [DialpadId(1), DialpadId(3)]);
    assert_eq!(page.cursor.as_deref(), Some("page-2"));
}
