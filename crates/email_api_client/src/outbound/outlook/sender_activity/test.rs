use chrono::DateTime;
use serde_json::json;
use wiremock::{
    Mock, ResponseTemplate,
    matchers::{header, method, path, query_param},
};

use super::*;
use crate::outbound::outlook::test::setup;

#[test]
fn search_names_the_domain_and_the_window_start_date() {
    let since = DateTime::parse_from_rfc3339("2026-05-09T13:45:00Z")
        .unwrap()
        .with_timezone(&Utc);

    assert_eq!(
        sender_domain_search(&SenderDomain::new("linear.app").unwrap(), since),
        "\"from:linear.app AND received>=2026-05-09\""
    );
}

#[tokio::test]
async fn counts_the_first_page_of_matching_message_ids() {
    let (server, api, token) = setup().await;
    Mock::given(method("GET"))
        .and(path("/v1.0/me/messages"))
        .and(header("authorization", "Bearer test-bearer"))
        .and(query_param(
            "$search",
            "\"from:slack.com AND received>=2026-05-09\"",
        ))
        .and(query_param("$select", "id"))
        .and(query_param("$top", "50"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "value": [{"id": "m1"}, {"id": "m2"}, {"id": "m3"}],
            "@odata.nextLink": format!("{}/v1.0/me/messages?$skip=3", server.uri())
        })))
        .expect(1)
        .mount(&server)
        .await;

    let since = DateTime::parse_from_rfc3339("2026-05-09T00:00:00Z")
        .unwrap()
        .with_timezone(&Utc);
    let count = api
        .count_messages_from_domain(&token, &SenderDomain::new("slack.com").unwrap(), since)
        .await
        .unwrap();

    assert_eq!(count, 3);
}

#[tokio::test]
async fn graph_throttling_is_a_rate_limit() {
    let (server, api, token) = setup().await;
    Mock::given(method("GET"))
        .and(path("/v1.0/me/messages"))
        .respond_with(ResponseTemplate::new(429).insert_header("Retry-After", "2"))
        .mount(&server)
        .await;

    let result = api
        .count_messages_from_domain(
            &token,
            &SenderDomain::new("notion.so").unwrap(),
            DateTime::from_timestamp(0, 0).unwrap(),
        )
        .await;

    assert!(matches!(result, Err(EmailApiError::RateLimited { .. })));
}
