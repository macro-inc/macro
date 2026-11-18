use std::sync::Arc;

use pipedream_mcp::domain::models::{ConnectApp, ConnectorOverlay};

use super::*;

fn owner() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email("owner@example.com").expect("a valid user id")
}

fn connection(app_slug: &str, provider: ConnectionProvider, enabled: bool) -> PipedreamConnection {
    PipedreamConnection {
        user_id: owner(),
        app_slug: app_slug.to_owned(),
        server_name: format!("{app_slug} name"),
        account_id: format!("apn_{app_slug}"),
        enabled,
        provider,
    }
}

fn app(slug: &str) -> AgentMcpServer {
    AgentMcpServer {
        app_slug: slug.to_owned(),
        server_name: format!("{slug} name"),
    }
}

/// The owner's connections, and the apps overlaid with Macro's own MCP
/// server.
struct Store {
    connections: Vec<PipedreamConnection>,
    overlaid: Vec<&'static str>,
}

impl ConnectionStore for Store {
    type Err = std::convert::Infallible;

    async fn save(&self, _record: &PipedreamConnection) -> Result<(), Self::Err> {
        unreachable!("counting connections never writes")
    }

    async fn load(
        &self,
        _user_id: &MacroUserIdStr<'static>,
        _app_slug: &str,
    ) -> Result<Option<PipedreamConnection>, Self::Err> {
        unreachable!("counting connections lists them")
    }

    async fn delete(
        &self,
        _user_id: &MacroUserIdStr<'static>,
        _app_slug: &str,
    ) -> Result<(), Self::Err> {
        unreachable!("counting connections never deletes")
    }

    async fn list(
        &self,
        _user_id: &MacroUserIdStr<'static>,
    ) -> Result<Vec<PipedreamConnection>, Self::Err> {
        Ok(self.connections.clone())
    }
}

impl ConnectorOverlays for Store {
    async fn overlays(&self) -> anyhow::Result<Vec<ConnectorOverlay>> {
        unreachable!("an app's overlay is looked up by its slug")
    }

    async fn overlay(&self, app_slug: &str) -> anyhow::Result<Option<ConnectorOverlay>> {
        Ok(self.overlaid.contains(&app_slug).then(|| ConnectorOverlay {
            app_slug: app_slug.to_owned(),
            server_url: format!("https://mcp.{app_slug}.example/mcp"),
        }))
    }
}

fn store() -> Store {
    Store {
        connections: vec![
            connection("linear", ConnectionProvider::Pipedream, true),
            connection("notion", ConnectionProvider::Connect, true),
            connection("github", ConnectionProvider::Pipedream, false),
        ],
        overlaid: vec!["sentry"],
    }
}

/// Macro Connect, configured: whether the owner is on it alone, and the
/// apps it serves.
struct Connect {
    only: bool,
    serves: Vec<&'static str>,
}

impl MacroConnect for Connect {
    async fn connect_only(&self, _user_id: &MacroUserIdStr<'static>) -> bool {
        self.only
    }

    async fn app_for_slug(&self, app_slug: &str) -> anyhow::Result<Option<ConnectApp>> {
        Ok(self.serves.contains(&app_slug).then(|| ConnectApp {
            app_id: format!("app_{app_slug}"),
            app_slug: app_slug.to_owned(),
            name: app_slug.to_owned(),
        }))
    }

    async fn create_connect_session(
        &self,
        _user_id: &MacroUserIdStr<'static>,
        _app: &ConnectApp,
    ) -> anyhow::Result<String> {
        unreachable!("counting connections starts no session")
    }

    async fn is_connected(
        &self,
        _user_id: &MacroUserIdStr<'static>,
        _app_id: &str,
    ) -> anyhow::Result<bool> {
        unreachable!("counting connections reads the stored grants")
    }

    async fn delete_connection(
        &self,
        _user_id: &MacroUserIdStr<'static>,
        _app_id: &str,
    ) -> anyhow::Result<()> {
        unreachable!("counting connections never deletes")
    }
}

fn connect(only: bool, serves: &[&'static str]) -> Option<Arc<Connect>> {
    Some(Arc::new(Connect {
        only,
        serves: serves.to_vec(),
    }))
}

/// Enabled grants count, from either backend, as dispatch uses them: a
/// Pipedream grant unless the owner is on Macro Connect alone, and a Connect
/// grant only where Connect is configured.
#[tokio::test]
async fn only_grants_dispatch_would_use_are_connected() {
    let without_connect = PipedreamConnectedApps::new(store(), None::<Arc<Connect>>);
    let beside_pipedream = PipedreamConnectedApps::new(store(), connect(false, &[]));
    let connect_alone = PipedreamConnectedApps::new(store(), connect(true, &[]));

    for (apps, connected) in [
        (&without_connect, vec!["linear"]),
        (&beside_pipedream, vec!["linear", "notion"]),
        (&connect_alone, vec!["notion"]),
    ] {
        assert_eq!(apps.connected_app_slugs(&owner()).await.unwrap(), connected);
        assert_eq!(
            apps.connected(&owner()).await.unwrap(),
            connected.iter().map(|slug| app(slug)).collect::<Vec<_>>()
        );
    }
}

/// An overlaid app connects to its vendor's own MCP server, never to a
/// grant a routine counts, so a routine can't require it. An owner on
/// Connect alone connects every app through Connect and never sees an
/// overlay: they can require exactly the apps Connect serves.
#[tokio::test]
async fn a_missing_app_is_requirable_only_where_its_owner_can_connect_it() {
    let asked = || vec![app("sentry"), app("asana"), app("linear")];
    let without_connect = PipedreamConnectedApps::new(store(), None::<Arc<Connect>>);
    let beside_pipedream = PipedreamConnectedApps::new(store(), connect(false, &["sentry"]));
    let connect_alone = PipedreamConnectedApps::new(store(), connect(true, &["sentry", "asana"]));
    let unserved = PipedreamConnectedApps::new(store(), connect(true, &[]));

    for apps in [&without_connect, &beside_pipedream] {
        assert_eq!(
            apps.requirable(&owner(), asked()).await.unwrap(),
            [app("asana"), app("linear")]
        );
    }
    assert_eq!(
        connect_alone.requirable(&owner(), asked()).await.unwrap(),
        [app("sentry"), app("asana")]
    );
    assert_eq!(unserved.requirable(&owner(), asked()).await.unwrap(), []);
}
