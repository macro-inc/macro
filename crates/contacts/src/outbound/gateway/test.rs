use super::*;
use axum::{
    Json, Router,
    body::Body,
    extract::{ConnectInfo, Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::post,
};
use std::{
    collections::HashSet,
    convert::Infallible,
    net::SocketAddr,
    sync::{Arc, Mutex},
    time::Duration,
};

#[derive(Clone)]
struct Gateway {
    status: StatusCode,
    received: Arc<Mutex<Vec<Received>>>,
}

struct Received {
    entity_type: String,
    entity_id: String,
    peer: SocketAddr,
    body: serde_json::Value,
}

async fn send_message(
    State(gateway): State<Gateway>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    Path((entity_type, entity_id)): Path<(String, String)>,
    Json(body): Json<serde_json::Value>,
) -> Response {
    gateway.received.lock().unwrap().push(Received {
        entity_type,
        entity_id,
        peer,
        body,
    });
    let body = futures::stream::once(async {
        tokio::time::sleep(Duration::from_millis(10)).await;
        Ok::<_, Infallible>(r#"{"receipts":[]}"#)
    });
    (gateway.status, Body::from_stream(body)).into_response()
}

fn user(user_id: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(user_id.to_owned()).unwrap()
}

async fn spawn_gateway(
    status: StatusCode,
) -> (ConnectionGatewayNotifier, Arc<Mutex<Vec<Received>>>) {
    let received = Arc::new(Mutex::new(Vec::new()));
    let router = Router::new()
        .route(
            "/message/send/{entity_type}/{entity_id}",
            post(send_message),
        )
        .with_state(Gateway {
            status,
            received: received.clone(),
        });
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move {
        axum::serve(
            listener,
            router.into_make_service_with_connect_info::<SocketAddr>(),
        )
        .await
        .unwrap();
    });
    let notifier = ConnectionGatewayNotifier::new("test-key".to_string(), url).unwrap();
    (notifier, received)
}

#[tokio::test]
async fn user_id_reaches_the_gateway_as_one_path_segment() {
    let (notifier, received) = spawn_gateway(StatusCode::OK).await;
    let user_ids = [
        "macro|accounts/payables@example.com",
        "macro|//alias@example.com",
        "macro|a#b?c%d@example.com",
    ];

    for user_id in user_ids {
        notifier
            .invalidate_contacts(&ContactsInvalidation::unknown(user(user_id)))
            .await
            .unwrap();
    }

    let received = received.lock().unwrap();
    let entity_ids: Vec<_> = received.iter().map(|r| r.entity_id.as_str()).collect();
    assert_eq!(entity_ids, user_ids);
    assert!(received.iter().all(|r| r.entity_type == "user"));
}

/// The fake gateway sends each body after its headers, so the pooled connection
/// is only reused if every response body is read to the end.
#[tokio::test]
async fn sequential_invalidations_reuse_one_connection() {
    for status in [StatusCode::OK, StatusCode::INTERNAL_SERVER_ERROR] {
        let (notifier, received) = spawn_gateway(status).await;

        for _ in 0..20 {
            let result = notifier
                .invalidate_contacts(&ContactsInvalidation::unknown(user(
                    "macro|user@example.com",
                )))
                .await;
            assert_eq!(result.is_ok(), status.is_success(), "{status}");
        }

        let peers: HashSet<_> = received.lock().unwrap().iter().map(|r| r.peer).collect();
        assert_eq!(peers.len(), 1, "{status}");
    }
}

#[tokio::test]
async fn invalidation_names_changed_contacts_only_when_known() {
    let (notifier, received) = spawn_gateway(StatusCode::OK).await;
    let owner = user("macro|owner@example.com");
    let contact = user("macro|contact@example.com");

    notifier
        .invalidate_contacts_for_users(vec![
            ContactsInvalidation::new(owner.clone(), vec![contact]),
            ContactsInvalidation::unknown(owner),
        ])
        .await
        .unwrap();

    let bodies: Vec<_> = received
        .lock()
        .unwrap()
        .iter()
        .map(|r| r.body.clone())
        .collect();
    assert_eq!(
        bodies,
        [
            serde_json::json!({
                "message_type": "contacts_invalidation",
                "message": {"changed": ["macro|contact@example.com"]},
            }),
            serde_json::json!({"message_type": "contacts_invalidation", "message": {}}),
        ]
    );
}

/// An error names the request, whose URL holds the user's email; neither
/// the span's error nor the log may carry it.
#[tokio::test]
async fn a_failed_invalidation_records_no_email() {
    use tracing::Instrument as _;

    let capture = crate::trace_context::capture::Capture::start();
    let (notifier, _) = spawn_gateway(StatusCode::INTERNAL_SERVER_ERROR).await;
    let owner = user("macro|owner@example.com");
    let contact = user("macro|contact@example.com");

    notifier
        .invalidate_contacts_for_users(vec![ContactsInvalidation::new(owner, vec![contact])])
        .instrument(tracing::info_span!(parent: None, "contacts.test"))
        .await
        .unwrap();

    let spans = capture.finished();
    assert!(
        spans.iter().any(|span| span.name == "contacts.invalidate"),
        "the failed call must be traced"
    );
    capture.assert_no_email("example.com");
}
