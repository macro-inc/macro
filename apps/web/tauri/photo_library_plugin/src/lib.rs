use serde::{Deserialize, Serialize};
use tauri::{
    AppHandle, Manager, Runtime, command,
    plugin::{Builder, PluginHandle, TauriPlugin},
};

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_photo_library);

#[cfg(target_os = "ios")]
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PickPhotoLibraryImagesPayload {
    staging_directory_path: String,
    token_prefix: &'static str,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StagedPhotoLibraryMedia {
    pub token: String,
    pub name: String,
    pub mime_type: String,
    pub size: u64,
    pub preview_path: String,
}

pub struct PhotoLibrary<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> PhotoLibrary<R> {
    #[cfg(target_os = "ios")]
    fn pick_photo_library_images(
        &self,
        staging_directory_path: String,
    ) -> Result<Vec<StagedPhotoLibraryMedia>, String> {
        self.0
            .run_mobile_plugin(
                "pickPhotoLibraryImages",
                PickPhotoLibraryImagesPayload {
                    staging_directory_path,
                    token_prefix: staged_upload_constants::PHOTO_LIBRARY_TOKEN_PREFIX,
                },
            )
            .map_err(|error| error.to_string())
    }
}

pub trait PhotoLibraryExt<R: Runtime> {
    fn photo_library(&self) -> &PhotoLibrary<R>;
}

impl<R: Runtime, T: Manager<R>> PhotoLibraryExt<R> for T {
    fn photo_library(&self) -> &PhotoLibrary<R> {
        self.state::<PhotoLibrary<R>>().inner()
    }
}

#[command]
async fn pick_photo_library_images<R: Runtime>(
    app: AppHandle<R>,
) -> Result<Vec<StagedPhotoLibraryMedia>, String> {
    #[cfg(not(target_os = "ios"))]
    {
        let _ = app;
        Err("photo library plugin is only available on iOS".to_string())
    }

    #[cfg(target_os = "ios")]
    {
        let staging_directory_path = app
            .path()
            .app_cache_dir()
            .map_err(|error| format!("failed to resolve app cache directory: {error}"))?
            .join(staged_upload_constants::PHOTO_LIBRARY_STAGING_DIRECTORY_NAME)
            .to_string_lossy()
            .into_owned();

        app.photo_library()
            .pick_photo_library_images(staging_directory_path)
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("photo-library")
        .invoke_handler(tauri::generate_handler![pick_photo_library_images])
        .setup(|_app, _api| {
            #[cfg(target_os = "ios")]
            {
                let handle = _api.register_ios_plugin(init_plugin_photo_library)?;
                _app.manage(PhotoLibrary(handle));
            }
            Ok(())
        })
        .build()
}
