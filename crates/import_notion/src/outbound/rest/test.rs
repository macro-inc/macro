use std::collections::{BTreeMap, VecDeque};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use chrono::{TimeZone, Utc};
use serde_json::json;
use tokio::time::Instant;

use http::{Method, StatusCode};

use super::{
    NOTION_REQUEST_INTERVAL, NotionRead, NotionRestClient, NotionTransport, RequestPacer,
    TransportResponse,
};
use crate::domain::model::{
    NotionDataSource, NotionId, NotionPage, NotionParent, NotionUser, NotionValue, PageMarkdown,
    Paged, SearchHit, SearchObject,
};
use crate::domain::ports::{NotionApi, NotionError};

/// Answers requests in order from a script and records what was sent.
struct ScriptedTransport {
    started: Instant,
    responses: Mutex<VecDeque<TransportResponse>>,
    requests: Mutex<Vec<SentRequest>>,
}

#[derive(Debug, Clone, PartialEq)]
struct SentRequest {
    method: Method,
    path: String,
    body: Option<serde_json::Value>,
    after: Duration,
}

impl ScriptedTransport {
    fn new(responses: Vec<TransportResponse>) -> Arc<Self> {
        Arc::new(Self {
            started: Instant::now(),
            responses: Mutex::new(responses.into()),
            requests: Mutex::new(Vec::new()),
        })
    }

    fn requests(&self) -> Vec<SentRequest> {
        self.requests.lock().unwrap().clone()
    }
}

impl NotionTransport for Arc<ScriptedTransport> {
    async fn send(&self, read: &NotionRead) -> Result<TransportResponse, NotionError> {
        self.requests.lock().unwrap().push(SentRequest {
            method: read.method(),
            path: read.path_and_query(),
            body: read.body().cloned(),
            after: self.started.elapsed(),
        });
        let response = self.responses.lock().unwrap().pop_front();
        Ok(response.expect("the script has a response for every request"))
    }
}

fn ok(body: serde_json::Value) -> TransportResponse {
    TransportResponse {
        status: StatusCode::OK,
        retry_after: None,
        body: body.to_string(),
    }
}

#[tokio::test(start_paused = true)]
async fn search_decodes_pages_and_data_sources_and_skips_what_it_cannot_read() {
    let transport = ScriptedTransport::new(vec![ok(json!({
        "object": "list",
        "results": [
            {
                "object": "page",
                "id": "59833787-2cf9-4fdf-8782-e53db20768a5",
                "created_time": "2026-03-01T09:30:00.000Z",
                "last_edited_time": "2026-03-02T10:15:00.000Z",
                "parent": {"type": "workspace", "workspace": true},
                "in_trash": false,
                "url": "https://www.notion.so/Q3-plan-598337872cf94fdf8782e53db20768a5",
                "properties": {
                    "title": {"id": "title", "type": "title", "title": [{"plain_text": "Q3 plan"}]}
                }
            },
            {
                "object": "data_source",
                "id": "1a44be12-0953-4631-a1d6-7d4c2b1b4a2f",
                "title": [{"plain_text": "Roadmap"}],
                "parent": {"type": "database_id", "database_id": "d9824bdc-8445-4327-be8b-5b47500af6ce"},
                "database_parent": {"type": "workspace", "workspace": true},
                "in_trash": true,
                "properties": {
                    "Name": {"id": "title", "name": "Name", "type": "title", "title": {}}
                }
            },
            {"object": "page", "id": "not-a-notion-id"},
            {"object": "agent", "id": "c7f0aa50-1f0e-4a52-9a17-e2f6f3a3b0c1"}
        ],
        "next_cursor": "c7f0aa50-1f0e-4a52-9a17-e2f6f3a3b0c1",
        "has_more": true,
        "type": "page_or_data_source",
        "page_or_data_source": {}
    }))]);
    let client = NotionRestClient::new(
        transport.clone(),
        Arc::new(RequestPacer::new(NOTION_REQUEST_INTERVAL)),
    );

    let page = client
        .search(SearchObject::Page, Some("first-cursor".into()))
        .await
        .unwrap();

    assert_eq!(
        page,
        Paged {
            results: vec![
                SearchHit::Page(NotionPage {
                    id: NotionId::parse("598337872cf94fdf8782e53db20768a5").unwrap(),
                    title: "Q3 plan".into(),
                    url: "https://www.notion.so/Q3-plan-598337872cf94fdf8782e53db20768a5".into(),
                    parent: NotionParent::Workspace,
                    last_edited: Utc.with_ymd_and_hms(2026, 3, 2, 10, 15, 0).unwrap(),
                    created: Utc.with_ymd_and_hms(2026, 3, 1, 9, 30, 0).unwrap(),
                    in_trash: false,
                    properties: BTreeMap::new(),
                }),
                SearchHit::DataSource(NotionDataSource {
                    id: NotionId::parse("1a44be1209534631a1d67d4c2b1b4a2f").unwrap(),
                    database_id: NotionId::parse("d9824bdc84454327be8b5b47500af6ce").unwrap(),
                    title: "Roadmap".into(),
                    database_parent: NotionParent::Workspace,
                    in_trash: true,
                    properties: vec![crate::domain::model::NotionPropertySchema {
                        id: "title".into(),
                        name: "Name".into(),
                        kind: crate::domain::model::NotionPropertyKind::Title,
                    }],
                }),
            ],
            next_cursor: Some("c7f0aa50-1f0e-4a52-9a17-e2f6f3a3b0c1".into()),
        }
    );
    assert_eq!(
        transport.requests(),
        vec![SentRequest {
            method: Method::POST,
            path: "/v1/search".into(),
            body: Some(json!({
                "filter": {"property": "object", "value": "page"},
                "sort": {"timestamp": "last_edited_time", "direction": "descending"},
                "page_size": 100,
                "start_cursor": "first-cursor"
            })),
            after: Duration::ZERO,
        }]
    );
}

#[tokio::test(start_paused = true)]
async fn the_last_page_of_a_search_has_no_cursor() {
    let transport = ScriptedTransport::new(vec![ok(json!({
        "object": "list",
        "results": [],
        "next_cursor": null,
        "has_more": false
    }))]);
    let client = NotionRestClient::new(
        transport.clone(),
        Arc::new(RequestPacer::new(NOTION_REQUEST_INTERVAL)),
    );

    let page = client.search(SearchObject::DataSource, None).await.unwrap();

    assert_eq!(
        page,
        Paged {
            results: vec![],
            next_cursor: None,
        }
    );
    assert_eq!(
        transport.requests()[0].body,
        Some(json!({
            "filter": {"property": "object", "value": "data_source"},
            "sort": {"timestamp": "last_edited_time", "direction": "descending"},
            "page_size": 100
        }))
    );
}

#[tokio::test(start_paused = true)]
async fn page_markdown_decodes_the_body_and_its_unknown_blocks() {
    let transport = ScriptedTransport::new(vec![ok(json!({
        "object": "page_markdown",
        "id": "59833787-2cf9-4fdf-8782-e53db20768a5",
        "markdown": "# Q3 plan\n\n<unknown url=\"https://www.notion.so/598337872cf94fdf8782e53db20768a5#c7f0aa501f0e4a529a17e2f6f3a3b0c1\" alt=\"toggle\"/>",
        "truncated": true,
        "unknown_block_ids": ["c7f0aa50-1f0e-4a52-9a17-e2f6f3a3b0c1"]
    }))]);
    let client = NotionRestClient::new(
        transport.clone(),
        Arc::new(RequestPacer::new(NOTION_REQUEST_INTERVAL)),
    );

    let markdown = client
        .page_markdown(&NotionId::parse("598337872cf94fdf8782e53db20768a5").unwrap())
        .await
        .unwrap();

    assert_eq!(
        markdown,
        PageMarkdown {
            markdown: "# Q3 plan\n\n<unknown url=\"https://www.notion.so/598337872cf94fdf8782e53db20768a5#c7f0aa501f0e4a529a17e2f6f3a3b0c1\" alt=\"toggle\"/>".into(),
            unknown_block_ids: vec![NotionId::parse("c7f0aa501f0e4a529a17e2f6f3a3b0c1").unwrap()],
        }
    );
    assert_eq!(
        transport.requests()[0].path,
        "/v1/pages/598337872cf94fdf8782e53db20768a5/markdown"
    );
}

#[tokio::test(start_paused = true)]
async fn a_rate_limit_is_retried_after_the_delay_notion_asked_for() {
    let transport = ScriptedTransport::new(vec![
        TransportResponse {
            status: StatusCode::TOO_MANY_REQUESTS,
            retry_after: Some(Duration::from_secs(7)),
            body: r#"{"object":"error","status":429,"code":"rate_limited","message":"slow down"}"#
                .into(),
        },
        ok(
            json!({"object": "database", "data_sources": [{"id": "1a44be12-0953-4631-a1d6-7d4c2b1b4a2f", "name": "Roadmap"}]}),
        ),
    ]);
    let client = NotionRestClient::new(
        transport.clone(),
        Arc::new(RequestPacer::new(NOTION_REQUEST_INTERVAL)),
    );

    let sources = client
        .database_sources(&NotionId::parse("d9824bdc84454327be8b5b47500af6ce").unwrap())
        .await
        .unwrap();

    assert_eq!(
        sources,
        vec![NotionId::parse("1a44be1209534631a1d67d4c2b1b4a2f").unwrap()]
    );
    let requests = transport.requests();
    assert_eq!(requests.len(), 2);
    assert_eq!(
        requests[0].path,
        "/v1/databases/d9824bdc84454327be8b5b47500af6ce"
    );
    assert_eq!(requests[0].after, Duration::ZERO);
    assert_eq!(requests[1].after, Duration::from_secs(7));
}

#[tokio::test(start_paused = true)]
async fn a_rate_limit_that_persists_fails_after_five_attempts() {
    let rate_limited = TransportResponse {
        status: StatusCode::TOO_MANY_REQUESTS,
        retry_after: Some(Duration::from_secs(1)),
        body: r#"{"object":"error","code":"rate_limited"}"#.into(),
    };
    let transport = ScriptedTransport::new(vec![rate_limited; 5]);
    let client = NotionRestClient::new(
        transport.clone(),
        Arc::new(RequestPacer::new(NOTION_REQUEST_INTERVAL)),
    );

    let error = client
        .page(&NotionId::parse("598337872cf94fdf8782e53db20768a5").unwrap())
        .await
        .unwrap_err();

    assert!(
        matches!(error, NotionError::RateLimited { retry_after: Some(delay) } if delay == Duration::from_secs(1)),
        "{error:?}"
    );
    assert_eq!(transport.requests().len(), 5);
}

#[tokio::test(start_paused = true)]
async fn a_transient_server_error_is_retried_with_backoff() {
    let transport = ScriptedTransport::new(vec![
        TransportResponse {
            status: StatusCode::SERVICE_UNAVAILABLE,
            retry_after: None,
            body: "upstream unavailable".into(),
        },
        ok(json!({"object": "page_markdown", "markdown": "done", "unknown_block_ids": []})),
    ]);
    let client = NotionRestClient::new(
        transport.clone(),
        Arc::new(RequestPacer::new(NOTION_REQUEST_INTERVAL)),
    );

    let markdown = client
        .page_markdown(&NotionId::parse("598337872cf94fdf8782e53db20768a5").unwrap())
        .await
        .unwrap();

    assert_eq!(markdown.markdown, "done");
    let requests = transport.requests();
    assert_eq!(requests.len(), 2);
    // The first backoff is half a second plus at most a quarter second of
    // jitter.
    assert!(
        requests[1].after >= Duration::from_millis(500),
        "{requests:?}"
    );
    assert!(
        requests[1].after <= Duration::from_millis(750),
        "{requests:?}"
    );
}

#[tokio::test(start_paused = true)]
async fn not_found_and_forbidden_are_final() {
    let transport = ScriptedTransport::new(vec![
        TransportResponse {
            status: StatusCode::NOT_FOUND,
            retry_after: None,
            body: r#"{"object":"error","status":404,"code":"object_not_found","message":"Could not find page"}"#.into(),
        },
        TransportResponse {
            status: StatusCode::FORBIDDEN,
            retry_after: None,
            body: r#"{"object":"error","status":403,"code":"restricted_resource","message":"no access"}"#.into(),
        },
        TransportResponse {
            status: StatusCode::BAD_REQUEST,
            retry_after: None,
            body: format!(r#"{{"object":"error","code":"validation_error","message":"{}"}}"#, "x".repeat(600)),
        },
    ]);
    let client = NotionRestClient::new(
        transport.clone(),
        Arc::new(RequestPacer::new(NOTION_REQUEST_INTERVAL)),
    );
    let id = NotionId::parse("598337872cf94fdf8782e53db20768a5").unwrap();

    let not_found = client.page(&id).await.unwrap_err();
    let forbidden = client.data_source(&id).await.unwrap_err();
    let invalid = client.page_markdown(&id).await.unwrap_err();

    assert!(matches!(not_found, NotionError::NotFound), "{not_found:?}");
    assert!(matches!(forbidden, NotionError::Forbidden), "{forbidden:?}");
    match invalid {
        NotionError::Upstream { status, body } => {
            assert_eq!(status, 400);
            assert_eq!(body.chars().count(), 500);
        }
        other => panic!("expected an upstream error, got {other:?}"),
    }
    assert_eq!(transport.requests().len(), 3);
}

#[tokio::test(start_paused = true)]
async fn concurrent_requests_on_one_connection_are_spaced_out() {
    let empty_markdown =
        ok(json!({"object": "page_markdown", "markdown": "", "unknown_block_ids": []}));
    let transport = ScriptedTransport::new(vec![empty_markdown; 3]);
    let pacer = Arc::new(RequestPacer::new(NOTION_REQUEST_INTERVAL));
    let first = NotionRestClient::new(transport.clone(), pacer.clone());
    let second = NotionRestClient::new(transport.clone(), pacer);
    let id = NotionId::parse("598337872cf94fdf8782e53db20768a5").unwrap();

    let (a, b, c) = tokio::join!(
        first.page_markdown(&id),
        second.page_markdown(&id),
        first.page_markdown(&id)
    );

    a.unwrap();
    b.unwrap();
    c.unwrap();
    let times: Vec<Duration> = transport
        .requests()
        .into_iter()
        .map(|request| request.after)
        .collect();
    assert_eq!(
        times,
        vec![
            Duration::ZERO,
            NOTION_REQUEST_INTERVAL,
            NOTION_REQUEST_INTERVAL * 2
        ]
    );
}

#[tokio::test(start_paused = true)]
async fn users_skip_bots_and_a_forbidden_listing_is_empty() {
    let transport = ScriptedTransport::new(vec![
        ok(json!({
            "object": "list",
            "results": [
                {"object": "user", "id": "ee5f0f84-409a-440f-983a-a5315961c6e4", "type": "person", "name": "Ada", "person": {"email": "ada@example.com"}},
                {"object": "user", "id": "c7f0aa50-1f0e-4a52-9a17-e2f6f3a3b0c1", "type": "person", "name": "Grace", "person": {}},
                {"object": "user", "id": "9a3b5ae0-c6e6-482d-b0e1-ed315ee6dc57", "type": "bot", "name": "Importer", "bot": {}}
            ],
            "next_cursor": "next-users",
            "has_more": true
        })),
        TransportResponse {
            status: StatusCode::FORBIDDEN,
            retry_after: None,
            body: r#"{"object":"error","status":403,"code":"restricted_resource"}"#.into(),
        },
    ]);
    let client = NotionRestClient::new(
        transport.clone(),
        Arc::new(RequestPacer::new(NOTION_REQUEST_INTERVAL)),
    );

    let first = client.users(None).await.unwrap();
    let second = client.users(first.next_cursor.clone()).await.unwrap();

    assert_eq!(
        first,
        Paged {
            results: vec![
                NotionUser {
                    id: NotionId::parse("ee5f0f84409a440f983aa5315961c6e4").unwrap(),
                    name: Some("Ada".into()),
                    email: Some("ada@example.com".into()),
                },
                NotionUser {
                    id: NotionId::parse("c7f0aa501f0e4a529a17e2f6f3a3b0c1").unwrap(),
                    name: Some("Grace".into()),
                    email: None,
                },
            ],
            next_cursor: Some("next-users".into()),
        }
    );
    assert_eq!(
        second,
        Paged {
            results: vec![],
            next_cursor: None,
        }
    );
    let paths: Vec<String> = transport
        .requests()
        .into_iter()
        .map(|request| request.path)
        .collect();
    assert_eq!(
        paths,
        vec![
            "/v1/users?page_size=100".to_owned(),
            "/v1/users?page_size=100&start_cursor=next-users".to_owned(),
        ]
    );
}

#[tokio::test(start_paused = true)]
async fn a_query_past_notions_result_cap_restarts_from_the_last_creation_time() {
    let row = |id: &str, created: &str| {
        json!({
            "object": "page",
            "id": id,
            "created_time": created,
            "last_edited_time": created,
            "parent": {"type": "data_source_id", "data_source_id": "1a44be12-0953-4631-a1d6-7d4c2b1b4a2f", "database_id": "d9824bdc-8445-4327-be8b-5b47500af6ce"},
            "url": "https://www.notion.so/row",
            "properties": {}
        })
    };
    let transport = ScriptedTransport::new(vec![
        ok(json!({
            "object": "list",
            "results": [row("598337872cf94fdf8782e53db20768a5", "2026-01-01T00:00:00.000Z")],
            "next_cursor": "notion-cursor",
            "has_more": true
        })),
        ok(json!({
            "object": "list",
            "results": [row("c7f0aa501f0e4a529a17e2f6f3a3b0c1", "2026-02-01T12:00:00.000Z")],
            "next_cursor": null,
            "has_more": false,
            "request_status": {"type": "incomplete", "incomplete_reason": "query_result_limit_reached"}
        })),
        ok(json!({
            "object": "list",
            "results": [
                row("c7f0aa501f0e4a529a17e2f6f3a3b0c1", "2026-02-01T12:00:00.000Z"),
                row("ee5f0f84409a440f983aa5315961c6e4", "2026-02-02T00:00:00.000Z")
            ],
            "next_cursor": null,
            "has_more": false
        })),
    ]);
    let client = NotionRestClient::new(
        transport.clone(),
        Arc::new(RequestPacer::new(NOTION_REQUEST_INTERVAL)),
    );
    let source = NotionId::parse("1a44be1209534631a1d67d4c2b1b4a2f").unwrap();

    let drained = crate::domain::inventory::all_rows(&client, &source)
        .await
        .unwrap();

    let ids: Vec<&str> = drained.rows.iter().map(|row| row.id.as_str()).collect();
    assert_eq!(
        ids,
        vec![
            "598337872cf94fdf8782e53db20768a5",
            "c7f0aa501f0e4a529a17e2f6f3a3b0c1",
            "ee5f0f84409a440f983aa5315961c6e4",
        ]
    );
    assert!(drained.complete, "the restart listed every row");
    let bodies: Vec<Option<serde_json::Value>> = transport
        .requests()
        .into_iter()
        .map(|request| request.body)
        .collect();
    assert_eq!(
        bodies,
        vec![
            Some(json!({
                "page_size": 100,
                "sorts": [{"timestamp": "created_time", "direction": "ascending"}]
            })),
            Some(json!({
                "page_size": 100,
                "sorts": [{"timestamp": "created_time", "direction": "ascending"}],
                "start_cursor": "notion-cursor"
            })),
            Some(json!({
                "page_size": 100,
                "sorts": [{"timestamp": "created_time", "direction": "ascending"}],
                "filter": {"timestamp": "created_time", "created_time": {"on_or_after": "2026-02-01T12:00:00.000Z"}}
            })),
        ]
    );
}

#[tokio::test(start_paused = true)]
async fn a_cap_that_makes_no_progress_drains_the_rows_it_listed_as_incomplete() {
    let row = |id: &str| {
        json!({
            "object": "page",
            "id": id,
            "created_time": "2026-02-01T12:00:00.000Z",
            "last_edited_time": "2026-02-01T12:00:00.000Z",
            "parent": {"type": "data_source_id", "data_source_id": "1a44be12-0953-4631-a1d6-7d4c2b1b4a2f", "database_id": "d9824bdc-8445-4327-be8b-5b47500af6ce"},
            "url": "https://www.notion.so/row",
            "properties": {}
        })
    };
    let transport = ScriptedTransport::new(vec![
        ok(json!({
            "object": "list",
            "results": [row("598337872cf94fdf8782e53db20768a5")],
            "next_cursor": null,
            "has_more": false,
            "request_status": {"type": "incomplete", "incomplete_reason": "query_result_limit_reached"}
        })),
        ok(json!({
            "object": "list",
            "results": [
                row("598337872cf94fdf8782e53db20768a5"),
                row("c7f0aa501f0e4a529a17e2f6f3a3b0c1")
            ],
            "next_cursor": null,
            "has_more": false,
            "request_status": {"type": "incomplete", "incomplete_reason": "query_result_limit_reached"}
        })),
    ]);
    let client = NotionRestClient::new(
        transport.clone(),
        Arc::new(RequestPacer::new(NOTION_REQUEST_INTERVAL)),
    );
    let source = NotionId::parse("1a44be1209534631a1d67d4c2b1b4a2f").unwrap();

    let drained = crate::domain::inventory::all_rows(&client, &source)
        .await
        .unwrap();

    let ids: Vec<&str> = drained.rows.iter().map(|row| row.id.as_str()).collect();
    assert_eq!(
        ids,
        vec![
            "598337872cf94fdf8782e53db20768a5",
            "c7f0aa501f0e4a529a17e2f6f3a3b0c1",
        ]
    );
    assert!(
        !drained.complete,
        "the restart returned rows from the same instant only, so the rest are missing"
    );
    assert_eq!(transport.requests().len(), 2);
}

#[tokio::test(start_paused = true)]
async fn a_truncated_relation_is_fetched_in_full() {
    let transport = ScriptedTransport::new(vec![
        ok(json!({
            "object": "page",
            "id": "59833787-2cf9-4fdf-8782-e53db20768a5",
            "created_time": "2026-03-01T09:30:00.000Z",
            "last_edited_time": "2026-03-01T09:30:00.000Z",
            "parent": {"type": "page_id", "page_id": "c7f0aa50-1f0e-4a52-9a17-e2f6f3a3b0c1"},
            "url": "https://www.notion.so/598337872cf94fdf8782e53db20768a5",
            "properties": {
                "Projects": {"id": "pJ%3B", "type": "relation", "relation": [{"id": "a1b2c3d4-0000-4000-8000-000000000001"}], "has_more": true}
            }
        })),
        ok(json!({
            "object": "list",
            "results": [
                {"object": "property_item", "id": "pJ%3B", "type": "relation", "relation": {"id": "a1b2c3d4-0000-4000-8000-000000000001"}}
            ],
            "next_cursor": "more",
            "has_more": true,
            "type": "property_item",
            "property_item": {"id": "pJ%3B", "type": "relation", "relation": {}}
        })),
        ok(json!({
            "object": "list",
            "results": [
                {"object": "property_item", "id": "pJ%3B", "type": "relation", "relation": {"id": "a1b2c3d4-0000-4000-8000-000000000002"}}
            ],
            "next_cursor": null,
            "has_more": false
        })),
    ]);
    let client = NotionRestClient::new(
        transport.clone(),
        Arc::new(RequestPacer::new(NOTION_REQUEST_INTERVAL)),
    );

    let page = client
        .page(&NotionId::parse("598337872cf94fdf8782e53db20768a5").unwrap())
        .await
        .unwrap();

    assert_eq!(
        page.properties.get("Projects"),
        Some(&NotionValue::Relation(vec![
            NotionId::parse("a1b2c3d4000040008000000000000001").unwrap(),
            NotionId::parse("a1b2c3d4000040008000000000000002").unwrap(),
        ]))
    );
    let paths: Vec<String> = transport
        .requests()
        .into_iter()
        .map(|request| request.path)
        .collect();
    assert_eq!(
        paths,
        vec![
            "/v1/pages/598337872cf94fdf8782e53db20768a5".to_owned(),
            "/v1/pages/598337872cf94fdf8782e53db20768a5/properties/pJ%3B?page_size=100".to_owned(),
            "/v1/pages/598337872cf94fdf8782e53db20768a5/properties/pJ%3B?page_size=100&start_cursor=more".to_owned(),
        ]
    );
}

/// Every request the client can build, named once per variant so a new one
/// fails to compile here until it is checked.
fn every_read() -> Vec<NotionRead> {
    let id = NotionId::parse("598337872cf94fdf8782e53db20768a5").unwrap();
    let reads = vec![
        NotionRead::Search(json!({})),
        NotionRead::Page(id.clone()),
        NotionRead::PageMarkdown(id.clone()),
        NotionRead::PageProperty {
            page: id.clone(),
            property: "title".into(),
            cursor: Some("next".into()),
        },
        NotionRead::DataSource(id.clone()),
        NotionRead::QueryDataSource {
            id: id.clone(),
            body: json!({}),
        },
        NotionRead::Database(id.clone()),
        NotionRead::ListViews {
            scope: crate::domain::views::ViewScope::Database(id.clone()),
            cursor: None,
        },
        NotionRead::RetrieveView(id.clone()),
        NotionRead::Users { cursor: None },
    ];
    for read in &reads {
        match read {
            NotionRead::Search(_)
            | NotionRead::Page(_)
            | NotionRead::PageMarkdown(_)
            | NotionRead::PageProperty { .. }
            | NotionRead::DataSource(_)
            | NotionRead::QueryDataSource { .. }
            | NotionRead::Database(_)
            | NotionRead::ListViews { .. }
            | NotionRead::RetrieveView(_)
            | NotionRead::Users { .. } => {}
        }
    }
    reads
}

#[test]
fn every_request_the_client_can_send_only_reads_notion() {
    let sent: Vec<(Method, String)> = every_read()
        .iter()
        .map(|read| (read.method(), read.path_and_query()))
        .collect();

    assert_eq!(
        sent,
        vec![
            (Method::POST, "/v1/search".to_owned()),
            (
                Method::GET,
                "/v1/pages/598337872cf94fdf8782e53db20768a5".to_owned()
            ),
            (
                Method::GET,
                "/v1/pages/598337872cf94fdf8782e53db20768a5/markdown".to_owned()
            ),
            (
                Method::GET,
                "/v1/pages/598337872cf94fdf8782e53db20768a5/properties/title?page_size=100&start_cursor=next"
                    .to_owned()
            ),
            (
                Method::GET,
                "/v1/data_sources/598337872cf94fdf8782e53db20768a5".to_owned()
            ),
            (
                Method::POST,
                "/v1/data_sources/598337872cf94fdf8782e53db20768a5/query".to_owned()
            ),
            (
                Method::GET,
                "/v1/databases/598337872cf94fdf8782e53db20768a5".to_owned()
            ),
            (Method::GET, "/v1/views?database_id=598337872cf94fdf8782e53db20768a5&page_size=100".to_owned()),
            (Method::GET, "/v1/views/598337872cf94fdf8782e53db20768a5".to_owned()),
            (Method::GET, "/v1/users?page_size=100".to_owned()),
        ]
    );
}

// Synthetic Views API fixtures, Notion-Version 2026-03-11:
// https://developers.notion.com/reference/list-views
// https://developers.notion.com/reference/retrieve-a-view
#[tokio::test(start_paused = true)]
async fn views_list_references_by_container_or_source_and_retrieve_full_configuration() {
    use crate::domain::views::ViewScope;
    let transport = ScriptedTransport::new(vec![
        ok(
            json!({"object":"list", "type":"view", "view":{}, "has_more":true,
            "next_cursor":"00000000-0000-4000-8000-000000000004",
            "results":[{"object":"view", "id":"00000000-0000-4000-8000-000000000001"}]}),
        ),
        ok(
            json!({"object":"list", "type":"view", "view":{}, "has_more":false, "next_cursor":null, "results":[]}),
        ),
        ok(
            json!({"object":"view", "id":"00000000-0000-4000-8000-000000000001",
            "name":"Open", "parent":{"type":"database_id", "database_id":"00000000-0000-4000-8000-000000000002"},
            "data_source_id":"00000000-0000-4000-8000-000000000003", "type":"table",
            "filter":{"property":"done", "checkbox":{"equals":false}}, "sorts":null, "configuration":null}),
        ),
    ]);
    let client = NotionRestClient::new(
        transport.clone(),
        Arc::new(RequestPacer::new(Duration::ZERO)),
    );
    let database = NotionId::parse("00000000-0000-4000-8000-000000000002").unwrap();
    let source = NotionId::parse("00000000-0000-4000-8000-000000000003").unwrap();
    let list = client
        .list_views(&ViewScope::Database(database), None)
        .await
        .unwrap();
    assert_eq!(
        list.results,
        vec![NotionId::parse("00000000-0000-4000-8000-000000000001").unwrap()]
    );
    assert!(
        client
            .list_views(&ViewScope::DataSource(source), list.next_cursor)
            .await
            .unwrap()
            .results
            .is_empty()
    );
    let view = client.retrieve_view(&list.results[0]).await.unwrap();
    assert_eq!(
        view.filter,
        Some(json!({"property":"done", "checkbox":{"equals":false}}))
    );
    assert_eq!(
        transport
            .requests()
            .iter()
            .map(|r| r.path.as_str())
            .collect::<Vec<_>>(),
        vec![
            "/v1/views?database_id=00000000000040008000000000000002&page_size=100",
            "/v1/views?data_source_id=00000000000040008000000000000003&page_size=100&start_cursor=00000000-0000-4000-8000-000000000004",
            "/v1/views/00000000000040008000000000000001"
        ]
    );
    assert!(
        transport
            .requests()
            .iter()
            .all(|r| r.method == Method::GET && r.body.is_none())
    );
}

#[tokio::test(start_paused = true)]
async fn incomplete_view_lists_are_errors_and_view_reads_retry_and_preserve_access_errors() {
    use crate::domain::views::ViewScope;
    let id = NotionId::parse("00000000-0000-4000-8000-000000000001").unwrap();
    let transport = ScriptedTransport::new(vec![
        ok(
            json!({"object":"list", "results":[], "has_more":false, "next_cursor":null, "request_status":{"type":"incomplete"}}),
        ),
        ok(json!({"object":"list", "results":[], "has_more":true, "next_cursor":null})),
        TransportResponse {
            status: StatusCode::TOO_MANY_REQUESTS,
            retry_after: Some(Duration::from_secs(2)),
            body: String::new(),
        },
        TransportResponse {
            status: StatusCode::FORBIDDEN,
            retry_after: None,
            body: String::new(),
        },
        TransportResponse {
            status: StatusCode::NOT_FOUND,
            retry_after: None,
            body: String::new(),
        },
    ]);
    let client = NotionRestClient::new(
        transport.clone(),
        Arc::new(RequestPacer::new(Duration::ZERO)),
    );
    assert!(matches!(
        client
            .list_views(&ViewScope::Database(id.clone()), None)
            .await,
        Err(NotionError::Upstream { status: 503, .. })
    ));
    assert!(matches!(
        client
            .list_views(&ViewScope::DataSource(id.clone()), None)
            .await,
        Err(NotionError::Upstream { status: 503, .. })
    ));
    assert!(matches!(
        client.retrieve_view(&id).await,
        Err(NotionError::Forbidden)
    ));
    assert!(transport.requests()[3].after >= Duration::from_secs(2));
    assert!(matches!(
        client.retrieve_view(&id).await,
        Err(NotionError::NotFound)
    ));
}

#[tokio::test(start_paused = true)]
async fn malformed_view_lists_cannot_be_mistaken_for_no_saved_views() {
    use crate::domain::views::ViewScope;
    let id = NotionId::parse("00000000-0000-4000-8000-000000000001").unwrap();
    let transport = ScriptedTransport::new(vec![ok(json!({}))]);
    let client = NotionRestClient::new(transport, Arc::new(RequestPacer::new(Duration::ZERO)));
    assert!(matches!(
        client.list_views(&ViewScope::Database(id), None).await,
        Err(NotionError::Decode(_))
    ));
}

#[tokio::test(start_paused = true)]
async fn database_body_references_resolve_against_documented_rest_shapes() {
    use crate::domain::databases::{SourceOwnership, read_page_databases};

    let fixture: serde_json::Value =
        serde_json::from_str(include_str!("../../../fixtures/database_occurrences.json")).unwrap();
    let transport = ScriptedTransport::new(vec![
        ok(fixture["page_markdown"].clone()),
        ok(fixture["database"].clone()),
        ok(fixture["owned_source"].clone()),
        ok(fixture["linked_source"].clone()),
    ]);
    let client = NotionRestClient::new(
        transport.clone(),
        Arc::new(RequestPacer::new(NOTION_REQUEST_INTERVAL)),
    );
    let page = NotionId::parse("598337872cf94fdf8782e53db20768a5").unwrap();
    let body = read_page_databases(&client, &page).await.unwrap();

    assert_eq!(
        body.markdown,
        fixture["page_markdown"]["markdown"].as_str().unwrap()
    );
    assert_eq!(body.occurrences.len(), 1);
    assert_eq!(
        body.occurrences[0].sources[0].ownership,
        Some(SourceOwnership::Owned)
    );
    assert_eq!(
        body.occurrences[0].sources[1].ownership,
        Some(SourceOwnership::Linked)
    );
    assert_eq!(
        body.occurrences[0].view_id,
        NotionId::parse("c7f0aa501f0e4a529a17e2f6f3a3b0c1")
    );
    assert!(body.occurrences[0].losses.is_empty());
    assert_eq!(
        transport
            .requests()
            .iter()
            .map(|request| request.path.as_str())
            .collect::<Vec<_>>(),
        vec![
            "/v1/pages/598337872cf94fdf8782e53db20768a5/markdown",
            "/v1/databases/d9824bdc84454327be8b5b47500af6ce",
            "/v1/data_sources/1a44be1209534631a1d67d4c2b1b4a2f",
            "/v1/data_sources/ee5f0f84409a440f983aa5315961c6e4",
        ]
    );
}

#[tokio::test(start_paused = true)]
async fn database_placements_keep_access_failures_distinct_from_needing_views() {
    use crate::domain::databases::{DatabaseLoss, ReadFailure, read_page_databases};

    let markdown = include_str!("../../../fixtures/database_unresolved.md");
    let transport = ScriptedTransport::new(vec![
        ok(json!({"object": "page_markdown", "markdown": markdown, "unknown_block_ids": []})),
        ok(json!({"object": "database", "data_sources": []})),
        TransportResponse {
            status: StatusCode::FORBIDDEN, retry_after: None,
            body: r#"{"object":"error","status":403,"code":"restricted_resource","message":"Access denied"}"#.into(),
        },
        TransportResponse {
            status: StatusCode::NOT_FOUND, retry_after: None,
            body: r#"{"object":"error","status":404,"code":"object_not_found","message":"Object not found"}"#.into(),
        },
        TransportResponse {
            status: StatusCode::BAD_REQUEST, retry_after: None,
            body: r#"{"object":"error","status":400,"code":"validation_error","message":"Not a database"}"#.into(),
        },
    ]);
    let client = NotionRestClient::new(
        transport.clone(),
        Arc::new(RequestPacer::new(NOTION_REQUEST_INTERVAL)),
    );
    let page = NotionId::parse("598337872cf94fdf8782e53db20768a5").unwrap();
    let body = read_page_databases(&client, &page).await.unwrap();
    assert_eq!(body.markdown, markdown);
    assert_eq!(body.occurrences.len(), 5);
    assert_eq!(body.occurrences[0].losses, vec![DatabaseLoss::NeedsViews]);
    assert_eq!(
        body.occurrences[1].losses,
        vec![DatabaseLoss::ContainerUnavailable {
            reason: ReadFailure::Forbidden
        }]
    );
    assert_eq!(
        body.occurrences[2].losses,
        vec![DatabaseLoss::ContainerUnavailable {
            reason: ReadFailure::NotFound
        }]
    );
    assert_eq!(
        body.occurrences[3].losses,
        vec![DatabaseLoss::ContainerUnavailable {
            reason: ReadFailure::InvalidObject
        }]
    );
    assert_eq!(
        body.occurrences[4].losses,
        vec![DatabaseLoss::MissingContainerId]
    );
    assert_eq!(body.occurrences[4].fallback_url(&page), page.url());
    assert_eq!(body.occurrences[4].title, "Notion database");
    assert_eq!(transport.requests().len(), 5);
}

#[tokio::test(start_paused = true)]
async fn one_malformed_source_does_not_lose_other_sources_in_the_placement() {
    use crate::domain::databases::{
        DatabaseLoss, ReadFailure, SourceOwnership, read_page_databases,
    };
    let fixture: serde_json::Value =
        serde_json::from_str(include_str!("../../../fixtures/database_occurrences.json")).unwrap();
    let mut unreadable = fixture["owned_source"].clone();
    unreadable["parent"] = json!({"type":"workspace"});
    let transport = ScriptedTransport::new(vec![
        ok(fixture["page_markdown"].clone()),
        ok(fixture["database"].clone()),
        ok(unreadable),
        ok(fixture["linked_source"].clone()),
    ]);
    let client = NotionRestClient::new(
        transport,
        Arc::new(RequestPacer::new(NOTION_REQUEST_INTERVAL)),
    );
    let body = read_page_databases(
        &client,
        &NotionId::parse("598337872cf94fdf8782e53db20768a5").unwrap(),
    )
    .await
    .unwrap();
    assert_eq!(body.occurrences[0].sources.len(), 2);
    assert_eq!(body.occurrences[0].sources[0].ownership, None);
    assert_eq!(
        body.occurrences[0].sources[1].ownership,
        Some(SourceOwnership::Linked)
    );
    assert!(matches!(
        &body.occurrences[0].losses[0],
        DatabaseLoss::SourceUnavailable {
            reason: ReadFailure::InvalidObject,
            ..
        }
    ));
}
