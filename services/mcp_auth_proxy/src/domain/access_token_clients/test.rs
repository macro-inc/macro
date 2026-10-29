use super::*;
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
            client_name: "Claude Code".to_owned(),
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
        clients
            .client_name("access-token")
            .await
            .unwrap()
            .as_deref(),
        Some("Claude Code")
    );
    assert_eq!(clients.client_name("another-token").await.unwrap(), None);
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
        clients.client_name("access-token").await.unwrap(),
        Some("x".repeat(64))
    );
}
