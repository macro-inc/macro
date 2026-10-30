//! Reaching a user's Notion through their Pipedream Connect grant: Pipedream
//! injects the account's credentials into proxied REST requests.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, PoisonError, Weak};

use http::header::{CONTENT_TYPE, HeaderMap, HeaderName, HeaderValue};
use macro_user_id::user_id::MacroUserIdStr;
use pipedream_mcp::domain::models::PipedreamConnection;
use pipedream_mcp::domain::ports::{ConnectedAppProxy, ConnectionStore};
use rootcause::compat::IntoRootcause;

use super::rest::{
    NOTION_REQUEST_INTERVAL, NOTION_VERSION, NotionRead, NotionRestClient, NotionTransport,
    RequestPacer, TransportResponse,
};
use crate::domain::ports::{NotionConnections, NotionError};

/// Pipedream's app slug for Notion.
const NOTION_APP: &str = "notion";

/// Notion's REST API origin.
const NOTION_API_URL: &str = "https://api.notion.com";

/// Opens users' Notion workspaces from their Pipedream connections.
///
/// Every client of one Pipedream account shares a [`RequestPacer`], so
/// concurrent imports from the same workspace grant stay under Notion's rate
/// limit together.
pub struct PipedreamNotionConnections<Store, Proxy> {
    store: Arc<Store>,
    proxy: Option<Arc<Proxy>>,
    pacers: Mutex<HashMap<String, Weak<RequestPacer>>>,
}

impl<Store, Proxy> PipedreamNotionConnections<Store, Proxy> {
    /// Connections read from `store`, proxied through `proxy`; with no proxy
    /// (Pipedream unconfigured) nobody has Notion connected.
    pub fn new(store: Arc<Store>, proxy: Option<Arc<Proxy>>) -> Self {
        Self {
            store,
            proxy,
            pacers: Mutex::new(HashMap::new()),
        }
    }

    fn pacer(&self, account_id: &str) -> Arc<RequestPacer> {
        let mut pacers = self.pacers.lock().unwrap_or_else(PoisonError::into_inner);
        if let Some(pacer) = pacers.get(account_id).and_then(Weak::upgrade) {
            return pacer;
        }
        pacers.retain(|_, pacer| pacer.strong_count() > 0);
        let pacer = Arc::new(RequestPacer::new(NOTION_REQUEST_INTERVAL));
        pacers.insert(account_id.to_owned(), Arc::downgrade(&pacer));
        pacer
    }
}

impl<Store, Proxy> NotionConnections for PipedreamNotionConnections<Store, Proxy>
where
    Store: ConnectionStore,
    Proxy: ConnectedAppProxy,
{
    type Api = NotionRestClient<PipedreamTransport<Proxy>>;

    #[tracing::instrument(skip_all, err)]
    async fn for_user(
        &self,
        user: &MacroUserIdStr<'static>,
    ) -> Result<Option<Self::Api>, NotionError> {
        let Some(proxy) = &self.proxy else {
            return Ok(None);
        };
        let connection = self.store.load(user, NOTION_APP).await.map_err(|error| {
            NotionError::Transport(rootcause::report!(
                "loading the Notion connection: {error:?}"
            ))
        })?;
        let Some(connection) = connection.filter(|connection| connection.enabled) else {
            return Ok(None);
        };
        let pacer = self.pacer(&connection.account_id);
        Ok(Some(NotionRestClient::new(
            PipedreamTransport {
                proxy: proxy.clone(),
                connection,
            },
            pacer,
        )))
    }
}

/// Sends Notion REST requests through Pipedream's Connect proxy for one
/// connected account.
pub struct PipedreamTransport<Proxy> {
    proxy: Arc<Proxy>,
    connection: PipedreamConnection,
}

impl<Proxy: ConnectedAppProxy> NotionTransport for PipedreamTransport<Proxy> {
    async fn send(&self, read: &NotionRead) -> Result<TransportResponse, NotionError> {
        let headers = HeaderMap::from_iter([
            (
                HeaderName::from_static("notion-version"),
                HeaderValue::from_static(NOTION_VERSION),
            ),
            (CONTENT_TYPE, HeaderValue::from_static("application/json")),
        ]);
        let response = self
            .proxy
            .proxy(
                &self.connection,
                read.method(),
                &format!("{NOTION_API_URL}{}", read.path_and_query()),
                &headers,
                read.body(),
            )
            .await
            .map_err(|error| NotionError::Transport(error.into_rootcause()))?;
        Ok(TransportResponse {
            status: response.status,
            retry_after: response.retry_after(),
            body: response.body,
        })
    }
}

#[cfg(test)]
mod test;
