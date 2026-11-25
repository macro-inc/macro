use connectors::fake::{FakeConnection, FakeConnectors};

use super::*;

fn owner() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email("owner@example.com").expect("a valid user id")
}

fn app(slug: &str) -> AgentMcpServer {
    AgentMcpServer {
        app_slug: slug.to_owned(),
        server_name: format!("{slug} name"),
    }
}

fn apps(fake: &FakeConnectors) -> RoutineConnectedApps<connectors::Connectors> {
    RoutineConnectedApps::new(Arc::new(fake.build()))
}

fn held(slug: &str) -> FakeConnection {
    FakeConnection::app(slug).named(&format!("{slug} name"))
}

async fn sorted_slugs(apps: &RoutineConnectedApps<connectors::Connectors>) -> Vec<String> {
    let mut slugs = apps.connected_app_slugs(&owner()).await.unwrap();
    slugs.sort();
    slugs
}

/// What routines count as connected is what chat counts: usable app
/// connections from any source, never a disabled one, a grant needing
/// reauthorization, or a server added by URL.
#[tokio::test]
async fn usable_app_connections_are_connected() {
    let fake = FakeConnectors::new()
        .with_overlay("figma", "https://mcp.figma.com/mcp")
        .with_connection(&owner(), held("linear"))
        .with_connection(&owner(), held("figma"))
        .with_connection(&owner(), held("github"))
        .with_connection(&owner(), held("asana").disabled())
        .with_connection(&owner(), held("notion").needs_reauth())
        .with_connection(
            &owner(),
            FakeConnection::server("https://mcp.example.com/mcp"),
        );
    let apps = apps(&fake);

    assert_eq!(sorted_slugs(&apps).await, ["figma", "github", "linear"]);
    let mut connected = apps.connected(&owner()).await.unwrap();
    connected.sort_by(|a, b| a.app_slug.cmp(&b.app_slug));
    assert_eq!(connected, [app("figma"), app("github"), app("linear")]);
}

/// A flagged owner's connection through Macro Connect counts; an unflagged
/// owner's would not, which the services decide.
#[tokio::test]
async fn a_flagged_owners_connect_connection_is_connected() {
    let fake = FakeConnectors::new()
        .with_connect_app("linear", true)
        .with_macro_connect_enabled(&owner())
        .with_connection(&owner(), held("linear"));

    assert_eq!(sorted_slugs(&apps(&fake)).await, ["linear"]);
}

/// The aliases of one app count as that app.
#[tokio::test]
async fn an_aliased_app_is_connected_under_its_canonical_slug() {
    let fake = FakeConnectors::new().with_connection(&owner(), held("slack_v2"));

    assert_eq!(sorted_slugs(&apps(&fake)).await, ["slack"]);
}

/// A routine may require any catalog app, overlaid ones included: once
/// connected, through whichever source counts, it is connected for the
/// routine as it is for chat. An app the catalog doesn't have is dropped.
#[tokio::test]
async fn a_missing_app_is_requirable_when_it_is_in_the_catalog() {
    let fake = FakeConnectors::new()
        .with_catalog_app("asana")
        .with_overlay("sentry", "https://mcp.sentry.dev/mcp");

    assert_eq!(
        apps(&fake)
            .requirable(
                &owner(),
                vec![
                    app("sentry"),
                    app("asana"),
                    app("not-an-app"),
                    app("Bad Slug")
                ]
            )
            .await
            .unwrap(),
        [app("sentry"), app("asana")]
    );
}

/// A routine saved with an alias requires the app the alias names: a stored
/// `slack_v2` is met by the connection answered as `slack`, and the reverse.
#[tokio::test]
async fn a_required_alias_is_met_by_the_apps_connection() {
    let fake = FakeConnectors::new()
        .with_connection(&owner(), held("slack_v2"))
        .with_connection(&owner(), held("linear"));
    let apps = apps(&fake);

    assert!(apps.all_connected(&owner(), &["slack_v2"]).await.unwrap());
    assert!(
        apps.all_connected(&owner(), &["slack", "linear"])
            .await
            .unwrap()
    );
    assert!(
        !apps
            .all_connected(&owner(), &["slack_v2", "notion"])
            .await
            .unwrap()
    );
    assert!(!apps.all_connected(&owner(), &["Not A Slug"]).await.unwrap());
}
