use serde::{Deserialize, Serialize};
use tauri::{
    AppHandle, Manager, Runtime, command,
    plugin::{Builder, PluginHandle, TauriPlugin},
};

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_pasteboard);

#[cfg(target_os = "ios")]
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StagePasteboardImagePayload {
    staging_directory_path: String,
    token_prefix: &'static str,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StagedPasteboardImage {
    pub token: Option<String>,
    pub name: Option<String>,
    pub mime_type: Option<String>,
    pub size: Option<u64>,
    pub preview_path: Option<String>,
}

pub struct Pasteboard<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> Pasteboard<R> {
    #[cfg(target_os = "ios")]
    fn stage_pasteboard_image(
        &self,
        staging_directory_path: String,
    ) -> Result<StagedPasteboardImage, String> {
        self.0
            .run_mobile_plugin(
                "stagePasteboardImage",
                StagePasteboardImagePayload {
                    staging_directory_path,
                    token_prefix: staged_upload_constants::PASTEBOARD_TOKEN_PREFIX,
                },
            )
            .map_err(|error| error.to_string())
    }
}

pub trait PasteboardExt<R: Runtime> {
    fn pasteboard(&self) -> &Pasteboard<R>;
}

impl<R: Runtime, T: Manager<R>> PasteboardExt<R> for T {
    fn pasteboard(&self) -> &Pasteboard<R> {
        self.state::<Pasteboard<R>>().inner()
    }
}

#[command]
async fn stage_pasteboard_image<R: Runtime>(
    app: AppHandle<R>,
) -> Result<StagedPasteboardImage, String> {
    #[cfg(not(target_os = "ios"))]
    {
        let _ = app;
        Err("pasteboard plugin is only available on iOS".to_string())
    }

    #[cfg(target_os = "ios")]
    {
        let staging_directory_path = app
            .path()
            .app_cache_dir()
            .map_err(|error| format!("failed to resolve app cache directory: {error}"))?
            .join(staged_upload_constants::PASTEBOARD_STAGING_DIRECTORY_NAME)
            .to_string_lossy()
            .into_owned();

        app.pasteboard()
            .stage_pasteboard_image(staging_directory_path)
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("pasteboard")
        .invoke_handler(tauri::generate_handler![stage_pasteboard_image])
        .setup(|_app, _api| {
            #[cfg(target_os = "ios")]
            {
                let handle = _api.register_ios_plugin(init_plugin_pasteboard)?;
                _app.manage(Pasteboard(handle));
            }
            Ok(())
        })
        .build()
}
