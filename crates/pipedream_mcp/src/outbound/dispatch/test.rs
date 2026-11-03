use super::*;
use reqwest::header::HeaderMap;
use url::Url;

/// One backend: answers with its own name, and knows `apps` by slug.
struct Fake {
    name: &'static str,
    apps: &'static [&'static str],
    /// Whether the caller holds a connection, for gateway tool listings.
    connected: bool,
}

const PIPEDREAM: Fake = Fake {
    name: "pipedream",
    apps: &["linear", "notion"],
    connected: false,
};

fn connect(connected: bool) -> Fake {
    Fake {
        name: "connect",
        apps: &["linear", "airtable_oauth"],
        connected,
    }
}

fn backends(connect: Option<Fake>) -> ConnectorBackends<Fake, Fake> {
    ConnectorBackends::new(Arc::new(PIPEDREAM), connect.map(Arc::new))
}

fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email("caller@example.com").unwrap()
}

fn record(provider: ConnectionProvider) -> PipedreamConnection {
    PipedreamConnection {
        user_id: user(),
        app_slug: "linear".into(),
        server_name: "Linear".into(),
        account_id: "id".into(),
        enabled: true,
        provider,
    }
}

impl McpUpstream for Fake {
    async fn upstream(&self, _record: &PipedreamConnection) -> anyhow::Result<McpUpstreamCall> {
        Ok(McpUpstreamCall {
            url: Url::parse(&format!("https://{}.test/mcp", self.name)).unwrap(),
            bearer_token: self.name.into(),
            headers: HeaderMap::new(),
        })
    }
}

impl ConnectorCapabilities for Fake {
    async fn tools(
        &self,
        _user_id: &MacroUserIdStr<'static>,
        app_slug: &str,
    ) -> anyhow::Result<Vec<ConnectorTool>> {
        if self.name == "connect" && !self.connected {
            anyhow::bail!("not connected");
        }
        Ok(vec![ConnectorTool {
            name: format!("{}_{app_slug}", self.name),
            description: String::new(),
        }])
    }
}

impl ConnectorDirectory for Fake {
    async fn search(
        &self,
        _search: Option<&str>,
        _cursor: Option<&str>,
        _limit: u32,
    ) -> anyhow::Result<CatalogPage> {
        Ok(CatalogPage::default())
    }

    async fn retrieve(&self, app_slug: &str) -> anyhow::Result<Option<CatalogEntry>> {
        Ok(self.apps.contains(&app_slug).then(|| CatalogEntry {
            app_slug: app_slug.to_owned(),
            display_name: self.name.to_owned(),
            description: None,
            icon_url: None,
            categories: Vec::new(),
        }))
    }
}

impl MacroConnect for Fake {
    async fn app_for_slug(&self, app_slug: &str) -> anyhow::Result<Option<ConnectApp>> {
        Ok(self.apps.contains(&app_slug).then(|| ConnectApp {
            app_id: app_slug.to_owned(),
            app_slug: app_slug.to_owned(),
            name: app_slug.to_owned(),
        }))
    }

    async fn create_connect_session(
        &self,
        _user_id: &MacroUserIdStr<'static>,
        _app: &ConnectApp,
    ) -> anyhow::Result<String> {
        Ok(format!("https://{}.test/session", self.name))
    }

    async fn is_connected(
        &self,
        _user_id: &MacroUserIdStr<'static>,
        _app_id: &str,
    ) -> anyhow::Result<bool> {
        Ok(self.connected)
    }

    async fn delete_connection(
        &self,
        _user_id: &MacroUserIdStr<'static>,
        _app_id: &str,
    ) -> anyhow::Result<()> {
        Ok(())
    }
}

#[tokio::test]
async fn each_record_reaches_the_backend_holding_its_grant() {
    let backends = backends(Some(connect(true)));

    let pipedream = backends
        .upstream(&record(ConnectionProvider::Pipedream))
        .await
        .unwrap();
    let connect = backends
        .upstream(&record(ConnectionProvider::Connect))
        .await
        .unwrap();

    assert_eq!(pipedream.bearer_token, "pipedream");
    assert_eq!(connect.bearer_token, "connect");
}

#[tokio::test]
async fn a_connect_record_without_connect_configured_is_an_error() {
    let backends = backends(None);

    let error = backends
        .upstream(&record(ConnectionProvider::Connect))
        .await
        .unwrap_err();

    assert!(error.to_string().contains("not configured"), "{error}");
}

#[tokio::test]
async fn tools_come_from_connect_only_for_a_connect_connection() {
    let user = user();

    let connected = backends(Some(connect(true)));
    let not_connected = backends(Some(connect(false)));
    let unconfigured = backends(None);

    assert_eq!(
        connected.tools(&user, "linear").await.unwrap()[0].name,
        "connect_linear"
    );
    assert_eq!(
        not_connected.tools(&user, "linear").await.unwrap()[0].name,
        "pipedream_linear"
    );
    // Connect does not serve Notion, so it is never asked.
    assert_eq!(
        connected.tools(&user, "notion").await.unwrap()[0].name,
        "pipedream_notion"
    );
    assert_eq!(
        unconfigured.tools(&user, "linear").await.unwrap()[0].name,
        "pipedream_linear"
    );
}

#[tokio::test]
async fn retrieve_prefers_pipedream_and_falls_back_to_connect() {
    let backends = backends(Some(connect(false)));

    let linear = backends.retrieve("linear").await.unwrap().unwrap();
    let airtable = backends.retrieve("airtable_oauth").await.unwrap().unwrap();

    assert_eq!(linear.display_name, "pipedream");
    assert_eq!(airtable.display_name, "connect");
    assert_eq!(backends.retrieve("unknown").await.unwrap(), None);
}

#[tokio::test]
async fn without_connect_no_app_routes_through_it() {
    let backends = backends(None);

    assert_eq!(backends.app_for_slug("linear").await.unwrap(), None);
    assert!(!backends.is_connected(&user(), "linear").await.unwrap());
}
