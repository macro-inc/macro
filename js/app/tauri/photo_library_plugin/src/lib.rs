use tauri::{
    Runtime,
    plugin::{Builder, TauriPlugin},
};

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_photo_library);

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("photo-library")
        .setup(|_app, api| {
            #[cfg(target_os = "ios")]
            api.register_ios_plugin(init_plugin_photo_library)?;
            Ok(())
        })
        .build()
}
