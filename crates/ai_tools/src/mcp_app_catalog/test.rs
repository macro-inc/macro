use super::*;
use connectors::fake::FakeConnectors;

fn catalog(fake: &FakeConnectors) -> ConnectorsAppCatalog<connectors::Connectors> {
    ConnectorsAppCatalog::new(Some(fake.build()))
}

#[tokio::test]
async fn a_catalog_app_can_be_pinned_and_an_unknown_one_cannot() {
    let catalog = catalog(&FakeConnectors::new().with_catalog_app("linear"));

    assert!(catalog.is_connectable_app("linear").await.unwrap());
    assert!(!catalog.is_connectable_app("not-an-app").await.unwrap());
}

#[tokio::test]
async fn an_overlaid_app_can_be_pinned_without_a_hosted_directory_listing_it() {
    let catalog =
        catalog(&FakeConnectors::new().with_overlay("figma", "https://mcp.figma.com/mcp"));

    assert!(catalog.is_connectable_app("figma").await.unwrap());
}

#[tokio::test]
async fn github_can_be_pinned_through_the_account_link() {
    let catalog = catalog(&FakeConnectors::new());

    assert!(catalog.is_connectable_app("github").await.unwrap());
}

#[tokio::test]
async fn an_alias_pins_the_app_it_names() {
    let catalog = catalog(&FakeConnectors::new().with_catalog_app("slack"));

    assert!(catalog.is_connectable_app("slack_v2").await.unwrap());
}

#[tokio::test]
async fn a_malformed_slug_is_not_an_app() {
    let catalog = catalog(&FakeConnectors::new().with_catalog_app("linear"));

    assert!(!catalog.is_connectable_app("Linear!").await.unwrap());
}

#[tokio::test]
async fn a_host_without_connectors_refuses_every_slug() {
    let catalog = ConnectorsAppCatalog::<connectors::Connectors>::new(None);

    let error = catalog
        .is_connectable_app("linear")
        .await
        .expect_err("nothing to verify against");
    assert!(matches!(error, BotError::Unavailable(message) if message.contains("not configured")));
}
