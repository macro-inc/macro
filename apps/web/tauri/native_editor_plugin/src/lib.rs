//! Android document-session view placement and application callback bridge.

#[cfg(target_os = "android")]
mod android;
pub mod generated;

/// Register Android commands without changing editor admission or other platforms.
pub fn init<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    let builder = tauri::plugin::Builder::new("native-editor");
    #[cfg(target_os = "android")]
    let builder = builder.invoke_handler(tauri::generate_handler![
        android::begin_account,
        android::create,
        android::mount,
        android::layout,
        android::focus,
        android::permissions,
        android::token_result,
        android::action,
        android::query,
        android::lifecycle,
        android::unmount,
        android::stop,
    ]);
    builder
        .setup(|app, api| {
            #[cfg(target_os = "android")]
            {
                use tauri::Manager;
                let handle =
                    api.register_android_plugin("com.macro.editor", "NativeEditorPlugin")?;
                app.manage(android::NativeEditor(handle));
            }
            #[cfg(not(target_os = "android"))]
            let _ = (app, api);
            Ok(())
        })
        .build()
}
