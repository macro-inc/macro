//! Properties over random inputs: the checked assertions of the integrations
//! data model, one property each.

use super::*;
use proptest::prelude::*;

const APPS: &[&str] = &[
    "github",
    "stripe",
    "figma",
    "jira",
    "confluence",
    "linear",
    "slack",
    "slack_v2",
    "granola",
    "asana",
];
const SERVERS: &[&str] = &[
    STRIPE_SERVER,
    "https://mcp.stripe.com/",
    FIGMA_SERVER,
    ATLASSIAN_SERVER,
    "https://mcp.linear.app/mcp",
    "https://tools.example.com/mcp",
];
const SOURCES: &[SourceKind] = &[
    SourceKind::Native,
    SourceKind::GithubLink,
    SourceKind::Pipedream,
    SourceKind::Connect,
];

/// Any connection a source could report. Native rows are servers and every
/// other source names an app. As in the model, every connection provides
/// MCP and Pipedream always an API; Connect, native and link rows sometimes
/// offer one, to check the resolver decides. `index` keeps ids distinct.
fn any_connection(index: usize) -> impl Strategy<Value = SourceConnection> {
    (
        0..SOURCES.len(),
        0..APPS.len().max(SERVERS.len()),
        any::<bool>(),
        any::<bool>(),
        any::<bool>(),
    )
        .prop_map(move |(source, target, enabled, authorized, api)| {
            let source = SOURCES[source];
            let key = match source {
                SourceKind::Native => server_key(SERVERS[target % SERVERS.len()]),
                _ => app_key(APPS[target % APPS.len()]),
            };
            let api = api || source == SourceKind::Pipedream;
            let api: Option<Arc<dyn ApiConnection>> = api.then(|| Arc::new(Undialed) as _);
            SourceConnection {
                source,
                key,
                source_id: format!("{index:03}"),
                name: format!("connection {index}"),
                enabled,
                authorized,
                mcp: Some(Arc::new(Undialed)),
                api,
            }
        })
}

fn any_connections() -> impl Strategy<Value = Vec<SourceConnection>> {
    (0..12usize).prop_flat_map(|count| (0..count).map(any_connection).collect::<Vec<_>>())
}

/// Which apps Connect serves, and of those which with an API.
fn any_connect_support() -> impl Strategy<Value = Vec<(ConnectorId, Surfaces)>> {
    proptest::collection::vec((any::<bool>(), any::<bool>()), APPS.len()).prop_map(|served| {
        APPS.iter()
            .zip(served)
            .filter(|(_, (serves, _))| *serves)
            .map(|(slug, (_, api))| (app(slug), Surfaces::new(true, api)))
            .collect()
    })
}

fn any_flag() -> impl Strategy<Value = Flag> {
    prop_oneof![Just(Flag::On), Just(Flag::Off)]
}

fn any_selection() -> impl Strategy<Value = Selection> {
    prop_oneof![
        Just(Selection::All),
        proptest::sample::subsequence(APPS, 0..=APPS.len())
            .prop_map(|slugs| Selection::Apps(slugs.into_iter().map(app).collect())),
    ]
}

/// The source the model designates for `app`, written out independently of
/// the resolver.
fn designated(flag: Flag, connect: &ConnectSupport, app: &ConnectorId) -> SourceKind {
    if flag == Flag::On && connect.surfaces(app).is_some() {
        SourceKind::Connect
    } else if app.as_str() == "github" {
        SourceKind::GithubLink
    } else if overlays().is_overlaid(app) {
        SourceKind::Native
    } else {
        SourceKind::Pipedream
    }
}

/// The input connection a handle's MCP connection came from.
fn mcp_input<'a>(inputs: &'a [SourceConnection], handle: &McpHandle) -> &'a SourceConnection {
    inputs
        .iter()
        .find(|input| {
            input
                .mcp
                .as_ref()
                .is_some_and(|mcp| Arc::ptr_eq(mcp, handle.connection()))
        })
        .unwrap()
}

/// The input connection an API handle came from.
fn api_input<'a>(inputs: &'a [SourceConnection], handle: &ApiHandle) -> &'a SourceConnection {
    inputs
        .iter()
        .find(|input| {
            input
                .api
                .as_ref()
                .is_some_and(|api| Arc::ptr_eq(api, handle.connection()))
        })
        .unwrap()
}

fn app_of(key: &ConnectorKey) -> Option<&ConnectorId> {
    match key {
        ConnectorKey::App(app) => Some(app),
        ConnectorKey::Server(_) => None,
    }
}

/// Everything the answer says, in a form two answers can be compared by.
fn summary(resolution: &Resolution) -> Vec<(ConnectorKey, String, Status, bool)> {
    resolution
        .mcp
        .resolved()
        .iter()
        .map(|resolved| {
            (
                resolved.key.clone(),
                resolved.name.clone(),
                resolved.status,
                resolved.mcp.is_some(),
            )
        })
        .collect()
}

proptest! {
    /// OneConnectionPerApp: each app and server gets exactly one answer, the
    /// same however the sources' rows are ordered.
    #[test]
    fn one_answer_per_app(
        flag in any_flag(),
        connect in any_connect_support(),
        (connections, shuffled) in any_connections()
            .prop_flat_map(|connections| (Just(connections.clone()), Just(connections).prop_shuffle())),
    ) {
        let connect = ConnectSupport::new(connect);
        let resolution = resolve(&user(), flag, &overlays(), &connect, connections);
        let reordered = resolve(&user(), flag, &overlays(), &connect, shuffled);

        let mut keys: Vec<_> = resolution.mcp.resolved().iter().map(|r| r.key.clone()).collect();
        let count = keys.len();
        keys.dedup();
        prop_assert_eq!(keys.len(), count);

        let mut api_apps: Vec<_> = resolution.api.iter().map(|handle| handle.app().clone()).collect();
        let api_count = api_apps.len();
        api_apps.sort();
        api_apps.dedup();
        prop_assert_eq!(api_apps.len(), api_count);

        prop_assert_eq!(summary(&resolution), summary(&reordered));
    }

    /// StatusMatchesUse, and a handle (MCP or API) exists only when connected.
    #[test]
    fn status_matches_use(
        flag in any_flag(),
        connect in any_connect_support(),
        connections in any_connections(),
    ) {
        let connect = ConnectSupport::new(connect);
        let resolution = resolve(&user(), flag, &overlays(), &connect, connections);

        for resolved in resolution.mcp.resolved() {
            prop_assert_eq!(resolved.status == Status::Connected, resolved.mcp.is_some());
        }
        for handle in resolution.mcp.handles() {
            prop_assert_eq!(resolution.mcp.status(handle.key()), Status::Connected);
        }
        for handle in &resolution.api {
            let key = ConnectorKey::App(handle.app().clone());
            prop_assert_eq!(resolution.mcp.status(&key), Status::Connected);
        }
    }

    /// FlaggedUsersUseOnlyConnect, UnflaggedUsersNeverUseConnect and
    /// OverlaidAppsNeverUsePipedream: every app handle comes from the source
    /// the table designates, and every URL server from a native row.
    #[test]
    fn handles_come_only_from_the_designated_source(
        flag in any_flag(),
        connect in any_connect_support(),
        connections in any_connections(),
    ) {
        let connect = ConnectSupport::new(connect);
        let resolution = resolve(&user(), flag, &overlays(), &connect, connections.clone());

        for handle in resolution.mcp.handles() {
            let source = mcp_input(&connections, handle).source;
            match app_of(handle.key()) {
                Some(app) => prop_assert_eq!(source, designated(flag, &connect, app)),
                None => prop_assert_eq!(source, SourceKind::Native),
            }
            if flag == Flag::Off {
                prop_assert_ne!(source, SourceKind::Connect);
            }
        }
    }

    /// OldConnectionsDoNotCount: a flagged user holding no Connect connection
    /// to an app Connect serves is not connected to it, whatever else they hold.
    #[test]
    fn old_connections_do_not_count(
        connect in any_connect_support(),
        connections in any_connections(),
    ) {
        let connect = ConnectSupport::new(connect);
        let resolution = resolve(&user(), Flag::On, &overlays(), &connect, connections.clone());

        for slug in APPS {
            let app = app(slug);
            let held_through_connect = connections.iter().any(|input| {
                input.source == SourceKind::Connect && input.key == ConnectorKey::App(app.clone())
            });
            if connect.surfaces(&app).is_some() && !held_through_connect {
                prop_assert_eq!(resolution.mcp.status(&ConnectorKey::App(app)), Status::NotConnected);
            }
        }
    }

    /// DisabledIsNeverUsed: nothing usable comes from a disabled connection.
    #[test]
    fn disabled_is_never_used(
        flag in any_flag(),
        connect in any_connect_support(),
        connections in any_connections(),
    ) {
        let connect = ConnectSupport::new(connect);
        let resolution = resolve(&user(), flag, &overlays(), &connect, connections.clone());

        for handle in resolution.mcp.handles() {
            prop_assert!(mcp_input(&connections, handle).enabled);
        }
        for handle in &resolution.api {
            prop_assert!(api_input(&connections, handle).enabled);
        }
    }

    /// ConnectingOnceIsEnough, ApiUsesTheSameConnection and
    /// NativeAndLinkNeverGiveApi: API access comes exactly when the counted
    /// connection's source has an API for the app, and from that connection.
    #[test]
    fn api_comes_from_the_counted_connection(
        flag in any_flag(),
        connect in any_connect_support(),
        connections in any_connections(),
    ) {
        let connect = ConnectSupport::new(connect);
        let resolution = resolve(&user(), flag, &overlays(), &connect, connections.clone());

        for handle in resolution.mcp.handles() {
            let Some(app) = app_of(handle.key()) else { continue };
            let input = mcp_input(&connections, handle);
            let source_has_api = match designated(flag, &connect, app) {
                SourceKind::Pipedream => true,
                SourceKind::Connect => connect.surfaces(app).is_some_and(|surfaces| surfaces.api()),
                SourceKind::Native | SourceKind::GithubLink => false,
            };
            let api = resolution.api.iter().find(|api| api.app() == app);

            prop_assert_eq!(api.is_some(), source_has_api && input.api.is_some());
            if let Some(api) = api {
                prop_assert!(std::ptr::eq(api_input(&connections, api), input));
            }
        }
        for handle in &resolution.api {
            let source = api_input(&connections, handle).source;
            prop_assert!(matches!(source, SourceKind::Pipedream | SourceKind::Connect));
        }
    }

    /// UrlServersAreNeverAnApp: a native row counts as an app only at that
    /// app's overlay server, and a row at an overlay server is never also a
    /// URL server.
    #[test]
    fn url_servers_are_never_an_app(
        flag in any_flag(),
        connect in any_connect_support(),
        connections in any_connections(),
    ) {
        let connect = ConnectSupport::new(connect);
        let overlays = overlays();
        let resolution = resolve(&user(), flag, &overlays, &connect, connections.clone());

        for handle in resolution.mcp.handles() {
            let input = mcp_input(&connections, handle);
            let ConnectorKey::Server(url) = &input.key else { continue };
            let overlaid_here: Vec<_> = overlays.apps_at(url).collect();
            match app_of(handle.key()) {
                Some(app) => prop_assert!(overlaid_here.contains(&app)),
                None => prop_assert!(overlaid_here.is_empty()),
            }
        }
    }

    /// SelectedListIsAPermission and AgentsNeverExceedTheirOwner: a scoped
    /// answer reaches only listed apps, never a URL server under a list, and
    /// never more than its owner has.
    #[test]
    fn selection_is_a_permission(
        flag in any_flag(),
        connect in any_connect_support(),
        connections in any_connections(),
        selection in any_selection(),
    ) {
        let connect = ConnectSupport::new(connect);
        let resolution = resolve(&user(), flag, &overlays(), &connect, connections);
        let scoped = resolution.mcp.scoped(&selection);

        let owners: Vec<_> = resolution.mcp.handles().map(|handle| handle.key().clone()).collect();
        for handle in scoped.handles() {
            prop_assert!(owners.contains(handle.key()));
            prop_assert!(scoped.permit(handle.key()).is_ok());
            if let Selection::Apps(apps) = &selection {
                prop_assert!(app_of(handle.key()).is_some_and(|app| apps.contains(app)));
            }
        }
        if let Selection::Apps(_) = &selection {
            for key in owners.iter().filter(|key| app_of(key).is_none()) {
                prop_assert_eq!(scoped.permit(key).unwrap_err(), PermitRefused::OutOfScope);
            }
        }
    }

    /// OnlyTheOwnersConnections: every handle is the user's own.
    #[test]
    fn only_the_owners_connections(
        flag in any_flag(),
        connect in any_connect_support(),
        connections in any_connections(),
    ) {
        let connect = ConnectSupport::new(connect);
        let resolution = resolve(&user(), flag, &overlays(), &connect, connections);

        for handle in resolution.mcp.handles() {
            prop_assert_eq!(handle.user(), &user());
        }
        for handle in &resolution.api {
            prop_assert_eq!(handle.user(), &user());
        }
    }
}
