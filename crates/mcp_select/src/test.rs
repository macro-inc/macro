use super::*;
use macro_user_id::user_id::MacroUserIdStr;
use mcp_client::domain::models::{McpServerRecord, StoredCredentials};
use mcp_client::domain::ports::McpServerStore;
use pipedream_mcp::domain::models::PipedreamConnection;
use pipedream_mcp::domain::ports::{ConnectionStore, McpConnection};
use std::sync::{Arc, Mutex};

const LINEAR_URL: &str = "http://127.0.0.1:1/linear";

fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from("macro|tester@macro.com".to_string()).expect("valid test user id")
}

fn linear() -> ConnectorRef<'static> {
    ConnectorRef {
        pipedream_app_slug: "linear",
        native_server_url: LINEAR_URL,
    }
}

struct MemoryNative(Mutex<Vec<McpServerRecord>>);
struct MemoryPipedream(Mutex<Vec<PipedreamConnection>>);

impl McpServerStore for MemoryNative {
    type Err = anyhow::Error;

    async fn save(&self, record: &McpServerRecord) -> Result<(), Self::Err> {
        self.0.lock().unwrap().push(record.clone());
        Ok(())
    }

    async fn load(
        &self,
        user_id: &MacroUserIdStr<'static>,
        server_url: &str,
    ) -> Result<Option<McpServerRecord>, Self::Err> {
        Ok(self
            .0
            .lock()
            .unwrap()
            .iter()
            .find(|r| &r.user_id == user_id && r.url == server_url)
            .cloned())
    }

    async fn delete(
        &self,
        user_id: &MacroUserIdStr<'static>,
        server_url: &str,
    ) -> Result<(), Self::Err> {
        self.0
            .lock()
            .unwrap()
            .retain(|r| !(&r.user_id == user_id && r.url == server_url));
        Ok(())
    }

    async fn list(
        &self,
        user_id: &MacroUserIdStr<'static>,
    ) -> Result<Vec<McpServerRecord>, Self::Err> {
        Ok(self
            .0
            .lock()
            .unwrap()
            .iter()
            .filter(|r| &r.user_id == user_id)
            .cloned()
            .collect())
    }
}

impl ConnectionStore for MemoryPipedream {
    type Err = anyhow::Error;

    async fn save(&self, record: &PipedreamConnection) -> Result<(), Self::Err> {
        self.0.lock().unwrap().push(record.clone());
        Ok(())
    }

    async fn load(
        &self,
        user_id: &MacroUserIdStr<'static>,
        app_slug: &str,
    ) -> Result<Option<PipedreamConnection>, Self::Err> {
        Ok(self
            .0
            .lock()
            .unwrap()
            .iter()
            .find(|r| &r.user_id == user_id && r.app_slug == app_slug)
            .cloned())
    }

    async fn delete(
        &self,
        user_id: &MacroUserIdStr<'static>,
        app_slug: &str,
    ) -> Result<(), Self::Err> {
        self.0
            .lock()
            .unwrap()
            .retain(|r| !(&r.user_id == user_id && r.app_slug == app_slug));
        Ok(())
    }

    async fn list(
        &self,
        user_id: &MacroUserIdStr<'static>,
    ) -> Result<Vec<PipedreamConnection>, Self::Err> {
        Ok(self
            .0
            .lock()
            .unwrap()
            .iter()
            .filter(|r| &r.user_id == user_id)
            .cloned()
            .collect())
    }
}

struct FailingConnection;

impl McpConnection for FailingConnection {
    async fn connect(
        &self,
        _record: &PipedreamConnection,
    ) -> anyhow::Result<pipedream_mcp::domain::models::McpServer> {
        anyhow::bail!("test connection refuses");
    }
}

fn native_linear() -> McpServerRecord {
    McpServerRecord {
        user_id: user(),
        url: LINEAR_URL.to_string(),
        server_name: "Linear".to_string(),
        credentials: Some(StoredCredentials::new(
            "client".into(),
            None,
            Vec::new(),
            None,
        )),
        // Selection keys off row presence; skip HTTP in McpToolSet::new.
        enabled: false,
    }
}

fn pipedream_slack() -> PipedreamConnection {
    PipedreamConnection {
        user_id: user(),
        app_slug: "slack".into(),
        server_name: "Slack".into(),
        account_id: "apn_slack".into(),
        enabled: true,
    }
}

fn pipedream_linear() -> PipedreamConnection {
    PipedreamConnection {
        user_id: user(),
        app_slug: "linear".into(),
        server_name: "Linear".into(),
        account_id: "apn_linear".into(),
        enabled: true,
    }
}

fn selector(
    native: Vec<McpServerRecord>,
    pipedream: Vec<PipedreamConnection>,
) -> McpToolSelector<MemoryNative, MemoryPipedream, FailingConnection> {
    McpToolSelector::new(
        Arc::new(MemoryNative(Mutex::new(native))),
        Arc::new(MemoryPipedream(Mutex::new(pipedream))),
        Arc::new(FailingConnection),
    )
}

#[tokio::test]
async fn only_pipedream_rows_select_pipedream() {
    let tools = selector(vec![], vec![pipedream_slack()])
        .user_toolset(&user())
        .await;
    assert!(matches!(tools, UserMcpTools::Pipedream(_)));
}

#[tokio::test]
async fn only_native_rows_select_native() {
    let tools = selector(vec![native_linear()], vec![])
        .user_toolset(&user())
        .await;
    assert!(matches!(tools, UserMcpTools::Native(_)));
}

#[tokio::test]
async fn both_stacks_select_both() {
    let tools = selector(vec![native_linear()], vec![pipedream_slack()])
        .user_toolset(&user())
        .await;
    assert!(matches!(tools, UserMcpTools::Both { .. }));
}

#[tokio::test]
async fn native_linear_stays_connected_when_slack_is_on_pipedream() {
    let connected = selector(vec![native_linear()], vec![pipedream_slack()])
        .connector_connected(&user(), linear())
        .await
        .unwrap();
    assert!(connected);
}

#[tokio::test]
async fn linear_native_url_returns_native_when_slack_is_on_pipedream() {
    let tools = selector(vec![native_linear()], vec![pipedream_slack()])
        .connector_toolset(&user(), linear())
        .await
        .unwrap();
    assert!(matches!(tools, Some(UserMcpTools::Native(_))));
}

#[tokio::test]
async fn pipedream_slug_returns_pipedream_when_that_slug_is_connected() {
    let tools = selector(vec![native_linear()], vec![pipedream_linear()])
        .connector_toolset(&user(), linear())
        .await
        .unwrap();
    assert!(matches!(tools, Some(UserMcpTools::Pipedream(_))));
}

#[test]
fn pipedream_first_keeps_pipedream_names_and_drops_native_collisions() {
    let merged = pipedream_first(
        vec!["linear".to_owned(), "slack".to_owned()],
        vec!["linear".to_owned(), "github".to_owned()],
        String::as_str,
    );
    assert_eq!(merged, ["linear", "slack", "github"]);
}

#[tokio::test]
async fn empty_user_is_native_and_empty() {
    let tools = selector(vec![], vec![]).user_toolset(&user()).await;
    assert!(matches!(tools, UserMcpTools::Native(_)));
    assert!(tools.is_empty());
}
