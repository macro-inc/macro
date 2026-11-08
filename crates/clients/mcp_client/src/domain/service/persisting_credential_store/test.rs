use super::*;
use crate::domain::models::MacroUserIdStr;
use macro_user_id::cowlike::CowLike;
use std::sync::Mutex;

/// In-memory [`McpServerStore`] fake that records every save.
struct FakeServerStore {
    saved: Mutex<Vec<McpServerRecord>>,
    fail_saves: bool,
}

impl FakeServerStore {
    fn new() -> Self {
        Self {
            saved: Mutex::new(Vec::new()),
            fail_saves: false,
        }
    }

    fn failing() -> Self {
        Self {
            saved: Mutex::new(Vec::new()),
            fail_saves: true,
        }
    }

    fn saved(&self) -> Vec<McpServerRecord> {
        self.saved.lock().unwrap().clone()
    }
}

impl McpServerStore for FakeServerStore {
    type Err = anyhow::Error;

    async fn save(&self, record: &McpServerRecord) -> Result<(), Self::Err> {
        if self.fail_saves {
            anyhow::bail!("store unavailable");
        }
        self.saved.lock().unwrap().push(record.clone());
        Ok(())
    }

    async fn load(
        &self,
        _user_id: &MacroUserIdStr<'static>,
        _server_url: &str,
    ) -> Result<Option<McpServerRecord>, Self::Err> {
        unimplemented!()
    }

    async fn delete(
        &self,
        _user_id: &MacroUserIdStr<'static>,
        _server_url: &str,
    ) -> Result<(), Self::Err> {
        unimplemented!()
    }

    async fn list(
        &self,
        _user_id: &MacroUserIdStr<'static>,
    ) -> Result<Vec<McpServerRecord>, Self::Err> {
        unimplemented!()
    }
}

fn record() -> McpServerRecord {
    McpServerRecord {
        user_id: MacroUserIdStr::parse_from_str("macro|test@example.com")
            .unwrap()
            .into_owned(),
        url: "https://mcp.linear.app/mcp".to_string(),
        server_name: "Linear".to_string(),
        credentials: None,
        enabled: true,
    }
}

fn credentials(received_at: u64) -> StoredCredentials {
    StoredCredentials::new("client-id".to_string(), None, vec![], Some(received_at))
}

#[tokio::test]
async fn seed_loads_without_persisting() {
    let store = Arc::new(FakeServerStore::new());
    let creds_store = PersistingCredentialStore::new(record(), store.clone());

    creds_store.seed(credentials(1)).await.unwrap();

    let loaded = creds_store.load().await.unwrap().unwrap();
    assert_eq!(loaded.client_id, "client-id");
    assert_eq!(loaded.token_received_at, Some(1));
    assert!(store.saved().is_empty(), "seed must not persist");
}

#[tokio::test]
async fn save_writes_through_to_server_store() {
    let store = Arc::new(FakeServerStore::new());
    let creds_store = PersistingCredentialStore::new(record(), store.clone());

    creds_store.save(credentials(2)).await.unwrap();

    let saved = store.saved();
    assert_eq!(saved.len(), 1);
    let persisted = &saved[0];
    assert_eq!(persisted.url, "https://mcp.linear.app/mcp");
    assert_eq!(persisted.server_name, "Linear");
    assert!(persisted.enabled);
    let creds = persisted.credentials.as_ref().unwrap();
    assert_eq!(creds.client_id, "client-id");
    assert_eq!(creds.token_received_at, Some(2));

    // The in-memory view is updated as well.
    let loaded = creds_store.load().await.unwrap().unwrap();
    assert_eq!(loaded.token_received_at, Some(2));
}

#[tokio::test]
async fn save_survives_store_failure() {
    let store = Arc::new(FakeServerStore::failing());
    let creds_store = PersistingCredentialStore::new(record(), store.clone());

    // A persist failure must not fail the save: the refreshed credentials
    // stay usable for the rest of the connection.
    creds_store.save(credentials(3)).await.unwrap();

    let loaded = creds_store.load().await.unwrap().unwrap();
    assert_eq!(loaded.token_received_at, Some(3));
    assert!(store.saved().is_empty());
}

#[tokio::test]
async fn clear_is_session_local() {
    let store = Arc::new(FakeServerStore::new());
    let creds_store = PersistingCredentialStore::new(record(), store.clone());

    creds_store.seed(credentials(4)).await.unwrap();
    creds_store.clear().await.unwrap();

    assert!(creds_store.load().await.unwrap().is_none());
    assert!(
        store.saved().is_empty(),
        "clear must not touch the server store"
    );
}
