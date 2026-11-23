//! Measures the first open of a retained production-size cache that a storage
//! 11 build left, against an ordinary reopen of the same cache, and splits it
//! into the 11 to 12 step and each derived rebuild that open also runs. Not a
//! regular test: it needs a file and runs for minutes.
use super::*;
use crate::storage::migration::test_hooks::{self, Storage11DerivedState};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

/// The scope the cache bench writes its databases under.
const BENCH_SCOPE: &str = "cache-bench";

fn copy_pair(from: &Path, to: &Path) {
    for suffix in COMPANION_SUFFIXES {
        let target = companion_path(to, suffix);
        if target.exists() {
            std::fs::remove_file(&target).unwrap();
        }
        let source = companion_path(from, suffix);
        if source.exists() {
            std::fs::copy(source, target).unwrap();
        }
    }
}

/// Bytes this process has written through `write(2)` so far.
fn written_bytes() -> u64 {
    std::fs::read_to_string("/proc/self/io")
        .unwrap()
        .lines()
        .find_map(|line| line.strip_prefix("wchar: "))
        .unwrap()
        .trim()
        .parse()
        .unwrap()
}

fn count(connection: &Db, sql: &str) -> i64 {
    required_i64(&driver::query(connection, sql, vec![]).unwrap()[0], 0).unwrap()
}

/// CPU time of the calling thread, which runs Turso's synchronous IO too.
fn thread_cpu() -> Duration {
    let schedstat = std::fs::read_to_string("/proc/thread-self/schedstat").unwrap();
    Duration::from_nanos(
        schedstat
            .split_whitespace()
            .next()
            .unwrap()
            .parse()
            .unwrap(),
    )
}

/// The process's peak resident memory since the last reset, in KiB.
fn peak_resident_kib() -> u64 {
    std::fs::read_to_string("/proc/self/status")
        .unwrap()
        .lines()
        .find_map(|line| line.strip_prefix("VmHWM:"))
        .unwrap()
        .trim()
        .trim_end_matches(" kB")
        .parse()
        .unwrap()
}

struct OpenCost {
    elapsed: Duration,
    cpu: Duration,
    written: u64,
    /// Peak resident memory during the open, in KiB.
    peak_kib: u64,
}

impl std::fmt::Display for OpenCost {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "{:.1} ms (cpu {:.1} ms, {} B written, peak {} KiB)",
            self.elapsed.as_secs_f64() * 1e3,
            self.cpu.as_secs_f64() * 1e3,
            self.written,
            self.peak_kib,
        )
    }
}

fn timed_open(database: &TursoFileDatabase) -> OpenCost {
    // Writing 5 resets the peak resident set to the current one.
    std::fs::write("/proc/self/clear_refs", "5").unwrap();
    let written = written_bytes();
    let cpu = thread_cpu();
    let started = Instant::now();
    let storage = database.open(BENCH_SCOPE).unwrap();
    let cost = OpenCost {
        elapsed: started.elapsed(),
        cpu: thread_cpu() - cpu,
        written: written_bytes() - written,
        peak_kib: peak_resident_kib(),
    };
    storage.try_close().unwrap();
    cost
}

fn file_bytes(path: &Path) -> u64 {
    COMPANION_SUFFIXES
        .iter()
        .map(|suffix| {
            std::fs::metadata(companion_path(path, suffix)).map_or(0, |metadata| metadata.len())
        })
        .sum()
}

#[test]
#[ignore = "needs CACHE_MIGRATION_DB=<a cache-bench database> (CACHE_MIGRATION_OUT=<dir> keeps the shapes the browser measurement loads); run in release with --ignored --nocapture"]
fn upgrade_cost_on_a_retained_cache() {
    let Some(source) = std::env::var_os("CACHE_MIGRATION_DB").map(PathBuf::from) else {
        return;
    };
    let runs: usize = std::env::var_os("CACHE_MIGRATION_RUNS")
        .and_then(|runs| runs.to_str()?.parse().ok())
        .unwrap_or(5);
    let directory = tempfile::tempdir_in(source.parent().unwrap()).unwrap();
    let current = directory.path().join("current.turso");
    let older = directory.path().join("older.turso");
    let live = directory.path().join("live.turso");

    copy_pair(&source, &current);
    let storage = TursoFileDatabase::new(&current)
        .unwrap()
        .open(BENCH_SCOPE)
        .unwrap();
    let connection = storage.connection();
    let contacts = count(
        &connection,
        "SELECT count(*) FROM records WHERE __typename = 'GraphqlContact'",
    );
    let contact_bytes = count(
        &connection,
        "SELECT coalesce(sum(length(value)), 0) FROM records WHERE __typename = 'GraphqlContact'",
    );
    let records = count(&connection, "SELECT count(*) FROM records");
    let documents = count(&connection, "SELECT count(*) FROM search_documents");
    let queued = count(&connection, "SELECT count(*) FROM mutation_queue");
    drop(connection);
    storage.try_close().unwrap();
    let rewrite = |path: &Path, change: &dyn Fn(&mut TursoStorage)| {
        copy_pair(&current, path);
        let mut storage = TursoFileDatabase::new(path)
            .unwrap()
            .open(BENCH_SCOPE)
            .unwrap();
        change(&mut storage);
        storage.try_close().unwrap();
    };
    rewrite(&older, &|storage| {
        test_hooks::rewrite_as_storage_11(storage).unwrap();
    });
    // The same derived state at storage 12, all of it and one part at a time,
    // so each rebuild's cost is its open's difference from a reopen.
    let derived = directory.path().join("derived.turso");
    rewrite(&derived, &|storage| {
        for part in Storage11DerivedState::ALL {
            test_hooks::rewind_derived_state(storage, part).unwrap();
        }
    });
    let parts = Storage11DerivedState::ALL.map(|part| {
        let path = directory.path().join(format!("{part:?}.turso"));
        rewrite(&path, &|storage| {
            test_hooks::rewind_derived_state(storage, part).unwrap();
        });
        (part, path)
    });
    eprintln!(
        "{}: {} bytes, {records} records, {contacts} contacts ({contact_bytes} payload bytes), \
         {documents} search documents, {queued} queued writes",
        source.display(),
        file_bytes(&current),
    );
    // The browser measurement in cache-wasm loads these over HTTP.
    if let Some(out) = std::env::var_os("CACHE_MIGRATION_OUT").map(PathBuf::from) {
        std::fs::create_dir_all(&out).unwrap();
        copy_pair(&current, &out.join("current.turso"));
        copy_pair(&older, &out.join("older.turso"));
        copy_pair(&derived, &out.join("derived.turso"));
    }

    let database = TursoFileDatabase::new(&live).unwrap();
    for run in 1..=runs {
        copy_pair(&current, &live);
        let reopen = timed_open(&database);
        copy_pair(&older, &live);
        let upgrade = timed_open(&database);
        let after = timed_open(&database);
        eprintln!(
            "run {run}: reopen at 12 {reopen}; open at 11 with upgrade {upgrade}; \
             reopen after upgrade {after}; file after upgrade {} B",
            file_bytes(&live),
        );
        copy_pair(&derived, &live);
        let rebuilds = timed_open(&database);
        let each = parts
            .iter()
            .map(|(part, path)| {
                copy_pair(path, &live);
                format!("{part:?} {}", timed_open(&database))
            })
            .collect::<Vec<_>>();
        eprintln!(
            "run {run} derived rebuilds at 12: all {rebuilds}; {}",
            each.join("; "),
        );
        let phases = step_phases(&older, &live)
            .into_iter()
            .map(|(name, elapsed)| format!("{name} {:.1} ms", elapsed.as_secs_f64() * 1e3))
            .collect::<Vec<_>>();
        eprintln!(
            "run {run} step DDL and commit (without the version write and \
             frozen-schema check the upgrade adds): {}",
            phases.join(", ")
        );
    }
}

/// Each DDL statement of the 11 to 12 step, timed inside one write
/// transaction as the runner runs it, then the commit. It leaves out what the
/// runner adds before that commit, the `storage_schema_version` write and the
/// frozen-schema check, so it splits up the DDL, not the whole upgrade, which
/// `timed_open` times.
fn step_phases(older: &Path, live: &Path) -> Vec<(String, Duration)> {
    copy_pair(older, live);
    let io: Arc<dyn IO> = Arc::new(PlatformIO::new().unwrap());
    let database = Database::open(
        io,
        live.to_str().unwrap(),
        OpenOptions::new(Arc::new(SqliteDialect)),
    )
    .unwrap();
    let connection = Db::uncached(database.connect().unwrap());
    let mut phases = Vec::new();
    driver::execute(&connection, "BEGIN IMMEDIATE", vec![]).unwrap();
    for sql in crate::storage::migration::UPGRADE_11_TO_12 {
        let started = Instant::now();
        driver::execute(&connection, sql, vec![]).unwrap();
        let name = sql.split(" ON ").next().unwrap_or(sql).to_owned();
        phases.push((name, started.elapsed()));
    }
    let started = Instant::now();
    driver::execute(&connection, "COMMIT", vec![]).unwrap();
    phases.push(("COMMIT".to_owned(), started.elapsed()));
    connection.close().unwrap();
    phases
}
