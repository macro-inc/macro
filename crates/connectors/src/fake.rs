//! A fake of the three services for other crates' tests (feature
//! `test-fakes`).
//!
//! [`FakeConnectors`] builds the real [`Connectors`] over in-memory sources,
//! so a test can only be given states the services can produce: a test says
//! what a user holds, and the fake stores it in the source the rules count
//! for that user. Changes made through the services (connect, disable,
//! rename, remove) land in the same store and show in the next answer.

use crate::domain::catalog::{self, Overlays};
use crate::domain::models::{ApiResponse, ConnectorId, ConnectorKey, ServerUrl, Surfaces};
use crate::domain::ports::{
    GrantState, MacroConnectEnabledFlagReader, OverlayCatalog, Source, SourceKind,
};
use crate::domain::service::Connectors;
use macro_user_id::user_id::MacroUserIdStr;
use source::{FakeRow, FakeSource, FakeStore, SharedStore, lock};
use std::collections::{HashMap, HashSet};
use std::sync::Arc;

pub use source::ApiCall;

pub(crate) mod source;

/// A connection a test user holds.
#[derive(Clone, Debug)]
pub struct FakeConnection {
    key: FakeKey,
    name: Option<String>,
    enabled: bool,
    grant: GrantState,
    tools: Vec<String>,
    response: (http::StatusCode, String),
    in_turn: Vec<ApiResponse>,
}

#[derive(Clone, Debug)]
enum FakeKey {
    App(String),
    Server(String),
}

impl FakeConnection {
    /// A connection to the catalog app `slug`, held in whichever source the
    /// rules count for its user: Connect for a flagged user when Connect
    /// serves it, the account link for GitHub, the native API source (API
    /// access, no MCP) for an app Macro reaches by REST itself (`autodesk`),
    /// the native server for an overlaid app, and Pipedream (with API access)
    /// for any other.
    pub fn app(slug: &str) -> Self {
        Self::new(FakeKey::App(slug.to_owned()))
    }

    /// A server added by URL.
    pub fn server(url: &str) -> Self {
        Self::new(FakeKey::Server(url.to_owned()))
    }

    fn new(key: FakeKey) -> Self {
        Self {
            key,
            name: None,
            enabled: true,
            grant: GrantState::Working,
            tools: Vec::new(),
            response: (http::StatusCode::OK, "{}".to_owned()),
            in_turn: Vec::new(),
        }
    }

    /// Its display name, which its tools are listed under.
    pub fn named(mut self, name: &str) -> Self {
        self.name = Some(name.to_owned());
        self
    }

    /// Turned off by the user.
    pub fn disabled(mut self) -> Self {
        self.enabled = false;
        self
    }

    /// Its grant no longer works.
    pub fn needs_reauth(mut self) -> Self {
        self.grant = GrantState::Dead;
        self
    }

    /// The tools its MCP server lists. Calling one answers `<name>:<tool>`.
    pub fn with_tools(mut self, tools: &[&str]) -> Self {
        self.tools = tools.iter().map(|tool| (*tool).to_owned()).collect();
        self
    }

    /// What every call to its API answers, where it has one.
    pub fn answering(mut self, status: http::StatusCode, body: &str) -> Self {
        self.response = (status, body.to_owned());
        self
    }

    /// Answer its API calls with `responses`, one per call in order, before
    /// falling back to what [`answering`](Self::answering) set: for a test of
    /// a vendor client's paging or retries.
    pub fn answering_in_turn(mut self, responses: impl IntoIterator<Item = ApiResponse>) -> Self {
        self.in_turn = responses.into_iter().collect();
        self
    }
}

/// Builds [`Connectors`] over in-memory sources.
#[derive(Default)]
pub struct FakeConnectors {
    store: SharedStore,
    pipedream_apps: HashSet<ConnectorId>,
    connect_apps: HashMap<ConnectorId, Surfaces>,
    overlays: Vec<(ConnectorId, ServerUrl)>,
    flags: HashMap<MacroUserIdStr<'static>, Result<bool, String>>,
    held: Vec<(MacroUserIdStr<'static>, FakeConnection)>,
    unreachable: Vec<MacroUserIdStr<'static>>,
}

impl FakeConnectors {
    /// No apps, no connections, nobody flagged.
    pub fn new() -> Self {
        Self::default()
    }

    /// `slug` is in Pipedream's directory.
    pub fn with_catalog_app(mut self, slug: &str) -> Self {
        self.pipedream_apps.insert(app(slug));
        self
    }

    /// Macro Connect serves `slug`, with API access when `api`.
    pub fn with_connect_app(mut self, slug: &str, api: bool) -> Self {
        self.connect_apps
            .insert(app(slug), Surfaces::new(true, api));
        self
    }

    /// `slug` is overlaid: served by the vendor's own MCP server at `url`.
    pub fn with_overlay(mut self, slug: &str, url: &str) -> Self {
        self.overlays.push((app(slug), server_url(url)));
        self
    }

    /// The Macro Connect rollout is on for `user`.
    pub fn with_macro_connect_enabled(mut self, user: &MacroUserIdStr<'static>) -> Self {
        self.flags.insert(user.clone(), Ok(true));
        self
    }

    /// Reading the rollout flag for `user` fails.
    pub fn with_macro_connect_enabled_flag_failing(
        mut self,
        user: &MacroUserIdStr<'static>,
    ) -> Self {
        self.flags
            .insert(user.clone(), Err("the flag service is down".to_owned()));
        self
    }

    /// No source can list `user`'s connections, as when a store is down.
    /// Every user it holds still counts as a candidate holder of their apps.
    pub fn with_connections_unreachable(mut self, user: &MacroUserIdStr<'static>) -> Self {
        self.unreachable.push(user.clone());
        self
    }

    /// `user` holds `connection`.
    pub fn with_connection(
        mut self,
        user: &MacroUserIdStr<'static>,
        connection: FakeConnection,
    ) -> Self {
        self.held.push((user.clone(), connection));
        self
    }

    /// The services over everything set up so far. Building again resets
    /// the store to the set-up state.
    ///
    /// # Panics
    ///
    /// On a slug or URL that does not parse: a test set-up mistake.
    pub fn build(&self) -> Connectors {
        let overlays = Overlays::new(self.overlays.clone());
        let mut pipedream_apps = self.pipedream_apps.clone();
        let rows = self
            .held
            .iter()
            .map(|(user, connection)| self.row(user, connection, &mut pipedream_apps))
            .collect();
        *lock(&self.store) = FakeStore {
            rows,
            api_calls: Vec::new(),
            unreachable: self.unreachable.clone(),
        };

        let source = |kind: SourceKind, supported: HashMap<ConnectorId, Surfaces>| FakeSource {
            kind,
            store: self.store.clone(),
            supported,
            overlays: overlays.clone(),
        };
        let pipedream_supported = pipedream_apps
            .into_iter()
            .map(|app| (app, Surfaces::new(true, true)))
            .collect();
        let github_supported = HashMap::from([(ConnectorId::github(), Surfaces::new(true, false))]);
        let native_api_supported = HashMap::from([(
            app(catalog::AUTODESK_SLUG),
            Surfaces::new(false, true),
        )]);
        let sources: Vec<Arc<dyn Source>> = vec![
            Arc::new(source(SourceKind::Native, HashMap::new())),
            Arc::new(source(SourceKind::GithubLink, github_supported)),
            Arc::new(source(SourceKind::Pipedream, pipedream_supported)),
            Arc::new(source(SourceKind::Connect, self.connect_apps.clone())),
            Arc::new(source(SourceKind::NativeApi, native_api_supported)),
        ];
        let servers = Arc::new(source(SourceKind::Native, HashMap::new()));

        Connectors::new(
            sources,
            Some(servers),
            FakeMacroConnectEnabledFlag(self.flags.clone()),
            FakeOverlays(overlays),
        )
    }

    /// Every API call made through connectors built here, in order.
    pub fn api_calls(&self) -> Vec<ApiCall> {
        lock(&self.store).api_calls.clone()
    }

    /// The row `connection` is stored as for `user`, in the source that
    /// counts for them.
    fn row(
        &self,
        user: &MacroUserIdStr<'static>,
        connection: &FakeConnection,
        pipedream_apps: &mut HashSet<ConnectorId>,
    ) -> FakeRow {
        let flagged = matches!(self.flags.get(user), Some(Ok(true)));
        let (source, key, api) = match &connection.key {
            FakeKey::Server(url) => (
                SourceKind::Native,
                ConnectorKey::Server(server_url(url)),
                false,
            ),
            FakeKey::App(slug) => {
                let app = app(slug);
                let overlay = self.overlays.iter().find(|(overlaid, _)| *overlaid == app);
                match (
                    flagged.then(|| self.connect_apps.get(&app)).flatten(),
                    overlay,
                ) {
                    (Some(surfaces), _) => {
                        (SourceKind::Connect, ConnectorKey::App(app), surfaces.api())
                    }
                    (None, _) if app == ConnectorId::github() => {
                        (SourceKind::GithubLink, ConnectorKey::App(app), false)
                    }
                    (None, _) if catalog::is_native_api(&app) => {
                        (SourceKind::NativeApi, ConnectorKey::App(app), true)
                    }
                    (None, Some((_, url))) => {
                        (SourceKind::Native, ConnectorKey::Server(url.clone()), false)
                    }
                    (None, None) => {
                        pipedream_apps.insert(app.clone());
                        (SourceKind::Pipedream, ConnectorKey::App(app), true)
                    }
                }
            }
        };

        let mut row = FakeRow::new(user.clone(), source, key, api);
        if let Some(name) = &connection.name {
            row.name = name.clone();
        }
        row.enabled = connection.enabled;
        row.grant = connection.grant;
        row.tools = connection.tools.clone();
        row.response = connection.response.clone();
        row.in_turn = Arc::new(std::sync::Mutex::new(
            connection.in_turn.iter().cloned().collect(),
        ));

        row
    }
}

fn app(slug: &str) -> ConnectorId {
    ConnectorId::parse(slug).unwrap_or_else(|error| panic!("fake set-up: {error}"))
}

fn server_url(url: &str) -> ServerUrl {
    ServerUrl::parse(url).unwrap_or_else(|error| panic!("fake set-up: {error}"))
}

/// The flag as set up; unset users are off.
pub(crate) struct FakeMacroConnectEnabledFlag(
    pub(crate) HashMap<MacroUserIdStr<'static>, Result<bool, String>>,
);

impl MacroConnectEnabledFlagReader for FakeMacroConnectEnabledFlag {
    async fn read(&self, user: &MacroUserIdStr<'static>) -> Result<bool, rootcause::Report> {
        match self.0.get(user) {
            Some(Ok(on)) => Ok(*on),
            Some(Err(message)) => Err(rootcause::report!("{message}")),
            None => Ok(false),
        }
    }
}

/// The overlay table as set up.
pub(crate) struct FakeOverlays(pub(crate) Overlays);

impl OverlayCatalog for FakeOverlays {
    async fn overlays(&self) -> Result<Overlays, rootcause::Report> {
        Ok(self.0.clone())
    }
}
