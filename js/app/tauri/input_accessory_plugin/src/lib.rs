use tauri::{
    plugin::{Builder, TauriPlugin},
    Runtime,
};

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_input_accessory);

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("input-accessory")
        .setup(|_app, api| {
            #[cfg(target_os = "ios")]
            api.register_ios_plugin(init_plugin_input_accessory)?;
            Ok(())
        })
        .build()
}
