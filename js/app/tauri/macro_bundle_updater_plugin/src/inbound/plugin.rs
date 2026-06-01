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
    outbound::{api_client::BundleClient, fs::FileSystem, system_info::SystemInfo},
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
    /// Update applied successfully.
    Completed,
    /// An error occurred during the update.
    Error {
        /// Human-readable error message.
        message: String,
    },
}

impl BundleUpdateEvent {
    fn new(cur: &Result<UpdateStatus, Report<UpdateError>>) -> Self {
        match cur.as_ref() {
            Ok(UpdateStatus::Idle) => BundleUpdateEvent::Idle,
            Ok(UpdateStatus::CheckingForDownload(_)) => BundleUpdateEvent::CheckingForUpdate,
            Ok(UpdateStatus::UpdateFound(found)) => BundleUpdateEvent::UpdateFound {
                version: found.bundle.version.to_string(),
                notes: found.bundle.notes.clone(),
            },
            Ok(UpdateStatus::WaitingForWifi(_found)) => BundleUpdateEvent::WaitingForWifi,
            Ok(UpdateStatus::NoUpdateNeeded) => BundleUpdateEvent::NoUpdateNeeded,
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
}

impl MacroBundleUpdaterPlugin {
    /// Create the plugin targeting the given update server URL.
    pub fn new(base_url: Url) -> Self {
        Self { base_url }
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
            tracing::info!("Bundle update complete, reloading to pick up new assets");
            if let Err(e) = webview.eval("window.location.reload();") {
                tracing::warn!(error=?e, "Failed to dispatch bundle update reload");
                service_state
                    .lock()
                    .await
                    .unmark_update_reload_dispatched();
            }
        } else {
            tracing::warn!(
                "Completed bundle update applied but no webview was available to reload"
            );
            service_state
                .lock()
                .await
                .unmark_update_reload_dispatched();
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

    tracing::info!("Bundle cleared, reloading to revert to built-in assets");
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
        let system_info = SystemInfo::new(app.clone());

        let service = Service::new(client, fs, system_info);
        let mut status_rx = service.status().clone();
        let mut wifi_retry_status_rx = service.status().clone();

        let _ = service.start();
        app.manage(tokio::sync::Mutex::new(service));

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
                            Ok(true) => tracing::info!(
                                "[bundle-update] retrying bundle download after Wi-Fi wait"
                            ),
                            Ok(false) => {}
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
