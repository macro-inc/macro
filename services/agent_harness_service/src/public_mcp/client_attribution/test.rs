use super::*;
use crate::public_mcp::test_support::MemoryStore;

fn client(name: &str) -> ClientInfo {
    ClientInfo {
        name: Some(name.to_owned()),
        version: Some("1.0".to_owned()),
        user_agent: None,
    }
}

#[tokio::test]
async fn a_tool_call_is_attributed_to_the_client_its_token_initialized_with() {
    let attribution = ClientAttribution::new(MemoryStore::default());
    attribution
        .remember("token-a", "macro|a@example.com", &client("claude-code"))
        .await;

    let found = attribution
        .client_for("token-a", "macro|a@example.com")
        .await;

    assert_eq!(found, Some(client("claude-code")));
}

#[tokio::test]
async fn attribution_is_shared_across_instances() {
    let shared = MemoryStore::default();
    let instance_a = ClientAttribution::new(shared.clone());
    let instance_b = ClientAttribution::new(shared);
    instance_a
        .remember("token-a", "macro|a@example.com", &client("codex"))
        .await;

    let found = instance_b
        .client_for("token-a", "macro|a@example.com")
        .await;

    assert_eq!(found, Some(client("codex")));
}

#[tokio::test]
async fn a_refreshed_token_falls_back_to_the_persons_last_client() {
    let attribution = ClientAttribution::new(MemoryStore::default());
    attribution
        .remember("old-token", "macro|a@example.com", &client("claude-code"))
        .await;

    let found = attribution
        .client_for("refreshed-token", "macro|a@example.com")
        .await;

    assert_eq!(found, Some(client("claude-code")));
}

#[tokio::test]
async fn the_handshake_name_wins_over_the_registered_name() {
    let attribution = ClientAttribution::new(MemoryStore::default());
    attribution
        .remember("token-a", "macro|a@example.com", &client("claude-code"))
        .await;

    attribution
        .remember_if_unknown(
            "token-a",
            "macro|a@example.com",
            &client("Claude Code (macro)"),
        )
        .await;

    assert_eq!(
        attribution
            .client_for("token-a", "macro|a@example.com")
            .await,
        Some(client("claude-code"))
    );
}

#[tokio::test]
async fn tokens_are_stored_as_digests() {
    let store = MemoryStore::default();
    let attribution = ClientAttribution::new(store.clone());

    attribution
        .remember("secret-token", "macro|a@example.com", &client("codex"))
        .await;

    let keys: Vec<String> = store.entries.lock().unwrap().keys().cloned().collect();
    assert!(keys.iter().all(|key| !key.contains("secret-token")));
}

#[tokio::test]
async fn an_unknown_person_has_no_client() {
    let attribution = ClientAttribution::new(MemoryStore::default());

    assert_eq!(
        attribution
            .client_for("token", "macro|nobody@example.com")
            .await,
        None
    );
}
