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

/// Pipedream and Connect, with the rollout answering `on` for everyone.
fn rolled_out(on: bool) -> ConnectorBackends<Fake, Fake> {
    backends(Some(connect(true))).with_rollout(Arc::new(move |_| Box::pin(async move { on })))
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
        _user_id: &MacroUserIdStr<'static>,
        _search: Option<&str>,
        _cursor: Option<&str>,
        _limit: u32,
    ) -> anyhow::Result<CatalogPage> {
        Ok(CatalogPage {
            entries: vec![CatalogEntry {
                app_slug: self.name.to_owned(),
                display_name: self.name.to_owned(),
                description: None,
                icon_url: None,
                categories: Vec::new(),
                org_setup: None,
            }],
            next_cursor: None,
        })
    }

    async fn retrieve(
        &self,
        _user_id: &MacroUserIdStr<'static>,
        app_slug: &str,
    ) -> anyhow::Result<Option<CatalogEntry>> {
        Ok(self.apps.contains(&app_slug).then(|| CatalogEntry {
            app_slug: app_slug.to_owned(),
            display_name: self.name.to_owned(),
            description: None,
            icon_url: None,
            categories: Vec::new(),
            org_setup: None,
        }))
    }
}

impl MacroConnect for Fake {
    async fn connect_only(&self, _user_id: &MacroUserIdStr<'static>) -> bool {
        self.name == "connect"
    }

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
async fn a_user_on_connect_alone_never_reaches_pipedream() {
    let user = user();
    let backends = rolled_out(true);

    assert!(backends.connect_only(&user).await);
    assert_eq!(
        backends
            .search(&user, None, None, 10)
            .await
            .unwrap()
            .entries[0]
            .app_slug,
        "connect"
    );
    assert_eq!(
        backends
            .retrieve(&user, "airtable_oauth")
            .await
            .unwrap()
            .unwrap()
            .display_name,
        "connect"
    );
    // Pipedream serves Notion; Connect does not, and nothing falls back.
    assert_eq!(backends.retrieve(&user, "notion").await.unwrap(), None);
    assert_eq!(
        backends.tools(&user, "linear").await.unwrap()[0].name,
        "connect_linear"
    );
    let error = backends
        .upstream(&record(ConnectionProvider::Pipedream))
        .await
        .unwrap_err();
    assert!(
        error
            .to_string()
            .contains("reconnect it through Macro Connect"),
        "{error}"
    );
    assert_eq!(
        backends
            .upstream(&record(ConnectionProvider::Connect))
            .await
            .unwrap()
            .bearer_token,
        "connect"
    );
}

#[tokio::test]
async fn with_the_rollout_off_everything_stays_on_pipedream() {
    let user = user();

    for backends in [
        rolled_out(false),
        backends(Some(connect(true))),
        backends(None),
    ] {
        assert!(!backends.connect_only(&user).await);
        assert_eq!(
            backends
                .search(&user, None, None, 10)
                .await
                .unwrap()
                .entries[0]
                .app_slug,
            "pipedream"
        );
        assert_eq!(
            backends.tools(&user, "linear").await.unwrap()[0].name,
            "pipedream_linear"
        );
        assert_eq!(
            backends.retrieve(&user, "airtable_oauth").await.unwrap(),
            None
        );
        assert_eq!(
            backends
                .upstream(&record(ConnectionProvider::Pipedream))
                .await
                .unwrap()
                .bearer_token,
            "pipedream"
        );
    }
}

#[tokio::test]
async fn without_connect_no_app_routes_through_it() {
    let backends = backends(None);

    assert_eq!(backends.app_for_slug("linear").await.unwrap(), None);
    assert!(!backends.is_connected(&user(), "linear").await.unwrap());
}
