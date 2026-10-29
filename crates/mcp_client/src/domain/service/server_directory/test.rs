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
        .add(
            owner(),
            "  https://mcp.linear.app/mcp ",
            " Linear ",
            AddedBy::User,
        )
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
        .add(
            owner(),
            "https://mcp.linear.app/mcp",
            "Renamed",
            AddedBy::User,
        )
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
        let result = directory.add(owner(), url, "Linear", AddedBy::User).await;
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
        .add(owner(), "https://mcp.linear.app/mcp", "   ", AddedBy::User)
        .await;

    assert!(
        matches!(result, Err(AddServerError::EmptyName)),
        "{result:?}"
    );
}

#[tokio::test]
async fn an_agent_may_not_add_a_non_public_or_cleartext_destination() {
    let store = Arc::new(FakeServerStore::default());
    let directory = ServerDirectory::new(store.clone());

    for url in [
        "http://mcp.linear.app/mcp",
        "https://localhost/mcp",
        "https://tools.localhost/mcp",
        "https://metadata.google.internal/mcp",
        "https://printer.local/mcp",
        "https://127.0.0.1/mcp",
        "https://10.1.2.3/mcp",
        "https://172.16.0.1/mcp",
        "https://192.168.1.1/mcp",
        "https://169.254.169.254/latest/meta-data",
        "https://100.64.0.1/mcp",
        "https://0.0.0.0/mcp",
        "https://[::1]/mcp",
        "https://[fd00::1]/mcp",
        "https://[fe80::1]/mcp",
        "https://[::ffff:127.0.0.1]/mcp",
    ] {
        let result = directory
            .add(owner(), url, "Internal", AddedBy::Agent)
            .await;
        assert!(
            matches!(result, Err(AddServerError::NonPublicDestination(_))),
            "{url}: {result:?}"
        );
    }
    assert!(store.records.lock().unwrap().is_empty());
}

#[tokio::test]
async fn an_agent_may_add_a_public_https_destination() {
    let directory = ServerDirectory::new(Arc::new(FakeServerStore::default()));

    for url in ["https://mcp.linear.app/mcp", "https://8.8.8.8/mcp"] {
        let result = directory.add(owner(), url, "Public", AddedBy::Agent).await;
        assert!(
            matches!(result, Ok(AddedServer::New(_))),
            "{url}: {result:?}"
        );
    }
}

#[tokio::test]
async fn a_user_may_still_add_a_cleartext_or_local_destination() {
    let directory = ServerDirectory::new(Arc::new(FakeServerStore::default()));

    let result = directory
        .add(owner(), "http://localhost:8080/mcp", "Local", AddedBy::User)
        .await;

    assert!(matches!(result, Ok(AddedServer::New(_))), "{result:?}");
}
