use std::sync::Arc;

use pipedream_mcp::domain::models::ConnectorOverlay;

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

fn connect_only(on: bool) -> ConnectRollout {
    Arc::new(move |_| Box::pin(async move { on }))
}

/// Enabled grants count, from either backend, unless the owner is on
/// Macro Connect alone: dispatch refuses their Pipedream grants, so those
/// never count.
#[tokio::test]
async fn an_owner_on_connect_alone_has_only_their_connect_grants_connected() {
    let everyone = PipedreamConnectedApps::new(store(), None);
    let rollout_off = PipedreamConnectedApps::new(store(), Some(connect_only(false)));
    let rollout_on = PipedreamConnectedApps::new(store(), Some(connect_only(true)));

    for apps in [&everyone, &rollout_off] {
        assert_eq!(
            apps.connected_app_slugs(&owner()).await.unwrap(),
            ["linear", "notion"]
        );
        assert_eq!(
            apps.connected(&owner()).await.unwrap(),
            [app("linear"), app("notion")]
        );
    }
    assert_eq!(
        rollout_on.connected_app_slugs(&owner()).await.unwrap(),
        ["notion"]
    );
    assert_eq!(
        rollout_on.connected(&owner()).await.unwrap(),
        [app("notion")]
    );
}

/// An overlaid app is connected to Macro's own MCP server, never to a
/// grant a routine counts, so a routine can't require it.
#[tokio::test]
async fn an_overlaid_app_is_not_one_a_routine_can_require() {
    let apps = PipedreamConnectedApps::new(store(), None);

    assert_eq!(
        apps.requirable(vec![app("sentry"), app("asana"), app("linear")])
            .await
            .unwrap(),
        [app("asana"), app("linear")]
    );
}
