//! Reading a user's Autodesk data through APS's Data Management and OSS
//! APIs. Every call is a `GET`; the import never writes to Autodesk.
//!
//! Requests go through an [`ApsTransport`]. [`ConnectedAps`] sends them
//! through the user's `autodesk` connection, so the connectors services
//! decide which connection counts and put its credentials on each request.

use std::collections::BTreeMap;
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use chrono::{DateTime, Utc};
use connectors::{ApiConnectionsService, ApiHandle, ApiRequest, ConnectorId, ConnectorsError};
use http::{HeaderMap, Method, StatusCode};
use macro_user_id::user_id::MacroUserIdStr;
use nom::character::complete::{char, u64 as decimal};
use nom::combinator::all_consuming;
use nom::sequence::separated_pair;
use nom::{IResult, Parser};
use serde::Deserialize;
use serde::de::{DeserializeOwned, IgnoredAny};
use tracing::Instrument;
use tracing::field::Empty;
use upstream_error::{UpstreamError, UpstreamFailure};
use url::Url;

use crate::domain::models::{
    ApsFolderId, ApsProject, ApsProjectId, Folder, FolderEntry, FolderPage, FusionItem,
    FusionVersion, Hub, HubId, ItemId, SignedUrl, StorageObject, VersionId,
};
use crate::domain::ports::{ApsConnections, ApsError, ApsReader};

#[cfg(test)]
mod test;

/// Autodesk's catalog app.
pub const AUTODESK_APP: &str = "autodesk";

/// APS's API origin.
const APS_API_URL: &str = "https://developer.api.autodesk.com";

/// How users know the provider, in upstream errors.
const SERVICE: &str = "Autodesk";

/// How many pages one listing follows before giving up: 100 pages of 200 is
/// far past any real project or version history.
const MAX_PAGES: u32 = 100;

/// Entries per browsed folder page, so one page stays a readable tool result.
const FOLDER_PAGE_LIMIT: u32 = 50;

/// How long to wait before the one retry of a rate-limited call when APS
/// gives no `Retry-After`.
const DEFAULT_RETRY_WAIT: Duration = Duration::from_secs(1);

/// The longest `Retry-After` worth waiting out inside one tool call; past it
/// the call reports the rate limit instead.
const MAX_RETRY_WAIT: Duration = Duration::from_secs(30);

/// An APS answer, whatever its status.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TransportResponse {
    /// The HTTP status.
    pub status: StatusCode,
    /// How long APS asked callers to wait.
    pub retry_after: Option<Duration>,
    /// The body. Never logged.
    pub body: String,
}

/// Sends `GET` requests to APS with one user's credentials.
pub trait ApsTransport: Send + Sync {
    /// Send a `GET` of `url`. A non-2xx answer is a response, not an error.
    fn get(&self, url: &Url) -> impl Future<Output = Result<TransportResponse, ApsError>> + Send;
}

/// Opens users' Autodesk accounts through their `autodesk` connections.
pub struct ConnectedAps<S> {
    service: Arc<S>,
}

impl<S> ConnectedAps<S> {
    /// Connections answered by `service`.
    pub fn new(service: Arc<S>) -> Self {
        Self { service }
    }
}

impl<S: ApiConnectionsService> ApsConnections for ConnectedAps<S> {
    type Reader = ApsClient<ConnectedTransport<S>>;

    #[tracing::instrument(name = "fusion.aps.connection", skip_all, err)]
    async fn for_user(
        &self,
        user: &MacroUserIdStr<'static>,
    ) -> Result<Option<Self::Reader>, ApsError> {
        let app = ConnectorId::parse(AUTODESK_APP).map_err(internal)?;
        let Some(handle) = self
            .service
            .connection(user, &app)
            .await
            .map_err(connectors_error)?
        else {
            return Ok(None);
        };
        Ok(Some(ApsClient::new(ConnectedTransport {
            service: self.service.clone(),
            handle,
        })))
    }
}

fn internal(error: impl std::error::Error + Send + Sync + 'static) -> ApsError {
    ApsError::Internal(rootcause::Report::new(error).into_dynamic())
}

fn connectors_error(error: ConnectorsError) -> ApsError {
    match error {
        // The connection went away or its grant died while it was in use:
        // either way the user has to connect Autodesk again.
        ConnectorsError::NeedsReauth(_) | ConnectorsError::NotFound(_) => ApsError::NeedsReauth,
        other => internal(other),
    }
}

fn invalid_response() -> ApsError {
    ApsError::Upstream(UpstreamError {
        service: SERVICE,
        failure: UpstreamFailure::InvalidResponse,
    })
}

/// Sends APS requests through one user's `autodesk` connection.
pub struct ConnectedTransport<S> {
    service: Arc<S>,
    handle: ApiHandle,
}

impl<S: ApiConnectionsService> ApsTransport for ConnectedTransport<S> {
    async fn get(&self, url: &Url) -> Result<TransportResponse, ApsError> {
        let response = self
            .service
            .call(
                &self.handle,
                ApiRequest {
                    method: Method::GET,
                    url: url.to_string(),
                    headers: HeaderMap::new(),
                    body: None,
                },
            )
            .await
            .map_err(connectors_error)?;
        Ok(TransportResponse {
            status: response.status,
            retry_after: response.retry_after(),
            body: response.body,
        })
    }
}

/// The APS calls the import makes, named on their spans.
#[derive(Debug, Clone, Copy, strum::IntoStaticStr)]
#[strum(serialize_all = "snake_case")]
enum Endpoint {
    Hubs,
    Projects,
    TopFolders,
    FolderContents,
    Item,
    Versions,
    SignedDownload,
}

/// An APS URL: `segments` are encoded one by one, so ids holding `:`, `?`
/// or `/` stay one segment each.
fn aps_url(segments: &[&str], query: &[(&str, String)]) -> Result<Url, ApsError> {
    let mut url = Url::parse(APS_API_URL).map_err(internal)?;
    url.path_segments_mut()
        .map_err(|()| ApsError::Internal(rootcause::report!("the APS origin has no path")))?
        .extend(segments);
    if !query.is_empty() {
        url.query_pairs_mut().extend_pairs(query);
    }
    Ok(url)
}

/// Reads one user's Autodesk data over a transport.
pub struct ApsClient<T> {
    transport: T,
}

impl<T: ApsTransport> ApsClient<T> {
    /// A reader over `transport`.
    pub fn new(transport: T) -> Self {
        Self { transport }
    }

    /// `GET` `url` and decode a success. A rate limit is waited out once.
    async fn get<B: DeserializeOwned>(&self, endpoint: Endpoint, url: Url) -> Result<B, ApsError> {
        let span = tracing::info_span!(
            "fusion.aps.call",
            endpoint = <&'static str>::from(endpoint),
            status = Empty,
            retry_after = Empty,
        );
        async {
            let mut response = self.transport.get(&url).await?;
            if response.status == StatusCode::TOO_MANY_REQUESTS {
                let wait = response.retry_after.unwrap_or(DEFAULT_RETRY_WAIT);
                if wait <= MAX_RETRY_WAIT {
                    tracing::Span::current().record("retry_after", wait.as_secs());
                    tokio::time::sleep(wait).await;
                    response = self.transport.get(&url).await?;
                }
            }
            tracing::Span::current().record("status", response.status.as_u16());

            let status = response.status;
            if status.is_success() {
                return serde_json::from_str(&response.body).map_err(|error| {
                    // Only the error's position, never the body it quotes.
                    tracing::warn!(
                        line = error.line(),
                        column = error.column(),
                        "undecodable APS answer"
                    );
                    invalid_response()
                });
            }
            Err(match status {
                StatusCode::UNAUTHORIZED => ApsError::NeedsReauth,
                StatusCode::FORBIDDEN => ApsError::Forbidden,
                StatusCode::NOT_FOUND => ApsError::NotFound,
                StatusCode::TOO_MANY_REQUESTS => ApsError::RateLimited {
                    retry_after: response.retry_after,
                },
                status if status.is_server_error() => ApsError::Upstream(UpstreamError {
                    service: SERVICE,
                    failure: UpstreamFailure::Unavailable,
                }),
                status => ApsError::Internal(rootcause::report!("APS answered {status}")),
            })
        }
        .instrument(span)
        .await
    }

    /// Every resource of a paged listing, following `links.next`.
    async fn all_pages(
        &self,
        endpoint: Endpoint,
        segments: &[&str],
    ) -> Result<Vec<Resource>, ApsError> {
        let mut resources = Vec::new();
        for page in 0..MAX_PAGES {
            let url = aps_url(segments, &[("page[number]", page.to_string())])?;
            let collection: Collection = self.get(endpoint, url).await?;
            resources.extend(collection.data);
            if collection.links.next.is_none() {
                return Ok(resources);
            }
        }
        tracing::warn!(
            endpoint = <&'static str>::from(endpoint),
            "APS listing ran past its page limit"
        );
        Err(invalid_response())
    }
}

impl<T: ApsTransport> ApsReader for ApsClient<T> {
    async fn hubs(&self) -> Result<Vec<Hub>, ApsError> {
        let url = aps_url(&["project", "v1", "hubs"], &[])?;
        let collection: Collection = self.get(Endpoint::Hubs, url).await?;
        Ok(collection
            .data
            .into_iter()
            .filter_map(|hub| {
                Some(Hub {
                    id: HubId::parse(&hub.id).ok()?,
                    name: hub.attributes.title(),
                })
            })
            .collect())
    }

    async fn projects(&self, hub: &HubId) -> Result<Vec<ApsProject>, ApsError> {
        let segments = ["project", "v1", "hubs", hub.as_str(), "projects"];
        let projects = self.all_pages(Endpoint::Projects, &segments).await?;
        Ok(projects
            .into_iter()
            .filter_map(|project| {
                Some(ApsProject {
                    id: ApsProjectId::parse(&project.id).ok()?,
                    name: project.attributes.title(),
                })
            })
            .collect())
    }

    async fn top_folders(
        &self,
        hub: &HubId,
        project: &ApsProjectId,
    ) -> Result<Vec<Folder>, ApsError> {
        let segments = [
            "project",
            "v1",
            "hubs",
            hub.as_str(),
            "projects",
            project.as_str(),
            "topFolders",
        ];
        let url = aps_url(&segments, &[])?;
        let collection: Collection = self.get(Endpoint::TopFolders, url).await?;
        Ok(collection.data.into_iter().filter_map(folder).collect())
    }

    async fn folder_contents(
        &self,
        project: &ApsProjectId,
        folder_id: &ApsFolderId,
        page: u32,
    ) -> Result<FolderPage, ApsError> {
        let segments = [
            "data",
            "v1",
            "projects",
            project.as_str(),
            "folders",
            folder_id.as_str(),
            "contents",
        ];
        let query = [
            ("page[number]", page.to_string()),
            ("page[limit]", FOLDER_PAGE_LIMIT.to_string()),
        ];
        let url = aps_url(&segments, &query)?;
        let collection: Collection = self.get(Endpoint::FolderContents, url).await?;

        let next_page = collection
            .links
            .next
            .is_some()
            .then(|| page.saturating_add(1));
        let entries = collection
            .data
            .into_iter()
            .filter_map(|resource| match resource.kind.as_str() {
                "folders" => folder(resource).map(FolderEntry::Folder),
                "items" => item(resource, &collection.included).map(FolderEntry::Item),
                _ => None,
            })
            .collect();
        Ok(FolderPage { entries, next_page })
    }

    async fn item(&self, project: &ApsProjectId, item_id: &ItemId) -> Result<FusionItem, ApsError> {
        let segments = [
            "data",
            "v1",
            "projects",
            project.as_str(),
            "items",
            item_id.as_str(),
        ];
        let url = aps_url(&segments, &[])?;
        let single: Single = self.get(Endpoint::Item, url).await?;
        item(single.data, &single.included).ok_or_else(invalid_response)
    }

    async fn versions(
        &self,
        project: &ApsProjectId,
        item_id: &ItemId,
    ) -> Result<Vec<FusionVersion>, ApsError> {
        let segments = [
            "data",
            "v1",
            "projects",
            project.as_str(),
            "items",
            item_id.as_str(),
            "versions",
        ];
        let versions = self.all_pages(Endpoint::Versions, &segments).await?;
        Ok(versions.into_iter().filter_map(version).collect())
    }

    async fn signed_download(&self, storage: &StorageObject) -> Result<SignedUrl, ApsError> {
        let segments = [
            "oss",
            "v2",
            "buckets",
            storage.bucket_key.as_str(),
            "objects",
            storage.object_key.as_str(),
            "signeds3download",
        ];
        let url = aps_url(&segments, &[])?;
        let signed: SignedDownload = self.get(Endpoint::SignedDownload, url).await?;
        signed.into_signed_url().ok_or_else(invalid_response)
    }
}

fn folder(resource: Resource) -> Option<Folder> {
    Some(Folder {
        id: ApsFolderId::parse(&resource.id).ok()?,
        name: resource.attributes.label(),
    })
}

/// An item, with its latest version number from the tip version `included`
/// beside it.
fn item(resource: Resource, included: &[Resource]) -> Option<FusionItem> {
    let tip = resource
        .relationships
        .tip
        .as_ref()
        .and_then(|tip| tip.data.as_ref())
        .map(|tip| tip.id.as_str());
    let latest_version = included
        .iter()
        .filter(|version| version.kind == "versions")
        .find(|version| tip.is_none_or(|tip| tip == version.id))
        .and_then(|version| version.attributes.version_number);
    Some(FusionItem {
        id: ItemId::parse(&resource.id).ok()?,
        name: resource.attributes.label(),
        latest_version,
    })
}

/// A version. Its extension is APS's `fileType`, or the one its name ends
/// in; its storage is where `relationships.storage` points.
fn version(resource: Resource) -> Option<FusionVersion> {
    let Resource {
        id,
        attributes,
        relationships,
        ..
    } = resource;
    let extension = attributes
        .file_type
        .clone()
        .or_else(|| {
            let name = attributes.name.as_deref()?;
            Some(Path::new(name).extension()?.to_str()?.to_owned())
        })
        .map(|extension| extension.to_ascii_lowercase());
    let storage = relationships
        .storage
        .and_then(|storage| storage.data)
        .and_then(|data| StorageObject::parse(&data.id));
    let created_at = attributes
        .create_time
        .as_deref()
        .and_then(|time| DateTime::parse_from_rfc3339(time).ok())
        .map(|time| time.with_timezone(&Utc));

    Some(FusionVersion {
        id: VersionId::parse(&id).ok()?,
        number: attributes.version_number?,
        created_at,
        size: attributes.storage_size,
        extension,
        storage,
    })
}

// -- wire types: APS's JSON:API documents, only the fields the import reads --

#[derive(Deserialize)]
struct Collection {
    data: Vec<Resource>,
    #[serde(default)]
    included: Vec<Resource>,
    #[serde(default)]
    links: Links,
}

#[derive(Deserialize)]
struct Single {
    data: Resource,
    #[serde(default)]
    included: Vec<Resource>,
}

#[derive(Deserialize, Default)]
struct Links {
    next: Option<IgnoredAny>,
}

#[derive(Deserialize)]
struct Resource {
    #[serde(rename = "type")]
    kind: String,
    id: String,
    #[serde(default)]
    attributes: Attributes,
    #[serde(default)]
    relationships: Relationships,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct Attributes {
    name: Option<String>,
    display_name: Option<String>,
    version_number: Option<u32>,
    create_time: Option<String>,
    storage_size: Option<u64>,
    file_type: Option<String>,
}

impl Attributes {
    /// A hub's or project's name.
    fn title(self) -> String {
        self.name.or(self.display_name).unwrap_or_default()
    }

    /// A folder's or item's name, as Autodesk shows it.
    fn label(self) -> String {
        self.display_name.or(self.name).unwrap_or_default()
    }
}

#[derive(Deserialize, Default)]
struct Relationships {
    tip: Option<Relationship>,
    storage: Option<Relationship>,
}

#[derive(Deserialize)]
struct Relationship {
    data: Option<Linkage>,
}

#[derive(Deserialize)]
struct Linkage {
    id: String,
}

/// The answer of `signeds3download`.
#[derive(Deserialize)]
struct SignedDownload {
    status: SignedStatus,
    url: Option<String>,
    /// For a chunked object: each chunk's URL, keyed by `<start>-<end>`.
    urls: Option<BTreeMap<String, String>>,
    size: Option<u64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
enum SignedStatus {
    /// One URL to the whole object.
    Complete,
    /// One OSS URL, where S3 can't serve the object.
    Fallback,
    /// The object is still stored in chunks, one URL each.
    Chunked,
}

impl SignedDownload {
    fn into_signed_url(self) -> Option<SignedUrl> {
        let parts = match self.status {
            SignedStatus::Complete | SignedStatus::Fallback => vec![self.url?],
            SignedStatus::Chunked => {
                let mut chunks = self
                    .urls?
                    .into_iter()
                    .map(|(range, url)| Some((chunk_start(&range)?, url)))
                    .collect::<Option<Vec<_>>>()?;
                chunks.sort_by_key(|(start, _)| *start);
                chunks.into_iter().map(|(_, url)| url).collect()
            }
        };
        if parts.is_empty() {
            return None;
        }
        Some(SignedUrl {
            parts,
            size: self.size,
        })
    }
}

/// Where a chunk named `<start>-<end>` starts.
fn chunk_start(range: &str) -> Option<u64> {
    fn chunk(input: &str) -> IResult<&str, (u64, u64)> {
        all_consuming(separated_pair(decimal, char('-'), decimal)).parse(input)
    }

    let (_, (start, _end)) = chunk(range).ok()?;
    Some(start)
}
