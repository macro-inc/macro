//! How a host assembles artifacts: the service over Postgres and the
//! document bucket, the content origin from `ArtifactContentUrl`, and the
//! frame ancestors from the web app origin.

#[cfg(test)]
mod test;

use anyhow::Context;
use macro_env::Environment;
use macro_service_urls::{AppServiceUrl, ArtifactContentUrl};
use sqlx::PgPool;

use crate::domain::models::ContentOrigin;
use crate::domain::ports::{ArtifactDocuments, ArtifactNotifier, ViewTokens};
use crate::domain::service::ArtifactServiceImpl;
use crate::outbound::pg_artifact_repository::PgArtifactRepository;
use crate::outbound::s3_object_store::S3ArtifactObjectStore;

/// The service as every host builds it.
pub type ArtifactServiceFor<Documents, Tokens, Notifier> =
    ArtifactServiceImpl<PgArtifactRepository, S3ArtifactObjectStore, Documents, Tokens, Notifier>;

/// Origins of the desktop and mobile shells, which embed artifacts like the
/// web app does.
const TAURI_ORIGINS: [&str; 3] = [
    "tauri://localhost",
    "http://tauri.localhost",
    "https://tauri.localhost",
];

/// Local frontends run on several ports and per-persona `*.localhost` hosts,
/// and outside production developers run them against hosted backends.
const LOCAL_FRONTEND_ORIGINS: [&str; 4] = [
    "http://localhost:*",
    "http://*.localhost:*",
    "https://localhost:*",
    "https://*.localhost:*",
];

/// The content origin `url` names.
pub fn content_origin(url: &ArtifactContentUrl) -> anyhow::Result<ContentOrigin> {
    let parsed = url.parse_url().context("ArtifactContentUrl is not a URL")?;
    let host = parsed
        .host_str()
        .context("ArtifactContentUrl has no host")?
        .to_ascii_lowercase();
    Ok(ContentOrigin {
        scheme: parsed.scheme().to_string(),
        host,
        port: parsed.port(),
    })
}

/// Every origin allowed to frame an artifact in `environment`.
pub fn frame_ancestors(
    app: &AppServiceUrl,
    environment: Environment,
) -> anyhow::Result<Vec<String>> {
    let app_origin = app
        .parse_url()
        .context("AppServiceUrl is not a URL")?
        .origin()
        .ascii_serialization();

    let mut origins = vec![app_origin];
    origins.extend(TAURI_ORIGINS.iter().map(|origin| origin.to_string()));
    if !matches!(environment, Environment::Production) {
        origins.extend(
            LOCAL_FRONTEND_ORIGINS
                .iter()
                .map(|origin| origin.to_string()),
        );
    }
    Ok(origins)
}

/// Build the artifact service.
#[expect(
    clippy::too_many_arguments,
    reason = "the service's adapters and its origin, assembled in one place"
)]
pub fn build_service<Documents, Tokens, Notifier>(
    pool: PgPool,
    s3_client: aws_sdk_s3::Client,
    document_storage_bucket: impl Into<String>,
    documents: Documents,
    tokens: Tokens,
    notifier: Notifier,
    origin: ContentOrigin,
) -> ArtifactServiceFor<Documents, Tokens, Notifier>
where
    Documents: ArtifactDocuments,
    Tokens: ViewTokens,
    Notifier: ArtifactNotifier,
{
    ArtifactServiceImpl::new(
        PgArtifactRepository::new(pool),
        S3ArtifactObjectStore::new(s3_client, document_storage_bucket),
        documents,
        tokens,
        notifier,
        origin,
    )
}
