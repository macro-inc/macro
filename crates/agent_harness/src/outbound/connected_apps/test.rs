use super::*;
use pipedream_mcp::domain::models::{ConnectorOverlay, PipedreamConnection};

/// One user's Pipedream rows, with `sentry` overlaid.
struct Connections(Vec<PipedreamConnection>);

impl ConnectionStore for Connections {
    type Err = String;
    async fn save(&self, _: &PipedreamConnection) -> Result<(), String> {
        unreachable!()
    }
    async fn load(
        &self,
        _: &MacroUserIdStr<'static>,
        app_slug: &str,
    ) -> Result<Option<PipedreamConnection>, String> {
        Ok(self.0.iter().find(|c| c.app_slug == app_slug).cloned())
    }
    async fn delete(&self, _: &MacroUserIdStr<'static>, _: &str) -> Result<(), String> {
        unreachable!()
    }
    async fn list(&self, _: &MacroUserIdStr<'static>) -> Result<Vec<PipedreamConnection>, String> {
        unreachable!()
    }
}

impl ConnectorOverlays for Connections {
    async fn overlays(&self) -> anyhow::Result<Vec<ConnectorOverlay>> {
        unreachable!()
    }
    async fn overlay(&self, app_slug: &str) -> anyhow::Result<Option<ConnectorOverlay>> {
        Ok((app_slug == "sentry").then(|| ConnectorOverlay {
            app_slug: "sentry".into(),
            server_url: "https://mcp.sentry.dev/mcp".into(),
        }))
    }
}

/// The user's native connection to the overlay server, by display name.
struct Native(Option<&'static str>);

impl OverlayConnections for Native {
    async fn connected_name(
        &self,
        _: &MacroUserIdStr<'static>,
        overlay: &ConnectorOverlay,
    ) -> anyhow::Result<Option<String>> {
        assert_eq!(overlay.server_url, "https://mcp.sentry.dev/mcp");
        Ok(self.0.map(str::to_owned))
    }
}

fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email("owner@example.com").unwrap()
}

fn pipedream(app_slug: &str, enabled: bool) -> PipedreamConnection {
    PipedreamConnection {
        user_id: user(),
        app_slug: app_slug.into(),
        server_name: format!("{app_slug} (Pipedream)"),
        account_id: "apn_1".into(),
        enabled,
    }
}

#[tokio::test]
async fn overlaid_apps_are_connected_through_their_native_server_only() {
    let apps = PipedreamConnectedApps::new(
        Arc::new(Connections(vec![
            pipedream("sentry", true),
            pipedream("stripe", true),
            pipedream("asana", false),
        ])),
        Arc::new(Native(Some("Sentry"))),
    );
    assert_eq!(
        apps.connected_app_name(&user(), "sentry").await.unwrap(),
        Some("Sentry".into())
    );
    assert_eq!(
        apps.connected_app_name(&user(), "stripe").await.unwrap(),
        Some("stripe (Pipedream)".into())
    );
    assert_eq!(
        apps.connected_app_name(&user(), "asana").await.unwrap(),
        None
    );

    let unconnected = PipedreamConnectedApps::new(
        Arc::new(Connections(vec![pipedream("sentry", true)])),
        Arc::new(Native(None)),
    );
    assert_eq!(
        unconnected
            .connected_app_name(&user(), "sentry")
            .await
            .unwrap(),
        None
    );
}
