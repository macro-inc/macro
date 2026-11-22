//! Resolving a connected app or custom server through the connectors
//! service.
//!
//! What a sandbox may reach is decided in one place, the connectors crate:
//! which connection counts for each app, whether it is usable, and whether
//! the session's agent was given it. This adapter asks that service for the
//! owner's connections, narrows them to the agent's selection, and turns the
//! proof it gets back into an upstream call. It never decides a source, a
//! flag or an enabled filter itself, and it cannot address an app it has no
//! proof for: the upstream comes only from a [`Permitted`] connection.
//!
//! The bearer and scoping headers it stamps are the owner's, which is why
//! this traffic flows through the proxy: the sandbox never holds them.

use connectors::{
    ConnectorId, ConnectorKey, ConnectorsError, McpConnections, McpConnectionsService,
    PermitRefused, Permitted, Selection, Upstream,
};
use macro_user_id::user_id::MacroUserIdStr;
use std::sync::Arc;

use crate::domain::error::EgressError;
use crate::domain::model::{
    BearerToken, CustomMcpServerKey, McpDestination, McpResolution, UpstreamCall,
};
use crate::domain::ports::McpCredentials;

#[cfg(test)]
mod test;

/// Resolves connected apps and custom servers against the owner's
/// connections, within what the session's agent was given.
pub struct ConnectorsMcpCredentials<Connections> {
    connections: Arc<Connections>,
}

impl<Connections> ConnectorsMcpCredentials<Connections>
where
    Connections: McpConnectionsService,
{
    /// Build the adapter over the connectors service.
    pub fn new(connections: Arc<Connections>) -> Self {
        Self { connections }
    }

    /// The key `destination` names among the owner's connections.
    ///
    /// A custom server is known here only by the hash of its address, so it
    /// is looked up among every usable connection the owner holds, in scope
    /// or not: whether the agent may reach it is [`McpConnections::permit`]'s
    /// to say.
    fn key(
        connections: &McpConnections,
        destination: &McpDestination,
    ) -> Result<ConnectorKey, EgressError> {
        match destination {
            McpDestination::Connected(slug) => ConnectorId::parse(slug.as_str())
                .map(ConnectorKey::App)
                .map_err(|_| EgressError::UnknownServer(slug.clone())),
            McpDestination::Custom(wanted) => connections
                .handles()
                .map(|handle| handle.key())
                .find(|key| match key {
                    ConnectorKey::Server(url) => {
                        CustomMcpServerKey::for_url(url.as_str()) == *wanted
                    }
                    ConnectorKey::App(_) => false,
                })
                .cloned()
                .ok_or_else(|| EgressError::UnknownCustomServer(wanted.clone())),
            McpDestination::Macro | McpDestination::Preview => {
                Err(EgressError::Internal(rootcause::report!(
                    "the connectors resolver was asked for Macro's own or a preview MCP server; \
                     the composition root did not layer WithMacroMcp"
                )))
            }
        }
    }

    /// The owner's display name for a usable connection.
    fn name(connections: &McpConnections, key: &ConnectorKey) -> String {
        connections
            .handles()
            .find(|handle| handle.key() == key)
            .map_or_else(|| key.to_string(), |handle| handle.name().to_owned())
    }

    /// The upstream a permitted connection is reached through.
    async fn upstream(
        &self,
        permitted: Permitted<'_>,
        connections: &McpConnections,
    ) -> Result<McpResolution, EgressError> {
        let key = permitted.key().clone();
        let key = &key;
        match self.connections.upstream(permitted).await {
            Ok(upstream) => upstream_call(upstream).map(McpResolution::Connected),
            // The grant died between listing and reaching for it.
            Err(ConnectorsError::NeedsReauth(_)) => Ok(match key {
                ConnectorKey::App(_) => McpResolution::NotConnected,
                ConnectorKey::Server(_) => McpResolution::Disconnected {
                    name: Self::name(connections, key),
                },
            }),
            Err(error) => Err(EgressError::Upstream(rootcause::report!(
                "could not address {key}: {error}"
            ))),
        }
    }

    /// An app in scope the owner cannot use yet: addressed for them anyway
    /// where its counted source can, so the session lists its real tools;
    /// otherwise answered with the connect prompt.
    async fn unconnected(
        &self,
        scoped: &McpConnections,
        key: &ConnectorKey,
    ) -> Result<McpResolution, EgressError> {
        let permitted = scoped
            .permit_unconnected(key)
            .map_err(|refused| match refused {
                PermitRefused::OutOfScope => EgressError::OutOfScope,
                PermitRefused::NotUsable(status) => EgressError::Internal(rootcause::report!(
                    "an app in scope was refused as {status:?}"
                )),
            })?;
        match self.connections.upstream(permitted).await {
            Ok(upstream) => upstream_call(upstream).map(McpResolution::Unconnected),
            // Its source reaches it only through the owner's own connection.
            Err(
                ConnectorsError::NotFound(_)
                | ConnectorsError::UnknownApp(_)
                | ConnectorsError::NeedsReauth(_),
            ) => Ok(McpResolution::NotConnected),
            Err(error) => Err(EgressError::Upstream(rootcause::report!(
                "could not address {key} for an owner who has not connected it: {error}"
            ))),
        }
    }
}

/// The upstream as the proxy stamps it. Its constructors are what refuse a
/// non-https endpoint, and they are the only way to pair a URL with a
/// credential.
fn upstream_call(upstream: Upstream) -> Result<UpstreamCall, EgressError> {
    let call = match upstream.bearer() {
        Some(bearer) => {
            UpstreamCall::bearer(upstream.url().clone(), BearerToken::new(bearer.to_owned()))?
        }
        None => UpstreamCall::anonymous(upstream.url().clone())?,
    };

    Ok(call.scoped_by(upstream.headers().clone()))
}

impl<Connections> McpCredentials for ConnectorsMcpCredentials<Connections>
where
    Connections: McpConnectionsService,
{
    #[tracing::instrument(skip_all, err, fields(%owner, ?destination))]
    async fn resolve(
        &self,
        owner: &MacroUserIdStr<'static>,
        _agent: bot_id::BotId,
        _session: uuid::Uuid,
        selection: &Selection,
        destination: &McpDestination,
    ) -> Result<McpResolution, EgressError> {
        let connections = self.connections.connections(owner).await.map_err(|error| {
            EgressError::Internal(rootcause::report!(
                "could not read the owner's MCP connections: {error}"
            ))
        })?;
        let key = Self::key(&connections, destination)?;

        let scoped = connections.scoped(selection);
        match scoped.permit(&key) {
            Ok(permitted) => self.upstream(permitted, &connections).await,
            Err(PermitRefused::OutOfScope) => Err(EgressError::OutOfScope),
            Err(PermitRefused::NotUsable(status)) => match key {
                ConnectorKey::App(_) => {
                    tracing::debug!(?status, "the owner cannot use this app yet");
                    self.unconnected(&scoped, &key).await
                }
                // Found among the usable connections above, so not reached;
                // answered as a server with nowhere to go all the same.
                ConnectorKey::Server(_) => match destination {
                    McpDestination::Custom(wanted) => {
                        Err(EgressError::UnknownCustomServer(wanted.clone()))
                    }
                    _ => Err(EgressError::OutOfScope),
                },
            },
        }
    }

    #[tracing::instrument(skip_all, err, fields(?destination))]
    async fn unauthorized(
        &self,
        owner: &MacroUserIdStr<'static>,
        destination: &McpDestination,
    ) -> Result<Option<String>, EgressError> {
        if matches!(destination, McpDestination::Macro | McpDestination::Preview) {
            return Ok(None);
        }
        let connections = self.connections.connections(owner).await.map_err(|error| {
            EgressError::Internal(rootcause::report!(
                "could not read the owner's MCP connections: {error}"
            ))
        })?;
        // The key exactly as `resolve` found it; a destination naming none
        // of the owner's connections has nothing to record on.
        let Ok(key) = Self::key(&connections, destination) else {
            return Ok(None);
        };
        let Some(name) = connections
            .handles()
            .find(|handle| handle.key() == &key)
            .map(|handle| handle.name().to_owned())
        else {
            return Ok(None);
        };

        self.connections
            .unauthorized(owner, &key)
            .await
            .map_err(|error| {
                EgressError::Internal(rootcause::report!(
                    "could not record that {key} asked for a sign-in: {error}"
                ))
            })?;
        Ok(Some(name))
    }
}
