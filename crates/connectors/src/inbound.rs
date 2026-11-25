//! Inbound adapters: the `/connectors` HTTP API, the routes vendors and
//! authorization servers call back on, and the agent tools that discover
//! and add connectors. They speak in apps and servers, never in sources.

/// The authenticated `/connectors` routes.
pub mod axum_router;
/// The public routes vendors and authorization servers redirect to or post.
pub mod callbacks;
/// Shapes the HTTP API sends and receives, and the connector key's string
/// form.
pub mod dto;
/// The agent tools that discover connectors and add servers.
pub mod toolset;

#[cfg(test)]
mod test_support;

#[cfg(test)]
mod test;

use crate::domain::models::ConnectorKey;
use macro_user_id::user_id::MacroUserIdStr;
use std::pin::Pin;
use std::sync::Arc;

/// A user's connection to an app or server that was just made or removed,
/// as hosts' hooks receive it. It never says which source holds it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ConnectorChange {
    /// Whose connection it is.
    pub user: MacroUserIdStr<'static>,
    /// The app or server.
    pub key: ConnectorKey,
}

/// A host's reaction to a [`ConnectorChange`] (e.g. recording analytics).
/// It runs before the request answers, so it must be quick or spawn.
pub type ConnectorHook =
    Arc<dyn Fn(ConnectorChange) -> Pin<Box<dyn Future<Output = ()> + Send>> + Send + Sync>;

/// One hook that runs each of `hooks` in turn, for a host with more than
/// one reaction to the same change.
pub fn each_of(hooks: Vec<ConnectorHook>) -> ConnectorHook {
    let hooks: Arc<[ConnectorHook]> = hooks.into();
    Arc::new(move |change: ConnectorChange| {
        let hooks = hooks.clone();
        Box::pin(async move {
            for hook in hooks.iter() {
                hook(change.clone()).await;
            }
        })
    })
}

/// Run `hook`, if any, for each of `keys`.
async fn fire(hook: Option<&ConnectorHook>, user: &MacroUserIdStr<'static>, keys: &[ConnectorKey]) {
    let Some(hook) = hook else {
        return;
    };
    for key in keys {
        hook(ConnectorChange {
            user: user.clone(),
            key: key.clone(),
        })
        .await;
    }
}
