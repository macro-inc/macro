//! The rules: which connection counts for each app, and what it may be used
//! for. This is the only code that applies them; everything else asks it.
//!
//! | App | Flag off | Flag on, Connect serves it | Flag on, Connect does not |
//! |---|---|---|---|
//! | GitHub | the account link | Connect | the account link |
//! | An overlaid app | native | Connect | native |
//! | Any other catalog app | Pipedream | Connect | Pipedream |
//! | A server added by URL | its own row | its own row | its own row |
//!
//! A connection through any other source is ignored (rule 1), a disabled one
//! is not connected (2), an app gets at most one answer (3), `slack_v2` is
//! `slack` (4), a native row is an app only at that app's overlay URL (5),
//! API access comes from the counted connection when its source provides an
//! API for the app (6), and a failed flag read is off (9).

use crate::domain::catalog::{ConnectSupport, Overlays};
use crate::domain::models::{
    ApiHandle, ConnectorId, ConnectorKey, McpConnections, McpHandle, Resolved, Status, Surfaces,
};
use crate::domain::ports::{GrantState, SourceConnection, SourceKind};
use macro_user_id::user_id::MacroUserIdStr;
use std::collections::BTreeMap;

#[cfg(test)]
mod test;

/// The Macro Connect rollout flag, as the rules see it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Flag {
    On,
    Off,
}

impl Flag {
    /// The flag from a read of it. A failed read is off (rule 9): nobody is
    /// moved onto Connect by an outage.
    pub(crate) fn from_read(read: Result<bool, rootcause::Report>) -> Self {
        match read {
            Ok(true) => Self::On,
            Ok(false) => Self::Off,
            Err(error) => {
                tracing::warn!(error = ?error, "could not read the Connect rollout flag; counting it as off");
                Self::Off
            }
        }
    }
}

/// One user's answer: their MCP connections, and API access where their
/// counted connection provides it.
pub(crate) struct Resolution {
    pub(crate) mcp: McpConnections,
    pub(crate) api: Vec<ApiHandle>,
}

/// Apply the rules to every connection `user` holds in every source.
///
/// `connect` must cover every app among `connections`: an app missing from
/// it is one Connect does not serve.
pub(crate) fn resolve(
    user: &MacroUserIdStr<'static>,
    flag: Flag,
    overlays: &Overlays,
    connect: &ConnectSupport,
    connections: Vec<SourceConnection>,
) -> Resolution {
    // Keep each key's best connection from the source that counts for it.
    // A BTreeMap so the answer's order never depends on the input's.
    let mut counted: BTreeMap<ConnectorKey, (Status, SourceConnection)> = BTreeMap::new();
    for connection in connections {
        for key in identify(&connection, overlays) {
            let counts = match &key {
                ConnectorKey::App(app) => {
                    connection.source == counted_source(app, flag, overlays, connect)
                }
                ConnectorKey::Server(_) => connection.source == SourceKind::Native,
            };
            if !counts {
                continue;
            }

            let status = status(&key, &connection);
            let better = counted.get(&key).is_none_or(|(held_status, held)| {
                (rank(status), &connection.source_id) < (rank(*held_status), &held.source_id)
            });
            if better {
                counted.insert(key, (status, connection.clone()));
            }
        }
    }

    let mut resolved = Vec::with_capacity(counted.len());
    let mut api = Vec::new();
    for (key, (status, connection)) in counted {
        let provides_api = match &key {
            ConnectorKey::App(app) => {
                connection.api.is_some() && source_provides_api(connection.source, app, connect)
            }
            ConnectorKey::Server(_) => false,
        };
        let surfaces = Surfaces::new(connection.mcp.is_some(), provides_api);

        let usable = status == Status::Connected;
        let mcp = match (&connection.mcp, usable) {
            (Some(mcp), true) => Some(McpHandle::new(
                key.clone(),
                connection.name.clone(),
                mcp.clone(),
            )),
            _ => None,
        };
        if let (ConnectorKey::App(app), Some(connection_api), true) =
            (&key, &connection.api, usable && provides_api)
        {
            api.push(ApiHandle::new(
                user.clone(),
                app.clone(),
                connection_api.clone(),
            ));
        }

        resolved.push(Resolved {
            key,
            name: connection.name,
            status,
            surfaces,
            mcp,
        });
    }

    Resolution {
        mcp: McpConnections::new(user.clone(), resolved),
        api,
    }
}

/// What a connection is to. A native row is an app only when its URL is
/// that app's overlay server (rule 5), and then it is every app overlaid at
/// that server, never also a server added by URL. A native row anywhere
/// else is a server added by URL.
pub(crate) fn identify(connection: &SourceConnection, overlays: &Overlays) -> Vec<ConnectorKey> {
    let (SourceKind::Native, ConnectorKey::Server(url)) = (&connection.source, &connection.key)
    else {
        return vec![connection.key.clone()];
    };

    let apps: Vec<_> = overlays
        .apps_at(url)
        .cloned()
        .map(ConnectorKey::App)
        .collect();
    if apps.is_empty() {
        vec![connection.key.clone()]
    } else {
        apps
    }
}

/// The one source whose connection counts for `app` (the table above).
pub(crate) fn counted_source(
    app: &ConnectorId,
    flag: Flag,
    overlays: &Overlays,
    connect: &ConnectSupport,
) -> SourceKind {
    if flag == Flag::On && connect.surfaces(app).is_some() {
        return SourceKind::Connect;
    }

    if *app == ConnectorId::github() {
        SourceKind::GithubLink
    } else if overlays.is_overlaid(app) {
        SourceKind::Native
    } else {
        SourceKind::Pipedream
    }
}

/// A counted connection's status. A server added by URL needs no grant to
/// be usable: some take anonymous requests, and dialing finds out. One
/// whose grant is known dead needs signing in again, as an app does.
fn status(key: &ConnectorKey, connection: &SourceConnection) -> Status {
    if !connection.enabled {
        return Status::Disabled;
    }

    match (key, connection.grant) {
        (_, GrantState::Working) | (ConnectorKey::Server(_), GrantState::Missing) => {
            Status::Connected
        }
        (_, GrantState::Dead) | (ConnectorKey::App(_), GrantState::Missing) => Status::NeedsReauth,
    }
}

/// Which of two connections to one key wins: the most usable.
fn rank(status: Status) -> u8 {
    match status {
        Status::Connected => 0,
        Status::NeedsReauth => 1,
        Status::Disabled => 2,
        Status::NotConnected => 3,
    }
}

/// Whether `source` provides an API for `app` (rule 6): Pipedream for every
/// app, Connect where its catalog lists API access, native servers and the
/// GitHub link never.
fn source_provides_api(source: SourceKind, app: &ConnectorId, connect: &ConnectSupport) -> bool {
    match source {
        SourceKind::Pipedream => true,
        SourceKind::Connect => connect.surfaces(app).is_some_and(|surfaces| surfaces.api()),
        SourceKind::Native | SourceKind::GithubLink => false,
    }
}
