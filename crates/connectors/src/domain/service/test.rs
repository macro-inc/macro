//! The services through their traits, over fake sources at the `Source`
//! port. Each use case has a case it allows and one it refuses.

use super::*;
use crate::domain::models::{PermitRefused, Selection};
use crate::fake::source::{FakeRow, FakeSource, FakeStore, SharedStore, lock};
use crate::fake::{FakeConnection, FakeConnectors, FakeFlag, FakeOverlays};
use ai_toolset::ToolSet;
use std::collections::HashMap;
use std::sync::Mutex;

const STRIPE_SERVER: &str = "https://mcp.stripe.com";

fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str("macro|user@example.com").unwrap()
}

fn other_user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str("macro|other@example.com").unwrap()
}

fn app(slug: &str) -> ConnectorId {
    ConnectorId::parse(slug).unwrap()
}

fn app_key(slug: &str) -> ConnectorKey {
    ConnectorKey::App(app(slug))
}

fn server_key(url: &str) -> ConnectorKey {
    ConnectorKey::Server(ServerUrl::parse(url).unwrap())
}

/// Every source over one table, with the catalog the tests share:
/// Pipedream lists Notion, Linear, Granola and Asana; Connect serves Linear
/// with an API and Granola and GitHub for MCP only; Stripe is overlaid.
struct World {
    store: SharedStore,
    flags: HashMap<MacroUserIdStr<'static>, Result<bool, String>>,
    /// Sources whose listing fails.
    down: Vec<SourceKind>,
}

impl World {
    fn new() -> Self {
        Self {
            store: Arc::new(Mutex::new(FakeStore::default())),
            flags: HashMap::new(),
            down: Vec::new(),
        }
    }

    fn flagged(mut self, user: &MacroUserIdStr<'static>) -> Self {
        self.flags.insert(user.clone(), Ok(true));
        self
    }

    fn flag_failing(mut self, user: &MacroUserIdStr<'static>) -> Self {
        self.flags
            .insert(user.clone(), Err("flag service down".to_owned()));
        self
    }

    fn holding(self, row: FakeRow) -> Self {
        lock(&self.store).rows.push(row);
        self
    }

    fn source_down(mut self, kind: SourceKind) -> Self {
        self.down.push(kind);
        self
    }

    fn overlays() -> Overlays {
        Overlays::new([(app("stripe"), ServerUrl::parse(STRIPE_SERVER).unwrap())])
    }

    fn source(&self, kind: SourceKind) -> FakeSource {
        let supported = match kind {
            SourceKind::Pipedream => ["notion", "linear", "granola", "asana"]
                .into_iter()
                .map(|slug| (app(slug), Surfaces::new(true, true)))
                .collect(),
            SourceKind::Connect => HashMap::from([
                (app("linear"), Surfaces::new(true, true)),
                (app("granola"), Surfaces::new(true, false)),
                (app("github"), Surfaces::new(true, false)),
            ]),
            SourceKind::GithubLink => {
                HashMap::from([(ConnectorId::github(), Surfaces::new(true, false))])
            }
            SourceKind::Native => HashMap::new(),
        };

        FakeSource {
            kind,
            store: self.store.clone(),
            supported,
            overlays: Self::overlays(),
        }
    }

    fn connectors(&self) -> Connectors {
        let sources: Vec<Arc<dyn Source>> = [
            SourceKind::Native,
            SourceKind::GithubLink,
            SourceKind::Pipedream,
            SourceKind::Connect,
        ]
        .into_iter()
        .map(|kind| -> Arc<dyn Source> {
            let source = self.source(kind);
            if self.down.contains(&kind) {
                Arc::new(Down(source))
            } else {
                Arc::new(source)
            }
        })
        .collect();

        Connectors::new(
            sources,
            Some(Arc::new(self.source(SourceKind::Native))),
            FakeFlag(self.flags.clone()),
            FakeOverlays(Self::overlays()),
        )
    }

    fn rows(&self) -> Vec<FakeRow> {
        lock(&self.store).rows.clone()
    }
}

/// A source whose store is down: listing fails, the rest still answers.
struct Down(FakeSource);

#[async_trait::async_trait]
impl Source for Down {
    fn kind(&self) -> SourceKind {
        self.0.kind()
    }

    async fn connections(
        &self,
        _user: &MacroUserIdStr<'static>,
    ) -> Result<Vec<SourceConnection>, rootcause::Report> {
        Err(rootcause::report!("store down"))
    }

    async fn supports(&self, app: &ConnectorId) -> Result<Option<Surfaces>, rootcause::Report> {
        self.0.supports(app).await
    }

    async fn holders(
        &self,
        app: &ConnectorId,
    ) -> Result<Vec<MacroUserIdStr<'static>>, rootcause::Report> {
        self.0.holders(app).await
    }

    async fn start_connect(
        &self,
        user: &MacroUserIdStr<'static>,
        key: &ConnectorKey,
    ) -> Result<ConnectStep, rootcause::Report> {
        self.0.start_connect(user, key).await
    }

    async fn complete_connect(
        &self,
        user: &MacroUserIdStr<'static>,
        app: &ConnectorId,
    ) -> Result<SourceConnection, rootcause::Report> {
        self.0.complete_connect(user, app).await
    }

    async fn set_enabled(
        &self,
        user: &MacroUserIdStr<'static>,
        key: &ConnectorKey,
        enabled: bool,
    ) -> Result<(), rootcause::Report> {
        self.0.set_enabled(user, key, enabled).await
    }

    async fn rename(
        &self,
        user: &MacroUserIdStr<'static>,
        key: &ConnectorKey,
        name: &str,
    ) -> Result<(), rootcause::Report> {
        self.0.rename(user, key, name).await
    }

    async fn remove(
        &self,
        user: &MacroUserIdStr<'static>,
        key: &ConnectorKey,
    ) -> Result<(), rootcause::Report> {
        self.0.remove(user, key).await
    }
}

fn row(source: SourceKind, key: ConnectorKey) -> FakeRow {
    let api = matches!(source, SourceKind::Pipedream)
        || (source == SourceKind::Connect && key == app_key("linear"));
    FakeRow::new(user(), source, key, api)
}

fn status_in(listing: &[Connector], key: &ConnectorKey) -> Option<Status> {
    listing
        .iter()
        .find(|connector| connector.key() == key)
        .map(Connector::status)
}

// MCP connections and the flag.

#[tokio::test]
async fn an_unflagged_users_pipedream_connection_is_connected() {
    let world = World::new().holding(row(SourceKind::Pipedream, app_key("linear")));

    let connections = world.connectors().connections(&user()).await.unwrap();

    assert_eq!(connections.status(&app_key("linear")), Status::Connected);
    assert_eq!(connections.handles().count(), 1);
}

#[tokio::test]
async fn a_flagged_users_old_connection_to_a_connect_app_reads_as_not_connected() {
    let world = World::new()
        .flagged(&user())
        .holding(row(SourceKind::Pipedream, app_key("linear")));
    let connectors = world.connectors();

    let connections = connectors.connections(&user()).await.unwrap();
    assert_eq!(connections.status(&app_key("linear")), Status::NotConnected);
    assert_eq!(connections.handles().count(), 0);

    // The settings list says so, and that the Connect connection would give
    // an API.
    let listing = connectors.list(&user()).await.unwrap();
    let linear = listing
        .iter()
        .find(|connector| *connector.key() == app_key("linear"))
        .unwrap();
    assert_eq!(linear.status(), Status::NotConnected);
    assert!(linear.surfaces().api());
}

#[tokio::test]
async fn a_flagged_users_connect_connection_is_connected() {
    let world = World::new()
        .flagged(&user())
        .holding(row(SourceKind::Connect, app_key("linear")));

    let connections = world.connectors().connections(&user()).await.unwrap();

    assert_eq!(connections.status(&app_key("linear")), Status::Connected);
}

#[tokio::test]
async fn a_failed_flag_read_counts_as_off() {
    let world = World::new()
        .flag_failing(&user())
        .holding(row(SourceKind::Connect, app_key("linear")))
        .holding(row(SourceKind::Pipedream, app_key("asana")));

    let connections = world.connectors().connections(&user()).await.unwrap();

    assert_eq!(connections.status(&app_key("linear")), Status::NotConnected);
    assert_eq!(connections.status(&app_key("asana")), Status::Connected);
}

#[tokio::test]
async fn tool_loading_answers_without_a_source_that_is_down_but_listing_fails() {
    let world = World::new()
        .holding(row(SourceKind::Pipedream, app_key("notion")))
        .holding(row(
            SourceKind::Native,
            server_key("https://tools.example.com/mcp"),
        ))
        .source_down(SourceKind::Pipedream);
    let connectors = world.connectors();

    let connections = connectors.connections(&user()).await.unwrap();
    assert_eq!(
        connections.status(&server_key("https://tools.example.com/mcp")),
        Status::Connected
    );
    assert_eq!(connections.status(&app_key("notion")), Status::NotConnected);

    assert!(connectors.list(&user()).await.is_err());
}

#[tokio::test]
async fn the_toolset_lists_each_usable_connections_tools() {
    let mut notion = row(SourceKind::Pipedream, app_key("notion"));
    notion.name = "Notion".to_owned();
    notion.tools = vec!["search".to_owned()];
    let mut disabled = row(SourceKind::Pipedream, app_key("asana"));
    disabled.name = "Asana".to_owned();
    disabled.tools = vec!["tasks".to_owned()];
    disabled.enabled = false;
    let world = World::new().holding(notion).holding(disabled);
    let connectors = world.connectors();

    let connections = connectors.connections(&user()).await.unwrap();
    let handles: Vec<McpHandle> = connections.handles().cloned().collect();
    let tools = connectors.toolset(&handles).await;

    let names: Vec<String> = tools.catalog().into_iter().map(|tool| tool.name).collect();
    assert_eq!(names, vec!["mcp__Notion__search".to_owned()]);
    let answer = ToolSet::<()>::dispatch_tool_call(
        &tools,
        (),
        ai_toolset::RequestContext::new(user()),
        "mcp__Notion__search",
        &serde_json::json!({}),
    )
    .await
    .unwrap()
    .unwrap();
    assert!(answer.to_string().contains("Notion:search"));
}

// The selected-apps permission.

#[tokio::test]
async fn a_selected_app_is_permitted_and_reaches_its_upstream() {
    let world = World::new().holding(row(SourceKind::Pipedream, app_key("notion")));
    let connectors = world.connectors();
    let connections = connectors.connections(&user()).await.unwrap();
    let scoped = connections.scoped(&Selection::Apps(vec![app("notion")]));

    let permitted = scoped.permit(&app_key("notion")).unwrap();
    let upstream = connectors.upstream(permitted).await.unwrap();

    assert_eq!(upstream.bearer(), Some("fake-token"));
}

#[tokio::test]
async fn an_app_outside_the_selection_is_refused_even_when_connected() {
    let world = World::new()
        .holding(row(SourceKind::Pipedream, app_key("notion")))
        .holding(row(SourceKind::Pipedream, app_key("linear")))
        .holding(row(
            SourceKind::Native,
            server_key("https://tools.example.com/mcp"),
        ));
    let connections = world.connectors().connections(&user()).await.unwrap();
    let scoped = connections.scoped(&Selection::Apps(vec![app("notion")]));

    assert_eq!(
        scoped.permit(&app_key("linear")).unwrap_err(),
        PermitRefused::OutOfScope
    );
    assert_eq!(
        scoped
            .permit(&server_key("https://tools.example.com/mcp"))
            .unwrap_err(),
        PermitRefused::OutOfScope
    );
    assert_eq!(scoped.handles().count(), 1);
}

#[tokio::test]
async fn a_selected_app_the_owner_has_not_connected_asks_to_connect() {
    let world = World::new();
    let connections = world.connectors().connections(&user()).await.unwrap();
    let scoped = connections.scoped(&Selection::Apps(vec![app("notion")]));

    assert_eq!(
        scoped.permit(&app_key("notion")).unwrap_err(),
        PermitRefused::NotUsable(Status::NotConnected)
    );
}

// API connections.

#[tokio::test]
async fn a_pipedream_connection_gives_api_access() {
    let world = World::new().holding(row(SourceKind::Pipedream, app_key("notion")));
    let connectors = world.connectors();

    let handle = connectors
        .connection(&user(), &app("notion"))
        .await
        .unwrap()
        .unwrap();
    let response = connectors
        .call(
            &handle,
            ApiRequest {
                method: http::Method::GET,
                url: "https://api.notion.com/v1/users/me".to_owned(),
                headers: http::HeaderMap::new(),
                body: None,
            },
        )
        .await
        .unwrap();

    assert_eq!(response.status, http::StatusCode::OK);
    assert_eq!(lock(&world.store).api_calls.len(), 1);
}

#[tokio::test]
async fn an_mcp_only_connection_gives_no_api_access() {
    let world = World::new()
        .flagged(&other_user())
        .holding(row(SourceKind::Native, server_key(STRIPE_SERVER)))
        .holding(FakeRow::new(
            other_user(),
            SourceKind::Connect,
            app_key("granola"),
            false,
        ));
    let connectors = world.connectors();

    // Stripe counts through its native server, which has no API.
    let connections = connectors.connections(&user()).await.unwrap();
    assert_eq!(connections.status(&app_key("stripe")), Status::Connected);
    assert!(
        connectors
            .connection(&user(), &app("stripe"))
            .await
            .unwrap()
            .is_none()
    );

    // Connect holds Granola as MCP only.
    assert!(
        connectors
            .connection(&other_user(), &app("granola"))
            .await
            .unwrap()
            .is_none()
    );
}

#[tokio::test]
async fn holders_are_only_users_whose_counted_connection_gives_api() {
    let flagged_old = MacroUserIdStr::parse_from_str("macro|flagged-old@example.com").unwrap();
    let mut disabled = FakeRow::new(
        MacroUserIdStr::parse_from_str("macro|disabled@example.com").unwrap(),
        SourceKind::Pipedream,
        app_key("granola"),
        true,
    );
    disabled.enabled = false;
    let world = World::new()
        .flagged(&other_user())
        .flagged(&flagged_old)
        .holding(row(SourceKind::Pipedream, app_key("granola")))
        .holding(FakeRow::new(
            other_user(),
            SourceKind::Connect,
            app_key("granola"),
            false,
        ))
        .holding(FakeRow::new(
            flagged_old,
            SourceKind::Pipedream,
            app_key("granola"),
            true,
        ))
        .holding(disabled);

    let holders = world.connectors().holders(&app("granola")).await.unwrap();

    let users: Vec<_> = holders.iter().map(|handle| handle.user().clone()).collect();
    assert_eq!(users, vec![user()]);
}

// Managing connections.

#[tokio::test]
async fn removing_github_unlinks_the_account() {
    let world = World::new().holding(row(SourceKind::GithubLink, app_key("github")));
    let connectors = world.connectors();
    assert_eq!(
        status_in(&connectors.list(&user()).await.unwrap(), &app_key("github")),
        Some(Status::Connected)
    );

    connectors
        .remove(&user(), &app_key("github"))
        .await
        .unwrap();

    assert!(world.rows().is_empty());
    let connections = connectors.connections(&user()).await.unwrap();
    assert_eq!(connections.status(&app_key("github")), Status::NotConnected);
}

#[tokio::test]
async fn removing_an_app_the_user_does_not_hold_is_not_found() {
    let world = World::new().holding(row(SourceKind::Pipedream, app_key("notion")));

    let error = world
        .connectors()
        .remove(&user(), &app_key("linear"))
        .await
        .unwrap_err();

    assert!(matches!(error, ConnectorsError::NotFound(key) if key == app_key("linear")));
    assert_eq!(world.rows().len(), 1);
}

#[tokio::test]
async fn disabling_an_overlaid_app_disables_its_native_server() {
    let world = World::new().holding(row(SourceKind::Native, server_key(STRIPE_SERVER)));
    let connectors = world.connectors();

    connectors
        .set_enabled(&user(), &app_key("stripe"), false)
        .await
        .unwrap();

    assert!(!world.rows()[0].enabled);
    let connections = connectors.connections(&user()).await.unwrap();
    assert_eq!(connections.status(&app_key("stripe")), Status::Disabled);
}

#[tokio::test]
async fn an_empty_name_is_refused() {
    let world = World::new().holding(row(SourceKind::Pipedream, app_key("notion")));

    let error = world
        .connectors()
        .rename(&user(), &app_key("notion"), "  ")
        .await
        .unwrap_err();

    assert!(matches!(error, ConnectorsError::EmptyName));
    assert_eq!(world.rows()[0].name, "notion");
}

#[tokio::test]
async fn catalog_apps_are_connectable_and_unknown_ones_are_not() {
    let connectors = World::new().connectors();

    assert!(connectors.connectable(&app("asana")).await.unwrap());
    assert!(connectors.connectable(&app("github")).await.unwrap());
    assert!(!connectors.connectable(&app("not-an-app")).await.unwrap());
}

#[tokio::test]
async fn an_overlaid_app_is_connectable_without_a_hosted_source_listing_it() {
    let connectors = FakeConnectors::new()
        .with_overlay("figma", "https://mcp.figma.com/mcp")
        .build();

    assert!(connectors.connectable(&app("figma")).await.unwrap());
    assert!(!connectors.connectable(&app("not-an-app")).await.unwrap());
}

#[tokio::test]
async fn connecting_goes_through_the_source_that_counts() {
    let world = World::new().flagged(&other_user());
    let connectors = world.connectors();
    let opened = |step: ConnectStep| match step {
        ConnectStep::OpenUrl(url) => url.query().unwrap_or_default().to_owned(),
        ConnectStep::EmbeddedDialog { .. } => panic!("fake sources open URLs"),
    };

    let flagged = connectors
        .start_connect(&other_user(), &app_key("linear"))
        .await
        .unwrap();
    assert_eq!(opened(flagged), "source=Connect&key=linear");

    let overlaid = connectors
        .start_connect(&user(), &app_key("stripe"))
        .await
        .unwrap();
    assert_eq!(
        opened(overlaid),
        "source=Native&key=https%3A%2F%2Fmcp.stripe.com"
    );

    let unknown = connectors
        .start_connect(&user(), &app_key("not-an-app"))
        .await
        .unwrap_err();
    assert!(matches!(unknown, ConnectorsError::UnknownApp(_)));
}

#[tokio::test]
async fn completing_through_connect_replaces_the_pipedream_row() {
    let world = World::new()
        .flagged(&user())
        .holding(row(SourceKind::Pipedream, app_key("linear")));
    let connectors = world.connectors();

    let connector = connectors
        .complete_connect(&user(), &app("linear"))
        .await
        .unwrap();

    assert_eq!(connector.status(), Status::Connected);
    assert!(connector.surfaces().api());
    let rows = world.rows();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].source, SourceKind::Connect);
}

#[tokio::test]
async fn an_agent_may_add_only_public_https_servers() {
    let connectors = World::new().connectors();

    let refused = connectors
        .add_server(
            &user(),
            ServerUrl::parse("http://tools.example.com/mcp").unwrap(),
            "Tools",
            AddedBy::Agent,
        )
        .await
        .unwrap_err();
    assert!(matches!(refused, ConnectorsError::NonPublicServer(_)));

    let added = connectors
        .add_server(
            &user(),
            ServerUrl::parse("https://tools.example.com/mcp").unwrap(),
            "Tools",
            AddedBy::Agent,
        )
        .await
        .unwrap();
    assert_eq!(*added.key(), server_key("https://tools.example.com/mcp"));
    assert_eq!(added.status(), Status::Connected);
}

#[tokio::test]
async fn a_server_added_at_an_overlay_address_is_that_app() {
    let connectors = World::new().connectors();

    let added = connectors
        .add_server(
            &user(),
            ServerUrl::parse(STRIPE_SERVER).unwrap(),
            "Stripe",
            AddedBy::User,
        )
        .await
        .unwrap();

    // Not signed in to yet, so the app needs authorizing.
    assert_eq!(*added.key(), app_key("stripe"));
    assert_eq!(added.status(), Status::NeedsReauth);
}

// The shared fake.

#[tokio::test]
async fn the_shared_fake_puts_each_connection_where_the_rules_count_it() {
    let fake = FakeConnectors::new()
        .with_connect_app("linear", true)
        .with_overlay("stripe", STRIPE_SERVER)
        .with_flag_on(&other_user())
        .with_connection(&user(), FakeConnection::app("linear"))
        .with_connection(&user(), FakeConnection::app("stripe").disabled())
        .with_connection(&other_user(), FakeConnection::app("linear"));
    let connectors = fake.build();

    let mine = connectors.connections(&user()).await.unwrap();
    assert_eq!(mine.status(&app_key("linear")), Status::Connected);
    assert_eq!(mine.status(&app_key("stripe")), Status::Disabled);
    let theirs = connectors.connections(&other_user()).await.unwrap();
    assert_eq!(theirs.status(&app_key("linear")), Status::Connected);

    let handle = connectors
        .connection(&other_user(), &app("linear"))
        .await
        .unwrap()
        .unwrap();
    connectors
        .call(
            &handle,
            ApiRequest {
                method: http::Method::POST,
                url: "https://api.linear.app/graphql".to_owned(),
                headers: http::HeaderMap::new(),
                body: None,
            },
        )
        .await
        .unwrap();
    assert_eq!(fake.api_calls().len(), 1);
}

#[test]
fn a_sources_refusal_answers_as_the_error_it_means() {
    let refused =
        |refusal: SourceRefusal| refusal_error(rootcause::Report::new(refusal).into_dynamic());

    assert!(matches!(
        refused(SourceRefusal::NotFound(app_key("notion"))),
        ConnectorsError::NotFound(key) if key == app_key("notion")
    ));
    assert!(matches!(
        refused(SourceRefusal::NeedsReauth(app_key("notion"))),
        ConnectorsError::NeedsReauth(key) if key == app_key("notion")
    ));
    assert!(matches!(
        refused(SourceRefusal::Unsupported(app_key("notion"))),
        ConnectorsError::UnknownApp(slug) if slug == app("notion")
    ));
    assert!(matches!(
        refused(SourceRefusal::Unsupported(server_key(
            "https://tools.example.com/mcp"
        ))),
        ConnectorsError::NotFound(_)
    ));
    assert!(matches!(
        refused(SourceRefusal::NonPublic(
            ServerUrl::parse("http://10.0.0.1/mcp").unwrap()
        )),
        ConnectorsError::NonPublicServer(_)
    ));
    assert!(matches!(
        refused(SourceRefusal::EmptyName),
        ConnectorsError::EmptyName
    ));
    assert!(matches!(
        refusal_error(rootcause::report!("vendor down")),
        ConnectorsError::Internal(_)
    ));
}
