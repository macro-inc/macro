use super::*;
use axum::{
    Json, Router,
    extract::{Path, State},
    routing::post,
};
use std::sync::{Arc, Mutex};

#[derive(Clone)]
struct Gateway {
    received: Arc<Mutex<Vec<Received>>>,
}

struct Received {
    entity_type: String,
    entity_id: String,
}

async fn send_message(
    State(gateway): State<Gateway>,
    Path((entity_type, entity_id)): Path<(String, String)>,
) -> Json<serde_json::Value> {
    gateway.received.lock().unwrap().push(Received {
        entity_type,
        entity_id,
    });
    Json(serde_json::json!({ "receipts": [] }))
}

async fn spawn_gateway() -> (ConnectionGatewayNotifier, Arc<Mutex<Vec<Received>>>) {
    let received = Arc::new(Mutex::new(Vec::new()));
    let router = Router::new()
        .route(
            "/message/send/{entity_type}/{entity_id}",
            post(send_message),
        )
        .with_state(Gateway {
            received: received.clone(),
        });
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
    let notifier = ConnectionGatewayNotifier::new("test-key".to_string(), url).unwrap();
    (notifier, received)
}

#[tokio::test]
async fn user_id_reaches_the_gateway_as_one_path_segment() {
    let (notifier, received) = spawn_gateway().await;
    let user_ids = [
        "macro|accounts/payables@example.com",
        "macro|//alias@example.com",
        "macro|a#b?c%d@example.com",
    ];

    for user_id in user_ids {
        notifier.invalidate_contacts(user_id).await.unwrap();
    }

    let received = received.lock().unwrap();
    let entity_ids: Vec<_> = received.iter().map(|r| r.entity_id.as_str()).collect();
    assert_eq!(entity_ids, user_ids);
    assert!(received.iter().all(|r| r.entity_type == "user"));
}
