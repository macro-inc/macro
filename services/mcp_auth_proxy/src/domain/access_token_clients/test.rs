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
        clients.issued_client("access-token").await.unwrap(),
        Some(IssuedClient {
            id: "client-1".to_owned(),
            name: Some("Claude Code".to_owned()),
        })
    );
    assert_eq!(clients.issued_client("another-token").await.unwrap(), None);
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
        clients
            .issued_client("access-token")
            .await
            .unwrap()
            .and_then(|client| client.name),
        Some("x".repeat(64))
    );
}

#[tokio::test]
async fn a_stored_name_registered_before_the_rules_is_held_to_them() {
    let registry = Arc::new(FakeClientRegistry::default());
    for (client_id, client_name) in [
        ("reserved", "Macro Support"),
        ("bidi", "Claude\u{202e} Code"),
    ] {
        registry
            .insert_client(&RegisteredClient {
                client_id: client_id.to_owned(),
                client_name: client_name.to_owned(),
                redirect_uris: vec![],
            })
            .await
            .unwrap();
    }
    let clients = clients(&registry);
    for client_id in ["reserved", "bidi"] {
        clients
            .bind(
                &format!("{client_id}-token"),
                &RefreshTokenBinding {
                    client_id: client_id.to_owned(),
                    grant_id: "grant-1".to_owned(),
                },
            )
            .await
            .unwrap();
    }

    assert_eq!(
        clients
            .issued_client("reserved-token")
            .await
            .unwrap()
            .and_then(|client| client.name),
        None
    );
    assert_eq!(
        clients
            .issued_client("bidi-token")
            .await
            .unwrap()
            .and_then(|client| client.name)
            .as_deref(),
        Some("Claude Code")
    );
}
