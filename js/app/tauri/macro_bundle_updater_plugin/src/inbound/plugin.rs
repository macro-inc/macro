use std::sync::Mutex;

use tauri::{Manager, Runtime, plugin::Plugin};
use url::Url;

use crate::{
    domain::{
        models::UpdateStatus,
        ports::AutoUpdateService,
        service::Service,
    },
    outbound::{api_client::BundleClient, fs::FileSystem, system_info::SystemInfo},
};

pub struct MacroBundleUpdaterPlugin {
    base_url: Url,
}

impl MacroBundleUpdaterPlugin {
    pub fn new(base_url: Url) -> Self {
        Self { base_url }
    }
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
            loop {
                if status_rx.changed().await.is_err() {
                    break;
                }
                // Extract the entrypoint from the borrow without cloning Report
                let entrypoint = {
                    let status = status_rx.borrow_and_update();
                    match status.as_ref() {
                        Ok(UpdateStatus::Completed(completed)) => {
                            Some(completed.entrypoint.clone())
                        }
                        Ok(UpdateStatus::NoUpdateNeeded) => break,
                        Err(e) => {
                            tracing::error!("Bundle update error: {e}");
                            break;
                        }
                        _ => None,
                    }
                };

                if let Some(entrypoint) = entrypoint {
                    let Ok(url) = Url::from_file_path(&entrypoint) else {
                        tracing::error!(
                            "Failed to construct file URL from {entrypoint:?}",
                        );
                        break;
                    };

                    if let Some(webview) = app_handle.webview_windows().values().next() {
                        tracing::info!("Bundle update complete, navigating to {url}");
                        let _ = webview.navigate(url);
                    }
                    break;
                }
            }
        });

        Ok(())
    }
}
