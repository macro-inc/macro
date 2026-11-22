//! Reaching a user's Notion through their Notion connection: the connectors
//! services decide which connection counts and whether it provides Notion's
//! REST API, and put the account's credentials on each request.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, PoisonError, Weak};

use connectors::domain::models::{ApiHandle, ApiRequest, ConnectorId};
use connectors::domain::service::ApiConnectionsService;
use http::header::{CONTENT_TYPE, HeaderMap, HeaderName, HeaderValue};
use macro_user_id::user_id::MacroUserIdStr;

use super::rest::{
    NOTION_REQUEST_INTERVAL, NOTION_VERSION, NotionRead, NotionRestClient, NotionTransport,
    RequestPacer, TransportResponse,
};
use crate::domain::ports::{NotionConnections, NotionError};

/// Notion's catalog app.
const NOTION_APP: &str = "notion";

/// Notion's REST API origin.
const NOTION_API_URL: &str = "https://api.notion.com";

/// Opens users' Notion workspaces through their Notion connections.
///
/// Every client of one user's connection shares a [`RequestPacer`], so
/// concurrent imports from the same workspace grant stay under Notion's rate
/// limit together.
pub struct ConnectedNotion<S> {
    service: Arc<S>,
    pacers: Mutex<HashMap<MacroUserIdStr<'static>, Weak<RequestPacer>>>,
}

impl<S> ConnectedNotion<S> {
    /// Connections answered by `service`.
    pub fn new(service: Arc<S>) -> Self {
        Self {
            service,
            pacers: Mutex::new(HashMap::new()),
        }
    }

    fn pacer(&self, user: &MacroUserIdStr<'static>) -> Arc<RequestPacer> {
        let mut pacers = self.pacers.lock().unwrap_or_else(PoisonError::into_inner);
        if let Some(pacer) = pacers.get(user).and_then(Weak::upgrade) {
            return pacer;
        }
        pacers.retain(|_, pacer| pacer.strong_count() > 0);
        let pacer = Arc::new(RequestPacer::new(NOTION_REQUEST_INTERVAL));
        pacers.insert(user.clone(), Arc::downgrade(&pacer));
        pacer
    }
}

impl<S: ApiConnectionsService> NotionConnections for ConnectedNotion<S> {
    type Api = NotionRestClient<ConnectedTransport<S>>;

    #[tracing::instrument(skip_all, err)]
    async fn for_user(
        &self,
        user: &MacroUserIdStr<'static>,
    ) -> Result<Option<Self::Api>, NotionError> {
        let app = ConnectorId::parse(NOTION_APP).map_err(transport)?;
        let Some(handle) = self
            .service
            .connection(user, &app)
            .await
            .map_err(transport)?
        else {
            return Ok(None);
        };
        Ok(Some(NotionRestClient::new(
            ConnectedTransport {
                service: self.service.clone(),
                handle,
            },
            self.pacer(user),
        )))
    }
}

fn transport(error: impl std::error::Error + Send + Sync + 'static) -> NotionError {
    NotionError::Transport(rootcause::Report::new(error).into_dynamic())
}

/// Sends Notion REST requests through one user's Notion connection.
pub struct ConnectedTransport<S> {
    service: Arc<S>,
    handle: ApiHandle,
}

impl<S: ApiConnectionsService> NotionTransport for ConnectedTransport<S> {
    async fn send(&self, read: &NotionRead) -> Result<TransportResponse, NotionError> {
        let headers = HeaderMap::from_iter([
            (
                HeaderName::from_static("notion-version"),
                HeaderValue::from_static(NOTION_VERSION),
            ),
            (CONTENT_TYPE, HeaderValue::from_static("application/json")),
        ]);
        let response = self
            .service
            .call(
                &self.handle,
                ApiRequest {
                    method: read.method(),
                    url: format!("{NOTION_API_URL}{}", read.path_and_query()),
                    headers,
                    body: read.body().cloned(),
                },
            )
            .await
            .map_err(transport)?;
        Ok(TransportResponse {
            status: response.status,
            retry_after: response.retry_after(),
            body: response.body,
        })
    }
}

#[cfg(test)]
mod test;
