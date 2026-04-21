use tokio::sync::Mutex;

use rootcause::Report;
use serde::Serialize;
use tauri::{Emitter, Manager, Runtime, plugin::Plugin};
use url::Url;

use crate::{
    domain::{
        models::{UpdateApproval, UpdateDenied, UpdateError, UpdateGranted, UpdateStatus},
        ports::AutoUpdateService,
        service::Service,
    },
    outbound::{api_client::BundleClient, fs::FileSystem, system_info::SystemInfo},
};

/// Concrete service type used by the plugin commands.
pub type PluginService = Service<FileSystem>;

const EVENT_NAME: &str = "bundle-update-status";

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
    let mut service = service.lock().await;
    let grant_tx = service.try_recv_grant_sender().map_err(|e| e.to_string())?;
    let approval = if approved {
        UpdateApproval::Granted(UpdateGranted::new())
    } else {
        UpdateApproval::Denied(UpdateDenied::new())
    };
    grant_tx
        .send(approval)
        .map_err(|_| "Worker dropped the grant receiver".to_string())
}

/// Apply a completed bundle update: set the bundle root and navigate to it.
#[tauri::command]
#[tracing::instrument(err, skip(service, app_handle))]
pub async fn perform_update<R: Runtime>(
    service: tauri::State<'_, Mutex<PluginService>>,
    app_handle: tauri::AppHandle<R>,
) -> Result<(), String> {
    let mut service = service.lock().await;
    let entrypoint = {
        let status = service.status().borrow();
        match status.as_ref() {
            Ok(UpdateStatus::Completed(bundle_location)) => bundle_location.entrypoint.clone(),
            _ => return Err("No pending update".into()),
        }
    };

    let bundle_dir = entrypoint
        .parent()
        .ok_or_else(|| format!("entrypoint {entrypoint:?} has no parent directory"))?
        .to_path_buf();

    let cache_dir = app_handle
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?;

    tracing::info!("Setting bundle root to {bundle_dir:?}");
    service
        .set_bundle_root(bundle_dir.clone(), &cache_dir)
        .await
        .map_err(|e| e.to_string())?;

    // Remove old bundle directories now that we've switched to the new one
    service.cleanup_old_bundles(&cache_dir, &bundle_dir).await;

    drop(service);

    // Reload to pick up the new bundle. Using location.reload() instead of
    // navigating to a new URL preserves WKWebView's cookie store.
    if let Some(webview) = app_handle.webview_windows().values().next() {
        tracing::info!("Bundle update complete, reloading to pick up new assets");
        let _ = webview.eval("window.location.reload();");
    }
    Ok(())
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

        Ok(())
    }
}
