use super::*;
use crate::domain::models::{MacroUserIdStr, McpServerRecord};
use macro_user_id::cowlike::CowLike;
use std::sync::{Arc, Mutex};

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
async fn connecting_a_new_server_adds_it_for_the_caller_and_asks_them_to_sign_in() {
    let store = Arc::new(FakeServerStore::default());
    let context = McpServerToolContext::wired(ServerDirectory::new(store.clone()));

    let response = ConnectMcpServer {
        url: "https://mcp.linear.app/mcp".to_owned(),
        server_name: "Linear".to_owned(),
    }
    .call(ServiceContext(context), RequestContext::new(owner()))
    .await
    .unwrap();

    assert_eq!(response.url, "https://mcp.linear.app/mcp");
    assert_eq!(response.server_name, "Linear");
    assert!(!response.already_connected);
    assert!(!response.authenticated);
    assert!(response.enabled);
    assert_eq!(
        response.summary,
        "Added Linear. If it needs a sign-in, the user must open Settings → Connections and click Connect next to Linear."
    );
    assert!(
        store
            .load(&owner(), "https://mcp.linear.app/mcp")
            .await
            .unwrap()
            .is_some()
    );
}

#[tokio::test]
async fn an_invalid_url_is_reported_to_the_model() {
    let context =
        McpServerToolContext::wired(ServerDirectory::new(Arc::new(FakeServerStore::default())));

    let error = ConnectMcpServer {
        url: "linear".to_owned(),
        server_name: "Linear".to_owned(),
    }
    .call(ServiceContext(context), RequestContext::new(owner()))
    .await
    .unwrap_err();

    assert_eq!(error.description, "`linear` is not an http(s) URL");
}

#[tokio::test]
async fn an_unwired_host_refuses_the_call() {
    let context = McpServerToolContext::<FakeServerStore>::unwired();

    let error = ConnectMcpServer {
        url: "https://mcp.linear.app/mcp".to_owned(),
        server_name: "Linear".to_owned(),
    }
    .call(ServiceContext(context), RequestContext::new(owner()))
    .await
    .unwrap_err();

    assert_eq!(
        error.description,
        "Connecting MCP servers is not available here."
    );
}
