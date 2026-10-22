//! [`SetupConnections`] over Macro's connector stack.
//!
//! Import apps ask the connector selector, which knows whether a native or a
//! Pipedream connection serves the app. Other apps are Pipedream-only, so
//! their connection record and the Pipedream directory answer.

use std::sync::Arc;

use async_trait::async_trait;
use macro_user_id::user_id::MacroUserIdStr;
use mcp_select::ConnectorSelect;
use pipedream_mcp::domain::ports::{ConnectionStore, ConnectorDirectory};
use rootcause::compat::IntoRootcause;

use crate::domain::{
    catalog::{App, KnownApp},
    ports::{Result, SetupConnections, SetupError},
};

/// Connections through the selector, the Pipedream store and directory.
pub struct ConnectorSetupConnections<S, C, D> {
    selector: Arc<S>,
    store: Arc<C>,
    directory: Option<Arc<D>>,
}

impl<S, C, D> ConnectorSetupConnections<S, C, D> {
    /// An adapter over the selector, the connection store and, when Pipedream
    /// is configured, its directory.
    pub fn new(selector: Arc<S>, store: Arc<C>, directory: Option<Arc<D>>) -> Self {
        Self {
            selector,
            store,
            directory,
        }
    }
}

#[async_trait]
impl<S, C, D> SetupConnections for ConnectorSetupConnections<S, C, D>
where
    S: ConnectorSelect,
    C: ConnectionStore,
    D: ConnectorDirectory,
{
    async fn is_connected(&self, user: &MacroUserIdStr<'static>, app: &App) -> Result<bool> {
        if let Some(source) = app.import_source() {
            return Ok(self
                .selector
                .connector_connected(user, source.connector_ref())
                .await
                .into_rootcause()?);
        }
        let slug = match app {
            App::Known(KnownApp {
                connect_slug: Some(slug),
                ..
            }) => (*slug).to_owned(),
            App::Known(_) => return Ok(false),
            App::Other(slug) => slug.clone(),
        };
        let record = self.store.load(user, &slug).await.map_err(|error| {
            SetupError::Internal(rootcause::report!("connection store: {error:?}"))
        })?;
        Ok(record.is_some())
    }

    async fn directory_name(&self, slug: &str) -> Result<Option<String>> {
        let Some(directory) = &self.directory else {
            return Ok(None);
        };
        Ok(directory
            .retrieve(slug)
            .await
            .into_rootcause()?
            .map(|entry| entry.display_name))
    }
}
