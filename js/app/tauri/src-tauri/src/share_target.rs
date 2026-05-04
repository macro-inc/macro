#[cfg(target_os = "ios")]
use crate::APP_SCHEME;
use serde::Serialize;
use std::sync::Mutex;
use tauri::AppHandle;
#[cfg(target_os = "ios")]
use tauri::Emitter;
#[cfg(target_os = "ios")]
use tauri::Manager;
#[cfg(target_os = "ios")]
use tauri_plugin_deep_link::DeepLinkExt;
use url::Url;
#[cfg(target_os = "ios")]
use uuid::Uuid;

#[derive(Default)]
pub(crate) struct PendingShareFilesState {
    filenames: Mutex<Vec<String>>,
}

#[cfg(target_os = "ios")]
#[derive(Clone, Serialize)]
struct ShareFilesReadyPayload {
    filenames: Vec<String>,
}

#[cfg(target_os = "ios")]
const SHARED_FILE_STAGING_DIR_NAME: &str = "ios-share-staging";
#[cfg(target_os = "ios")]
const STALE_SHARED_FILE_TTL_SECS: u64 = 60 * 60 * 24;
#[cfg(any(target_os = "ios", test))]
const STAGED_SHARED_FILE_NOT_FOUND_ERROR: &str = "staged shared file not found";

#[derive(Serialize)]
pub(crate) struct StagedSharedFile {
    token: String,
    name: String,
    mime_type: String,
    size: u64,
    preview_path: Option<String>,
}

fn lock_pending_share_filenames(
    state: &PendingShareFilesState,
) -> std::sync::MutexGuard<'_, Vec<String>> {
    match state.filenames.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    }
}

#[cfg(target_os = "ios")]
fn replace_pending_share_filenames(state: &PendingShareFilesState, filenames: Vec<String>) {
    *lock_pending_share_filenames(state) = filenames;
}

#[cfg(test)]
fn remaining_pending_share_filenames(
    pending_filenames: &[String],
    consumed_filenames: &[String],
) -> Vec<String> {
    pending_filenames
        .iter()
        .filter(|name| !consumed_filenames.contains(name))
        .cloned()
        .collect()
}

#[cfg(target_os = "ios")]
fn consume_pending_share_filenames(
    container_path: &std::path::Path,
    state: &PendingShareFilesState,
    filenames: &[String],
) {
    let filenames: Vec<String> = filenames
        .iter()
        .filter_map(|name| sanitize_shared_filename(name).map(str::to_owned))
        .collect();

    {
        let mut pending_filenames = lock_pending_share_filenames(state);
        pending_filenames.retain(|name| !filenames.contains(name));
    }

    for name in filenames {
        let path = container_path.join(name);
        if let Err(error) = std::fs::remove_file(&path) {
            if error.kind() != std::io::ErrorKind::NotFound {
                tracing::warn!(
                    "failed to delete consumed shared file {}: {}",
                    path.display(),
                    error
                );
            }
        }
    }
}

/// Returns the filesystem path of the shared App Group container used to
/// exchange files between the Share Extension and the main app.
/// Calls NSFileManager directly via the objc2 runtime — no FFI to main.mm needed.
#[cfg(target_os = "ios")]
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

#[cfg(target_os = "ios")]
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

#[cfg(target_os = "ios")]
fn next_shared_file_stage_token() -> String {
    format!("share-stage-{}", Uuid::new_v4().simple())
}

#[cfg(target_os = "ios")]
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

#[cfg(target_os = "ios")]
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

#[cfg(target_os = "ios")]
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

#[cfg(any(target_os = "ios", test))]
fn is_staged_shared_file_not_found_error(error: &str) -> bool {
    error == STAGED_SHARED_FILE_NOT_FOUND_ERROR
}

#[cfg(target_os = "ios")]
fn move_file_to_path(source: &std::path::Path, target: &std::path::Path) -> std::io::Result<()> {
    match std::fs::rename(source, target) {
        Ok(()) => Ok(()),
        Err(_) => {
            std::fs::copy(source, target)?;
            std::fs::remove_file(source)
        }
    }
}

#[cfg(target_os = "ios")]
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

#[cfg(target_os = "ios")]
pub(crate) fn cleanup_stale_staged_shared_files(app: &AppHandle) {
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

#[cfg(any(target_os = "ios", test))]
fn sanitize_shared_filename(name: &str) -> Option<&str> {
    let path = std::path::Path::new(name);
    match path.file_name().and_then(|file_name| file_name.to_str()) {
        Some(file_name) if file_name == name && file_name.starts_with("share_") => Some(file_name),
        _ => None,
    }
}

#[cfg(any(target_os = "ios", test))]
fn share_filenames_from_url(url: &Url) -> Vec<String> {
    url.query_pairs()
        .filter(|(key, _)| key == "files")
        .flat_map(|(_, value)| {
            value
                .split(',')
                .filter_map(|name| sanitize_shared_filename(name).map(str::to_owned))
                .collect::<Vec<_>>()
        })
        .collect()
}

#[cfg(target_os = "ios")]
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
        _ => "application/octet-stream",
    }
}

#[tauri::command]
pub(crate) fn get_pending_share_filenames(
    app: tauri::AppHandle,
    state: tauri::State<'_, PendingShareFilesState>,
) -> Vec<String> {
    #[cfg(not(target_os = "ios"))]
    let _ = &app;

    let pending = lock_pending_share_filenames(&state).clone();

    #[cfg(not(target_os = "ios"))]
    if !pending.is_empty() {
        return pending;
    }

    #[cfg(target_os = "ios")]
    {
        if !pending.is_empty() {
            if let Some(container_path) = ios_app_group_container_path() {
                let container_path = std::path::Path::new(&container_path);
                let existing_pending: Vec<String> = pending
                    .into_iter()
                    .filter(|name| container_path.join(name).is_file())
                    .collect();

                replace_pending_share_filenames(&state, existing_pending.clone());

                if !existing_pending.is_empty() {
                    return existing_pending;
                }
            } else {
                return pending;
            }
        }

        match app.deep_link().get_current() {
            Ok(Some(urls)) => {
                if let Some(url) = urls.first() {
                    if url.scheme() == APP_SCHEME
                        && url.host_str() == Some("share")
                    {
                        let filenames = share_filenames_from_url(url);
                        replace_pending_share_filenames(&state, filenames.clone());
                        return filenames;
                    }
                }
            }
            Ok(None) | Err(_) => {}
        }
    }

    Vec::new()
}

/// Tauri command: move files saved by the Share Extension out of the shared
/// App Group container into the app's own staging directory and return their
/// metadata. Successfully staged files are consumed from the native
/// pending-share queue so they are not replayed on the next app launch.
#[tauri::command]
pub(crate) fn pop_shared_files(
    app: tauri::AppHandle,
    filenames: Vec<String>,
    state: tauri::State<'_, PendingShareFilesState>,
) -> Vec<StagedSharedFile> {
    #[cfg(not(target_os = "ios"))]
    {
        let _ = (app, filenames, state);
        return vec![];
    }

    #[cfg(target_os = "ios")]
    {
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
                    tracing::warn!(
                        "failed to stage shared file {}: {}",
                        path.display(),
                        error
                    );
                }
            }
        }

        if !consumed_filenames.is_empty() {
            consume_pending_share_filenames(&container_path, &state, &consumed_filenames);
        }

        files
    }
}

/// Tauri command: delete staged share files after the frontend is finished with
/// them (for example after cancel or successful send).
#[tauri::command]
pub(crate) fn clear_shared_files(app: tauri::AppHandle, tokens: Vec<String>) -> Result<(), String> {
    #[cfg(target_os = "ios")]
    {
        for token in tokens {
            let path = match staged_shared_file_path(&app, &token) {
                Ok(path) => path,
                Err(error) if is_staged_shared_file_not_found_error(&error) => continue,
                Err(error) => return Err(error),
            };
            if let Err(error) = std::fs::remove_file(path) {
                if error.kind() != std::io::ErrorKind::NotFound {
                    return Err(format!("failed to delete staged shared file: {error}"));
                }
            }
        }
        Ok(())
    }

    #[cfg(not(target_os = "ios"))]
    {
        let _ = (app, tokens);
        Ok(())
    }
}

/// Tauri command: upload a staged shared file directly to a presigned URL
/// without copying the file through JS memory.
#[tauri::command]
pub(crate) async fn upload_shared_file_to_presigned_url(
    app: tauri::AppHandle,
    token: String,
    upload_url: String,
    mime_type: String,
) -> Result<(), String> {
    #[cfg(not(target_os = "ios"))]
    {
        let _ = (app, token, upload_url, mime_type);
        return Ok(());
    }

    #[cfg(target_os = "ios")]
    {
        use reqwest::header::CONTENT_TYPE;

        let upload_url = Url::parse(&upload_url)
            .map_err(|error| format!("invalid shared file upload URL: {error}"))?;
        if !matches!(upload_url.scheme(), "http" | "https") {
            return Err("invalid shared file upload URL scheme".to_string());
        }

        let path = staged_shared_file_path(&app, &token)?;
        let upload_url = upload_url.to_string();

        tokio::task::spawn_blocking(move || -> Result<(), String> {
            let file = std::fs::File::open(&path)
                .map_err(|error| format!("failed to open staged shared file: {error}"))?;
            let size = file
                .metadata()
                .map_err(|error| format!("failed to read staged shared file metadata: {error}"))?
                .len();

            let body = reqwest::blocking::Body::sized(file, size);
            let client = reqwest::blocking::Client::builder()
                .connect_timeout(std::time::Duration::from_secs(30))
                .timeout(std::time::Duration::from_secs(300))
                .build()
                .map_err(|error| format!("failed to build HTTP client: {error}"))?;
            let mut request = client.put(upload_url).body(body);

            if !mime_type.is_empty() {
                request = request.header(CONTENT_TYPE, mime_type);
            }

            let response = request
                .send()
                .map_err(|error| format!("failed to upload staged shared file: {error}"))?;

            let status = response.status();
            if !status.is_success() {
                let detail = response.text().unwrap_or_default();
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

            if let Err(error) = std::fs::remove_file(&path) {
                if error.kind() != std::io::ErrorKind::NotFound {
                    tracing::warn!(
                        "failed to delete staged shared file after upload {}: {}",
                        path.display(),
                        error
                    );
                }
            }

            Ok(())
        })
        .await
        .map_err(|error| format!("failed to join staged shared file upload task: {error}"))?
    }
}

pub(crate) fn maybe_handle_share_deep_link(handle: &AppHandle, url: &Url) -> bool {
    #[cfg(target_os = "ios")]
    {
        if url.scheme() == APP_SCHEME && url.host_str() == Some("share") {
            let filenames = share_filenames_from_url(url);
            replace_pending_share_filenames(
                &handle.state::<PendingShareFilesState>(),
                filenames.clone(),
            );
            let _ = handle.emit("share-files-ready", ShareFilesReadyPayload { filenames });
            return true;
        }
    }

    #[cfg(not(target_os = "ios"))]
    let _ = (handle, url);

    false
}

#[cfg(test)]
mod tests;
