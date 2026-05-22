use reqwest::header::{CONTENT_LENGTH, CONTENT_TYPE};
use serde::Deserialize;
use std::path::{Path, PathBuf};
use tauri::AppHandle;
use tauri::Manager;
use url::Url;
#[cfg(target_os = "ios")]
use uuid::Uuid;

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum StagedUploadSource {
    Share,
    Pasteboard,
}

impl StagedUploadSource {
    fn directory_name(self) -> &'static str {
        match self {
            Self::Share => "ios-share-staging",
            Self::Pasteboard => "ios-pasteboard-staging",
        }
    }

    fn token_prefix(self) -> &'static str {
        match self {
            Self::Share => "share-stage-",
            Self::Pasteboard => "paste-stage-",
        }
    }

    fn description(self) -> &'static str {
        match self {
            Self::Share => "staged shared file",
            Self::Pasteboard => "staged pasteboard image",
        }
    }

    fn not_found_error(self) -> &'static str {
        match self {
            Self::Share => "staged shared file not found",
            Self::Pasteboard => "staged pasteboard image not found",
        }
    }
}

#[cfg(target_os = "ios")]
pub(crate) fn next_stage_token(source: StagedUploadSource) -> String {
    format!("{}{}", source.token_prefix(), Uuid::new_v4().simple())
}

fn is_valid_stage_token(source: StagedUploadSource, token: &str) -> bool {
    token.starts_with(source.token_prefix())
        && token.len() <= 128
        && token.bytes().all(|byte| {
            matches!(
                byte,
                b'0'..=b'9' | b'a'..=b'z' | b'A'..=b'Z' | b'-' | b'_'
            )
        })
}

pub(crate) fn staging_dir_path(
    app: &AppHandle,
    source: StagedUploadSource,
) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_cache_dir()
        .map_err(|error| format!("failed to resolve app cache directory: {error}"))?
        .join(source.directory_name()))
}

fn ensure_staging_dir(app: &AppHandle, source: StagedUploadSource) -> Result<PathBuf, String> {
    let dir = staging_dir_path(app, source)?;
    std::fs::create_dir_all(&dir).map_err(|error| {
        format!(
            "failed to create {} directory: {error}",
            source.description()
        )
    })?;
    Ok(dir)
}

#[cfg(target_os = "ios")]
pub(crate) fn staged_file_path_for_name(
    app: &AppHandle,
    source: StagedUploadSource,
    token: &str,
    source_name: &str,
) -> Result<PathBuf, String> {
    if !is_valid_stage_token(source, token) {
        return Err(format!("invalid {} token", source.description()));
    }

    let file_name = std::path::Path::new(source_name)
        .file_name()
        .and_then(|file_name| file_name.to_str())
        .filter(|file_name| *file_name == source_name)
        .ok_or_else(|| format!("invalid {} source name", source.description()))?;

    Ok(ensure_staging_dir(app, source)?.join(format!("{token}-{file_name}")))
}

pub(crate) fn staged_file_path(
    app: &AppHandle,
    source: StagedUploadSource,
    token: &str,
) -> Result<PathBuf, String> {
    if !is_valid_stage_token(source, token) {
        return Err(format!("invalid {} token", source.description()));
    }

    let staging_dir = ensure_staging_dir(app, source)?;
    let legacy_path = staging_dir.join(token);
    if legacy_path.is_file() {
        return Ok(legacy_path);
    }

    let prefix = format!("{token}-");
    let entries = std::fs::read_dir(&staging_dir)
        .map_err(|error| format!("failed to read {} directory: {error}", source.description()))?;

    for entry in entries {
        let entry = entry
            .map_err(|error| format!("failed to inspect {}: {error}", source.description()))?;
        let file_name = entry.file_name();
        if file_name.to_string_lossy().starts_with(&prefix) {
            let path = entry.path();
            if path.is_file() {
                return Ok(path);
            }
        }
    }

    Err(source.not_found_error().to_string())
}

#[tauri::command]
pub(crate) async fn upload_staged_file_to_presigned_url(
    app: AppHandle,
    source: StagedUploadSource,
    token: String,
    upload_url: String,
    mime_type: String,
) -> Result<(), String> {
    let path = staged_file_path(&app, source, &token)?;
    let description = source.description();
    upload_file_to_presigned_url(&path, &upload_url, &mime_type, description).await?;

    if let Err(error) = tokio::fs::remove_file(&path).await
        && error.kind() != std::io::ErrorKind::NotFound
    {
        tracing::warn!(
            "failed to delete {} after upload {}: {}",
            description,
            path.display(),
            error
        );
    }

    Ok(())
}

pub(crate) async fn upload_file_to_presigned_url(
    path: &Path,
    upload_url: &str,
    mime_type: &str,
    description: &str,
) -> Result<(), String> {
    let upload_url = Url::parse(upload_url)
        .map_err(|error| format!("invalid {description} upload URL: {error}"))?;
    if !matches!(upload_url.scheme(), "http" | "https") {
        return Err(format!("invalid {description} upload URL scheme"));
    }

    let file = tokio::fs::File::open(path)
        .await
        .map_err(|error| format!("failed to open {description}: {error}"))?;
    let size = file
        .metadata()
        .await
        .map_err(|error| format!("failed to read {description} metadata: {error}"))?
        .len();

    let body = reqwest::Body::wrap_stream(tokio_util::io::ReaderStream::new(file));
    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(30))
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .map_err(|error| format!("failed to build HTTP client: {error}"))?;

    let mut request = client.put(upload_url).body(body);
    if !mime_type.is_empty() {
        request = request.header(CONTENT_TYPE, mime_type);
    }

    let response = request
        .header(CONTENT_LENGTH, size.to_string())
        .send()
        .await
        .map_err(|error| format!("failed to upload {description}: {error}"))?;

    let status = response.status();
    if status.is_success() {
        return Ok(());
    }

    let detail = response.text().await.unwrap_or_default();
    if detail.trim().is_empty() {
        return Err(format!("failed to upload {description}: HTTP {status}"));
    }
    Err(format!(
        "failed to upload {description}: HTTP {status}: {}",
        detail.trim()
    ))
}
