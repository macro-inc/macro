//! Creates the startup windows and brings them back when the app is launched
//! again.
//!
//! A second launch exits inside the single-instance plugin before it creates a
//! window, so the running process must surface its own window. When that
//! process has lost its window (closed, or destroyed with a lost WindowServer
//! session), it rebuilds the window from the startup config; otherwise the
//! user sees nothing and every relaunch silently exits.

use navigation_plugin::MacroNavigationPlugin;
use tauri::utils::config::WindowConfig;
use tauri::{AppHandle, Manager};

use crate::{AppRuntime, ConfigureWindow};

/// What [`build`] needs to recreate a startup window after setup.
pub(crate) struct StartupWindows {
    configs: Vec<WindowConfig>,
    navigation: MacroNavigationPlugin,
    configure: ConfigureWindow,
}

impl StartupWindows {
    pub(crate) fn new(
        configs: Vec<WindowConfig>,
        navigation: MacroNavigationPlugin,
        configure: ConfigureWindow,
    ) -> Self {
        Self {
            configs,
            navigation,
            configure,
        }
    }
}

/// Builds every startup window, at launch, after installing the macOS app
/// menu they share.
pub(crate) fn create_all(
    app: &AppHandle<AppRuntime>,
    windows: &StartupWindows,
) -> tauri::Result<()> {
    #[cfg(target_os = "macos")]
    super::app_menu::install(app)?;
    for config in &windows.configs {
        build(app, windows, config)?;
    }
    Ok(())
}

fn build(
    app: &AppHandle<AppRuntime>,
    windows: &StartupWindows,
    config: &WindowConfig,
) -> tauri::Result<tauri::WebviewWindow<AppRuntime>> {
    let navigation = windows.navigation.clone();
    let handle = app.clone();
    let window = tauri::WebviewWindowBuilder::from_config(app, config)?
        .on_new_window(move |url, _features| navigation.on_new_window(&handle, &url));
    (windows.configure)(window).build()
}

/// Shows, unminimizes and focuses each startup window, recreating any that no
/// longer exist. Called when another launch of the app hands off to this one.
pub(crate) fn reveal(app: &AppHandle<AppRuntime>) {
    let handle = app.clone();
    let dispatched = app.run_on_main_thread(move || {
        let Some(windows) = handle.try_state::<StartupWindows>() else {
            tracing::warn!("startup windows unavailable; cannot reveal Macro");
            return;
        };
        #[cfg(target_os = "macos")]
        if let Err(error) = handle.show() {
            tracing::warn!(?error, "unable to unhide Macro");
        }
        for config in &windows.configs {
            let window = match handle.get_webview_window(&config.label) {
                Some(window) => window,
                None => {
                    tracing::warn!(label = %config.label, "startup window missing; recreating");
                    match build(&handle, &windows, config) {
                        Ok(window) => window,
                        Err(error) => {
                            tracing::error!(?error, label = %config.label, "unable to recreate window");
                            continue;
                        }
                    }
                }
            };
            for result in [window.unminimize(), window.show(), window.set_focus()] {
                if let Err(error) = result {
                    tracing::warn!(?error, label = %config.label, "unable to reveal window");
                }
            }
        }
    });
    if let Err(error) = dispatched {
        tracing::error!(?error, "unable to dispatch window reveal");
    }
}
