use super::*;
use mcp_client_label::McpClientKind;
use crate::{domain::models::RegisteredClient, test_support::FakeClientRegistry};

fn clients(registry: &Arc<FakeClientRegistry>) -> AccessTokenClients {
    AccessTokenClients::new(
        Arc::clone(registry) as Arc<dyn RefreshTokenBindingStore>,
        Arc::clone(registry) as Arc<dyn ClientRegistrationStore>,
    )
}

#[tokio::test]
async fn an_access_token_names_the_client_it_was_issued_to() {
    let registry = Arc::new(FakeClientRegistry::default());
    registry
        .insert_client(&RegisteredClient {
            client_id: "client-1".to_owned(),
            client_name: "Claude Code (macro)".to_owned(),
            redirect_uris: vec!["http://localhost:53581/callback".to_owned()],
        })
        .await
        .unwrap();
    let clients = clients(&registry);
    clients
        .bind(
            "access-token",
            &RefreshTokenBinding {
                client_id: "client-1".to_owned(),
                grant_id: "grant-1".to_owned(),
            },
        )
        .await
        .unwrap();

    assert_eq!(
        clients.client("access-token").await.unwrap(),
        Some(McpClientLabel {
            name: "Claude Code (macro)".to_owned(),
            kind: Some(McpClientKind::ClaudeCode),
        })
    );
    assert_eq!(clients.client("another-token").await.unwrap(), None);
}

#[tokio::test]
async fn a_long_self_reported_name_is_cut_to_a_label() {
    let registry = Arc::new(FakeClientRegistry::default());
    registry
        .insert_client(&RegisteredClient {
            client_id: "client-1".to_owned(),
            client_name: "x".repeat(500),
            redirect_uris: vec![],
        })
        .await
        .unwrap();
    let clients = clients(&registry);
    clients
        .bind(
            "access-token",
            &RefreshTokenBinding {
                client_id: "client-1".to_owned(),
                grant_id: "grant-1".to_owned(),
            },
        )
        .await
        .unwrap();

    assert_eq!(
        clients.client("access-token").await.unwrap(),
        Some(McpClientLabel {
            name: "x".repeat(64),
            kind: None,
        })
    );
}

#[tokio::test]
async fn a_client_claiming_a_product_its_redirect_uris_contradict_has_no_kind() {
    let registry = Arc::new(FakeClientRegistry::default());
    registry
        .insert_client(&RegisteredClient {
            client_id: "client-1".to_owned(),
            client_name: "Claude".to_owned(),
            redirect_uris: vec!["https://evil.example/callback".to_owned()],
        })
        .await
        .unwrap();
    let clients = clients(&registry);
    clients
        .bind(
            "access-token",
            &RefreshTokenBinding {
                client_id: "client-1".to_owned(),
                grant_id: "grant-1".to_owned(),
            },
        )
        .await
        .unwrap();

    assert_eq!(
        clients.client("access-token").await.unwrap(),
        Some(McpClientLabel {
            name: "Claude".to_owned(),
            kind: None,
        })
    );
}
