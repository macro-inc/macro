//! A [`NotionApi`] over Notion's REST API: request shapes, decoding,
//! pacing and retries, independent of how requests reach Notion.

use std::future::Future;
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use chrono::{DateTime, SecondsFormat, Utc};
use http::{Method, StatusCode};
use rand::Rng;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use tokio::time::Instant;

use crate::domain::model::{
    NotionDataSource, NotionId, NotionPage, NotionUser, PageMarkdown, Paged, SearchHit,
    SearchObject,
};
use crate::domain::ports::{NotionApi, NotionError};

mod wire;

use wire::{
    WireDataSource, WireDatabase, WireError, WireList, WireMarkdown, WireObject, WirePage,
    WirePropertyItem, WireUser, WireValue,
};

/// The Notion API version the wire shapes follow (the data sources API).
pub const NOTION_VERSION: &str = "2026-03-11";

/// The spacing between requests on one connection: Notion allows about
/// three requests a second per integration.
pub const NOTION_REQUEST_INTERVAL: Duration = Duration::from_millis(340);

/// Notion's largest page size.
const PAGE_SIZE: u8 = 100;

/// Attempts per request before a rate limit or transient failure is final.
const MAX_ATTEMPTS: u8 = 5;

/// The first retry's delay when Notion does not say how long to wait.
const BASE_BACKOFF: Duration = Duration::from_millis(500);

/// The longest backoff between attempts.
const MAX_BACKOFF: Duration = Duration::from_secs(30);

/// The most random delay added to a backoff, in milliseconds.
const MAX_JITTER_MILLIS: u64 = 250;

/// How much of an error body is kept.
const ERROR_BODY_CHARS: usize = 500;

/// A request the importer makes to Notion. The client can send nothing
/// else: every variant is a read (a `GET`, or one of the two `POST`s Notion
/// uses for reads, search and data source queries), so an import can never
/// modify or delete anything in the user's Notion.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum NotionRead {
    /// `POST /v1/search` with a search body.
    Search(serde_json::Value),
    /// `GET /v1/pages/{id}`.
    Page(NotionId),
    /// `GET /v1/pages/{id}/markdown`.
    PageMarkdown(NotionId),
    /// `GET /v1/pages/{page}/properties/{property}`, one page of references.
    PageProperty {
        /// The page.
        page: NotionId,
        /// The property's id, as Notion encodes it in paths.
        property: String,
        /// Where the previous page of references ended.
        cursor: Option<String>,
    },
    /// `GET /v1/data_sources/{id}`.
    DataSource(NotionId),
    /// `POST /v1/data_sources/{id}/query` with a query body.
    QueryDataSource {
        /// The data source.
        id: NotionId,
        /// The filter, sorts and cursor.
        body: serde_json::Value,
    },
    /// `GET /v1/databases/{id}`.
    Database(NotionId),
    /// `GET /v1/users`, one page of members.
    Users {
        /// Where the previous page of members ended.
        cursor: Option<String>,
    },
}

impl NotionRead {
    /// The HTTP method Notion's API takes this read with.
    pub fn method(&self) -> Method {
        match self {
            Self::Search(_) | Self::QueryDataSource { .. } => Method::POST,
            Self::Page(_)
            | Self::PageMarkdown(_)
            | Self::PageProperty { .. }
            | Self::DataSource(_)
            | Self::Database(_)
            | Self::Users { .. } => Method::GET,
        }
    }

    /// The path and query, such as `/v1/search`.
    pub fn path_and_query(&self) -> String {
        match self {
            Self::Search(_) => "/v1/search".to_owned(),
            Self::Page(id) => format!("/v1/pages/{id}"),
            Self::PageMarkdown(id) => format!("/v1/pages/{id}/markdown"),
            Self::PageProperty {
                page,
                property,
                cursor,
            } => with_cursor(
                format!("/v1/pages/{page}/properties/{property}?page_size={PAGE_SIZE}"),
                cursor,
            ),
            Self::DataSource(id) => format!("/v1/data_sources/{id}"),
            Self::QueryDataSource { id, .. } => format!("/v1/data_sources/{id}/query"),
            Self::Database(id) => format!("/v1/databases/{id}"),
            Self::Users { cursor } => {
                with_cursor(format!("/v1/users?page_size={PAGE_SIZE}"), cursor)
            }
        }
    }

    /// The JSON body, for the reads that take one.
    pub fn body(&self) -> Option<&serde_json::Value> {
        match self {
            Self::Search(body) | Self::QueryDataSource { body, .. } => Some(body),
            Self::Page(_)
            | Self::PageMarkdown(_)
            | Self::PageProperty { .. }
            | Self::DataSource(_)
            | Self::Database(_)
            | Self::Users { .. } => None,
        }
    }
}

fn with_cursor(mut path: String, cursor: &Option<String>) -> String {
    if let Some(cursor) = cursor {
        path.push_str(&format!("&start_cursor={cursor}"));
    }
    path
}

/// Notion's answer to one request, whatever its status.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TransportResponse {
    /// The HTTP status.
    pub status: StatusCode,
    /// How long Notion asked callers to wait, from `Retry-After`.
    pub retry_after: Option<Duration>,
    /// The response body.
    pub body: String,
}

/// Carries one request to Notion's REST API with the connection's
/// credentials.
pub trait NotionTransport: Send + Sync + 'static {
    /// Send `read`. A non-2xx answer is a response; only a request that did
    /// not complete is an error, and it should be [`NotionError::Transport`]
    /// to be retried.
    fn send(
        &self,
        read: &NotionRead,
    ) -> impl Future<Output = Result<TransportResponse, NotionError>> + Send;
}

/// Spaces requests on one Notion connection, shared by every client of that
/// connection so concurrent imports together stay under the rate limit.
#[derive(Debug)]
pub struct RequestPacer {
    interval: Duration,
    next: Mutex<Instant>,
}

impl RequestPacer {
    /// A pacer letting one request through every `interval`.
    pub fn new(interval: Duration) -> Self {
        Self {
            interval,
            next: Mutex::new(Instant::now()),
        }
    }

    /// Wait for this request's turn.
    async fn wait(&self) {
        let slot = {
            let mut next = self.next.lock().unwrap_or_else(PoisonError::into_inner);
            let slot = (*next).max(Instant::now());
            *next = slot + self.interval;
            slot
        };
        tokio::time::sleep_until(slot).await;
    }

    /// Hold every request for `delay`, as Notion asked.
    fn hold(&self, delay: Duration) {
        let mut next = self.next.lock().unwrap_or_else(PoisonError::into_inner);
        *next = (*next).max(Instant::now() + delay);
    }
}

/// A [`NotionApi`] speaking Notion's REST API through a [`NotionTransport`].
///
/// Requests wait their turn on the shared [`RequestPacer`]; rate limits
/// (429) and transient failures (5xx, 529, incomplete requests) are retried
/// with backoff and jitter, honouring `Retry-After` for every request on the
/// connection.
pub struct NotionRestClient<Transport> {
    transport: Transport,
    pacer: Arc<RequestPacer>,
}

impl<Transport: NotionTransport> NotionRestClient<Transport> {
    /// A client sending through `transport`, paced by `pacer`.
    pub fn new(transport: Transport, pacer: Arc<RequestPacer>) -> Self {
        Self { transport, pacer }
    }

    async fn request<Body: DeserializeOwned>(&self, read: NotionRead) -> Result<Body, NotionError> {
        let text = self.send(&read).await?;
        serde_json::from_str(&text)
            .map_err(|error| NotionError::Decode(format!("{}: {error}", read.path_and_query())))
    }

    #[tracing::instrument(
        name = "notion.request",
        skip_all,
        err,
        fields(method = %read.method(), path = %read.path_and_query(), attempts, status)
    )]
    async fn send(&self, read: &NotionRead) -> Result<String, NotionError> {
        let span = tracing::Span::current();
        let mut attempt: u8 = 0;
        loop {
            attempt += 1;
            span.record("attempts", attempt);
            self.pacer.wait().await;
            let (error, retry_after) = match self.transport.send(read).await {
                Ok(response) => {
                    span.record("status", response.status.as_u16());
                    if response.status.is_success() {
                        return Ok(response.body);
                    }
                    match failure(response) {
                        Failure::Final(error) => return Err(error),
                        Failure::Transient { error, retry_after } => (error, retry_after),
                    }
                }
                Err(NotionError::Transport(report)) => (NotionError::Transport(report), None),
                Err(error) => return Err(error),
            };
            if attempt >= MAX_ATTEMPTS {
                return Err(error);
            }
            tracing::warn!(attempt, error = %error, "retrying Notion request");
            match retry_after {
                Some(delay) => self.pacer.hold(delay),
                None => tokio::time::sleep(backoff(attempt)).await,
            }
        }
    }

    /// `page` with every truncated reference list fetched in full.
    async fn complete(&self, mut page: WirePage) -> Result<NotionPage, NotionError> {
        for property in page.properties.values_mut() {
            if !property.value.truncated() {
                continue;
            }
            let people = matches!(property.value, WireValue::People { .. });
            let references = self.all_references(&page.id, &property.id).await?;
            property.value = if people {
                WireValue::People {
                    people: references,
                    has_more: false,
                }
            } else {
                WireValue::Relation {
                    relation: references,
                    has_more: false,
                }
            };
        }
        Ok(page.into_page())
    }

    async fn all_references(
        &self,
        page: &NotionId,
        property: &str,
    ) -> Result<Vec<wire::WireReference>, NotionError> {
        let mut references = Vec::new();
        let mut cursor: Option<String> = None;
        loop {
            let read = NotionRead::PageProperty {
                page: page.clone(),
                property: property.to_owned(),
                cursor: cursor.take(),
            };
            let list: WireList = self.request(read.clone()).await?;
            for item in &list.results {
                let item = WirePropertyItem::deserialize(item).map_err(|error| {
                    NotionError::Decode(format!("{}: {error}", read.path_and_query()))
                })?;
                references.extend(item.reference().map(|id| wire::WireReference { id }));
            }
            match list.next() {
                Some(next) => cursor = Some(next),
                None => return Ok(references),
            }
        }
    }

    async fn pages(&self, list: &WireList) -> Result<Vec<NotionPage>, NotionError> {
        let mut pages = Vec::with_capacity(list.results.len());
        for item in &list.results {
            match WireObject::deserialize(item) {
                Ok(WireObject::Page(page)) => pages.push(self.complete(page).await?),
                Ok(WireObject::DataSource(_) | WireObject::Other) => {}
                Err(error) => skip(item, &error),
            }
        }
        Ok(pages)
    }
}

impl<Transport: NotionTransport> NotionApi for NotionRestClient<Transport> {
    async fn search(
        &self,
        object: SearchObject,
        cursor: Option<String>,
    ) -> Result<Paged<SearchHit>, NotionError> {
        let value = match object {
            SearchObject::Page => "page",
            SearchObject::DataSource => "data_source",
        };
        let mut body = serde_json::json!({
            "filter": {"property": "object", "value": value},
            "sort": {"timestamp": "last_edited_time", "direction": "descending"},
            "page_size": PAGE_SIZE,
        });
        if let Some(cursor) = cursor {
            body["start_cursor"] = serde_json::Value::String(cursor);
        }
        let list: WireList = self.request(NotionRead::Search(body)).await?;
        let mut results = Vec::with_capacity(list.results.len());
        for item in &list.results {
            match WireObject::deserialize(item) {
                Ok(WireObject::Page(page)) => results.push(SearchHit::Page(page.into_page())),
                Ok(WireObject::DataSource(source)) => match source.into_data_source() {
                    Ok(source) => results.push(SearchHit::DataSource(source)),
                    Err(error) => skip(item, &error),
                },
                Ok(WireObject::Other) => {}
                Err(error) => skip(item, &error),
            }
        }
        Ok(Paged {
            results,
            next_cursor: list.next(),
        })
    }

    async fn page(&self, id: &NotionId) -> Result<NotionPage, NotionError> {
        let page: WirePage = self.request(NotionRead::Page(id.clone())).await?;
        self.complete(page).await
    }

    async fn page_markdown(&self, id: &NotionId) -> Result<PageMarkdown, NotionError> {
        let markdown: WireMarkdown = self.request(NotionRead::PageMarkdown(id.clone())).await?;
        Ok(PageMarkdown {
            markdown: markdown.markdown,
            unknown_block_ids: markdown.unknown_block_ids,
        })
    }

    async fn data_source(&self, id: &NotionId) -> Result<NotionDataSource, NotionError> {
        let read = NotionRead::DataSource(id.clone());
        let source: WireDataSource = self.request(read.clone()).await?;
        source
            .into_data_source()
            .map_err(|error| NotionError::Decode(format!("{}: {error}", read.path_and_query())))
    }

    async fn database_sources(&self, database: &NotionId) -> Result<Vec<NotionId>, NotionError> {
        let database: WireDatabase = self.request(NotionRead::Database(database.clone())).await?;
        Ok(database
            .data_sources
            .into_iter()
            .map(|source| source.id)
            .collect())
    }

    /// Rows oldest first. Notion caps one query at 10,000 rows; past the cap
    /// the cursor restarts the query from the last row's creation time, so
    /// rows created in that same instant come again and callers draining the
    /// query de-duplicate by id.
    async fn query_data_source(
        &self,
        id: &NotionId,
        cursor: Option<String>,
    ) -> Result<Paged<NotionPage>, NotionError> {
        let cursor = match cursor {
            Some(cursor) => serde_json::from_str::<QueryCursor>(&cursor)
                .map_err(|error| NotionError::Decode(format!("query cursor: {error}")))?,
            None => QueryCursor::default(),
        };
        let mut body = serde_json::json!({
            "page_size": PAGE_SIZE,
            "sorts": [{"timestamp": "created_time", "direction": "ascending"}],
        });
        if let Some(after) = cursor.created_on_or_after {
            body["filter"] = serde_json::json!({
                "timestamp": "created_time",
                "created_time": {"on_or_after": after.to_rfc3339_opts(SecondsFormat::Millis, true)},
            });
        }
        if let Some(start) = &cursor.start_cursor {
            body["start_cursor"] = serde_json::Value::String(start.clone());
        }
        let list: WireList = self
            .request(NotionRead::QueryDataSource {
                id: id.clone(),
                body,
            })
            .await?;
        let rows = self.pages(&list).await?;

        let next = match list.next() {
            Some(start) => Some(QueryCursor {
                start_cursor: Some(start),
                created_on_or_after: cursor.created_on_or_after,
            }),
            None if list.incomplete() => match rows.last() {
                Some(last) if Some(last.created) != cursor.created_on_or_after => {
                    Some(QueryCursor {
                        start_cursor: None,
                        created_on_or_after: Some(last.created),
                    })
                }
                _ => {
                    tracing::warn!(data_source = %id, "query stopped at Notion's cap without progress; rows are missing");
                    None
                }
            },
            None => None,
        };
        let next_cursor = next
            .map(|next| serde_json::to_string(&next))
            .transpose()
            .map_err(|error| NotionError::Decode(format!("query cursor: {error}")))?;
        Ok(Paged {
            results: rows,
            next_cursor,
        })
    }

    async fn users(&self, cursor: Option<String>) -> Result<Paged<NotionUser>, NotionError> {
        let list: WireList = match self.request(NotionRead::Users { cursor }).await {
            Ok(list) => list,
            // Listing members needs a capability the connection may lack.
            Err(NotionError::Forbidden) => {
                return Ok(Paged {
                    results: Vec::new(),
                    next_cursor: None,
                });
            }
            Err(error) => return Err(error),
        };
        let mut results = Vec::with_capacity(list.results.len());
        for item in &list.results {
            match WireUser::deserialize(item) {
                Ok(user) => results.extend(user.into_user()),
                Err(error) => skip(item, &error),
            }
        }
        Ok(Paged {
            results,
            next_cursor: list.next(),
        })
    }
}

/// Where a data source query resumes: Notion's own cursor, within the
/// created-time window that restarts a query past Notion's result cap.
#[derive(Debug, Default, Serialize, Deserialize)]
struct QueryCursor {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    start_cursor: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    created_on_or_after: Option<DateTime<Utc>>,
}

enum Failure {
    Transient {
        error: NotionError,
        retry_after: Option<Duration>,
    },
    Final(NotionError),
}

fn failure(response: TransportResponse) -> Failure {
    let code = serde_json::from_str::<WireError>(&response.body)
        .ok()
        .and_then(|error| error.code);
    match (response.status, code.as_deref()) {
        (StatusCode::TOO_MANY_REQUESTS, _) | (_, Some("rate_limited")) => Failure::Transient {
            error: NotionError::RateLimited {
                retry_after: response.retry_after,
            },
            retry_after: response.retry_after,
        },
        (
            StatusCode::INTERNAL_SERVER_ERROR
            | StatusCode::BAD_GATEWAY
            | StatusCode::SERVICE_UNAVAILABLE
            | StatusCode::GATEWAY_TIMEOUT,
            _,
        ) => Failure::Transient {
            retry_after: response.retry_after,
            error: upstream(response),
        },
        // Notion's overloaded status, outside the standard set.
        (status, _) if status.as_u16() == 529 => Failure::Transient {
            retry_after: response.retry_after,
            error: upstream(response),
        },
        (StatusCode::NOT_FOUND, _) | (_, Some("object_not_found")) => {
            Failure::Final(NotionError::NotFound)
        }
        (StatusCode::FORBIDDEN, _) | (_, Some("restricted_resource")) => {
            Failure::Final(NotionError::Forbidden)
        }
        _ => Failure::Final(upstream(response)),
    }
}

fn upstream(response: TransportResponse) -> NotionError {
    // Notion explains itself in `message`; keep that rather than the JSON
    // around it, which is no use to a reader.
    let explained = serde_json::from_str::<WireError>(&response.body)
        .ok()
        .and_then(|error| error.message)
        .filter(|message| !message.trim().is_empty());
    let body = explained.unwrap_or(response.body);
    NotionError::Upstream {
        status: response.status.as_u16(),
        body: body.chars().take(ERROR_BODY_CHARS).collect(),
    }
}

/// The delay before attempt `attempt + 1`: exponential, capped, jittered.
fn backoff(attempt: u8) -> Duration {
    let exponential = BASE_BACKOFF.saturating_mul(1 << u32::from(attempt.saturating_sub(1)));
    let jitter = Duration::from_millis(rand::rng().random_range(0..=MAX_JITTER_MILLIS));
    exponential.min(MAX_BACKOFF) + jitter
}

fn skip(item: &serde_json::Value, error: &dyn std::fmt::Display) {
    let id = item.get("id").and_then(serde_json::Value::as_str);
    tracing::warn!(id, error = %error, "skipping a Notion object the importer cannot read");
}

#[cfg(test)]
mod test;
