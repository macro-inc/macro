use serde::Serialize;
use std::sync::Mutex;
use tauri::AppHandle;
use url::Url;

#[cfg(target_os = "ios")]
mod ios;
#[cfg(not(target_os = "ios"))]
mod noop;
#[cfg(any(target_os = "ios", test))]
mod shared;

#[cfg(target_os = "ios")]
use ios::ShareTargetPlatformImpl;
#[cfg(not(target_os = "ios"))]
use noop::ShareTargetPlatformImpl;

#[derive(Default)]
pub(crate) struct PendingShareFilesState {
    filenames: Mutex<Vec<String>>,
}

impl PendingShareFilesState {
    pub(crate) fn with_data<F, U>(&self, f: F) -> U
    where
        F: FnOnce(&mut Vec<String>) -> U,
    {
        let mut filenames = self
            .filenames
            .lock()
            .expect("pending share files mutex poisoned");
        f(&mut filenames)
    }
}

#[derive(Serialize)]
pub(crate) struct StagedSharedFile {
    token: String,
    name: String,
    mime_type: String,
    size: u64,
    preview_path: Option<String>,
}

pub(crate) trait ShareTargetPlatform {
    fn cleanup_stale_staged_shared_files(app: &AppHandle);

    fn get_pending_share_filenames(app: AppHandle, state: &PendingShareFilesState) -> Vec<String>;

    fn pop_shared_files(
        app: AppHandle,
        filenames: Vec<String>,
        state: &PendingShareFilesState,
    ) -> Vec<StagedSharedFile>;

    fn clear_shared_files(app: AppHandle, tokens: Vec<String>) -> Result<(), String>;

    async fn upload_shared_file_to_presigned_url(
        app: AppHandle,
        token: String,
        upload_url: String,
        mime_type: String,
    ) -> Result<(), String>;

    async fn read_shared_file_text(app: AppHandle, token: String) -> Result<String, String>;

    fn maybe_handle_share_deep_link(handle: &AppHandle, url: &Url) -> bool;
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

pub(crate) fn cleanup_stale_staged_shared_files(app: &AppHandle) {
    ShareTargetPlatformImpl::cleanup_stale_staged_shared_files(app);
}

#[tauri::command]
pub(crate) fn get_pending_share_filenames(
    app: AppHandle,
    state: tauri::State<'_, PendingShareFilesState>,
) -> Vec<String> {
    ShareTargetPlatformImpl::get_pending_share_filenames(app, &state)
}

/// Tauri command: move files saved by the Share Extension out of the shared
/// App Group container into the app's own staging directory and return their
/// metadata. Successfully staged files are consumed from the native
/// pending-share queue so they are not replayed on the next app launch.
#[tauri::command]
pub(crate) fn pop_shared_files(
    app: AppHandle,
    filenames: Vec<String>,
    state: tauri::State<'_, PendingShareFilesState>,
) -> Vec<StagedSharedFile> {
    ShareTargetPlatformImpl::pop_shared_files(app, filenames, &state)
}

/// Tauri command: delete staged share files after the frontend is finished with
/// them (for example after cancel or successful send).
#[tauri::command]
pub(crate) fn clear_shared_files(app: AppHandle, tokens: Vec<String>) -> Result<(), String> {
    ShareTargetPlatformImpl::clear_shared_files(app, tokens)
}

/// Tauri command: upload a staged shared file directly to a presigned URL
/// without copying the file through JS memory.
#[tauri::command]
pub(crate) async fn upload_shared_file_to_presigned_url(
    app: AppHandle,
    token: String,
    upload_url: String,
    mime_type: String,
) -> Result<(), String> {
    ShareTargetPlatformImpl::upload_shared_file_to_presigned_url(app, token, upload_url, mime_type)
        .await
}

#[tauri::command]
pub(crate) async fn read_shared_file_text(app: AppHandle, token: String) -> Result<String, String> {
    ShareTargetPlatformImpl::read_shared_file_text(app, token).await
}

pub(crate) fn maybe_handle_share_deep_link(handle: &AppHandle, url: &Url) -> bool {
    ShareTargetPlatformImpl::maybe_handle_share_deep_link(handle, url)
}

#[cfg(test)]
mod tests;
