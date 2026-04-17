use std::sync::Mutex;

use rootcause::Report;
use serde::Serialize;
use tauri::{Emitter, Manager, Runtime, plugin::Plugin};
use url::Url;

use crate::{
    domain::{
        models::{UpdateApproval, UpdateError, UpdateStatus},
        ports::AutoUpdateService,
        service::Service,
    },
    outbound::{api_client::BundleClient, fs::FileSystem, system_info::SystemInfo},
};

const EVENT_NAME: &str = "bundle-update-status";

#[derive(Clone, Serialize)]
#[serde(tag = "status", content = "data")]
pub enum BundleUpdateEvent {
    Idle,
    CheckingForUpdate,
    UpdateFound {
        version: String,
        notes: Option<String>,
    },
    NoUpdateNeeded,
    Downloading {
        progress: f64,
    },
    Unzipping {
        progress: f64,
    },
    Completed,
    Error {
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

pub struct MacroBundleUpdaterPlugin {
    base_url: Url,
}

impl MacroBundleUpdaterPlugin {
    pub fn new(base_url: Url) -> Self {
        Self { base_url }
    }
}

#[tauri::command]
pub fn grant_bundle_update(
    service: tauri::State<'_, Mutex<Service>>,
    approved: bool,
) -> Result<(), String> {
    let mut service = service.lock().unwrap();
    let request = {
        let status = service.status().borrow();
        match status.as_ref() {
            Ok(UpdateStatus::UpdateFound(found)) => found.request,
            _ => return Err("No pending update request".into()),
        }
    };
    let approval = if approved {
        UpdateApproval::Granted(request.grant())
    } else {
        UpdateApproval::Denied(request.deny())
    };
    service.grant_or_deny(approval).map_err(|e| e.to_string())
}

#[tauri::command]
#[tracing::instrument(err, skip(service, bundle_root))]
pub fn perform_update<R: Runtime>(
    service: tauri::State<'_, Mutex<Service>>,
    bundle_root: tauri::State<'_, crate::BundleRoot>,
    app_handle: tauri::AppHandle<R>,
) -> Result<(), String> {
    let Ok(service) = service.lock() else {
        return Err("autoupdate state mutex is poisoned".to_string());
    };
    let entrypoint = {
        let status = service.status().borrow();
        match status.as_ref() {
            Ok(UpdateStatus::Completed(bundle_location)) => bundle_location.entrypoint.clone(),
            _ => return Err("No pending update".into()),
        }
    };

    // Set the bundle root to the parent of index.html (the unzipped directory)
    let bundle_dir = entrypoint
        .parent()
        .ok_or_else(|| format!("entrypoint {entrypoint:?} has no parent directory"))?
        .to_path_buf();
    tracing::info!("Setting bundle root to {bundle_dir:?}");
    *bundle_root.0.write().map_err(|e| e.to_string())? = Some(bundle_dir);

    // Navigate to the updated bundle, preserving the current hash route.
    if let Some(webview) = app_handle.webview_windows().values().next() {
        tracing::info!("Bundle update complete, navigating to updated bundle");
        let _ = webview.eval(
            "window.location.href = 'tauri://localhost/app/index.html' + window.location.hash;"
        );
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

        app.manage(Mutex::new(service));

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
