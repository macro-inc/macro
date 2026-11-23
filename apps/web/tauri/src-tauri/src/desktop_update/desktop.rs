use super::report::{
    BundleLocation, Failure, FailureKind, Outcome, PendingInstall, Report, Reports, Trigger,
};
use super::state::{State, Status};
use download::Store;
use macro_bundle_updater_plugin::inbound::plugin::PluginService;
use serde::Deserialize;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{App, AppHandle, Emitter, ExitRequestApi, Listener, Manager, Runtime};
use tauri_plugin_updater::UpdaterExt;
use tokio::sync::Notify;

const EVENT: &str = "native-update-status";
/// Tells the frontend that reports are waiting; it drains them with
/// `take_native_update_reports`.
const REPORT_EVENT: &str = "native-update-report";
const CHECK_INTERVAL: Duration = Duration::from_secs(6 * 60 * 60);
const RETRY_INTERVAL: Duration = Duration::from_secs(60);
const MAX_RETRY_INTERVAL: Duration = Duration::from_secs(60 * 60);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(15 * 60);

mod download;
#[cfg(test)]
mod test;

#[derive(Default, Deserialize)]
struct Config {
    enabled: bool,
}

/// A verified update saved in app data, read back and verified again to install.
struct Download {
    update: tauri_plugin_updater::Update,
    store: Store,
}

struct Coordinator {
    state: Mutex<State<Download>>,
    check: Notify,
    restart: Mutex<bool>,
    reports: Mutex<Reports>,
    current_version: String,
    bundle_location: Option<BundleLocation>,
}

impl Coordinator {
    fn new(enabled: bool, current_version: String) -> Self {
        Self {
            state: Mutex::new(State::new(enabled)),
            check: Notify::new(),
            restart: Mutex::new(false),
            reports: Mutex::new(Reports::default()),
            current_version,
            bundle_location: BundleLocation::current(),
        }
    }
}

/// A failed check, and how far it got.
#[derive(Debug)]
enum CheckError {
    Check(tauri_plugin_updater::Error),
    Download {
        version: String,
        download_ms: u32,
        error: tauri_plugin_updater::Error,
    },
}

impl CheckError {
    fn outcome(&self, consecutive_failures: u32) -> Outcome {
        match self {
            Self::Check(error) => Outcome::CheckFailed {
                failure: error.into(),
                consecutive_failures,
            },
            Self::Download {
                version,
                download_ms,
                error,
            } => Outcome::DownloadFailed {
                target_version: version.clone(),
                download_ms: *download_ms,
                failure: error.into(),
                consecutive_failures,
            },
        }
    }
}

/// When and how long a check ran, for its reports.
struct Timing {
    started_at_ms: u64,
    started: Instant,
}

impl Timing {
    fn start() -> Self {
        Self {
            started_at_ms: now_ms(),
            started: Instant::now(),
        }
    }

    fn elapsed_ms(&self) -> u32 {
        duration_ms(self.started.elapsed())
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}

fn duration_ms(duration: Duration) -> u32 {
    duration.as_millis().try_into().unwrap_or(u32::MAX)
}

/// Holds the install record and the saved download. App data, not a cache
/// directory the system may purge.
fn update_directory<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    app.path()
        .app_local_data_dir()
        .inspect_err(
            |error| tracing::warn!(error=?error, "no app data directory for native update records"),
        )
        .ok()
        .map(|directory| directory.join("native-update"))
}

fn pending_install_path<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    update_directory(app).map(|directory| directory.join("pending-install.json"))
}

/// The updater's public key, which also verifies the saved download.
fn updater_pubkey<R: Runtime>(app: &App<R>) -> Option<String> {
    app.config()
        .plugins
        .0
        .get("updater")?
        .get("pubkey")?
        .as_str()
        .map(str::to_owned)
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
    // Downloads are kept in app data; without it, updates stay disabled and
    // the status says so. The updater plugin can't start without its key.
    let store = match update_directory(app.handle()) {
        Some(directory) if enabled => {
            let pubkey = updater_pubkey(app).ok_or("the updater config has no pubkey")?;
            Some(Store::new(directory, pubkey))
        }
        _ => None,
    };
    let coordinator = Arc::new(Coordinator::new(
        store.is_some(),
        app.package_info().version.to_string(),
    ));
    app.manage(coordinator.clone());
    // Report the install the previous launch started, whether or not this
    // launch checks for updates.
    if let Some(report) = pending_install_path(app.handle()).and_then(|path| {
        PendingInstall::take(
            &path,
            &coordinator.current_version,
            coordinator.bundle_location,
        )
    }) {
        report_outcome(app.handle(), &coordinator, report);
    }
    let Some(store) = store else {
        return Ok(());
    };
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
        let mut failures = 0u32;
        loop {
            let timing = Timing::start();
            let result = check(&handle, &coordinator, &store, &timing).await;
            let delay = match result {
                Ok(checked) => {
                    retry = RETRY_INTERVAL;
                    // A refused check proves nothing about the feed.
                    if checked {
                        failures = 0;
                    }
                    CHECK_INTERVAL
                }
                Err(error) => {
                    tracing::warn!(error=?error, "native update check failed");
                    failures = failures.saturating_add(1);
                    report(&handle, &coordinator, &timing, error.outcome(failures));
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

/// Hands the waiting reports to the frontend, each once.
pub fn take_reports<R: Runtime>(app: &AppHandle<R>) -> Vec<Report> {
    app.try_state::<Arc<Coordinator>>()
        .map_or_else(Vec::new, |coordinator| {
            coordinator
                .reports
                .lock()
                .expect("native update reports poisoned")
                .take()
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

fn report<R: Runtime>(
    app: &AppHandle<R>,
    coordinator: &Coordinator,
    timing: &Timing,
    outcome: Outcome,
) {
    report_outcome(
        app,
        coordinator,
        Report {
            started_at_ms: timing.started_at_ms,
            duration_ms: timing.elapsed_ms(),
            current_version: coordinator.current_version.clone(),
            bundle_location: coordinator.bundle_location,
            outcome,
        },
    );
}

fn report_outcome<R: Runtime>(app: &AppHandle<R>, coordinator: &Coordinator, report: Report) {
    tracing::info!(outcome = ?report.outcome, "native update outcome");
    coordinator
        .reports
        .lock()
        .expect("native update reports poisoned")
        .push(report);
    app.emit(REPORT_EVENT, ())
        .inspect_err(|error| tracing::warn!(error=?error, "failed to emit native update report"))
        .ok();
}

/// Checks the feed and downloads a newer version, resuming a download an
/// earlier launch or attempt saved. `Ok(false)` when the state refused to
/// start a check, so no request was made.
async fn check<R: Runtime>(
    app: &AppHandle<R>,
    coordinator: &Coordinator,
    store: &Store,
    timing: &Timing,
) -> Result<bool, CheckError> {
    if !coordinator
        .state
        .lock()
        .expect("native update state poisoned")
        .begin_check()
    {
        return Ok(false);
    }
    publish(app, coordinator, Status::Checking);
    let Some(mut update) = app
        .updater_builder()
        .timeout(REQUEST_TIMEOUT)
        .build()
        .map_err(CheckError::Check)?
        .check()
        .await
        .map_err(CheckError::Check)?
    else {
        // A saved download is for a version this app already runs, or one
        // the feed withdrew.
        store
            .remove()
            .inspect_err(|error| tracing::warn!(error = ?error.kind(), "could not remove an obsolete native update download"))
            .ok();
        report(app, coordinator, timing, Outcome::UpToDate);
        publish(app, coordinator, Status::Idle);
        return Ok(true);
    };
    let version = update.version.clone();
    report(
        app,
        coordinator,
        timing,
        Outcome::UpdateFound {
            target_version: version.clone(),
        },
    );
    publish(
        app,
        coordinator,
        Status::Downloading {
            version: version.clone(),
        },
    );
    update.timeout = Some(DOWNLOAD_TIMEOUT);
    let download_started = Instant::now();
    // The store verifies the whole file before returning; partial or
    // unverified bytes never become ready.
    let downloaded = store
        .download(&update)
        .await
        .map_err(|error| CheckError::Download {
            version: version.clone(),
            download_ms: duration_ms(download_started.elapsed()),
            error,
        })?;
    report(
        app,
        coordinator,
        timing,
        Outcome::Downloaded {
            target_version: version.clone(),
            download_ms: duration_ms(download_started.elapsed()),
            download_bytes: downloaded.bytes,
            resumed_bytes: downloaded.resumed_bytes,
        },
    );
    coordinator
        .state
        .lock()
        .expect("native update state poisoned")
        .downloaded(
            version.clone(),
            Download {
                update,
                store: store.clone(),
            },
        );
    app.emit(EVENT, Status::Ready { version })
        .inspect_err(|error| tracing::warn!(error=?error, "failed to emit native update ready"))
        .ok();
    Ok(true)
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
        let pending = PendingInstall {
            from_version: coordinator.current_version.clone(),
            target_version: download.update.version.clone(),
            trigger: if restart {
                Trigger::Restart
            } else {
                Trigger::Quit
            },
            started_at_ms: now_ms(),
            failure: None,
        };
        let record = pending_install_path(&app);
        let result = tauri::async_runtime::spawn_blocking(move || {
            install(&install_app, download, pending, record.as_deref())
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

/// Installs a verified download, leaving a record of the attempt for the
/// next launch to report. The app exits before anything here could reach
/// telemetry.
fn install<R: Runtime>(
    app: &AppHandle<R>,
    download: Download,
    mut pending: PendingInstall,
    record: Option<&std::path::Path>,
) -> Result<(), Failure> {
    if let Some(path) = record {
        pending
            .write(path)
            .inspect_err(|error| tracing::warn!(error=?error.kind(), "could not record the native update install"))
            .ok();
    }
    let result: Result<(), Failure> = (|| {
        // The saved file could have changed on disk since it was verified.
        let bytes = download
            .store
            .read_verified(&download.update.signature)
            .map_err(|error| {
                tracing::error!(error=?error, "saved native update did not verify before install");
                Failure::from(&error)
            })?;
        // Close the native database before handing control to an installer.
        if let Some(cache) = app.try_state::<graphql_cache_plugin::CacheState>() {
            cache.shutdown().map_err(|error| {
                tracing::error!(error=%error, "native cache shutdown failed before update install");
                Failure::new(FailureKind::CacheShutdown)
            })?;
        }
        download.update.install(bytes).map_err(|error| {
            tracing::error!(error=?error, "native update install failed");
            Failure::from(&error)
        })?;
        download
            .store
            .remove()
            .inspect_err(|error| tracing::warn!(error = ?error.kind(), "could not remove the installed native update download"))
            .ok();
        Ok(())
    })();
    if let (Err(failure), Some(path)) = (&result, record) {
        pending.failure = Some(failure.clone());
        pending
            .write(path)
            .inspect_err(|error| tracing::warn!(error=?error.kind(), "could not record the native update failure"))
            .ok();
    }
    result
}
