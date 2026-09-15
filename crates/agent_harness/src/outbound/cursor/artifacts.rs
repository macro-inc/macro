//! Cursor's artifact store as a source of session files.
//!
//! A cloud agent writes its walkthrough screenshots and screen recordings into
//! its `artifacts/` directory, and none of it appears in the run stream — the
//! only way to learn a file exists is to ask. The listing is agent-scoped and
//! cumulative, with no run filter, so "what is new" is a diff the caller keeps:
//! every turn sees everything every earlier turn wrote, and an agent that
//! reshoots a screenshot writes the same path twice. That is why identity here
//! is path *and* write time, not path alone.
//!
//! Cursor's download urls live fifteen minutes, so nothing collected can point
//! back at Cursor. Each file is fetched and pushed into an [`ArtifactStore`] on
//! the way out, and what the session log records is the store's permalink.

use std::collections::BTreeSet;

use bytes::Bytes;
use cursor_cloud_agents::api::wire::ArtifactListing;
use cursor_cloud_agents::api::{ApiKey, CursorClient, CursorConfig};
use cursor_cloud_agents::domain::model::CursorAgentId;
use macro_user_id::user_id::MacroUserIdStr;

use agent_runtime_protocol::domain::schema::v0::Artifact;
use agent_session::domain::model::ExternalSession;

use crate::domain::error::{HarnessError, Result};
use crate::domain::ports::{ArtifactSource, ArtifactStore, ArtifactUpload};
use crate::outbound::cursor::keys::CursorApiKeys;
use crate::outbound::cursor::manager::CURSOR_PROVIDER;

#[cfg(test)]
mod test;

/// The largest artifact this will pull into memory, 64 MiB.
///
/// The whole file is buffered on its way to the store, so the cap is what
/// keeps one long screen recording from being a memory incident. A file past
/// it is skipped and warned about rather than truncated: half a video is worse
/// than no video. Lifting this means streaming the body from Cursor straight
/// into the store's presigned upload instead of buffering, which neither
/// client can do yet.
const MAX_ARTIFACT_BYTES: u64 = 64 * 1024 * 1024;

/// The starting ref a [`CursorConfig`] must name. Nothing here creates an
/// agent, so it is never read; the config has no way to say so.
const UNUSED_STARTING_REF: &str = "main";

/// Content types S3 uses to mean "no idea", which the file's own extension can
/// usually improve on.
const UNINFORMATIVE_MIME_TYPES: [&str; 2] = ["application/octet-stream", "binary/octet-stream"];

/// The type an unrecognized extension falls back to: a download, not a render.
const FALLBACK_MIME_TYPE: &str = "application/octet-stream";

/// One artifact's bytes as they came off Cursor's presigned url.
pub(super) struct FetchedArtifact {
    /// The `Content-Type` the storage host declared, if it declared one.
    content_type: Option<String>,
    /// The body.
    bytes: Bytes,
}

/// The three Cursor calls collecting artifacts takes.
///
/// Named as a trait so the collection policy — filtering, ordering, the size
/// cap, what a single failure costs — is testable without an HTTP server
/// standing in for Cursor.
pub(super) trait CursorArtifactApi: Send + Sync {
    /// Every artifact the agent has written so far.
    fn list(
        &self,
        agent: &CursorAgentId,
    ) -> impl Future<Output = Result<Vec<ArtifactListing>>> + Send;

    /// A presigned url for one listed path, good for fifteen minutes.
    fn download_url(
        &self,
        agent: &CursorAgentId,
        path: &str,
    ) -> impl Future<Output = Result<String>> + Send;

    /// The bytes behind a presigned url.
    fn fetch(&self, url: &str) -> impl Future<Output = Result<FetchedArtifact>> + Send;
}

/// Where a per-owner [`CursorArtifactApi`] comes from.
///
/// A Cursor session runs on its owner's own account, so there is no one client
/// to hold: the key is resolved per call, as everywhere else in this module.
pub(super) trait CursorArtifactApis: Send + Sync + 'static {
    /// The API this resolves to.
    type Api: CursorArtifactApi;

    /// An API authenticated as `owner`.
    fn api_for(&self, owner: &MacroUserIdStr<'_>)
    -> impl Future<Output = Result<Self::Api>> + Send;
}

/// Clients built from the owners' own registered keys.
pub struct OwnerCursorClients<Keys> {
    keys: Keys,
    base_url: String,
}

impl<Keys> CursorArtifactApis for OwnerCursorClients<Keys>
where
    Keys: CursorApiKeys,
{
    type Api = CursorClient;

    async fn api_for(&self, owner: &MacroUserIdStr<'_>) -> Result<CursorClient> {
        let config = self.keys.resolve(owner).await?;
        CursorClient::new(CursorConfig {
            api_key: ApiKey::new(config.key.expose()),
            base_url: self.base_url.clone(),
            model: None,
            starting_ref: UNUSED_STARTING_REF.to_owned(),
            record_dir: None,
        })
        .map_err(|error| {
            HarnessError::Artifacts(rootcause::report!(
                "could not build a cursor client: {error}"
            ))
        })
    }
}

impl CursorArtifactApi for CursorClient {
    async fn list(&self, agent: &CursorAgentId) -> Result<Vec<ArtifactListing>> {
        let listing = self
            .list_artifacts(agent)
            .await
            .map_err(|error| HarnessError::Artifacts(rootcause::report!("{error}")))?;
        Ok(listing.items)
    }

    async fn download_url(&self, agent: &CursorAgentId, path: &str) -> Result<String> {
        let download = self
            .artifact_download_url(agent, path)
            .await
            .map_err(|error| HarnessError::Artifacts(rootcause::report!("{error}")))?;
        Ok(download.url)
    }

    async fn fetch(&self, url: &str) -> Result<FetchedArtifact> {
        let response = self
            .fetch_artifact(url)
            .await
            .map_err(|error| HarnessError::Artifacts(rootcause::report!("{error}")))?;
        let content_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .map(ToOwned::to_owned);
        let bytes = response.bytes().await.map_err(|error| {
            HarnessError::Artifacts(rootcause::report!(
                "could not read an artifact body: {error}"
            ))
        })?;
        Ok(FetchedArtifact {
            content_type,
            bytes,
        })
    }
}

/// Collects a Cursor agent's artifacts, re-hosted so they outlive Cursor's
/// urls.
pub struct CursorArtifacts<Apis, Store> {
    apis: Apis,
    store: Store,
}

impl<Keys, Store> CursorArtifacts<OwnerCursorClients<Keys>, Store> {
    /// Collect through clients built from `keys`, storing into `store`.
    #[must_use]
    pub fn new(keys: Keys, store: Store, base_url: String) -> Self {
        Self {
            apis: OwnerCursorClients { keys, base_url },
            store,
        }
    }
}

impl<Apis, Store> CursorArtifacts<Apis, Store> {
    /// Collect through an arbitrary API source. For tests, which stand in for
    /// Cursor rather than talking to it.
    #[cfg(test)]
    fn with_apis(apis: Apis, store: Store) -> Self {
        Self { apis, store }
    }
}

impl<Apis, Store> ArtifactSource for CursorArtifacts<Apis, Store>
where
    Apis: CursorArtifactApis,
    Store: ArtifactStore,
{
    #[tracing::instrument(
        name = "cursor.artifacts.collect",
        skip_all,
        err,
        fields(
            agent.external.provider = %external.provider,
            agent.external.id = %external.external_id,
            artifacts.known = known.len(),
        )
    )]
    async fn collect(
        &self,
        owner: &MacroUserIdStr<'_>,
        external: &ExternalSession,
        known: &BTreeSet<String>,
    ) -> Result<Vec<Artifact>> {
        if external.provider != CURSOR_PROVIDER {
            return Ok(Vec::new());
        }
        let api = self.apis.api_for(owner).await?;
        let agent = CursorAgentId::new(external.external_id.clone());

        let mut fresh: Vec<ArtifactListing> = api
            .list(&agent)
            .await?
            .into_iter()
            .filter(|listing| !known.contains(&artifact_key(listing)))
            .collect();
        // Oldest first, so the strip reads in the order the agent shot it.
        // Path breaks ties: two files written in the same second still have to
        // land in one stable order, or a re-collection reorders the log.
        fresh.sort_by(|left, right| {
            (&left.updated_at, &left.path).cmp(&(&right.updated_at, &right.path))
        });

        let mut collected = Vec::with_capacity(fresh.len());
        for listing in fresh {
            let key = artifact_key(&listing);
            if listing.size_bytes > MAX_ARTIFACT_BYTES {
                tracing::warn!(
                    artifact.key = %key,
                    artifact.size_bytes = listing.size_bytes,
                    "skipping an artifact larger than the buffering cap"
                );
                continue;
            }
            // One unreadable file must not cost the rest of the walkthrough:
            // the collection is best-effort past the listing, which is the
            // only call whose failure means the answer would be wrong rather
            // than short.
            match collect_one(&api, &self.store, &agent, &listing, key.clone()).await {
                Ok(artifact) => collected.push(artifact),
                Err(error) => tracing::warn!(
                    error = ?error,
                    artifact.key = %key,
                    "could not collect an artifact"
                ),
            }
        }
        Ok(collected)
    }
}

/// Fetch one artifact and re-host it.
///
/// A free function rather than a method so the collection type does not carry
/// this module's private traits in its public bounds.
async fn collect_one<Api, Store>(
    api: &Api,
    store: &Store,
    agent: &CursorAgentId,
    listing: &ArtifactListing,
    key: String,
) -> Result<Artifact>
where
    Api: CursorArtifactApi,
    Store: ArtifactStore,
{
    // The url is minted here rather than with the listing because it stops
    // working fifteen minutes later, and a batch of them would age while the
    // earlier files uploaded.
    let url = api.download_url(agent, &listing.path).await?;
    let fetched = api.fetch(&url).await?;
    let name = file_name(&listing.path);
    let mime_type = resolve_mime_type(fetched.content_type.as_deref(), &name);
    let size_bytes = fetched.bytes.len() as u64;
    let stored = store
        .store(ArtifactUpload {
            file_name: name.clone(),
            mime_type: mime_type.clone(),
            bytes: fetched.bytes,
        })
        .await?;
    Ok(Artifact {
        key,
        uri: stored.uri,
        name,
        mime_type,
        size_bytes,
    })
}

/// The identity two collections compare a file by.
///
/// Path alone is not it: an agent that reshoots `artifacts/screenshot.png`
/// writes the same path a second time, and that is a new file to show.
fn artifact_key(listing: &ArtifactListing) -> String {
    format!("{}@{}", listing.path, listing.updated_at)
}

/// The last segment of a workspace-relative artifact path.
fn file_name(path: &str) -> String {
    path.rsplit('/').next().unwrap_or(path).to_owned()
}

/// What to serve a file back as.
///
/// The storage host's own `Content-Type` wins when it says anything: it is the
/// type the file was uploaded with. The generic octet-stream answers are not
/// an opinion, so the extension gets to overrule them — a `.png` served as
/// octet-stream renders as a download rather than an image.
fn resolve_mime_type(content_type: Option<&str>, name: &str) -> String {
    let declared = content_type
        .map(|content_type| {
            content_type
                .split(';')
                .next()
                .unwrap_or(content_type)
                .trim()
                .to_owned()
        })
        .filter(|content_type| {
            !content_type.is_empty()
                && !UNINFORMATIVE_MIME_TYPES.contains(&content_type.to_ascii_lowercase().as_str())
        });
    declared.unwrap_or_else(|| mime_type_for_extension(name).to_owned())
}

/// A media type from a file's extension.
///
/// A hand-written table rather than a mime database crate: the set of things a
/// walkthrough produces is small and known, and the fallback is honest about
/// everything else.
fn mime_type_for_extension(name: &str) -> &'static str {
    let extension = name
        .rsplit_once('.')
        .map(|(_, extension)| extension.to_ascii_lowercase())
        .unwrap_or_default();
    match extension.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        "mov" => "video/quicktime",
        "txt" | "log" => "text/plain",
        "json" => "application/json",
        "md" => "text/markdown",
        "pdf" => "application/pdf",
        _ => FALLBACK_MIME_TYPE,
    }
}
