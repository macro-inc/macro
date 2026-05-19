use super::{PendingShareFilesState, ShareTargetPlatform, StagedSharedFile};
use tauri::AppHandle;
use url::Url;

pub(super) struct ShareTargetPlatformImpl;

impl ShareTargetPlatform for ShareTargetPlatformImpl {
    fn cleanup_stale_staged_shared_files(_app: &AppHandle) {}

    fn get_pending_share_filenames(_app: AppHandle, state: &PendingShareFilesState) -> Vec<String> {
        state.with_data(|d| d.clone())
    }

    fn pop_shared_files(
        _app: AppHandle,
        _filenames: Vec<String>,
        _state: &PendingShareFilesState,
    ) -> Vec<StagedSharedFile> {
        vec![]
    }

    fn clear_shared_files(_app: AppHandle, _tokens: Vec<String>) -> Result<(), String> {
        Ok(())
    }

    async fn upload_shared_file_to_presigned_url(
        _app: AppHandle,
        _token: String,
        _upload_url: String,
        _mime_type: String,
    ) -> Result<(), String> {
        Ok(())
    }

    async fn read_shared_file_text(_app: AppHandle, _token: String) -> Result<String, String> {
        Ok(String::new())
    }

    fn maybe_handle_share_deep_link(_handle: &AppHandle, _url: &Url) -> bool {
        false
    }
}
