use super::*;

#[tokio::test]
async fn an_unconfigured_catalog_refuses_every_slug() {
    let catalog = PipedreamMcpAppCatalog::new(None);
    let error = catalog
        .is_connectable_app("linear")
        .await
        .expect_err("no directory");
    assert!(matches!(error, BotError::Unavailable(message) if message.contains("not configured")));
}
