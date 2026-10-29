use super::*;
use serde_json::json;
#[path = "../../../test_support.rs"]
mod support;

#[tokio::test(start_paused = true)]
async fn rate_limit_holds_the_shared_account_and_retries() {
    let proxy = Arc::new(support::Proxy::new(vec![
        json!({"limited":true}),
        json!({"ok":true}),
        json!({"ok":true}),
    ]));
    proxy.responses.lock().unwrap()[0].status = StatusCode::TOO_MANY_REQUESTS;
    proxy.responses.lock().unwrap()[0]
        .headers
        .insert(http::header::RETRY_AFTER, "10".parse().unwrap());
    let user = MacroUserIdStr::try_from_email("owner@example.com").unwrap();
    let connections = Connections::new(
        Arc::new(support::Store),
        Some(proxy.clone()),
        "linear",
        Duration::from_secs(1),
    );
    let a = connections.open(&user).await.unwrap();
    let b = connections.open(&user).await.unwrap();
    assert!(Arc::ptr_eq(&a.pacer, &b.pacer));
    let started = Instant::now();
    assert_eq!(
        a.read(Method::POST, "https://api.linear.app/graphql", None)
            .await
            .unwrap(),
        json!({"ok":true})
    );
    assert_eq!(Instant::now() - started, Duration::from_secs(10));
    b.read(Method::POST, "https://api.linear.app/graphql", None)
        .await
        .unwrap();
    assert_eq!(Instant::now() - started, Duration::from_secs(11));
}
