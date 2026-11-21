use super::*;
use crate::domain::{
    models::AccountState,
    service::test::{MemoryRepository, TestCipher, UncertainTransport},
};
use std::sync::{
    Mutex,
    atomic::{AtomicBool, AtomicU32},
};

#[tokio::test]
async fn actual_router_rejects_missing_wrong_and_empty_keys() {
    for configured in ["correct-internal-key", ""] {
        let repository = Arc::new(MemoryRepository {
            state: Mutex::new(AccountState::default()),
            saved_unknown: AtomicBool::new(false),
            owner_available: AtomicBool::new(true),
        });
        let transport = Arc::new(UncertainTransport {
            repository: repository.clone(),
            submissions: AtomicU32::new(0),
            deadline: AtomicBool::new(false),
            sent_found: std::sync::Mutex::new(std::collections::BTreeSet::new()),
            submission_deadline: std::sync::Mutex::new(None),
        });
        let engine = Arc::new(Engine::new(repository, Arc::new(TestCipher), transport));
        let app = router(ApiState {
            engine,
            internal_key: configured.into(),
        });
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let (stop, stopped) = tokio::sync::oneshot::channel();
        let server = tokio::spawn(async move {
            axum::serve(listener, app)
                .with_graceful_shutdown(async move {
                    let _ = stopped.await;
                })
                .await
                .unwrap();
        });
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(5))
            .build()
            .unwrap();
        for supplied in [None, Some("wrong-internal-key"), Some("")] {
            let mut request = client
                .post(format!("http://{address}/internal/v1/discover"))
                .json(&serde_json::json!({"email":"owner@example.net"}));
            if let Some(key) = supplied {
                request = request.header("x-internal-auth-key", key);
            }
            assert_eq!(
                request.send().await.unwrap().status(),
                reqwest::StatusCode::UNAUTHORIZED
            );
        }
        if !configured.is_empty() {
            for email in [
                "not-an-address",
                "bad..local@example.net",
                "owner@@example.net",
                " owner@example.net",
            ] {
                let login = serde_json::json!({
                    "endpoint": {"host": "mail.example.net", "port": 993, "tls": "implicit", "username": "account-id"},
                    "password": "synthetic-test-secret"
                });
                for (route, body) in [
                    ("discover", serde_json::json!({"email": email})),
                    (
                        "verify",
                        serde_json::json!({
                            "userId": "macro|owner@example.net", "email": email,
                            "imap": login, "smtp": login, "confirmedHosts": ["mail.example.net"]
                        }),
                    ),
                ] {
                    let response = client
                        .post(format!("http://{address}/internal/v1/{route}"))
                        .header("x-internal-auth-key", configured)
                        .json(&body)
                        .send()
                        .await
                        .unwrap();
                    // Json extraction refuses the identity before either engine
                    // operation can reach its credential or discovery adapter.
                    assert_eq!(response.status(), reqwest::StatusCode::UNPROCESSABLE_ENTITY);
                    assert!(
                        !response
                            .text()
                            .await
                            .unwrap()
                            .contains("synthetic-test-secret")
                    );
                }
            }
            assert_eq!(
                client
                    .post(format!("http://{address}/internal/v1/discover"))
                    .header("x-internal-auth-key", configured)
                    .json(&serde_json::json!({"email":"owner@example.net"}))
                    .send()
                    .await
                    .unwrap()
                    .status(),
                reqwest::StatusCode::OK
            );
        }
        stop.send(()).unwrap();
        server.await.unwrap();
    }
}
