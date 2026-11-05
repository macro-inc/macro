use super::*;

#[tokio::test]
async fn cancellation_drops_in_flight_work_and_empties_the_daemons_tracker() {
    let tasks = TaskTracker::new();
    let cancel = CancellationToken::new();
    let (started, running) = tokio::sync::oneshot::channel();
    let (dropped, stopped) = tokio::sync::oneshot::channel();
    struct InFlight(Option<tokio::sync::oneshot::Sender<()>>);
    impl Drop for InFlight {
        fn drop(&mut self) {
            if let Some(sender) = self.0.take() {
                let _ = sender.send(());
            }
        }
    }
    track_reporter(&tasks, cancel.clone(), async move {
        let _in_flight = InFlight(Some(dropped));
        started.send(()).unwrap();
        std::future::pending::<()>().await;
    });
    running.await.unwrap();
    cancel.cancel();
    tasks.close();
    tokio::time::timeout(Duration::from_secs(1), tasks.wait())
        .await
        .unwrap();
    stopped.await.unwrap();
    assert!(tasks.is_empty());
}

#[tokio::test]
async fn a_listening_display_port_counts_as_a_screen() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap().to_string();
    assert!(listening(&address).await);
    drop(listener);
    assert!(!listening(&address).await);
}

#[tokio::test]
async fn persona_health_uses_the_existing_authenticated_capability_report() {
    use chrono::Utc;
    use harnesses::domain::models::PersonaHealth;
    use std::collections::BTreeMap;
    use wiremock::{
        Mock, MockServer, ResponseTemplate,
        matchers::{body_json, header, method, path},
    };
    let server = MockServer::start().await;
    let capabilities = HarnessCapabilities {
        screen: true,
        personas: BTreeMap::from([(
            "persona".to_owned(),
            PersonaHealth::Healthy {
                checked_at: Utc::now(),
                last_turn_at: None,
            },
        )]),
    };
    Mock::given(method("PUT"))
        .and(path("/harnesses/me/capabilities"))
        .and(header(HARNESS_TOKEN_HEADER, "test-harness-token"))
        .and(body_json(serde_json::to_value(&capabilities).unwrap()))
        .respond_with(ResponseTemplate::new(204))
        .expect(1)
        .mount(&server)
        .await;
    let http = reqwest::Client::builder()
        .no_proxy()
        .timeout(REPORT_TIMEOUT)
        .build()
        .unwrap();
    report(
        &http,
        &format!("{}/harnesses/me/capabilities", server.uri()),
        "test-harness-token",
        &capabilities,
    )
    .await
    .unwrap();
    server.verify().await;
}

#[test]
fn legacy_capability_reports_default_to_no_personas() {
    assert_eq!(
        serde_json::from_str::<HarnessCapabilities>(r#"{"screen":true}"#).unwrap(),
        HarnessCapabilities {
            screen: true,
            ..Default::default()
        }
    );
    assert_eq!(
        serde_json::from_str::<HarnessCapabilities>("{}").unwrap(),
        HarnessCapabilities::default()
    );
}
