//! Stages files pasted from the macOS pasteboard for a Rust-side upload, as
//! the iOS pasteboard plugin does.
//!
//! Chromium hands a pasted Finder file to JS as a `File`, and uploading it
//! through the Tauri HTTP plugin copies every byte into the renderer, which
//! crashes the app for large videos. Instead the file is copied (an APFS clone
//! on the same volume) into the pasteboard staging directory and hashed here;
//! JS then uploads it with `upload_staged_file_to_presigned_url`.

use serde::Serialize;
use staged_upload_constants::{PASTEBOARD_STAGING_DIRECTORY_NAME, PASTEBOARD_TOKEN_PREFIX};
use tauri::{AppHandle, Manager};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StagedPasteboardFile {
    token: String,
    name: String,
    mime_type: String,
    size: u64,
    sha256: String,
}

/// Stages every regular file on the general pasteboard. Returns an empty list
/// when it holds no file URLs, and on platforms other than macOS.
#[tauri::command]
#[tracing::instrument(name = "desktop.pasteboard.stage", skip_all, err)]
pub(crate) async fn stage_desktop_pasteboard_files(
    app: AppHandle,
) -> Result<Vec<StagedPasteboardFile>, String> {
    let paths = pasteboard_file_paths();
    if paths.is_empty() {
        return Ok(Vec::new());
    }

    let staging_dir = app
        .path()
        .app_cache_dir()
        .map_err(|error| format!("failed to resolve app cache directory: {error}"))?
        .join(PASTEBOARD_STAGING_DIRECTORY_NAME);

    tauri::async_runtime::spawn_blocking(move || {
        std::fs::create_dir_all(&staging_dir)
            .map_err(|error| format!("failed to create pasteboard staging directory: {error}"))?;
        let mut staged = Vec::with_capacity(paths.len());
        for path in paths {
            if path.is_file() {
                staged.push(stage_file(&path, &staging_dir)?);
            }
        }
        tracing::info!(count = staged.len(), "staged desktop pasteboard files");
        Ok(staged)
    })
    .await
    .map_err(|error| format!("pasteboard staging task failed: {error}"))?
}

fn stage_file(
    source: &std::path::Path,
    staging_dir: &std::path::Path,
) -> Result<StagedPasteboardFile, String> {
    use sha2::{Digest, Sha256};
    use std::io::Read;

    let name = source
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or("pasted file has no valid name")?
        .to_string();
    let token = format!("{PASTEBOARD_TOKEN_PREFIX}{}", uuid::Uuid::new_v4().simple());
    let target = staging_dir.join(format!("{token}-{name}"));

    // std::fs::copy clones on APFS, so a same-volume video stages instantly.
    let size = std::fs::copy(source, &target)
        .map_err(|error| format!("failed to stage pasted file: {error}"))?;

    let mut file = std::fs::File::open(&target)
        .map_err(|error| format!("failed to open staged file: {error}"))?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0; 1024 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|error| format!("failed to hash staged file: {error}"))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    let sha256 = hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();

    Ok(StagedPasteboardFile {
        mime_type: mime_guess::from_path(&name)
            .first_or_octet_stream()
            .essence_str()
            .to_string(),
        token,
        name,
        size,
        sha256,
    })
}

#[cfg(target_os = "macos")]
fn pasteboard_file_paths() -> Vec<std::path::PathBuf> {
    use objc2::msg_send;
    use objc2::rc::{Retained, autoreleasepool};
    use objc2::runtime::{AnyClass, AnyObject};
    use objc2_foundation::{NSString, ns_string};

    autoreleasepool(|_| {
        let (Some(pasteboard_class), Some(url_class)) =
            (AnyClass::get(c"NSPasteboard"), AnyClass::get(c"NSURL"))
        else {
            return Vec::new();
        };

        // SAFETY: standard AppKit/Foundation selectors with their documented
        // signatures; nullable returns are read as `Option`.
        unsafe {
            let pasteboard: Option<Retained<AnyObject>> =
                msg_send![pasteboard_class, generalPasteboard];
            let Some(pasteboard) = pasteboard else {
                return Vec::new();
            };
            let items: Option<Retained<AnyObject>> = msg_send![&pasteboard, pasteboardItems];
            let Some(items) = items else {
                return Vec::new();
            };

            let count: usize = msg_send![&items, count];
            let mut paths = Vec::with_capacity(count);
            for index in 0..count {
                let item: Retained<AnyObject> = msg_send![&items, objectAtIndex: index];
                let url_string: Option<Retained<NSString>> =
                    msg_send![&item, stringForType: ns_string!("public.file-url")];
                let Some(url_string) = url_string else {
                    continue;
                };
                // Finder writes file reference URLs (file:///.file/id=...);
                // filePathURL resolves them to a path.
                let url: Option<Retained<AnyObject>> =
                    msg_send![url_class, URLWithString: &*url_string];
                let Some(url) = url else { continue };
                let path_url: Option<Retained<AnyObject>> = msg_send![&url, filePathURL];
                let Some(path_url) = path_url else { continue };
                let path: Option<Retained<NSString>> = msg_send![&path_url, path];
                if let Some(path) = path {
                    paths.push(std::path::PathBuf::from(path.to_string()));
                }
            }
            paths
        }
    })
}

#[cfg(not(target_os = "macos"))]
fn pasteboard_file_paths() -> Vec<std::path::PathBuf> {
    Vec::new()
}
