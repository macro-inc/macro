#![deny(missing_docs)]

//! Typed, authenticated Rust client for the Macro Connect API.

pub mod wire;

use std::{fmt, time::Duration};

use connect_platform::inject_trace_headers;
use reqwest::{Method, StatusCode, header::HeaderMap};
use tracing::Span;
use url::Url;
use zeroize::{Zeroize as _, Zeroizing};

use wire::{
    CatalogEntry, ConnectSessionRequest, ConnectSessionResponse, Connection, ConnectionsPage,
    ConnectionsQuery, ConnectionsSummary, DeleteResponse, ErrorResponse, ListedConnection,
    ListedUser, TokenResponse, UsersPage, UsersQuery,
};

/// A failure a Connect customer can act on.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// The user has no connection to the requested app.
    #[error("app is not connected")]
    NotConnected,
    /// The user must reconnect the app.
    #[error("connection needs reauthorization")]
    NeedsReauth,
    /// The customer key was rejected.
    #[error("customer key was rejected")]
    Unauthorized,
    /// Connect could not be reached or is temporarily unavailable.
    #[error("Connect is unavailable")]
    Unavailable,
    /// Connect returned another API error.
    #[error("Connect API returned {status}: {message}")]
    Api {
        /// HTTP status code.
        status: StatusCode,
        /// API error code or response message.
        message: String,
    },
    /// Request construction or decoding failed.
    #[error("Connect client failed: {0}")]
    Internal(rootcause::Report),
}

/// Authenticated client for one Connect customer.
pub struct ConnectClient {
    base_url: Url,
    customer_key: Zeroizing<String>,
    http: reqwest::Client,
}

impl fmt::Debug for ConnectClient {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ConnectClient")
            .field("base_url", &self.base_url)
            .field("customer_key", &"[REDACTED]")
            .finish_non_exhaustive()
    }
}

/// Address and customer credential for an MCP client to dial Connect's gateway.
pub struct McpUpstream {
    /// Customer-scoped MCP gateway URL.
    pub url: Url,
    /// Customer bearer token to send to the gateway.
    pub bearer_token: String,
}

impl fmt::Debug for McpUpstream {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("McpUpstream")
            .field("url", &self.url)
            .field("bearer_token", &"[REDACTED]")
            .finish()
    }
}

impl Drop for McpUpstream {
    fn drop(&mut self) {
        self.bearer_token.zeroize();
    }
}

impl ConnectClient {
    /// Construct a client for a Connect origin or prefixed base URL.
    pub fn new(base_url: &str, customer_key: impl Into<String>) -> Result<Self, Error> {
        let base_url = Url::parse(base_url)
            .map_err(|error| Error::Internal(rootcause::Report::new(error).into_dynamic()))?;
        if !matches!(base_url.scheme(), "http" | "https")
            || base_url.cannot_be_a_base()
            || !base_url.username().is_empty()
            || base_url.password().is_some()
            || base_url.query().is_some()
            || base_url.fragment().is_some()
        {
            return Err(Error::Internal(
                rootcause::Report::new(std::io::Error::new(
                    std::io::ErrorKind::InvalidInput,
                    "invalid Connect base URL",
                ))
                .into_dynamic(),
            ));
        }
        let http = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(30))
            .build()
            .map_err(|error| Error::Internal(rootcause::Report::new(error).into_dynamic()))?;
        Ok(Self {
            base_url,
            customer_key: Zeroizing::new(customer_key.into()),
            http,
        })
    }

    /// List apps available to connect.
    #[tracing::instrument(
        name = "connect.client.catalog",
        skip_all,
        fields(app_id, outcome),
        err
    )]
    pub async fn catalog(&self) -> Result<Vec<CatalogEntry>, Error> {
        self.request(Method::GET, &["v1", "catalog"], None).await
    }

    /// Fetch an official SVG icon from Connect's public catalog.
    pub async fn catalog_icon(&self, app_id: &str) -> Result<Vec<u8>, Error> {
        let mut headers = HeaderMap::new();
        inject_trace_headers(&mut headers);
        let response = self
            .http
            .get(self.route(&["v1", "catalog", app_id, "icon.svg"]))
            .headers(headers)
            .send()
            .await
            .map_err(|_| Error::Unavailable)?;
        if !response.status().is_success() {
            return Err(Error::Api {
                status: response.status(),
                message: "catalog icon unavailable".to_owned(),
            });
        }
        response
            .bytes()
            .await
            .map(|bytes| bytes.to_vec())
            .map_err(|_| Error::Unavailable)
    }

    /// Create a browser session for connecting a user's app.
    #[tracing::instrument(name = "connect.client.create_connect_session", skip_all, fields(app_id = %app_id, outcome), err)]
    pub async fn create_connect_session(
        &self,
        external_user_id: &str,
        app_id: &str,
        redirect_url: &str,
    ) -> Result<ConnectSessionResponse, Error> {
        let body = ConnectSessionRequest {
            external_user_id: external_user_id.to_owned(),
            app_id: app_id.to_owned(),
            redirect_url: redirect_url.to_owned(),
        };
        self.request(Method::POST, &["v1", "connect-sessions"], Some(&body))
            .await
    }

    /// List a user's app connections.
    #[tracing::instrument(
        name = "connect.client.connections",
        skip_all,
        fields(app_id, outcome),
        err
    )]
    pub async fn connections(&self, external_user_id: &str) -> Result<Vec<Connection>, Error> {
        self.request(
            Method::GET,
            &["v1", "users", external_user_id, "connections"],
            None,
        )
        .await
    }

    /// List one page of this customer's connections, newest first.
    #[tracing::instrument(
        name = "connect.client.list_connections",
        skip_all,
        fields(count, outcome),
        err
    )]
    pub async fn list_connections(
        &self,
        query: ConnectionsQuery,
    ) -> Result<ConnectionsPage, Error> {
        let mut url = self.route(&["v1", "connections"]);
        {
            let mut pairs = url.query_pairs_mut();
            if let Some(limit) = query.limit {
                pairs.append_pair("limit", &limit.to_string());
            }
            if let Some(cursor) = &query.cursor {
                pairs.append_pair("cursor", cursor);
            }
            if let Some(app_id) = &query.app_id {
                pairs.append_pair("app_id", app_id);
            }
            if let Some(status) = query.status {
                pairs.append_pair("status", &status.to_string());
            }
        }
        let page: ConnectionsPage = self.request_at(Method::GET, url, None).await?;
        Span::current().record("count", page.items.len());
        Ok(page)
    }

    /// Return summary counts for this customer.
    #[tracing::instrument(
        name = "connect.client.connections_summary",
        skip_all,
        fields(users, connections, outcome),
        err
    )]
    pub async fn connections_summary(&self) -> Result<ConnectionsSummary, Error> {
        let summary: ConnectionsSummary = self
            .request(Method::GET, &["v1", "connections", "summary"], None)
            .await?;
        Span::current().record("users", summary.users);
        Span::current().record("connections", summary.connections);
        Ok(summary)
    }

    /// Collect every page matching the filters. Callers should use pages for large datasets.
    pub async fn all_connections(
        &self,
        mut query: ConnectionsQuery,
    ) -> Result<Vec<ListedConnection>, Error> {
        let mut items = Vec::new();
        loop {
            let page = self.list_connections(query.clone()).await?;
            items.extend(page.items);
            match page.next_cursor {
                Some(cursor) if query.cursor.as_deref() != Some(&cursor) => {
                    query.cursor = Some(cursor)
                }
                Some(_) => {
                    return Err(Error::Internal(
                        rootcause::Report::new(std::io::Error::new(
                            std::io::ErrorKind::InvalidData,
                            "repeated connections cursor",
                        ))
                        .into_dynamic(),
                    ));
                }
                None => return Ok(items),
            }
        }
    }

    /// List one page of connected users with all of each user's connections.
    #[tracing::instrument(
        name = "connect.client.list_users",
        skip_all,
        fields(count, outcome),
        err
    )]
    pub async fn list_users(&self, query: UsersQuery) -> Result<UsersPage, Error> {
        let mut url = self.route(&["v1", "users"]);
        {
            let mut pairs = url.query_pairs_mut();
            if let Some(limit) = query.limit {
                pairs.append_pair("limit", &limit.to_string());
            }
            if let Some(cursor) = &query.cursor {
                pairs.append_pair("cursor", cursor);
            }
            if let Some(app_id) = &query.app_id {
                pairs.append_pair("app_id", app_id);
            }
            if let Some(status) = query.status {
                pairs.append_pair("status", &status.to_string());
            }
        }
        let page: UsersPage = self.request_at(Method::GET, url, None).await?;
        Span::current().record("count", page.items.len());
        Ok(page)
    }

    /// Collect all connected users matching the filters.
    pub async fn all_users(&self, mut query: UsersQuery) -> Result<Vec<ListedUser>, Error> {
        let mut items = Vec::new();
        loop {
            let page = self.list_users(query.clone()).await?;
            items.extend(page.items);
            match page.next_cursor {
                Some(cursor) if query.cursor.as_deref() != Some(&cursor) => {
                    query.cursor = Some(cursor)
                }
                Some(_) => {
                    return Err(Error::Internal(
                        rootcause::Report::new(std::io::Error::new(
                            std::io::ErrorKind::InvalidData,
                            "repeated users cursor",
                        ))
                        .into_dynamic(),
                    ));
                }
                None => return Ok(items),
            }
        }
    }

    /// Delete a user's app connection locally. The vendor grant is not revoked.
    #[tracing::instrument(name = "connect.client.delete_connection", skip_all, fields(app_id = %app_id, outcome), err)]
    pub async fn delete_connection(
        &self,
        external_user_id: &str,
        app_id: &str,
    ) -> Result<DeleteResponse, Error> {
        self.request(
            Method::DELETE,
            &["v1", "users", external_user_id, "connections", app_id],
            None,
        )
        .await
    }

    /// Export a user's current vendor access token.
    #[tracing::instrument(name = "connect.client.access_token", skip_all, fields(app_id = %app_id, outcome), err)]
    pub async fn access_token(
        &self,
        external_user_id: &str,
        app_id: &str,
    ) -> Result<TokenResponse, Error> {
        self.request(
            Method::GET,
            &[
                "v1",
                "users",
                external_user_id,
                "connections",
                app_id,
                "token",
            ],
            None,
        )
        .await
    }

    /// Return the gateway address and credential without making a network call.
    #[tracing::instrument(name = "connect.client.mcp_upstream", skip_all, fields(app_id = %app_id, outcome = "ready"))]
    pub fn mcp_upstream(&self, external_user_id: &str, app_id: &str) -> McpUpstream {
        McpUpstream {
            url: self.route(&["v1", "users", external_user_id, "mcp", app_id]),
            bearer_token: self.customer_key.to_string(),
        }
    }

    fn route(&self, parts: &[&str]) -> Url {
        let mut url = self.base_url.clone();
        // `new` accepts only hierarchical HTTP URLs, so path segments are available.
        let mut segments = url.path_segments_mut().expect("validated HTTP base URL");
        segments.pop_if_empty();
        segments.extend(parts.iter().copied());
        drop(segments);
        url
    }

    async fn request<T: serde::de::DeserializeOwned>(
        &self,
        method: Method,
        parts: &[&str],
        body: Option<&ConnectSessionRequest>,
    ) -> Result<T, Error> {
        self.request_at(method, self.route(parts), body).await
    }

    async fn request_at<T: serde::de::DeserializeOwned>(
        &self,
        method: Method,
        url: Url,
        body: Option<&ConnectSessionRequest>,
    ) -> Result<T, Error> {
        let mut headers = HeaderMap::new();
        inject_trace_headers(&mut headers);
        let mut request = self
            .http
            .request(method, url)
            .headers(headers)
            .bearer_auth(self.customer_key.as_str());
        if let Some(body) = body {
            request = request.json(body);
        }
        let response = request.send().await.map_err(|error| {
            if error.is_connect() || error.is_timeout() {
                Span::current().record("outcome", "unavailable");
                Error::Unavailable
            } else {
                Span::current().record("outcome", "internal");
                Error::Internal(rootcause::Report::new(error).into_dynamic())
            }
        })?;
        let status = response.status();
        let bytes = response.bytes().await.map_err(|error| {
            Span::current().record("outcome", "internal");
            Error::Internal(rootcause::Report::new(error).into_dynamic())
        })?;
        if !status.is_success() {
            let message = serde_json::from_slice::<ErrorResponse>(&bytes)
                .map(|response| response.error)
                .unwrap_or_else(|_| status.canonical_reason().unwrap_or("API error").to_owned());
            let error = match (status, message.as_str()) {
                (StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN, _) => Error::Unauthorized,
                (status, _) if status.is_server_error() => Error::Unavailable,
                (StatusCode::NOT_FOUND, _) => Error::NotConnected,
                (StatusCode::CONFLICT, "needs_reauth") => Error::NeedsReauth,
                _ => Error::Api { status, message },
            };
            Span::current().record(
                "outcome",
                match error {
                    Error::NotConnected => "not_connected",
                    Error::NeedsReauth => "needs_reauth",
                    Error::Unauthorized => "unauthorized",
                    Error::Unavailable => "unavailable",
                    _ => "api_error",
                },
            );
            return Err(error);
        }
        let value = serde_json::from_slice(&bytes).map_err(|error| {
            Span::current().record("outcome", "decode_error");
            Error::Internal(rootcause::Report::new(error).into_dynamic())
        })?;
        Span::current().record("outcome", "ok");
        Ok(value)
    }
}

#[cfg(test)]
mod test;
