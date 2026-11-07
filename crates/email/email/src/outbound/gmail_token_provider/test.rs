use super::*;

#[tokio::test]
async fn lazy_connection_does_not_require_redis_at_construction_and_failures_remain_retryable() {
    let provider = GmailTokenProviderImpl::lazy(
        // Port zero is deliberately unavailable; no shared Redis or auth server
        // is needed to verify the host can construct its optional capability.
        redis::Client::open("redis://127.0.0.1:0").unwrap(),
        Arc::new(AuthServiceClient::new(
            "test-key".to_owned(),
            "http://127.0.0.1:0".to_owned(),
        )),
    );
    let TokenCacheConnection::Lazy { connection, .. } = &provider.redis_conn else {
        panic!("expected lazy token cache");
    };
    assert!(!connection.initialized());
    for _ in 0..2 {
        assert!(matches!(
            provider.connection().await,
            Err(EmailErr::ProviderErr(_))
        ));
        assert!(
            !connection.initialized(),
            "a failed attempt must not poison subsequent initialization"
        );
    }
}
