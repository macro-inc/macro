//! Measures opening a retained production-size cache with a changed GraphQL
//! schema, in each tier, against reopening it unchanged and against the reset
//! every schema change cost before. Not a regular test: it needs a
//! cache-bench database and runs for minutes.

use crate::projection_inputs;
use cache_core::meta::{BUNDLED_SCHEMA_SDL, Schema, bundled_schema};
use cache_turso::{TursoFileDatabase, Unrecorded};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};

/// The scope the cache bench writes its databases under.
const BENCH_SCOPE: &str = "cache-bench";

fn copy_pair(from: &Path, to: &Path) {
    for suffix in ["", "-wal", "-shm"] {
        let companion = |path: &Path| PathBuf::from(format!("{}{suffix}", path.display()));
        let target = companion(to);
        if target.exists() {
            std::fs::remove_file(&target).unwrap();
        }
        if companion(from).exists() {
            std::fs::copy(companion(from), target).unwrap();
        }
    }
}

/// A `/proc` counter of this process.
fn proc_field(path: &str, name: &str) -> u64 {
    std::fs::read_to_string(path)
        .unwrap()
        .lines()
        .find_map(|line| line.strip_prefix(name))
        .unwrap()
        .trim()
        .trim_end_matches(" kB")
        .parse()
        .unwrap()
}

/// CPU time of the calling thread, which runs Turso's synchronous IO too,
/// and the time it waited for a CPU, which a loaded machine adds to the wall
/// time.
fn thread_cpu() -> (Duration, Duration) {
    let schedstat = std::fs::read_to_string("/proc/thread-self/schedstat").unwrap();
    let mut fields = schedstat
        .split_whitespace()
        .map(|field| Duration::from_nanos(field.parse().unwrap()));
    (fields.next().unwrap(), fields.next().unwrap())
}

/// The bundled schema with `declaration` added to `typename`.
fn added(typename: &str, declaration: &str) -> Arc<Schema> {
    let sdl = BUNDLED_SCHEMA_SDL;
    let start = sdl.find(&format!("\ntype {typename} ")).unwrap();
    let open = start + sdl[start..].find("{\n").unwrap() + 2;
    changed(format!("{}\t{declaration}\n{}", &sdl[..open], &sdl[open..]))
}

/// The bundled schema with `field` of `typename` declared as `declared`.
fn retyped(typename: &str, field: &str, declared: &str) -> Arc<Schema> {
    let sdl = BUNDLED_SCHEMA_SDL;
    let start = sdl.find(&format!("\ntype {typename} ")).unwrap();
    let end = start + sdl[start..].find("\n}").unwrap();
    let line = sdl[start..end]
        .lines()
        .find(|line| line.starts_with(&format!("\t{field}:")))
        .unwrap();
    let at = start + sdl[start..end].find(line).unwrap();
    changed(format!(
        "{}\t{field}: {declared}{}",
        &sdl[..at],
        &sdl[at + line.len()..]
    ))
}

/// The bundled schema with its query root renamed.
fn query_root_renamed() -> Arc<Schema> {
    changed(BUNDLED_SCHEMA_SDL.replace("SoupQueryRoot", "SoupQueryRootRenamed"))
}

fn changed(sdl: String) -> Arc<Schema> {
    let schema = Schema::from_sdl(&sdl).unwrap();
    assert_ne!(schema.hash(), bundled_schema().hash());
    schema
}

/// What an open cost.
struct Cost {
    elapsed: Duration,
    cpu: Duration,
    waited: Duration,
    written: u64,
    peak: u64,
}

impl std::fmt::Display for Cost {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            formatter,
            "{:.1} ms (cpu {:.1} ms, waited for a cpu {:.1} ms, {} B written, peak {} KiB)",
            self.elapsed.as_secs_f64() * 1e3,
            self.cpu.as_secs_f64() * 1e3,
            self.waited.as_secs_f64() * 1e3,
            self.written,
            self.peak,
        )
    }
}

fn measured<T>(run: impl FnOnce() -> T) -> (T, Cost) {
    // Writing 5 resets the peak resident set to the current one.
    std::fs::write("/proc/self/clear_refs", "5").unwrap();
    let written = proc_field("/proc/self/io", "wchar: ");
    let (cpu, waited) = thread_cpu();
    let started = Instant::now();
    let value = run();
    let (cpu_after, waited_after) = thread_cpu();
    let cost = Cost {
        elapsed: started.elapsed(),
        cpu: cpu_after - cpu,
        waited: waited_after - waited,
        written: proc_field("/proc/self/io", "wchar: ") - written,
        peak: proc_field("/proc/self/status", "VmHWM:"),
    };
    (value, cost)
}

/// Opens `path`, brings it to `schema`, and says what the open and the
/// adoption each cost and what the adoption did.
fn timed_open(path: &Path, schema: &Arc<Schema>, unrecorded: Unrecorded) -> String {
    let inputs = projection_inputs();
    let database = TursoFileDatabase::new(path).unwrap();
    let (storage, open) = measured(|| database.open(BENCH_SCOPE).unwrap());
    let (adoption, adopt) = measured(|| storage.adopt_schema(schema, &inputs, unrecorded).unwrap());
    storage.try_close().unwrap();
    format!(
        "open {open}; adopt {adopt} {} dropped {} incomplete {} retired {} {:?}",
        adoption.outcome(),
        adoption.dropped_records,
        adoption.incomplete_documents,
        adoption.retired_overlays,
        adoption.change,
    )
}

/// What every schema change cost before the cache stored its schema: a
/// physical reset, then opening the empty file and storing the schema.
fn timed_reset(path: &Path, schema: &Arc<Schema>) -> String {
    let inputs = projection_inputs();
    let database = TursoFileDatabase::new(path).unwrap();
    let (storage, cost) = measured(|| {
        database.physical_reset().unwrap();
        let storage = database.open(BENCH_SCOPE).unwrap();
        storage
            .adopt_schema(schema, &inputs, Unrecorded::Guess)
            .unwrap();
        storage
    });
    storage.try_close().unwrap();
    format!("reset and open {cost}")
}

#[test]
#[ignore = "needs CACHE_SCHEMA_DB=<a cache-bench database>; run in release with --ignored --nocapture"]
fn schema_change_cost_on_a_retained_cache() {
    let Some(source) = std::env::var_os("CACHE_SCHEMA_DB").map(PathBuf::from) else {
        return;
    };
    let runs: usize = std::env::var_os("CACHE_SCHEMA_RUNS")
        .and_then(|runs| runs.to_str()?.parse().ok())
        .unwrap_or(3);
    let directory = tempfile::tempdir_in(source.parent().unwrap()).unwrap();
    let stored = directory.path().join("stored.turso");
    let live = directory.path().join("live.turso");
    // The first open upgrades the bench file to this storage version and
    // stores the bundled schema, as a build of this one would have.
    copy_pair(&source, &stored);
    eprintln!(
        "first open, storing the schema: {}",
        timed_open(
            &stored,
            &bundled_schema(),
            Unrecorded::Known(bundled_schema())
        )
    );
    // CACHE_SCHEMA_OUT=<file> keeps that database, which the browser
    // measurement (cache-wasm's `schema_cost`) opens.
    if let Some(out) = std::env::var_os("CACHE_SCHEMA_OUT").map(PathBuf::from) {
        copy_pair(&stored, &out);
    }
    let message = "GraphqlSoupEmailMessage";
    let thread = "GraphqlSoupEmailThread";
    let cases = [
        ("unchanged", bundled_schema()),
        (
            "a message field added",
            added(message, "cacheCostProbe: String"),
        ),
        (
            "message bodyText to Int",
            retyped(message, "bodyText", "Int"),
        ),
        (
            "thread isRead to String! (Mail facts read it)",
            retyped(thread, "isRead", "String!"),
        ),
        (
            "notification state to Int (every document's facts read it)",
            retyped("GraphqlNotification", "state", "Int"),
        ),
        ("query root renamed", query_root_renamed()),
    ];
    // CACHE_SCHEMA_CASE=<words> runs only the cases whose name holds them.
    let only = std::env::var_os("CACHE_SCHEMA_CASE").and_then(|only| only.into_string().ok());
    let selected = |name: &str| {
        only.as_ref()
            .is_none_or(|only| name.contains(only.as_str()))
    };
    for run in 1..=runs {
        for (name, schema) in &cases {
            if !selected(name) {
                continue;
            }
            copy_pair(&stored, &live);
            let open = timed_open(&live, schema, Unrecorded::Guess);
            let reopen = timed_open(&live, schema, Unrecorded::Guess);
            eprintln!("run {run} {name}: {open}; reopen {reopen}");
        }
        if selected("reset") {
            copy_pair(&stored, &live);
            eprintln!(
                "run {run} reset: {}",
                timed_reset(&live, &query_root_renamed())
            );
        }
    }
}
