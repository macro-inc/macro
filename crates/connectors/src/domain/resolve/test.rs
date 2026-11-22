//! Section 2's rules, one named case per table cell and numbered rule, plus
//! two properties over random inputs.

use super::*;
use crate::domain::catalog::{ConnectSupport, Overlays};
use crate::domain::models::{
    ApiRequest, ApiResponse, PermitRefused, Selection, ServerUrl, Surfaces, Upstream,
};
use crate::domain::ports::{ApiConnection, McpConnection};
use mcp_toolset::McpServer;
use std::sync::Arc;

mod properties;

/// A connection the rules may pick but no test dials.
struct Undialed;

#[async_trait::async_trait]
impl McpConnection for Undialed {
    async fn dial(&self) -> Result<McpServer, rootcause::Report> {
        Err(rootcause::report!("not dialed in rule tests"))
    }

    async fn upstream(&self) -> Result<Upstream, rootcause::Report> {
        Err(rootcause::report!("not addressed in rule tests"))
    }
}

#[async_trait::async_trait]
impl ApiConnection for Undialed {
    async fn call(&self, _request: ApiRequest) -> Result<ApiResponse, rootcause::Report> {
        Err(rootcause::report!("not called in rule tests"))
    }
}

fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str("macro|user@example.com").unwrap()
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

const STRIPE_SERVER: &str = "https://mcp.stripe.com";
const FIGMA_SERVER: &str = "https://mcp.figma.com/mcp";
const ATLASSIAN_SERVER: &str = "https://mcp.atlassian.com/v1/sse";

/// Stripe and Figma are overlaid, and Jira and Confluence share one overlay
/// server.
fn overlays() -> Overlays {
    Overlays::new([
        (app("stripe"), ServerUrl::parse(STRIPE_SERVER).unwrap()),
        (app("figma"), ServerUrl::parse(FIGMA_SERVER).unwrap()),
        (app("jira"), ServerUrl::parse(ATLASSIAN_SERVER).unwrap()),
        (
            app("confluence"),
            ServerUrl::parse(ATLASSIAN_SERVER).unwrap(),
        ),
    ])
}

/// Connect serves GitHub, Stripe and Granola for MCP only, and Linear and
/// Jira for MCP and API. It does not serve Figma, Confluence or Asana.
fn connect() -> ConnectSupport {
    ConnectSupport::new([
        (app("github"), Surfaces::new(true, false)),
        (app("stripe"), Surfaces::new(true, false)),
        (app("granola"), Surfaces::new(true, false)),
        (app("linear"), Surfaces::new(true, true)),
        (app("jira"), Surfaces::new(true, true)),
    ])
}

/// A connection `source` holds, enabled and authorized, providing MCP and,
/// where the source can, an API. Its name says which source it came from.
fn held(source: SourceKind, key: ConnectorKey) -> SourceConnection {
    let api: Option<Arc<dyn ApiConnection>> = match source {
        SourceKind::Pipedream | SourceKind::Connect => Some(Arc::new(Undialed)),
        SourceKind::Native | SourceKind::GithubLink => None,
    };
    SourceConnection {
        source,
        source_id: key.to_string(),
        name: format!("{source:?}"),
        key,
        enabled: true,
        authorized: true,
        mcp: Some(Arc::new(Undialed)),
        api,
    }
}

fn disabled(connection: SourceConnection) -> SourceConnection {
    SourceConnection {
        enabled: false,
        ..connection
    }
}

fn unauthorized(connection: SourceConnection) -> SourceConnection {
    SourceConnection {
        authorized: false,
        ..connection
    }
}

fn run(flag: Flag, connections: Vec<SourceConnection>) -> Resolution {
    resolve(&user(), flag, &overlays(), &connect(), connections)
}

/// The name of the connection whose handle is offered for `key`.
fn handle_name(resolution: &Resolution, key: &ConnectorKey) -> Option<String> {
    resolution
        .mcp
        .handles()
        .find(|handle| handle.key() == key)
        .map(|handle| handle.name().to_owned())
}

fn every_source(key: ConnectorKey) -> Vec<SourceConnection> {
    vec![
        held(SourceKind::GithubLink, key.clone()),
        held(SourceKind::Pipedream, key.clone()),
        held(SourceKind::Connect, key),
    ]
}

// The table: GitHub.

#[test]
fn github_flag_off_counts_the_account_link() {
    let resolution = run(Flag::Off, every_source(app_key("github")));

    assert_eq!(resolution.mcp.status(&app_key("github")), Status::Connected);
    assert_eq!(
        handle_name(&resolution, &app_key("github")).as_deref(),
        Some("GithubLink")
    );
}

#[test]
fn github_flag_on_counts_connect() {
    let resolution = run(Flag::On, every_source(app_key("github")));

    assert_eq!(
        handle_name(&resolution, &app_key("github")).as_deref(),
        Some("Connect")
    );
}

#[test]
fn github_flag_on_with_only_the_link_is_not_connected() {
    let resolution = run(
        Flag::On,
        vec![held(SourceKind::GithubLink, app_key("github"))],
    );

    assert_eq!(
        resolution.mcp.status(&app_key("github")),
        Status::NotConnected
    );
    assert_eq!(resolution.mcp.handles().count(), 0);
}

#[test]
fn github_flag_on_connect_does_not_serve_it_counts_the_link() {
    let connections = every_source(app_key("github"));
    let resolution = resolve(
        &user(),
        Flag::On,
        &overlays(),
        &ConnectSupport::default(),
        connections,
    );

    assert_eq!(
        handle_name(&resolution, &app_key("github")).as_deref(),
        Some("GithubLink")
    );
}

// The table: an overlaid app.

#[test]
fn overlaid_app_flag_off_counts_native() {
    let resolution = run(
        Flag::Off,
        vec![
            held(SourceKind::Native, server_key(STRIPE_SERVER)),
            held(SourceKind::Pipedream, app_key("stripe")),
            held(SourceKind::Connect, app_key("stripe")),
        ],
    );

    assert_eq!(
        handle_name(&resolution, &app_key("stripe")).as_deref(),
        Some("Native")
    );
    assert_eq!(resolution.mcp.resolved().len(), 1);
}

#[test]
fn overlaid_app_flag_on_connect_serves_it_counts_connect() {
    let resolution = run(
        Flag::On,
        vec![
            held(SourceKind::Native, server_key(STRIPE_SERVER)),
            held(SourceKind::Pipedream, app_key("stripe")),
            held(SourceKind::Connect, app_key("stripe")),
        ],
    );

    assert_eq!(
        handle_name(&resolution, &app_key("stripe")).as_deref(),
        Some("Connect")
    );
    assert_eq!(resolution.mcp.resolved().len(), 1);
}

#[test]
fn overlaid_app_flag_on_connect_does_not_serve_it_counts_native() {
    let resolution = run(
        Flag::On,
        vec![
            held(SourceKind::Native, server_key(FIGMA_SERVER)),
            held(SourceKind::Pipedream, app_key("figma")),
        ],
    );

    assert_eq!(
        handle_name(&resolution, &app_key("figma")).as_deref(),
        Some("Native")
    );
}

#[test]
fn overlaid_app_native_row_without_a_grant_needs_reauth() {
    let resolution = run(
        Flag::Off,
        vec![unauthorized(held(
            SourceKind::Native,
            server_key(STRIPE_SERVER),
        ))],
    );

    assert_eq!(
        resolution.mcp.status(&app_key("stripe")),
        Status::NeedsReauth
    );
    assert_eq!(resolution.mcp.handles().count(), 0);
}

// The table: any other catalog app.

#[test]
fn catalog_app_flag_off_counts_pipedream() {
    let resolution = run(
        Flag::Off,
        vec![
            held(SourceKind::Pipedream, app_key("linear")),
            held(SourceKind::Connect, app_key("linear")),
        ],
    );

    assert_eq!(
        handle_name(&resolution, &app_key("linear")).as_deref(),
        Some("Pipedream")
    );
}

#[test]
fn catalog_app_flag_on_connect_serves_it_counts_connect() {
    let resolution = run(
        Flag::On,
        vec![
            held(SourceKind::Pipedream, app_key("linear")),
            held(SourceKind::Connect, app_key("linear")),
        ],
    );

    assert_eq!(
        handle_name(&resolution, &app_key("linear")).as_deref(),
        Some("Connect")
    );
}

#[test]
fn catalog_app_flag_on_connect_does_not_serve_it_counts_pipedream() {
    let resolution = run(
        Flag::On,
        vec![held(SourceKind::Pipedream, app_key("asana"))],
    );

    assert_eq!(resolution.mcp.status(&app_key("asana")), Status::Connected);
    assert_eq!(
        handle_name(&resolution, &app_key("asana")).as_deref(),
        Some("Pipedream")
    );
}

// The table: a server added by URL.

#[test]
fn url_server_counts_its_own_row_whatever_the_flag() {
    let url = "https://tools.example.com/mcp";
    for flag in [Flag::Off, Flag::On] {
        let resolution = run(flag, vec![held(SourceKind::Native, server_key(url))]);

        assert_eq!(resolution.mcp.status(&server_key(url)), Status::Connected);
        assert_eq!(
            handle_name(&resolution, &server_key(url)).as_deref(),
            Some("Native")
        );
    }
}

#[test]
fn url_server_without_a_grant_is_usable() {
    let url = "https://tools.example.com/mcp";
    let resolution = run(
        Flag::Off,
        vec![unauthorized(held(SourceKind::Native, server_key(url)))],
    );

    assert_eq!(resolution.mcp.status(&server_key(url)), Status::Connected);
}

// Rule 1: any other source is ignored.

#[test]
fn rule1_flagged_users_pipedream_connection_to_a_connect_app_is_not_connected() {
    let resolution = run(
        Flag::On,
        vec![held(SourceKind::Pipedream, app_key("linear"))],
    );

    assert_eq!(
        resolution.mcp.status(&app_key("linear")),
        Status::NotConnected
    );
    assert_eq!(resolution.mcp.handles().count(), 0);
    assert!(resolution.mcp.destinations().is_empty());
    assert!(resolution.api.is_empty());
    assert_eq!(
        resolution.mcp.permit(&app_key("linear")).unwrap_err(),
        PermitRefused::NotUsable(Status::NotConnected)
    );
}

#[test]
fn rule1_flagged_users_native_connection_to_a_connect_app_is_not_connected() {
    let resolution = run(
        Flag::On,
        vec![held(SourceKind::Native, server_key(STRIPE_SERVER))],
    );

    assert_eq!(
        resolution.mcp.status(&app_key("stripe")),
        Status::NotConnected
    );
    assert_eq!(
        resolution.mcp.status(&server_key(STRIPE_SERVER)),
        Status::NotConnected
    );
    assert_eq!(resolution.mcp.handles().count(), 0);
}

#[test]
fn rule1_unflagged_users_connect_connection_is_not_used() {
    let resolution = run(
        Flag::Off,
        vec![held(SourceKind::Connect, app_key("linear"))],
    );

    assert_eq!(
        resolution.mcp.status(&app_key("linear")),
        Status::NotConnected
    );
    assert_eq!(resolution.mcp.handles().count(), 0);
    assert!(resolution.api.is_empty());
}

#[test]
fn rule1_pipedream_connection_to_an_overlaid_app_is_ignored() {
    let resolution = run(
        Flag::Off,
        vec![held(SourceKind::Pipedream, app_key("figma"))],
    );

    assert_eq!(
        resolution.mcp.status(&app_key("figma")),
        Status::NotConnected
    );
    assert!(resolution.api.is_empty());
}

// Rule 2: a disabled connection is not connected.

#[test]
fn rule2_disabled_connection_is_not_connected() {
    let url = "https://tools.example.com/mcp";
    let resolution = run(
        Flag::Off,
        vec![
            disabled(held(SourceKind::Pipedream, app_key("linear"))),
            disabled(held(SourceKind::Native, server_key(url))),
        ],
    );

    assert_eq!(resolution.mcp.status(&app_key("linear")), Status::Disabled);
    assert_eq!(resolution.mcp.status(&server_key(url)), Status::Disabled);
    assert_eq!(resolution.mcp.handles().count(), 0);
    assert!(resolution.api.is_empty());
    assert_eq!(
        resolution.mcp.permit(&app_key("linear")).unwrap_err(),
        PermitRefused::NotUsable(Status::Disabled)
    );
}

#[test]
fn rule2_disabled_counted_connection_does_not_fall_back_to_another_source() {
    let resolution = run(
        Flag::On,
        vec![
            disabled(held(SourceKind::Connect, app_key("linear"))),
            held(SourceKind::Pipedream, app_key("linear")),
        ],
    );

    assert_eq!(resolution.mcp.status(&app_key("linear")), Status::Disabled);
    assert_eq!(resolution.mcp.handles().count(), 0);
}

// Rule 3: at most one connection per app.

#[test]
fn rule3_two_connections_to_one_app_give_one_answer() {
    let resolution = run(
        Flag::Off,
        vec![
            held(SourceKind::Pipedream, app_key("slack_v2")),
            held(SourceKind::Pipedream, app_key("slack")),
            held(
                SourceKind::Native,
                server_key("https://tools.example.com/mcp"),
            ),
            held(
                SourceKind::Native,
                server_key("https://tools.example.com/mcp/"),
            ),
        ],
    );

    assert_eq!(resolution.mcp.resolved().len(), 2);
    assert_eq!(resolution.mcp.handles().count(), 2);
    assert_eq!(resolution.api.len(), 1);
}

#[test]
fn rule3_the_usable_connection_wins() {
    let mut usable = held(SourceKind::Pipedream, app_key("slack"));
    usable.source_id = "slack_v2".to_owned();
    usable.name = "usable".to_owned();
    let mut off = disabled(held(SourceKind::Pipedream, app_key("slack")));
    off.source_id = "slack".to_owned();

    for connections in [
        vec![usable.clone(), off.clone()],
        vec![off.clone(), usable.clone()],
    ] {
        let resolution = run(Flag::Off, connections);

        assert_eq!(resolution.mcp.status(&app_key("slack")), Status::Connected);
        assert_eq!(
            handle_name(&resolution, &app_key("slack")).as_deref(),
            Some("usable")
        );
    }
}

// Rule 4: `slack` and `slack_v2` are one app.

#[test]
fn rule4_slack_v2_is_slack() {
    assert_eq!(app("slack_v2"), app("slack"));

    let resolution = run(
        Flag::Off,
        vec![held(SourceKind::Pipedream, app_key("slack_v2"))],
    );

    assert_eq!(resolution.mcp.status(&app_key("slack")), Status::Connected);
}

#[test]
fn rule4_an_overlay_under_the_alias_is_the_app() {
    let overlays = Overlays::new([(
        app("slack_v2"),
        ServerUrl::parse("https://mcp.slack.com/mcp").unwrap(),
    )]);
    let resolution = resolve(
        &user(),
        Flag::Off,
        &overlays,
        &connect(),
        vec![held(
            SourceKind::Native,
            server_key("https://mcp.slack.com/mcp"),
        )],
    );

    assert_eq!(resolution.mcp.status(&app_key("slack")), Status::Connected);
}

// Rule 5: a native row is an app only at that app's overlay URL.

#[test]
fn rule5_native_row_at_the_overlay_url_is_the_app() {
    let resolution = run(
        Flag::Off,
        vec![held(
            SourceKind::Native,
            server_key("https://MCP.stripe.com/"),
        )],
    );

    assert_eq!(resolution.mcp.status(&app_key("stripe")), Status::Connected);
    assert_eq!(
        resolution.mcp.status(&server_key(STRIPE_SERVER)),
        Status::NotConnected
    );
}

#[test]
fn rule5_native_row_to_a_vendor_that_is_not_overlaid_is_a_url_server() {
    let linear_server = "https://mcp.linear.app/mcp";
    let resolution = run(
        Flag::Off,
        vec![
            held(SourceKind::Native, server_key(linear_server)),
            held(SourceKind::Pipedream, app_key("linear")),
        ],
    );

    assert_eq!(
        resolution.mcp.status(&server_key(linear_server)),
        Status::Connected
    );
    assert_eq!(
        handle_name(&resolution, &app_key("linear")).as_deref(),
        Some("Pipedream")
    );
    assert_eq!(resolution.mcp.handles().count(), 2);
}

#[test]
fn rule5_native_row_alone_does_not_connect_an_app_that_is_not_overlaid() {
    let resolution = run(
        Flag::Off,
        vec![held(
            SourceKind::Native,
            server_key("https://mcp.notion.com/mcp"),
        )],
    );

    assert_eq!(
        resolution.mcp.status(&app_key("notion")),
        Status::NotConnected
    );
}

#[test]
fn rule5_native_row_on_another_path_of_the_overlay_host_is_a_url_server() {
    let other_path = "https://mcp.stripe.com/beta";
    let resolution = run(
        Flag::Off,
        vec![held(SourceKind::Native, server_key(other_path))],
    );

    assert_eq!(
        resolution.mcp.status(&app_key("stripe")),
        Status::NotConnected
    );
    assert_eq!(
        resolution.mcp.status(&server_key(other_path)),
        Status::Connected
    );
}

// Rule 5 with a shared overlay address: one row stands for every app there.

#[test]
fn shared_overlay_address_row_counts_for_every_app_there() {
    let resolution = run(
        Flag::Off,
        vec![held(SourceKind::Native, server_key(ATLASSIAN_SERVER))],
    );

    assert_eq!(resolution.mcp.status(&app_key("jira")), Status::Connected);
    assert_eq!(
        resolution.mcp.status(&app_key("confluence")),
        Status::Connected
    );
    assert_eq!(
        resolution.mcp.status(&server_key(ATLASSIAN_SERVER)),
        Status::NotConnected
    );
    let keys: Vec<_> = resolution
        .mcp
        .handles()
        .map(|handle| handle.key().clone())
        .collect();
    assert_eq!(keys, vec![app_key("confluence"), app_key("jira")]);
}

#[test]
fn shared_overlay_address_row_counts_only_for_the_apps_native_serves() {
    let resolution = run(
        Flag::On,
        vec![held(SourceKind::Native, server_key(ATLASSIAN_SERVER))],
    );

    assert_eq!(
        resolution.mcp.status(&app_key("jira")),
        Status::NotConnected
    );
    assert_eq!(
        resolution.mcp.status(&app_key("confluence")),
        Status::Connected
    );
    assert_eq!(
        resolution.mcp.status(&server_key(ATLASSIAN_SERVER)),
        Status::NotConnected
    );
    assert_eq!(resolution.mcp.resolved().len(), 1);
}

#[test]
fn shared_overlay_address_row_is_ignored_when_connect_serves_every_app_there() {
    let connect = ConnectSupport::new([
        (app("jira"), Surfaces::new(true, true)),
        (app("confluence"), Surfaces::new(true, false)),
    ]);
    let resolution = resolve(
        &user(),
        Flag::On,
        &overlays(),
        &connect,
        vec![held(SourceKind::Native, server_key(ATLASSIAN_SERVER))],
    );

    assert!(resolution.mcp.resolved().is_empty());
}

// Rule 6: API access comes from the counted connection.

#[test]
fn rule6_pipedream_provides_an_api_for_every_app() {
    let resolution = run(
        Flag::Off,
        vec![held(SourceKind::Pipedream, app_key("asana"))],
    );

    assert_eq!(resolution.api.len(), 1);
    assert_eq!(resolution.api[0].app(), &app("asana"));
}

#[test]
fn rule6_connect_provides_an_api_only_where_its_catalog_lists_one() {
    let resolution = run(
        Flag::On,
        vec![
            held(SourceKind::Connect, app_key("linear")),
            held(SourceKind::Connect, app_key("granola")),
        ],
    );

    let apps: Vec<_> = resolution
        .api
        .iter()
        .map(|handle| handle.app().clone())
        .collect();
    assert_eq!(apps, vec![app("linear")]);
    assert_eq!(
        resolution.mcp.status(&app_key("granola")),
        Status::Connected
    );
}

#[test]
fn rule6_native_and_the_github_link_never_provide_an_api() {
    let mut native = held(SourceKind::Native, server_key(STRIPE_SERVER));
    native.api = Some(Arc::new(Undialed));
    let mut link = held(SourceKind::GithubLink, app_key("github"));
    link.api = Some(Arc::new(Undialed));

    let resolution = run(Flag::Off, vec![native, link]);

    assert_eq!(resolution.mcp.handles().count(), 2);
    assert!(resolution.api.is_empty());
}

#[test]
fn rule6_the_api_comes_from_the_connection_that_counts() {
    let pipedream = held(SourceKind::Pipedream, app_key("linear"));
    let connect = held(SourceKind::Connect, app_key("linear"));
    let connect_api = connect.api.clone().unwrap();

    let resolution = run(Flag::On, vec![pipedream, connect]);

    assert_eq!(resolution.api.len(), 1);
    assert!(Arc::ptr_eq(resolution.api[0].connection(), &connect_api));
}

#[test]
fn rule6_flagged_user_has_no_api_for_an_app_connect_holds_as_mcp_only() {
    let resolution = run(
        Flag::On,
        vec![
            held(SourceKind::Pipedream, app_key("granola")),
            held(SourceKind::Connect, app_key("granola")),
        ],
    );

    assert_eq!(
        resolution.mcp.status(&app_key("granola")),
        Status::Connected
    );
    assert!(resolution.api.is_empty());
}

// Rule 7: an agent reaches only the apps it was given.

#[test]
fn rule7_selected_apps_reach_only_those_apps() {
    let url = "https://tools.example.com/mcp";
    let resolution = run(
        Flag::Off,
        vec![
            held(SourceKind::Pipedream, app_key("linear")),
            held(SourceKind::Pipedream, app_key("asana")),
            held(SourceKind::Native, server_key(url)),
        ],
    );
    let scoped = resolution.mcp.scoped(&Selection::Apps(vec![app("linear")]));

    let keys: Vec<_> = scoped
        .handles()
        .map(|handle| handle.key().clone())
        .collect();
    assert_eq!(keys, vec![app_key("linear")]);
    assert_eq!(scoped.destinations(), vec![app_key("linear")]);
    assert!(scoped.permit(&app_key("linear")).is_ok());
    assert_eq!(
        scoped.permit(&app_key("asana")).unwrap_err(),
        PermitRefused::OutOfScope
    );
    assert_eq!(
        scoped.permit(&server_key(url)).unwrap_err(),
        PermitRefused::OutOfScope
    );
}

#[test]
fn rule7_selected_app_not_connected_is_advertised_and_asks_to_connect() {
    let resolution = run(
        Flag::Off,
        vec![held(SourceKind::Pipedream, app_key("linear"))],
    );
    let scoped = resolution
        .mcp
        .scoped(&Selection::Apps(vec![app("linear"), app("notion")]));

    assert_eq!(
        scoped.destinations(),
        vec![app_key("linear"), app_key("notion")]
    );
    assert_eq!(
        scoped.permit(&app_key("notion")).unwrap_err(),
        PermitRefused::NotUsable(Status::NotConnected)
    );
}

#[test]
fn rule7_all_apps_still_gets_a_connect_prompt_for_an_unconnected_app() {
    let resolution = run(
        Flag::Off,
        vec![held(SourceKind::Pipedream, app_key("linear"))],
    );
    let scoped = resolution.mcp.scoped(&Selection::All);

    assert_eq!(scoped.destinations(), vec![app_key("linear")]);
    assert_eq!(
        scoped.permit(&app_key("notion")).unwrap_err(),
        PermitRefused::NotUsable(Status::NotConnected)
    );
}

#[test]
fn rule7_scoping_again_only_narrows() {
    let resolution = run(
        Flag::Off,
        vec![
            held(SourceKind::Pipedream, app_key("linear")),
            held(SourceKind::Pipedream, app_key("asana")),
        ],
    );
    let scoped = resolution
        .mcp
        .scoped(&Selection::Apps(vec![app("linear")]))
        .scoped(&Selection::All)
        .scoped(&Selection::Apps(vec![app("linear"), app("asana")]));

    assert_eq!(
        scoped.permit(&app_key("asana")).unwrap_err(),
        PermitRefused::OutOfScope
    );
    assert!(scoped.permit(&app_key("linear")).is_ok());
}

// Rule 8: a GitHub link whose token stopped working needs reauthorization.

#[test]
fn rule8_github_link_with_a_dead_token_needs_reauth() {
    let resolution = run(
        Flag::Off,
        vec![unauthorized(held(
            SourceKind::GithubLink,
            app_key("github"),
        ))],
    );

    assert_eq!(
        resolution.mcp.status(&app_key("github")),
        Status::NeedsReauth
    );
    assert_eq!(resolution.mcp.handles().count(), 0);
    assert_eq!(
        resolution.mcp.permit(&app_key("github")).unwrap_err(),
        PermitRefused::NotUsable(Status::NeedsReauth)
    );
}

// Rule 9: a failed flag read counts as flag off.

#[test]
fn rule9_failed_flag_read_counts_as_off() {
    let flag = Flag::from_read(Err(rootcause::report!("flag service unreachable")));
    assert_eq!(flag, Flag::Off);

    let resolution = run(
        flag,
        vec![
            held(SourceKind::Pipedream, app_key("linear")),
            held(SourceKind::Connect, app_key("linear")),
        ],
    );
    assert_eq!(
        handle_name(&resolution, &app_key("linear")).as_deref(),
        Some("Pipedream")
    );
}

#[test]
fn rule9_a_read_flag_is_what_it_reads() {
    assert_eq!(Flag::from_read(Ok(true)), Flag::On);
    assert_eq!(Flag::from_read(Ok(false)), Flag::Off);
}
