//! The services through their traits, over fake sources at the `Source`
//! port. Each use case has a case it allows and one it refuses.

use super::*;
use crate::domain::models::{PermitRefused, Selection};
use crate::fake::source::{FakeRow, FakeSource, FakeStore, SharedStore, lock};
use crate::fake::{FakeConnection, FakeConnectors, FakeMacroConnectEnabledFlag, FakeOverlays};
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
    /// Sources whose catalog (`supports`) fails.
    catalog_down: Vec<SourceKind>,
}

impl World {
    fn new() -> Self {
        Self {
            store: Arc::new(Mutex::new(FakeStore::default())),
            flags: HashMap::new(),
            down: Vec::new(),
            catalog_down: Vec::new(),
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

    fn catalog_down(mut self, kind: SourceKind) -> Self {
        self.catalog_down.push(kind);
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
            let store_down = self.down.contains(&kind);
            let catalog_down = self.catalog_down.contains(&kind);
            if store_down || catalog_down {
                Arc::new(Down {
                    source,
                    store_down,
                    catalog_down,
                })
            } else {
                Arc::new(source)
            }
        })
        .collect();

        Connectors::new(
            sources,
            Some(Arc::new(self.source(SourceKind::Native))),
            FakeMacroConnectEnabledFlag(self.flags.clone()),
            FakeOverlays(Self::overlays()),
        )
    }

    fn rows(&self) -> Vec<FakeRow> {
        lock(&self.store).rows.clone()
    }
}

/// A source with an outage: its store (listing fails), its catalog
/// (`supports` fails), or both. The rest still answers.
struct Down {
    source: FakeSource,
    store_down: bool,
    catalog_down: bool,
}

#[async_trait::async_trait]
impl Source for Down {
    fn kind(&self) -> SourceKind {
        self.source.kind()
    }

    async fn connections(
        &self,
        user: &MacroUserIdStr<'static>,
    ) -> Result<Vec<SourceConnection>, rootcause::Report> {
        if self.store_down {
            return Err(rootcause::report!("store down"));
        }
        self.source.connections(user).await
    }

    async fn supports(&self, app: &ConnectorId) -> Result<Option<Surfaces>, rootcause::Report> {
        if self.catalog_down {
            return Err(rootcause::report!("catalog down"));
        }
        self.source.supports(app).await
    }

    async fn holders(
        &self,
        app: &ConnectorId,
    ) -> Result<Vec<MacroUserIdStr<'static>>, rootcause::Report> {
        self.source.holders(app).await
    }

    async fn start_connect(
        &self,
        user: &MacroUserIdStr<'static>,
        key: &ConnectorKey,
    ) -> Result<ConnectStep, rootcause::Report> {
        self.source.start_connect(user, key).await
    }

    async fn complete_connect(
        &self,
        user: &MacroUserIdStr<'static>,
        app: &ConnectorId,
    ) -> Result<SourceConnection, rootcause::Report> {
        self.source.complete_connect(user, app).await
    }

    async fn set_enabled(
        &self,
        user: &MacroUserIdStr<'static>,
        key: &ConnectorKey,
        enabled: bool,
    ) -> Result<(), rootcause::Report> {
        self.source.set_enabled(user, key, enabled).await
    }

    async fn rename(
        &self,
        user: &MacroUserIdStr<'static>,
        key: &ConnectorKey,
        name: &str,
    ) -> Result<(), rootcause::Report> {
        self.source.rename(user, key, name).await
    }

    async fn remove(
        &self,
        user: &MacroUserIdStr<'static>,
        key: &ConnectorKey,
    ) -> Result<(), rootcause::Report> {
        self.source.remove(user, key).await
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
async fn connects_catalog_down_answers_as_if_the_rollout_were_off_for_tool_loading() {
    let world = World::new()
        .flagged(&user())
        .holding(row(SourceKind::Connect, app_key("linear")))
        .holding(row(SourceKind::Pipedream, app_key("asana")))
        .holding(row(
            SourceKind::Native,
            server_key("https://tools.example.com/mcp"),
        ))
        .catalog_down(SourceKind::Connect);
    let connectors = world.connectors();

    let connections = connectors.connections(&user()).await.unwrap();
    assert_eq!(connections.status(&app_key("linear")), Status::NotConnected);
    assert_eq!(connections.status(&app_key("asana")), Status::Connected);
    assert_eq!(
        connections.status(&server_key("https://tools.example.com/mcp")),
        Status::Connected
    );
    assert_eq!(connections.handles().count(), 2);

    // Settings and API lookups must not guess.
    assert!(connectors.list(&user()).await.is_err());
    assert!(connectors.connection(&user(), &app("asana")).await.is_err());
}

#[tokio::test]
async fn connects_catalog_is_not_asked_for_an_unflagged_user() {
    let world = World::new()
        .holding(row(SourceKind::Pipedream, app_key("linear")))
        .catalog_down(SourceKind::Connect);
    let connectors = world.connectors();

    assert_eq!(
        status_in(&connectors.list(&user()).await.unwrap(), &app_key("linear")),
        Some(Status::Connected)
    );
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

/// The scoping headers an upstream carries, as (user, app).
fn scope_of(upstream: &Upstream) -> (Option<&str>, Option<&str>) {
    let header = |name: &str| {
        upstream
            .headers()
            .get(name)
            .and_then(|value| value.to_str().ok())
    };
    (header("x-pd-external-user-id"), header("x-pd-app-slug"))
}

/// An app in scope whose counted source scopes a call by user and app
/// (Pipedream) is addressed for an owner who has not connected it, or has
/// turned it off, so a sandbox can list its tools; the proof says it is not
/// connected.
#[tokio::test]
async fn an_unconnected_app_whose_source_addresses_any_user_is_permitted_for_listing() {
    let held_off = World::new().holding(FakeRow {
        enabled: false,
        ..row(SourceKind::Pipedream, app_key("asana"))
    });
    for world in [World::new(), held_off] {
        let connectors = world.connectors();
        let connections = connectors.connections(&user()).await.unwrap();
        let scoped = connections.scoped(&Selection::Apps(vec![app("asana")]));

        assert!(matches!(
            scoped.permit(&app_key("asana")).unwrap_err(),
            PermitRefused::NotUsable(_)
        ));
        let permitted = scoped.permit_unconnected(&app_key("asana")).unwrap();
        assert!(!permitted.is_connected());
        let upstream = connectors.upstream(permitted).await.unwrap();

        assert_eq!(scope_of(&upstream), (Some(user().as_ref()), Some("asana")));
    }
}

/// An app outside the agent's scope is never addressed, connected or not.
#[tokio::test]
async fn an_unconnected_app_outside_the_scope_is_never_permitted() {
    let world = World::new().holding(row(SourceKind::Pipedream, app_key("notion")));
    let connections = world.connectors().connections(&user()).await.unwrap();
    let scoped = connections.scoped(&Selection::Apps(vec![app("asana")]));

    for slug in ["notion", "linear"] {
        assert_eq!(
            scoped.permit_unconnected(&app_key(slug)).unwrap_err(),
            PermitRefused::OutOfScope
        );
    }
}

/// An app whose counted source reaches it only through the user's own
/// connection is not addressed: Connect for a flagged user (even one still
/// holding a Pipedream row, which the rules ignore), an overlaid app's
/// native server, and the GitHub link. The caller keeps the connect prompt.
#[tokio::test]
async fn an_unconnected_app_whose_source_needs_a_connection_is_not_addressed() {
    let world = World::new()
        .flagged(&user())
        .holding(row(SourceKind::Pipedream, app_key("linear")));
    let connectors = world.connectors();
    let connections = connectors.connections(&user()).await.unwrap();

    for slug in ["linear", "stripe", "github"] {
        let permitted = connections.permit_unconnected(&app_key(slug)).unwrap();
        assert!(!permitted.is_connected());

        assert!(
            matches!(
                connectors.upstream(permitted).await,
                Err(ConnectorsError::NotFound(key)) if key == app_key(slug)
            ),
            "{slug} must not be addressed without a connection"
        );
    }
}

/// A server added by URL is never addressed without its row, and an app the
/// owner can use is permitted as connected.
#[tokio::test]
async fn permitting_unconnected_never_widens_a_server_or_weakens_a_connection() {
    let world = World::new().holding(row(SourceKind::Pipedream, app_key("notion")));
    let connectors = world.connectors();
    let connections = connectors.connections(&user()).await.unwrap();

    assert_eq!(
        connections
            .permit_unconnected(&server_key("https://tools.example.com/mcp"))
            .unwrap_err(),
        PermitRefused::NotUsable(Status::NotConnected)
    );
    let notion = connections.permit_unconnected(&app_key("notion")).unwrap();
    assert!(notion.is_connected());
    assert_eq!(
        connectors.upstream(notion).await.unwrap().bearer(),
        Some("fake-token")
    );
}

/// A native server at an address several overlaid apps share is one
/// connection: an agent given everything is told about it once, while a
/// selected list names each app it was given.
#[tokio::test]
async fn a_server_shared_by_overlaid_apps_is_advertised_once_to_an_agent_given_everything() {
    let connectors = FakeConnectors::new()
        .with_overlay("stripe", STRIPE_SERVER)
        .with_overlay("stripe_payments", STRIPE_SERVER)
        .with_connection(&user(), FakeConnection::app("stripe"))
        .with_connection(&user(), FakeConnection::app("notion"))
        .build();
    let connections = connectors.connections(&user()).await.unwrap();

    assert_eq!(connections.handles().count(), 3);
    assert_eq!(
        connections.destinations(),
        [app_key("notion"), app_key("stripe")]
    );
    let selected = connections.scoped(&Selection::Apps(vec![
        app("stripe"),
        app("stripe_payments"),
    ]));
    assert_eq!(
        selected.destinations(),
        [app_key("stripe"), app_key("stripe_payments")]
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

/// A background sync stops whoever `holders` leaves out, so a candidate
/// it cannot resolve fails the call instead of being left out.
#[tokio::test]
async fn holders_fail_when_a_candidates_own_source_is_down() {
    let world = World::new()
        .holding(row(SourceKind::Pipedream, app_key("granola")))
        .source_down(SourceKind::Pipedream);

    assert!(world.connectors().holders(&app("granola")).await.is_err());
}

#[tokio::test]
async fn holders_answer_without_a_source_that_holds_none_of_them() {
    let world = World::new()
        .holding(row(SourceKind::Pipedream, app_key("granola")))
        .source_down(SourceKind::Connect)
        .source_down(SourceKind::GithubLink)
        .source_down(SourceKind::Native);

    let holders = world.connectors().holders(&app("granola")).await.unwrap();

    let users: Vec<_> = holders.iter().map(|handle| handle.user().clone()).collect();
    assert_eq!(users, vec![user()]);
}

#[tokio::test]
async fn holders_fail_when_a_candidates_flag_cannot_be_read() {
    let world = World::new()
        .flag_failing(&other_user())
        .holding(row(SourceKind::Pipedream, app_key("granola")))
        .holding(FakeRow::new(
            other_user(),
            SourceKind::Pipedream,
            app_key("granola"),
            true,
        ));

    assert!(world.connectors().holders(&app("granola")).await.is_err());
}

#[tokio::test]
async fn holders_fail_when_connects_catalog_is_down_for_a_flagged_candidate() {
    let world = World::new()
        .flagged(&user())
        .holding(row(SourceKind::Pipedream, app_key("granola")))
        .catalog_down(SourceKind::Connect);

    assert!(world.connectors().holders(&app("granola")).await.is_err());
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
        .with_macro_connect_enabled(&other_user())
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
