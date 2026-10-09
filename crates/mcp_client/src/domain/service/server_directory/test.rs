use super::*;
use crate::domain::models::StoredCredentials;
use macro_user_id::cowlike::CowLike;
use std::sync::Mutex;

/// In-memory [`McpServerStore`] keyed by user and URL.
#[derive(Default)]
struct FakeServerStore {
    records: Mutex<Vec<McpServerRecord>>,
}

impl McpServerStore for FakeServerStore {
    type Err = anyhow::Error;

    async fn save(&self, record: &McpServerRecord) -> Result<(), Self::Err> {
        let mut records = self.records.lock().unwrap();
        records.retain(|stored| !(stored.user_id == record.user_id && stored.url == record.url));
        records.push(record.clone());
        Ok(())
    }

    async fn load(
        &self,
        user_id: &MacroUserIdStr<'static>,
        server_url: &str,
    ) -> Result<Option<McpServerRecord>, Self::Err> {
        Ok(self
            .records
            .lock()
            .unwrap()
            .iter()
            .find(|stored| &stored.user_id == user_id && stored.url == server_url)
            .cloned())
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

fn owner() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str("macro|owner@example.com")
        .unwrap()
        .into_owned()
}

#[tokio::test]
async fn a_new_url_is_stored_enabled_and_without_credentials() {
    let store = Arc::new(FakeServerStore::default());
    let directory = ServerDirectory::new(store.clone());

    let added = directory
        .add(owner(), "  https://mcp.linear.app/mcp ", " Linear ")
        .await
        .unwrap();

    let AddedServer::New(record) = added else {
        panic!("expected a new server, got {added:?}");
    };
    assert_eq!(record.url, "https://mcp.linear.app/mcp");
    assert_eq!(record.server_name, "Linear");
    assert!(record.enabled);
    assert!(record.credentials.is_none());
    let stored = store
        .load(&owner(), "https://mcp.linear.app/mcp")
        .await
        .unwrap()
        .expect("the server is stored");
    assert_eq!(stored.server_name, "Linear");
}

#[tokio::test]
async fn re_adding_a_url_keeps_the_grant_it_holds() {
    let store = Arc::new(FakeServerStore::default());
    store
        .save(&McpServerRecord {
            user_id: owner(),
            url: "https://mcp.linear.app/mcp".to_owned(),
            server_name: "Linear".to_owned(),
            credentials: Some(StoredCredentials::new(
                "client-id".to_owned(),
                None,
                Vec::new(),
                Some(1_000),
            )),
            enabled: false,
        })
        .await
        .unwrap();
    let directory = ServerDirectory::new(store.clone());

    let added = directory
        .add(owner(), "https://mcp.linear.app/mcp", "Renamed")
        .await
        .unwrap();

    let AddedServer::Existing(record) = added else {
        panic!("expected the existing server, got {added:?}");
    };
    assert_eq!(record.server_name, "Linear");
    assert!(!record.enabled);
    assert!(record.credentials.is_some());
}

#[tokio::test]
async fn a_url_that_is_not_http_is_refused() {
    let directory = ServerDirectory::new(Arc::new(FakeServerStore::default()));

    for url in ["linear", "file:///etc/passwd", "ftp://mcp.example.com"] {
        let result = directory.add(owner(), url, "Linear").await;
        assert!(
            matches!(result, Err(AddServerError::InvalidUrl(_))),
            "{url}: {result:?}"
        );
    }
}

#[tokio::test]
async fn an_empty_name_is_refused() {
    let directory = ServerDirectory::new(Arc::new(FakeServerStore::default()));

    let result = directory
        .add(owner(), "https://mcp.linear.app/mcp", "   ")
        .await;

    assert!(
        matches!(result, Err(AddServerError::EmptyName)),
        "{result:?}"
    );
}
