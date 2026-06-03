use tokio::sync::Mutex;

use rootcause::Report;
use serde::Serialize;
use std::time::Duration;
use tauri::{Emitter, Manager, Runtime, plugin::Plugin};
use url::Url;

use crate::{
    domain::{
        models::{UpdateError, UpdateStatus},
        ports::AutoUpdateService,
        service::{ApplyUpdateResult, Service},
    },
    outbound::{
        api_client::BundleClient,
        fs::FileSystem,
        system_info::{SystemInfo, native_build},
    },
};

/// Concrete service type used by the plugin commands.
pub type PluginService = Service<FileSystem>;

const EVENT_NAME: &str = "bundle-update-status";
const WIFI_RETRY_INTERVAL: Duration = Duration::from_secs(30);

/// Serializable event emitted to the frontend via Tauri's event system.
#[derive(Clone, Serialize)]
#[serde(tag = "status", content = "data")]
pub enum BundleUpdateEvent {
    /// No update activity.
    Idle,
    /// Checking the server for updates.
    CheckingForUpdate,
    /// An update is available.
    UpdateFound {
        /// The new version string.
        version: String,
        /// Optional release notes.
        notes: Option<String>,
    },
    /// An update is available, but download is deferred until Wi-Fi or Ethernet is available.
    WaitingForWifi,
    /// Already on the latest version.
    NoUpdateNeeded,
    /// Bundle download in progress.
    Downloading {
        /// Download progress percentage (0–100).
        progress: f64,
    },
    /// Bundle extraction in progress.
    Unzipping {
        /// Extraction progress percentage (0–100).
        progress: f64,
    },
    /// The active OTA bundle must be cleared.
    ClearRequired {
        /// Reason the server requested a clear.
        reason: String,
    },
    /// A newer bundle exists but requires a newer native app build.
    NativeUpdateRequired {
        /// The newer bundle build that could not be applied.
        #[serde(rename = "bundleBuild")]
        bundle_build: u64,
        /// The minimum native build required by that bundle.
        #[serde(rename = "minNativeBuild")]
        min_native_build: u64,
    },
    /// Update applied successfully.
    Completed,
    /// An error occurred during the update.
    Error {
        /// Human-readable error message.
        message: String,
    },
}

/// Debug metadata about the currently effective JavaScript bundle.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BundleDebugInfo {
    /// Current effective bundle build.
    bundle_build: u64,
    /// Whether the effective bundle came from OTA cache or embedded assets.
    source: BundleDebugSource,
    /// Runtime native app build number.
    native_build: u64,
}

/// Source of the currently effective JavaScript bundle.
#[derive(Clone, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum BundleDebugSource {
    /// The native app's embedded bundle is active.
    Embedded,
    /// A cached OTA bundle is active.
    Ota,
}

impl BundleUpdateEvent {
    fn new(cur: &Result<UpdateStatus, Report<UpdateError>>) -> Self {
        match cur.as_ref() {
            Ok(UpdateStatus::Idle) => BundleUpdateEvent::Idle,
            Ok(UpdateStatus::CheckingForDownload(_)) => BundleUpdateEvent::CheckingForUpdate,
            Ok(UpdateStatus::UpdateFound(found)) => BundleUpdateEvent::UpdateFound {
                version: found.bundle.bundle_build.to_string(),
                notes: found.bundle.notes.clone(),
            },
            Ok(UpdateStatus::WaitingForWifi(_found)) => BundleUpdateEvent::WaitingForWifi,
            Ok(UpdateStatus::NoUpdateNeeded) => BundleUpdateEvent::NoUpdateNeeded,
            Ok(UpdateStatus::ClearRequired(clear)) => BundleUpdateEvent::ClearRequired {
                reason: clear.reason.clone(),
            },
            Ok(UpdateStatus::NativeUpdateRequired(required)) => {
                BundleUpdateEvent::NativeUpdateRequired {
                    bundle_build: required.bundle_build,
                    min_native_build: required.min_native_build,
                }
            }
            Ok(UpdateStatus::DownloadingBundle(dl)) => BundleUpdateEvent::Downloading {
                progress: dl.progress.value(),
            },
            Ok(UpdateStatus::UnzippingBundle(uz)) => BundleUpdateEvent::Unzipping {
                progress: uz.progress.value(),
            },
            Ok(UpdateStatus::Completed(_completed)) => BundleUpdateEvent::Completed,
            Err(e) => BundleUpdateEvent::Error {
                message: e.to_string(),
            },
        }
    }
}

/// Tauri plugin that manages OTA bundle updates.
pub struct MacroBundleUpdaterPlugin {
    base_url: Url,
    embedded_bundle_build: u64,
}

impl MacroBundleUpdaterPlugin {
    /// Create the plugin targeting the given update server URL.
    pub fn new(base_url: Url, embedded_bundle_build: u64) -> Self {
        Self {
            base_url,
            embedded_bundle_build,
        }
    }
}

/// Approve or deny a pending bundle update.
#[tauri::command]
pub async fn grant_bundle_update(
    service: tauri::State<'_, Mutex<PluginService>>,
    approved: bool,
) -> Result<(), String> {
    let service = service.lock().await;
    service
        .approve_pending_update(approved)
        .map_err(|e| e.to_string())
}

/// Retry a bundle update that is waiting for Wi-Fi or Ethernet.
pub async fn retry_waiting_for_wifi<R: Runtime>(
    app_handle: &tauri::AppHandle<R>,
) -> Result<bool, String> {
    let Some(service_state) = app_handle.try_state::<Mutex<PluginService>>() else {
        return Ok(false);
    };

    let service = service_state.lock().await;
    service.retry_waiting_for_wifi().map_err(|e| e.to_string())
}

/// Start a fresh bundle update check.
pub async fn start_update_check<R: Runtime>(
    app_handle: &tauri::AppHandle<R>,
) -> Result<bool, String> {
    let Some(service_state) = app_handle.try_state::<Mutex<PluginService>>() else {
        return Ok(false);
    };

    let service = service_state.lock().await;
    service.start().map_err(|e| e.to_string())?;
    Ok(true)
}

/// Allow a pending bundle update reload to be dispatched again.
pub async fn allow_update_reload_retry<R: Runtime>(
    app_handle: &tauri::AppHandle<R>,
) -> Result<bool, String> {
    let Some(service_state) = app_handle.try_state::<Mutex<PluginService>>() else {
        return Ok(false);
    };

    let mut service = service_state.lock().await;
    Ok(service.allow_update_reload_retry())
}

/// Apply a completed bundle update to the live webview.
///
/// Returns `Ok(true)` if an update was applied, `Ok(false)` if the service is
/// not in the `Completed` state (no pending update to commit).
pub async fn apply_completed_update<R: Runtime>(
    app_handle: &tauri::AppHandle<R>,
) -> Result<bool, String> {
    apply_completed_update_from(app_handle, "command").await
}

/// Apply a completed bundle update and include the caller in operational logs.
pub async fn apply_completed_update_from<R: Runtime>(
    app_handle: &tauri::AppHandle<R>,
    source: &'static str,
) -> Result<bool, String> {
    let service_state = app_handle
        .try_state::<Mutex<PluginService>>()
        .ok_or_else(|| "Bundle updater plugin not initialized".to_string())?;

    let cache_dir = app_handle
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?;

    let apply_result = {
        let mut service = service_state.lock().await;
        let result = service
            .apply_update(&cache_dir)
            .await
            .map_err(|e| e.to_string())?;
        if result == ApplyUpdateResult::ReloadNeeded {
            service.mark_update_reload_dispatched();
        }
        result
    };

    if apply_result == ApplyUpdateResult::ReloadNeeded {
        // Reload to pick up the new bundle. Using location.reload() instead of
        // navigating to a new URL preserves WKWebView's cookie store.
        if let Some(webview) = app_handle.webview_windows().values().next() {
            if let Err(e) = webview.eval("window.location.reload();") {
                tracing::warn!(
                    source,
                    error=?e,
                    "[bundle-update] failed to dispatch webview reload"
                );
                service_state.lock().await.unmark_update_reload_dispatched();
            }
        } else {
            tracing::warn!(
                source,
                "[bundle-update] completed bundle update applied but no webview was available to reload"
            );
            service_state.lock().await.unmark_update_reload_dispatched();
        }
    }
    Ok(apply_result != ApplyUpdateResult::NoUpdate)
}

/// Apply a completed bundle update: set the bundle root and navigate to it.
///
/// Returns `true` if a completed update was applied, or `false` when there is
/// no completed update pending.
#[tauri::command]
#[tracing::instrument(err, skip(app_handle))]
pub async fn perform_update<R: Runtime>(app_handle: tauri::AppHandle<R>) -> Result<bool, String> {
    apply_completed_update(&app_handle).await
}

/// Acknowledge that the webview mounted after an applied bundle update reload.
#[tauri::command]
pub async fn ack_bundle_update_reload(
    service: tauri::State<'_, Mutex<PluginService>>,
) -> Result<bool, String> {
    service
        .lock()
        .await
        .acknowledge_update_reload()
        .map_err(|e| e.to_string())
}

/// Trigger a manual check for bundle updates.
#[tauri::command]
pub async fn check_for_update(
    service: tauri::State<'_, Mutex<PluginService>>,
) -> Result<(), String> {
    let service = service.lock().await;
    service.start().map_err(|e| e.to_string())
}

/// Return the current bundle update status as a serializable event.
#[tauri::command]
pub async fn get_bundle_update_status(
    service: tauri::State<'_, Mutex<PluginService>>,
) -> Result<BundleUpdateEvent, String> {
    let service = service.lock().await;
    let status = service.status().borrow();
    Ok(BundleUpdateEvent::new(&status))
}

/// Return debug metadata for the currently effective JavaScript bundle.
#[tauri::command]
pub async fn get_bundle_debug_info(
    service: tauri::State<'_, Mutex<PluginService>>,
) -> Result<BundleDebugInfo, String> {
    let service = service.lock().await;
    let embedded_bundle_build = service.embedded_bundle_build();
    let cached_bundle_build = service.bundle_build().await;
    Ok(BundleDebugInfo {
        bundle_build: cached_bundle_build.unwrap_or(embedded_bundle_build),
        source: if cached_bundle_build.is_some() {
            BundleDebugSource::Ota
        } else {
            BundleDebugSource::Embedded
        },
        native_build: crate::outbound::system_info::native_build(),
    })
}

/// Clear the downloaded bundle and revert to built-in assets.
#[tauri::command]
pub async fn clear_bundle<R: Runtime>(
    service: tauri::State<'_, Mutex<PluginService>>,
    app_handle: tauri::AppHandle<R>,
) -> Result<(), String> {
    let cache_dir = app_handle
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?;

    service
        .lock()
        .await
        .clear_bundle_root(&cache_dir)
        .await
        .map_err(|e| e.to_string())?;

    if let Some(webview) = app_handle.webview_windows().values().next() {
        let _ = webview.eval("window.location.reload();");
    }
    Ok(())
}

impl<R: Runtime> Plugin<R> for MacroBundleUpdaterPlugin {
    fn name(&self) -> &'static str {
        "macro-bundle-updater"
    }

    fn initialize(
        &mut self,
        app: &tauri::AppHandle<R>,
        _config: serde_json::Value,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let client = BundleClient::new(self.base_url.clone());
        let fs = FileSystem;
        let system_info = SystemInfo::new(app.clone(), self.embedded_bundle_build);

        let mut service = Service::new(client, fs, system_info, self.embedded_bundle_build);
        let mut acknowledge_setup_apply = false;
        let mut start_update_check = false;
        if let Ok(cache_dir) = app.path().app_cache_dir() {
            let restored_pending = tauri::async_runtime::block_on(async {
                service.load_bundle_root(&cache_dir, native_build()).await
            });
            if restored_pending {
                match tauri::async_runtime::block_on(async {
                    service.apply_update(&cache_dir).await
                }) {
                    Ok(ApplyUpdateResult::ReloadNeeded) => {
                        acknowledge_setup_apply = true;
                    }
                    Ok(ApplyUpdateResult::ReloadAlreadyDispatched) => {
                        acknowledge_setup_apply = true;
                    }
                    Ok(ApplyUpdateResult::NoUpdate) => {
                        tracing::warn!(
                            "[bundle-update] restored pending bundle had no update to apply during plugin initialization"
                        );
                        start_update_check = true;
                    }
                    Err(e) => {
                        tracing::error!(
                            "[bundle-update] failed to apply restored pending bundle during plugin initialization: {e}"
                        );
                        start_update_check = true;
                    }
                }
            } else {
                start_update_check = true;
            }
        } else {
            tracing::warn!(
                "[bundle-update] failed to read app cache dir during plugin initialization"
            );
            start_update_check = true;
        }
        let mut status_rx = service.status().clone();
        let mut wifi_retry_status_rx = service.status().clone();

        app.manage(tokio::sync::Mutex::new(service));
        if acknowledge_setup_apply || start_update_check {
            let Some(service_state) = app.try_state::<Mutex<PluginService>>() else {
                tracing::warn!(
                    "[bundle-update] plugin service state unavailable during initialization"
                );
                return Ok(());
            };
            let Ok(mut service) = service_state.try_lock() else {
                tracing::warn!("[bundle-update] plugin service state locked during initialization");
                return Ok(());
            };
            if acknowledge_setup_apply {
                if let Err(e) = service.acknowledge_update_reload() {
                    tracing::warn!(
                        "[bundle-update] failed to acknowledge plugin-initialized bundle apply: {e}"
                    );
                }
            } else if let Err(e) = service.start() {
                tracing::warn!(
                    "[bundle-update] failed to start update check during plugin initialization: {e}"
                );
            }
        }

        let app_handle = app.clone();
        tauri::async_runtime::spawn(async move {
            // Emit current state before waiting for changes
            {
                let event = status_rx.borrow_and_update();
                let _ = app_handle.emit(EVENT_NAME, BundleUpdateEvent::new(&event));
            }
            loop {
                if status_rx.changed().await.is_err() {
                    tracing::error!("The sender handle was dropped unexpectedly");
                    break;
                }
                let event = status_rx.borrow_and_update();
                let _ = app_handle.emit(EVENT_NAME, BundleUpdateEvent::new(&event));
            }
        });

        let app_handle = app.clone();
        tauri::async_runtime::spawn(async move {
            loop {
                if !matches!(
                    &*wifi_retry_status_rx.borrow(),
                    Ok(UpdateStatus::WaitingForWifi(_))
                ) {
                    if wifi_retry_status_rx.changed().await.is_err() {
                        return;
                    }
                    continue;
                }

                tokio::select! {
                    _ = tokio::time::sleep(WIFI_RETRY_INTERVAL) => {
                        match retry_waiting_for_wifi(&app_handle).await {
                            Ok(true) | Ok(false) => {}
                            Err(e) => tracing::warn!(
                                "[bundle-update] failed to retry bundle download after Wi-Fi wait: {e}"
                            ),
                        }
                    }
                    changed = wifi_retry_status_rx.changed() => {
                        if changed.is_err() {
                            return;
                        }
                    }
                }
            }
        });

        Ok(())
    }
}
