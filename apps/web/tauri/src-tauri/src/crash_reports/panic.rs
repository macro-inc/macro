//! The panic hook: writes each panic to `panic-<uuid>.json` before the
//! default hook prints it, so it survives the process dying.

use std::cell::Cell;
use std::fs;
use std::panic::PanicHookInfo;
use std::path::{Path, PathBuf};

use uuid::Uuid;

use super::scrub::{scrub_message, short_source_path};
use super::{Launch, PANIC_PREFIX, PanicCrash, PanicFrame, StoredPanic, now_ms, write_atomically};

/// Panic files kept unsent, so a panic loop cannot fill the disk.
const MAX_STORED_PANICS: usize = 20;
/// Frames kept, innermost first.
const MAX_FRAMES: usize = 64;
/// The app's own crates, for PostHog's in-app frames.
const APP_CRATES: &[&str] = &[
    "app",
    "app_lib",
    "graphql_cache_plugin",
    "logger",
    "macro_bundle_updater_plugin",
    "macro_desktop_cef",
    "navigation_plugin",
    "staged_upload_constants",
];

/// What every panic of this launch shares.
pub(super) struct Context {
    pub launch: Launch,
    pub os_version: Option<String>,
}

thread_local! {
    static IN_HOOK: Cell<bool> = const { Cell::new(false) };
}

pub(super) fn install(dir: PathBuf, context: Context) {
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        // A panic while recording a panic would recurse into this hook.
        let entered = IN_HOOK.try_with(|in_hook| !in_hook.replace(true));
        if entered == Ok(true) {
            if let Err(error) = record(&dir, &context, info) {
                eprintln!("Failed to record the panic for crash reporting: {error}");
            }
            let _ = IN_HOOK.try_with(|in_hook| in_hook.set(false));
        }
        previous(info);
    }));
}

fn record(dir: &Path, context: &Context, info: &PanicHookInfo<'_>) -> std::io::Result<()> {
    let stored = fs::read_dir(dir)?
        .filter_map(Result::ok)
        .filter(|entry| {
            entry
                .file_name()
                .to_string_lossy()
                .starts_with(PANIC_PREFIX)
        })
        .count();
    if stored >= MAX_STORED_PANICS {
        return Ok(());
    }
    let backtrace = std::backtrace::Backtrace::force_capture().to_string();
    let panic = StoredPanic {
        timestamp_ms: now_ms(),
        launch: context.launch.clone(),
        os_version: context.os_version.clone(),
        arch: std::env::consts::ARCH.to_string(),
        crash: PanicCrash {
            thread: std::thread::current().name().map(str::to_string),
            message: scrub_message(info.payload_as_str().unwrap_or("Box<dyn Any>")),
            location: info.location().map(|location| {
                format!(
                    "{}:{}:{}",
                    short_source_path(location.file()),
                    location.line(),
                    location.column()
                )
            }),
            frames: parse_backtrace(&backtrace),
        },
    };
    let path = dir.join(format!("{PANIC_PREFIX}{}.json", Uuid::new_v4()));
    write_atomically(&path, &serde_json::to_vec(&panic)?)
}

/// Frames from `std::backtrace::Backtrace`'s display, innermost first, without
/// the hook and panic machinery above the code that panicked or the runtime
/// below the thread's entry point.
pub(super) fn parse_backtrace(backtrace: &str) -> Vec<PanicFrame> {
    let mut frames: Vec<PanicFrame> = Vec::new();
    for line in backtrace.lines() {
        let line = line.trim_start();
        if let Some(location) = line.strip_prefix("at ") {
            if let Some(frame) = frames.last_mut() {
                let mut parts = location.rsplitn(3, ':');
                let (_column, line, file) = (parts.next(), parts.next(), parts.next());
                if let (Some(file), Some(line)) = (file, line.and_then(|line| line.parse().ok())) {
                    frame.file = Some(short_source_path(file));
                    frame.line = Some(line);
                }
            }
            continue;
        }
        let Some((index, function)) = line.split_once(": ") else {
            continue;
        };
        if index.is_empty() || !index.bytes().all(|byte| byte.is_ascii_digit()) {
            continue;
        }
        let function = strip_hash(function.trim());
        frames.push(PanicFrame {
            in_app: is_app_function(&function),
            function,
            file: None,
            line: None,
        });
    }
    // The panic starts at `rust_begin_unwind`; the `core::panicking` frames
    // after it are `unwrap`, `expect`, and the like.
    let start = frames
        .iter()
        .position(|frame| frame.function.ends_with("rust_begin_unwind"))
        .map(|unwind| {
            let mut start = unwind + 1;
            while frames
                .get(start)
                .is_some_and(|frame| frame.function.starts_with("core::panicking::"))
            {
                start += 1;
            }
            start
        })
        .unwrap_or(0);
    frames.drain(..start);
    if let Some(end) = frames
        .iter()
        .position(|frame| frame.function.contains("__rust_begin_short_backtrace"))
    {
        frames.truncate(end);
    }
    frames.truncate(MAX_FRAMES);
    frames
}

/// Legacy-mangled names can end in `::h<16 hex digits>`, which differs per build.
fn strip_hash(function: &str) -> String {
    match function.rsplit_once("::h") {
        Some((name, hash))
            if hash.len() == 16 && hash.bytes().all(|byte| byte.is_ascii_hexdigit()) =>
        {
            name.to_string()
        }
        _ => function.to_string(),
    }
}

fn is_app_function(function: &str) -> bool {
    let path = function.trim_start_matches('<');
    APP_CRATES.iter().any(|krate| {
        path.strip_prefix(krate)
            .is_some_and(|rest| rest.starts_with("::"))
    })
}
