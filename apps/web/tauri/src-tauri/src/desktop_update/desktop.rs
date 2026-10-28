use super::state::{State, Status};
use macro_bundle_updater_plugin::inbound::plugin::PluginService;
use serde::Deserialize;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{App, AppHandle, Emitter, ExitRequestApi, Listener, Manager, Runtime};
use tauri_plugin_updater::UpdaterExt;
use tokio::sync::Notify;

const EVENT: &str = "native-update-status";
const CHECK_INTERVAL: Duration = Duration::from_secs(6 * 60 * 60);
const RETRY_INTERVAL: Duration = Duration::from_secs(60);
const MAX_RETRY_INTERVAL: Duration = Duration::from_secs(60 * 60);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(15 * 60);

#[cfg(test)]
mod test;

#[derive(Default, Deserialize)]
struct Config {
    enabled: bool,
}

struct Download {
    update: tauri_plugin_updater::Update,
    bytes: Vec<u8>,
}

struct Coordinator {
    state: Mutex<State<Download>>,
    check: Notify,
    restart: Mutex<bool>,
}

pub fn setup<R: Runtime>(
    app: &mut App<R>,
    recording: bool,
) -> Result<(), Box<dyn std::error::Error>> {
    let config: Config = app
        .config()
        .plugins
        .0
        .get("desktop-update")
        .cloned()
        .map(serde_json::from_value)
        .transpose()?
        .unwrap_or_default();
    let enabled = config.enabled
        && cfg!(any(target_os = "macos", target_os = "linux"))
        && !cfg!(debug_assertions)
        && cfg!(feature = "auto_apply_update")
        && !recording;
    let coordinator = Arc::new(Coordinator {
        state: Mutex::new(State::new(enabled)),
        check: Notify::new(),
        restart: Mutex::new(false),
    });
    app.manage(coordinator.clone());
    if !enabled {
        return Ok(());
    }
    app.handle()
        .plugin(tauri_plugin_updater::Builder::new().build())?;
    let notify = coordinator.clone();
    app.listen("bundle-update-status", move |event| {
        // The bundle service owns compatibility decisions; react to its result.
        if serde_json::from_str::<serde_json::Value>(event.payload())
            .is_ok_and(|event| event["status"] == "NativeUpdateRequired")
        {
            notify.check.notify_one();
        }
    });
    let handle = app.handle().clone();
    tauri::async_runtime::spawn(async move {
        let mut retry = RETRY_INTERVAL;
        loop {
            let result = check(&handle, &coordinator).await;
            let delay = match result {
                Ok(()) => {
                    retry = RETRY_INTERVAL;
                    CHECK_INTERVAL
                }
                Err(error) => {
                    tracing::warn!(error=?error, "native update check failed");
                    publish(
                        &handle,
                        &coordinator,
                        Status::Error {
                            message: "Could not download the app update. Will retry automatically."
                                .into(),
                        },
                    );
                    let delay = retry;
                    retry = (retry * 2).min(MAX_RETRY_INTERVAL);
                    delay
                }
            };
            // Compatibility events cannot turn an unavailable feed into a tight loop.
            tokio::time::sleep(RETRY_INTERVAL).await;
            tokio::select! {
                _ = tokio::time::sleep(delay.saturating_sub(RETRY_INTERVAL)) => {}
                _ = coordinator.check.notified() => {}
            }
        }
    });
    Ok(())
}

pub fn status<R: Runtime>(app: &AppHandle<R>) -> Status {
    app.try_state::<Arc<Coordinator>>()
        .map_or(Status::Disabled, |coordinator| {
            coordinator
                .state
                .lock()
                .expect("native update state poisoned")
                .status
                .clone()
        })
}

fn publish<R: Runtime>(app: &AppHandle<R>, coordinator: &Coordinator, status: Status) {
    coordinator
        .state
        .lock()
        .expect("native update state poisoned")
        .status = status.clone();
    app.emit(EVENT, &status)
        .inspect_err(|error| tracing::warn!(error=?error, "failed to emit native update status"))
        .ok();
}

async fn check<R: Runtime>(
    app: &AppHandle<R>,
    coordinator: &Coordinator,
) -> tauri_plugin_updater::Result<()> {
    if !coordinator
        .state
        .lock()
        .expect("native update state poisoned")
        .begin_check()
    {
        return Ok(());
    }
    publish(app, coordinator, Status::Checking);
    let Some(mut update) = app
        .updater_builder()
        .timeout(REQUEST_TIMEOUT)
        .build()?
        .check()
        .await?
    else {
        publish(app, coordinator, Status::Idle);
        return Ok(());
    };
    let version = update.version.clone();
    publish(
        app,
        coordinator,
        Status::Downloading {
            version: version.clone(),
        },
    );
    update.timeout = Some(DOWNLOAD_TIMEOUT);
    // download() verifies the signature before returning. Never install partial
    // bytes or bytes restored from an unverified disk cache.
    let bytes = update.download(|_, _| {}, || {}).await?;
    coordinator
        .state
        .lock()
        .expect("native update state poisoned")
        .downloaded(version.clone(), Download { update, bytes });
    app.emit(EVENT, Status::Ready { version })
        .inspect_err(|error| tracing::warn!(error=?error, "failed to emit native update ready"))
        .ok();
    Ok(())
}

pub fn restart<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let coordinator = app
        .try_state::<Arc<Coordinator>>()
        .ok_or("Native updater is unavailable")?;
    if !matches!(status(app), Status::Ready { .. }) {
        return Err("No verified app update is ready".into());
    }
    *coordinator
        .restart
        .lock()
        .expect("native update restart state poisoned") = true;
    // Use the same quit path as the menu/OS. restart() itself bypasses exit prevention.
    app.exit(0);
    Ok(())
}

pub fn on_exit_requested<R: Runtime>(app: &AppHandle<R>, api: &ExitRequestApi) {
    let Some(coordinator) = app.try_state::<Arc<Coordinator>>() else {
        return;
    };
    let download = {
        let mut state = coordinator
            .state
            .lock()
            .expect("native update state poisoned");
        if state.is_installing() {
            api.prevent_exit();
            return;
        }
        let Some(download) = state.begin_install() else {
            return;
        };
        download
    };
    api.prevent_exit();
    let coordinator = coordinator.inner().clone();
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        publish(&app, &coordinator, Status::Installing);
        // Serializes against bundle application/reload until the process exits.
        let bundle = app.state::<tokio::sync::Mutex<PluginService>>();
        let _bundle_guard = bundle.lock().await;
        let install_app = app.clone();
        let restart = *coordinator
            .restart
            .lock()
            .expect("native update restart state poisoned");
        let result = tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
            // Close the native database before handing control to an installer.
            if let Some(cache) = install_app.try_state::<graphql_cache_plugin::CacheState>() {
                cache.shutdown()?;
            }
            download
                .update
                .install(download.bytes)
                .map_err(|error| error.to_string())
        })
        .await;
        let installed = matches!(&result, Ok(Ok(())));
        if !installed {
            tracing::error!(error=?result, "native update installation failed; leaving app for manual recovery");
        }
        coordinator
            .state
            .lock()
            .expect("native update state poisoned")
            .finish_exit();
        if installed && restart {
            app.restart();
        } else {
            app.exit(0);
            // Keep OTA reloads blocked while the event loop processes ExitRequested.
            std::future::pending::<()>().await;
        }
    });
}
