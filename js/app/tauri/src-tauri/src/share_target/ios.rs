use super::shared::{
    STAGED_SHARED_FILE_NOT_FOUND_ERROR, is_staged_shared_file_not_found_error,
    sanitize_shared_filename, share_filenames_from_url,
};
use super::{PendingShareFilesState, ShareTargetPlatform, StagedSharedFile};
use crate::APP_SCHEME;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_deep_link::DeepLinkExt;
use url::Url;
use uuid::Uuid;

pub(super) struct ShareTargetPlatformImpl;

#[derive(Clone, Serialize)]
struct ShareFilesReadyPayload {
    filenames: Vec<String>,
}

const SHARED_FILE_STAGING_DIR_NAME: &str = "ios-share-staging";
const STALE_SHARED_FILE_TTL_SECS: u64 = 60 * 60 * 24;
/// Returns the filesystem path of the shared App Group container used to
/// exchange files between the Share Extension and the main app.
/// Calls NSFileManager directly via the objc2 runtime — no FFI to main.mm needed.
fn ios_app_group_container_path() -> Option<String> {
    use objc2::rc::autoreleasepool;
    use objc2::runtime::AnyObject;
    use objc2::{class, msg_send};
    use std::ffi::{CStr, CString};
    use std::os::raw::c_char;

    autoreleasepool(|_| unsafe {
        let manager: *mut AnyObject = msg_send![class!(NSFileManager), defaultManager];

        let c_group = CString::new("group.com.macro.app.prod").ok()?;
        let group_ns: *mut AnyObject = msg_send![
            class!(NSString),
            stringWithUTF8String: c_group.as_ptr() as *const c_char
        ];

        let url: *mut AnyObject = msg_send![
            manager,
            containerURLForSecurityApplicationGroupIdentifier: group_ns
        ];
        if url.is_null() {
            return None;
        }

        let path_obj: *mut AnyObject = msg_send![url, path];
        if path_obj.is_null() {
            return None;
        }

        let c_path: *const c_char = msg_send![path_obj, UTF8String];
        if c_path.is_null() {
            return None;
        }

        CStr::from_ptr(c_path).to_str().ok().map(|s| s.to_string())
    })
}

fn shared_file_staging_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|error| format!("failed to resolve app cache directory: {error}"))?
        .join(SHARED_FILE_STAGING_DIR_NAME);
    std::fs::create_dir_all(&dir)
        .map_err(|error| format!("failed to create shared file staging directory: {error}"))?;
    Ok(dir)
}

fn next_shared_file_stage_token() -> String {
    format!("share-stage-{}", Uuid::new_v4().simple())
}

fn sanitize_shared_file_stage_token(token: &str) -> Option<&str> {
    let valid = !token.is_empty()
        && token.len() <= 128
        && token.bytes().all(|byte| {
            matches!(
                byte,
                b'0'..=b'9' | b'a'..=b'z' | b'A'..=b'Z' | b'-' | b'_'
            )
        });
    valid.then_some(token)
}

fn staged_shared_file_path_for_name(
    app: &AppHandle,
    token: &str,
    source_name: &str,
) -> Result<std::path::PathBuf, String> {
    let token = sanitize_shared_file_stage_token(token)
        .ok_or_else(|| "invalid shared file staging token".to_string())?;
    let source_name = sanitize_shared_filename(source_name)
        .ok_or_else(|| "invalid shared file staging source name".to_string())?;
    Ok(shared_file_staging_dir(app)?.join(format!("{token}-{source_name}")))
}

fn staged_shared_file_path(app: &AppHandle, token: &str) -> Result<std::path::PathBuf, String> {
    let token = sanitize_shared_file_stage_token(token)
        .ok_or_else(|| "invalid shared file staging token".to_string())?;
    let staging_dir = shared_file_staging_dir(app)?;
    let legacy_path = staging_dir.join(token);
    if legacy_path.is_file() {
        return Ok(legacy_path);
    }

    let prefix = format!("{token}-");
    let entries = std::fs::read_dir(&staging_dir)
        .map_err(|error| format!("failed to read shared file staging directory: {error}"))?;

    for entry in entries {
        let entry =
            entry.map_err(|error| format!("failed to inspect staged shared file: {error}"))?;
        let file_name = entry.file_name();
        if file_name.to_string_lossy().starts_with(&prefix) {
            return Ok(entry.path());
        }
    }

    Err(STAGED_SHARED_FILE_NOT_FOUND_ERROR.to_string())
}

fn move_file_to_path(source: &std::path::Path, target: &std::path::Path) -> std::io::Result<()> {
    match std::fs::rename(source, target) {
        Ok(()) => Ok(()),
        Err(_) => {
            std::fs::copy(source, target)?;
            std::fs::remove_file(source)
        }
    }
}

fn stage_shared_file(
    app: &AppHandle,
    source_path: &std::path::Path,
    source_name: &str,
) -> Result<StagedSharedFile, String> {
    let token = next_shared_file_stage_token();
    let staged_path = staged_shared_file_path_for_name(app, &token, source_name)?;
    let mime_type = mime_type_from_path(source_path).to_string();
    let size = std::fs::metadata(source_path)
        .map_err(|error| format!("failed to read shared file metadata: {error}"))?
        .len();
    let preview_path = mime_type
        .starts_with("image/")
        .then(|| staged_path.to_string_lossy().into_owned());
    move_file_to_path(source_path, &staged_path)
        .map_err(|error| format!("failed to stage shared file: {error}"))?;

    Ok(StagedSharedFile {
        token,
        name: source_name.to_string(),
        mime_type,
        size,
        preview_path,
    })
}

fn cleanup_stale_staged_shared_files(app: &AppHandle) {
    let Ok(staging_dir) = app
        .path()
        .app_cache_dir()
        .map(|dir| dir.join(SHARED_FILE_STAGING_DIR_NAME))
    else {
        return;
    };

    let Ok(entries) = std::fs::read_dir(&staging_dir) else {
        return;
    };

    let cutoff = std::time::SystemTime::now()
        .checked_sub(std::time::Duration::from_secs(STALE_SHARED_FILE_TTL_SECS))
        .unwrap_or(std::time::UNIX_EPOCH);

    for entry in entries.flatten() {
        let Ok(metadata) = entry.metadata() else {
            continue;
        };

        if !metadata.is_file() {
            continue;
        }

        let modified = metadata.modified().or_else(|_| metadata.created());
        let should_remove = modified.map(|time| time < cutoff).unwrap_or(false);

        if should_remove {
            let _ = std::fs::remove_file(entry.path());
        }
    }

    let _ = std::fs::remove_dir(staging_dir);
}

fn consume_pending_share_filenames(
    container_path: &std::path::Path,
    state: &PendingShareFilesState,
    filenames: &[String],
) {
    let filenames: Vec<String> = filenames
        .iter()
        .filter_map(|name| sanitize_shared_filename(name).map(str::to_owned))
        .collect();

    state.with_data(|files| files.retain(|name| !filenames.contains(name)));

    for name in filenames {
        let path = container_path.join(name);
        if let Err(error) = std::fs::remove_file(&path)
            && error.kind() != std::io::ErrorKind::NotFound
        {
            tracing::warn!(
                "failed to delete consumed shared file {}: {}",
                path.display(),
                error
            );
        }
    }
}

fn mime_type_from_path(path: &std::path::Path) -> &'static str {
    let ext = path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("")
        .to_lowercase();

    match ext.as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "heic" | "heif" => "image/heic",
        "mov" => "video/quicktime",
        "mp4" => "video/mp4",
        "url" => "text/uri-list",
        "txt" => "text/plain",
        _ => "application/octet-stream",
    }
}

impl ShareTargetPlatform for ShareTargetPlatformImpl {
    fn cleanup_stale_staged_shared_files(app: &AppHandle) {
        cleanup_stale_staged_shared_files(app);
    }

    fn get_pending_share_filenames(app: AppHandle, state: &PendingShareFilesState) -> Vec<String> {
        let pending = state.with_data(|f| f.clone());

        if !pending.is_empty() {
            if let Some(container_path) = ios_app_group_container_path() {
                let container_path = std::path::Path::new(&container_path);
                let existing_pending: Vec<String> = pending
                    .into_iter()
                    .filter(|name| container_path.join(name).is_file())
                    .collect();

                let existing_pending_clone = existing_pending.clone();
                state.with_data(|files| {
                    *files = existing_pending_clone;
                });

                if !existing_pending.is_empty() {
                    return existing_pending;
                }
            } else {
                state.with_data(|files| *files = Vec::new());
                return vec![];
            }
        }

        match app.deep_link().get_current() {
            Ok(Some(urls)) => {
                if let Some(url) = urls.first()
                    && url.scheme() == APP_SCHEME
                    && url.host_str() == Some("share")
                {
                    let filenames = share_filenames_from_url(url);
                    let filenames_clone = filenames.clone();
                    state.with_data(|files| {
                        *files = filenames_clone;
                    });
                    return filenames;
                }
            }
            Ok(None) | Err(_) => {}
        }

        Vec::new()
    }

    fn pop_shared_files(
        app: AppHandle,
        filenames: Vec<String>,
        state: &PendingShareFilesState,
    ) -> Vec<StagedSharedFile> {
        let container_path = match ios_app_group_container_path() {
            Some(p) => p,
            None => return vec![],
        };

        let container_path = std::path::PathBuf::from(container_path);
        let mut files = Vec::with_capacity(filenames.len());
        let mut consumed_filenames = Vec::new();
        for name in filenames {
            let Some(name) = sanitize_shared_filename(&name).map(str::to_owned) else {
                continue;
            };

            let path = container_path.join(&name);
            if !path.exists() {
                consumed_filenames.push(name);
                continue;
            }

            match stage_shared_file(&app, &path, &name) {
                Ok(staged_file) => {
                    files.push(staged_file);
                    consumed_filenames.push(name);
                }
                Err(error) => {
                    tracing::warn!("failed to stage shared file {}: {}", path.display(), error);
                }
            }
        }

        if !consumed_filenames.is_empty() {
            consume_pending_share_filenames(&container_path, state, &consumed_filenames);
        }

        files
    }

    fn clear_shared_files(app: AppHandle, tokens: Vec<String>) -> Result<(), String> {
        for token in tokens {
            let path = match staged_shared_file_path(&app, &token) {
                Ok(path) => path,
                Err(error) if is_staged_shared_file_not_found_error(&error) => continue,
                Err(error) => return Err(error),
            };
            if let Err(error) = std::fs::remove_file(path)
                && error.kind() != std::io::ErrorKind::NotFound
            {
                return Err(format!("failed to delete staged shared file: {error}"));
            }
        }
        Ok(())
    }

    async fn upload_shared_file_to_presigned_url(
        app: AppHandle,
        token: String,
        upload_url: String,
        mime_type: String,
    ) -> Result<(), String> {
        use reqwest::header::{CONTENT_LENGTH, CONTENT_TYPE};

        let upload_url = Url::parse(&upload_url)
            .map_err(|error| format!("invalid shared file upload URL: {error}"))?;
        if !matches!(upload_url.scheme(), "http" | "https") {
            return Err("invalid shared file upload URL scheme".to_string());
        }

        let path = staged_shared_file_path(&app, &token)?;
        let file = tokio::fs::File::open(&path)
            .await
            .map_err(|error| format!("failed to open staged shared file: {error}"))?;
        let size = file
            .metadata()
            .await
            .map_err(|error| format!("failed to read staged shared file metadata: {error}"))?
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
            .map_err(|error| format!("failed to upload staged shared file: {error}"))?;

        let status = response.status();
        if !status.is_success() {
            let detail = response.text().await.unwrap_or_default();
            if detail.trim().is_empty() {
                return Err(format!(
                    "failed to upload staged shared file: HTTP {status}"
                ));
            }
            return Err(format!(
                "failed to upload staged shared file: HTTP {status}: {}",
                detail.trim()
            ));
        }

        if let Err(error) = tokio::fs::remove_file(&path).await
            && error.kind() != std::io::ErrorKind::NotFound
        {
            tracing::warn!(
                "failed to delete staged shared file after upload {}: {}",
                path.display(),
                error
            );
        }

        Ok(())
    }

    async fn read_shared_file_text(app: AppHandle, token: String) -> Result<String, String> {
        let path = staged_shared_file_path(&app, &token)?;
        tokio::task::spawn_blocking(move || {
            std::fs::read_to_string(&path)
                .map_err(|error| format!("failed to read staged shared text file: {error}"))
        })
        .await
        .map_err(|error| format!("failed to join staged shared text file read task: {error}"))?
    }

    fn maybe_handle_share_deep_link(handle: &AppHandle, url: &Url) -> bool {
        if url.scheme() == APP_SCHEME && url.host_str() == Some("share") {
            let filenames = share_filenames_from_url(url);

            let state = handle.state::<PendingShareFilesState>();
            let filenames_clone = filenames.clone();
            state.with_data(|f| {
                *f = filenames_clone;
            });

            let _ = handle.emit("share-files-ready", ShareFilesReadyPayload { filenames });
            return true;
        }

        false
    }
}
