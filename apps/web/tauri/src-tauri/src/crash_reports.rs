//! Native crash reports, kept on this machine until the webview sends them.
//!
//! A Rust panic is written to a file by the panic hook as it happens. Chromium
//! (the macOS CEF build) writes a minidump through Crashpad, which uploads
//! nothing: `crash_reporter.cfg` names no server. On a later webview start the
//! frontend takes the reports, sends each to PostHog as `$exception`, and acks
//! them, which deletes the files. A minidump holds process memory, so only a
//! signature read from it (process type, exception, module and offset) leaves
//! the machine. See `README.md#native-crash-reports`.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::Manager;

#[cfg(any(feature = "cef", test))]
mod dump_signature;
mod panic;
mod scrub;
#[cfg(test)]
mod test;

/// Reports offered per take, so a crash loop cannot flood one launch.
const MAX_REPORTS_PER_TAKE: usize = 10;
/// Launch records kept to date the crashes they produced.
const MAX_LAUNCHES: usize = 20;
const LAUNCHES_FILE: &str = "launches.json";
/// How long before its dump a main-thread panic counts as that crash's cause.
const PANIC_ABORT_WINDOW_MS: u64 = 10_000;
const PANIC_PREFIX: &str = "panic-";
const MINIDUMP_PREFIX: &str = "minidump-";
/// Crashpad moves a finished dump to `pending` and, after an upload, to
/// `completed`. With no server it stays in `pending`; `new` is still being written.
const CRASHPAD_REPORT_DIRS: &[&str] = &["pending", "completed"];

/// The native build that was running.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct Launch {
    #[cfg_attr(test, specta(type = specta_typescript::Number))]
    pub started_at_ms: u64,
    pub native_version: String,
    #[cfg_attr(test, specta(type = specta_typescript::Number))]
    pub native_build_time_ms: u64,
}

/// One crash, read back after it happened.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct CrashReport {
    /// Passed back to `ack_native_crash_reports` once the report is sent.
    pub id: String,
    /// When it happened, in Unix milliseconds.
    #[cfg_attr(test, specta(type = specta_typescript::Number))]
    pub timestamp_ms: u64,
    /// The launch that crashed, when its record survives.
    pub launch: Option<Launch>,
    /// `std::env::consts::OS` of the machine that wrote the report.
    pub os: String,
    pub os_version: Option<String>,
    pub arch: Option<String>,
    pub crash: Crash,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Crash {
    Panic(PanicCrash),
    // Only the Chromium build reads minidumps.
    #[cfg_attr(not(any(feature = "cef", test)), allow(dead_code))]
    Native(NativeCrash),
}

/// A Rust panic in the app's own process. The message is scrubbed of quoted
/// values, paths, URLs, and email addresses before it is written.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct PanicCrash {
    pub thread: Option<String>,
    pub message: String,
    /// `file:line:column` of the panic.
    pub location: Option<String>,
    /// Innermost first, without the panic machinery.
    pub frames: Vec<PanicFrame>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct PanicFrame {
    pub function: String,
    pub file: Option<String>,
    pub line: Option<u32>,
    /// Whether the function is in one of the app's own crates.
    pub in_app: bool,
}

/// A Chromium process that died, from its minidump.
#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct NativeCrash {
    /// `main` for the app's own process, else Chromium's `ptype` (`renderer`,
    /// `gpu-process`, `utility`).
    pub process_type: String,
    /// The OS exception, such as `EXC_BAD_ACCESS / KERN_INVALID_ADDRESS`.
    pub exception: String,
    /// Chromium wrote the dump without crashing (a non-fatal report).
    pub dumped_without_crashing: bool,
    /// The crashing instruction, as hex.
    pub instruction_address: Option<String>,
    /// The module holding that instruction.
    pub module: Option<CrashModule>,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct CrashModule {
    /// File name only: the full path can name the user's home directory.
    pub name: String,
    /// Identifies the build to symbolicate against (the Mach-O UUID).
    pub debug_id: Option<String>,
    pub code_id: Option<String>,
    /// Load address, as hex.
    pub base_address: String,
    #[cfg_attr(test, specta(type = specta_typescript::Number))]
    pub size: u64,
    /// The instruction's offset into the module, as hex.
    pub offset: String,
}

/// A panic as written to disk by the hook.
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredPanic {
    timestamp_ms: u64,
    launch: Launch,
    os_version: Option<String>,
    arch: String,
    crash: PanicCrash,
}

type Claimed = HashMap<String, Vec<PathBuf>>;

/// A report found on disk, with the files the ack deletes.
struct Found {
    report: CrashReport,
    files: Vec<PathBuf>,
}

pub struct CrashReports {
    dir: PathBuf,
    crashpad_database: Option<PathBuf>,
    /// Reports offered in this process, so a second webview or a reloaded
    /// document is not handed them again. Unacked ones return next launch.
    claimed: Mutex<Claimed>,
}

impl CrashReports {
    fn new(dir: PathBuf, crashpad_database: Option<PathBuf>) -> Self {
        Self {
            dir,
            crashpad_database,
            claimed: Mutex::new(HashMap::new()),
        }
    }

    fn take(&self) -> Vec<CrashReport> {
        let Ok(mut claimed) = self.claimed.lock() else {
            return Vec::new();
        };
        let launches = read_launches(&self.dir);
        let mut found = self.find_panics(&claimed);
        found.extend(self.find_minidumps(&launches, &claimed));
        let mut found = fold_panic_aborts(found);
        found.sort_by_key(|found| found.report.timestamp_ms);
        found.truncate(MAX_REPORTS_PER_TAKE);
        found
            .into_iter()
            .map(|found| {
                claimed.insert(found.report.id.clone(), found.files);
                found.report
            })
            .collect()
    }

    fn ack(&self, ids: &[String]) {
        let Ok(claimed) = self.claimed.lock() else {
            return;
        };
        // Only files this process offered: an id is never turned into a path.
        for files in ids.iter().filter_map(|id| claimed.get(id)) {
            for file in files {
                let removed = if file.is_dir() {
                    fs::remove_dir_all(file)
                } else {
                    fs::remove_file(file)
                };
                if let Err(error) = removed
                    && error.kind() != std::io::ErrorKind::NotFound
                {
                    tracing::warn!(%error, "Failed to delete a sent crash report");
                }
            }
        }
    }

    fn find_panics(&self, claimed: &Claimed) -> Vec<Found> {
        let mut found = Vec::new();
        for path in files_in(&self.dir) {
            if file_id(&path, PANIC_PREFIX, "partial").is_some() {
                remove_abandoned(&path);
                continue;
            }
            let Some(id) = file_id(&path, PANIC_PREFIX, "json") else {
                continue;
            };
            if claimed.contains_key(&id) {
                continue;
            }
            match fs::read(&path).map(|bytes| serde_json::from_slice::<StoredPanic>(&bytes)) {
                Ok(Ok(stored)) => found.push(Found {
                    report: CrashReport {
                        id,
                        timestamp_ms: stored.timestamp_ms,
                        launch: Some(stored.launch),
                        os: std::env::consts::OS.to_string(),
                        os_version: stored.os_version,
                        arch: Some(stored.arch),
                        crash: Crash::Panic(stored.crash),
                    },
                    files: vec![path],
                }),
                // A record from another version, or cut short as the process
                // died. It cannot be reported, so don't keep offering it.
                Ok(Err(error)) => {
                    tracing::warn!(%error, "Discarding an unreadable panic report");
                    let _ = fs::remove_file(&path);
                }
                Err(error) => tracing::warn!(%error, "Failed to read a panic report"),
            }
        }
        found
    }

    #[cfg(any(feature = "cef", test))]
    fn find_minidumps(&self, launches: &[Launch], claimed: &Claimed) -> Vec<Found> {
        let Some(database) = &self.crashpad_database else {
            return Vec::new();
        };
        let mut found = Vec::new();
        for dir in CRASHPAD_REPORT_DIRS {
            for path in files_in(&database.join(dir)) {
                let Some(uuid) = path
                    .file_stem()
                    .and_then(|stem| stem.to_str())
                    .filter(|_| path.extension().is_some_and(|ext| ext == "dmp"))
                else {
                    continue;
                };
                let id = format!("{MINIDUMP_PREFIX}{uuid}");
                if claimed.contains_key(&id) {
                    continue;
                }
                let attachments = database.join("attachments").join(uuid);
                let dump = dump_signature::read(&path).unwrap_or_else(|error| {
                    tracing::warn!(%error, "Failed to read a minidump");
                    dump_signature::Dump::unreadable(modified_ms(&path))
                });
                found.push(Found {
                    report: dump.into_report(id, launches),
                    files: vec![path, attachments],
                });
            }
        }
        found
    }

    #[cfg(not(any(feature = "cef", test)))]
    fn find_minidumps(&self, _launches: &[Launch], _claimed: &Claimed) -> Vec<Found> {
        // Only the Chromium build writes minidumps.
        let _ = (
            &self.crashpad_database,
            CRASHPAD_REPORT_DIRS,
            MINIDUMP_PREFIX,
        );
        Vec::new()
    }
}

/// A panic on the main thread aborts the process when it unwinds into the
/// event loop, and Crashpad then writes a dump of the same crash. Report the
/// panic, which says more, and delete the dump with it.
fn fold_panic_aborts(found: Vec<Found>) -> Vec<Found> {
    let (mut kept, dumps): (Vec<_>, Vec<_>) = found
        .into_iter()
        .partition(|found| !matches!(&found.report.crash, Crash::Native(crash) if crash.process_type == "main"));
    for dump in dumps {
        // Minidump times have whole seconds; the panic is written first.
        let window = dump
            .report
            .timestamp_ms
            .saturating_sub(PANIC_ABORT_WINDOW_MS)
            ..=dump.report.timestamp_ms + 1000;
        let panic = kept.iter_mut().find(|found| {
            matches!(&found.report.crash, Crash::Panic(panic) if panic.thread.as_deref() == Some("main"))
                && window.contains(&found.report.timestamp_ms)
        });
        match panic {
            Some(panic) => panic.files.extend(dump.files),
            None => kept.push(dump),
        }
    }
    kept
}

/// A `.partial` left by a process killed between write and rename. A recent
/// one may still be in flight on another thread.
fn remove_abandoned(path: &Path) {
    let abandoned = fs::metadata(path)
        .and_then(|metadata| metadata.modified())
        .is_ok_and(|modified| modified.elapsed().is_ok_and(|age| age.as_secs() > 60));
    if abandoned {
        let _ = fs::remove_file(path);
    }
}

/// The launch running at `timestamp_ms`, which has whole seconds (a
/// minidump's time): the latest one started by the end of that second. When
/// that launch started within the second itself, the crash may belong to the
/// launch before it, so neither is named.
#[cfg(any(feature = "cef", test))]
fn launch_at(launches: &[Launch], timestamp_ms: u64) -> Option<Launch> {
    let second_end = timestamp_ms + 999;
    let latest = launches
        .iter()
        .filter(|launch| launch.started_at_ms <= second_end)
        .max_by_key(|launch| launch.started_at_ms)?;
    let ambiguous = latest.started_at_ms > timestamp_ms
        && launches
            .iter()
            .any(|launch| launch.started_at_ms < latest.started_at_ms);
    (!ambiguous).then(|| latest.clone())
}

fn files_in(dir: &Path) -> Vec<PathBuf> {
    fs::read_dir(dir)
        .map(|entries| {
            entries
                .filter_map(Result::ok)
                .map(|entry| entry.path())
                .filter(|path| path.is_file())
                .collect()
        })
        .unwrap_or_default()
}

/// `panic-<uuid>.json` → `panic-<uuid>`.
fn file_id(path: &Path, prefix: &str, extension: &str) -> Option<String> {
    if path.extension()? != extension {
        return None;
    }
    let stem = path.file_stem()?.to_str()?;
    stem.starts_with(prefix).then(|| stem.to_string())
}

#[cfg(any(feature = "cef", test))]
fn modified_ms(path: &Path) -> u64 {
    fs::metadata(path)
        .and_then(|metadata| metadata.modified())
        .map(unix_ms)
        .unwrap_or_else(|_| now_ms())
}

fn unix_ms(time: SystemTime) -> u64 {
    time.duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn now_ms() -> u64 {
    unix_ms(SystemTime::now())
}

fn read_launches(dir: &Path) -> Vec<Launch> {
    fs::read(dir.join(LAUNCHES_FILE))
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

fn record_launch(dir: &Path, launch: &Launch) -> std::io::Result<()> {
    let mut launches = read_launches(dir);
    launches.push(launch.clone());
    let excess = launches.len().saturating_sub(MAX_LAUNCHES);
    launches.drain(..excess);
    write_atomically(&dir.join(LAUNCHES_FILE), &serde_json::to_vec(&launches)?)
}

/// Write beside the target and rename, so a reader never sees half a file.
fn write_atomically(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let partial = path.with_extension("partial");
    fs::write(&partial, bytes)?;
    fs::rename(&partial, path)
}

/// Starts recording panics, and finds the crash reports of earlier launches.
/// Call first in setup: a panic before this is only printed.
pub fn setup<R: tauri::Runtime>(app: &tauri::App<R>) {
    let dir = match app.path().app_data_dir() {
        Ok(dir) => dir.join("crash-reports"),
        Err(error) => {
            tracing::warn!(%error, "Crash reports unavailable: no app data directory");
            return;
        }
    };
    if let Err(error) = fs::create_dir_all(&dir) {
        tracing::warn!(%error, "Crash reports unavailable");
        return;
    }
    let launch = Launch {
        started_at_ms: now_ms(),
        native_version: app.package_info().version.to_string(),
        native_build_time_ms: crate::get_native_build_time(),
    };
    if let Err(error) = record_launch(&dir, &launch) {
        tracing::warn!(%error, "Failed to record this launch for crash reports");
    }
    panic::install(
        dir.clone(),
        panic::Context {
            launch,
            os_version: Some(tauri_plugin_os::version().to_string()),
            redactions: scrub::Redactions::for_this_user(),
        },
    );
    // The CEF runtime's default `root_cache_path`, which Chromium also uses
    // as the Crashpad database (`tauri-runtime-cef`, `Cef::root_cache_path`).
    #[cfg(feature = "cef")]
    let crashpad_database = app.path().app_cache_dir().ok().map(|dir| dir.join("cef"));
    #[cfg(not(feature = "cef"))]
    let crashpad_database = None;
    app.manage(CrashReports::new(dir, crashpad_database));
}

/// Crash reports not yet sent, oldest first. Each is offered once per process.
/// Off the main thread: it reads every new dump.
#[tauri::command(async)]
pub fn take_native_crash_reports(state: tauri::State<'_, CrashReports>) -> Vec<CrashReport> {
    state.take()
}

/// Deletes the reports the frontend sent.
#[tauri::command(async)]
pub fn ack_native_crash_reports(state: tauri::State<'_, CrashReports>, ids: Vec<String>) {
    state.ack(&ids);
}
