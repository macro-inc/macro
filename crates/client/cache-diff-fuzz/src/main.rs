//! Differential fuzzer for the client cache: generates operation sequences
//! from a seed, drives the native host engine with them, and writes a trace
//! of every response and of the tables left on disk. Two builds of this
//! binary (before and after a change) given the same seed must write the
//! same trace; `fuzz.sh` runs both and compares.

mod dump;
mod exec;
mod faker;
mod malformed;
mod normalize;
mod probe;
mod rng;
mod sequence;

mod host {
    include!(concat!(env!("OUT_DIR"), "/host/mod.rs"));
}

use clap::Parser;
use serde_json::{Value, json};
use std::collections::BTreeMap;
use std::io::Write;
use std::path::{Path, PathBuf};

#[derive(Parser)]
#[command(about = "Differential fuzzer for the client cache engine")]
struct Args {
    /// First seed to run.
    #[arg(long)]
    seed: u64,
    /// Number of consecutive seeds to run.
    #[arg(long, default_value_t = 1)]
    count: u64,
    /// Ops per sequence; by default each seed picks 60 to 300.
    #[arg(long)]
    ops: Option<usize>,
    /// Where traces (`<seed>.trace`) and counters (`<seed>.stats.json`) go.
    #[arg(long)]
    out: PathBuf,
    /// Scratch space for the cache files, removed after each seed.
    #[arg(long)]
    work: PathBuf,
    /// The app's GraphQL schema (`static_assets/schema.graphql`).
    #[arg(long)]
    schema: PathBuf,
    /// Directory holding `docs.json` and `mail-tabs.json`.
    #[arg(long)]
    assets: PathBuf,
    /// Also write every normalized response and table row (`<seed>.full`).
    #[arg(long)]
    full: bool,
    /// Write the generated sequence as `<seed>.case.json` and stop.
    #[arg(long)]
    emit_case: bool,
    /// Run this case file (from `--emit-case`, possibly minimized) instead of generating.
    #[arg(long)]
    case: Option<PathBuf>,
    /// Keep the cache files after the run.
    #[arg(long)]
    keep: bool,
    /// Compare stored records by what they decode to, not by their bytes (see `dump::tables`).
    #[arg(long)]
    decoded_records: bool,
    /// Compare index document facts by what they hold, not by the table that holds them,
    /// and the storage schema version masked (see `dump::tables`).
    #[arg(long)]
    decoded_facts: bool,
    /// Compare the search index as one row per document (profile, bucket, text, time, hash),
    /// whichever tables hold it (see `dump::tables`).
    #[arg(long)]
    decoded_search: bool,
    /// Leave out stored rows whose COLUMN holds the text VALUE, in every table
    /// declaring that column (repeatable; see `dump::tables`): rows a change
    /// stores on purpose, such as a new derived sort fact (`attribute=NAME`) or
    /// its `meta` entry (`key=NAME`).
    #[arg(long, value_name = "COLUMN=VALUE", value_parser = ignore_rows)]
    ignore_rows: Vec<(String, String)>,
    /// Drop the sort fact NAME from the projections optimistic layers store
    /// (repeatable; see `dump::tables`): a new derived sort fact shows there too.
    #[arg(long, value_name = "NAME")]
    ignore_json_fact: Vec<String>,
    /// Compare responses without their `sourceHash` (an upgrade to a build that
    /// hashes records differently rehashes unchanged ones).
    #[arg(long)]
    mask_source_hashes: bool,
    /// Records the engine keeps decoded in its hot tier (the host's default when unset).
    #[arg(long)]
    hot_capacity: Option<u32>,
    /// Start from a copy of this cache directory (another build's, for an upgrade) instead of an empty one.
    #[arg(long)]
    start_from: Option<PathBuf>,
    /// Wait this many milliseconds (plus up to 30) in real time at each `idle`,
    /// `reopen` and `crash` op, so a host's own idle checkpoint runs, and races
    /// the reopen or crash after it.
    #[arg(long)]
    real_pause: Option<u64>,
    /// At `idle` ops, leave checkpointing to the host instead of calling its
    /// idle point.
    #[arg(long)]
    no_idle_hook: bool,
    /// Stage each hydrate before the op ahead of it and commit it at its own
    /// turn, as the browser host stages one between `prepareHydrate` and
    /// `commitHydrate` (a side built with STAGED_HYDRATE=1).
    #[arg(long)]
    stage_hydrates: bool,
    /// The share of hydrates (0 to 1) run with reads issued from other
    /// threads while they run. A read issued before the hydrate returned must
    /// answer as the state before it or after it, and one issued after it
    /// returned as the state after it, or the seed fails. Not compared: give it to both
    /// sides, so both read the same before and after.
    #[arg(long, default_value_t = 0.0, value_parser = share)]
    concurrent_reads: f64,
    /// The share of email threads (0 to 1) given 237 to 243 properties, each of
    /// its own definition, so their distinct attributes land around the predicate
    /// index's limit of 256 per document. A thread is wide or not by its id, and
    /// every copy of a wide thread carries the same properties.
    /// It changes the cases generated, so give it to both sides.
    #[arg(long, default_value_t = 0.0, value_parser = share)]
    wide_properties: f64,
    /// Fail the first open right after it commits migration step K, as a
    /// process killed there would, then open again (a side built with
    /// MIGRATION_HOOKS=1). Meant for a run that starts from an older build's
    /// file (`--start-from`, `UPGRADE`, a `CHAIN_*` segment).
    #[arg(long, value_name = "K", value_parser = clap::value_parser!(u32).range(1..))]
    interrupt_migration_after: Option<u32>,
    /// The share of reads, filters, searches and keyed reads (0 to 1) sent
    /// with a request id; some are abandoned while queued (see
    /// `exec::abandon`). Give it to both sides: a side whose host can't
    /// abandon reads runs them all. Abandoned answers are masked, and
    /// operations an abandon left registered broadly are masked out of
    /// `affectedOps`; `<seed>.broad` lists where, for `fuzz.sh` to check
    /// that the other side reported each of them too (not in `CHAIN_*` runs).
    #[arg(long, default_value_t = 0.0, value_parser = share)]
    abandon_reads: f64,
    /// The share of ops (0 to 1) run with the next record write armed to fail, as a
    /// database error would (a side built with STORAGE_FAULTS=1). Which ops is drawn from
    /// the seed apart from the case, so both sides arm the same ones and the case is
    /// unchanged. Stats count `fault.armed` and `fault.fired` (ops whose write failed).
    #[arg(long, default_value_t = 0.0, value_parser = share)]
    fail_writes: f64,
}

fn main() -> Result<(), rootcause::Report> {
    let mut args = Args::parse();
    // The host spawns background work (the idle checkpoint) on its async
    // runtime, a Tokio one; ops still run one at a time on this thread.
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_time()
        .build()?;
    let _runtime = runtime.enter();
    let sdl = std::fs::read_to_string(&args.schema)?;
    let faker = faker::Faker::new(&sdl)?;
    let sources: BTreeMap<String, String> =
        serde_json::from_str(&std::fs::read_to_string(args.assets.join("docs.json"))?)?;
    let tabs: serde_json::Map<String, Value> = serde_json::from_str(&std::fs::read_to_string(
        args.assets.join("mail-tabs.json"),
    )?)?;
    // Sorted, so the pick does not depend on whether serde_json keeps insertion order.
    let mut tabs: Vec<(String, Value)> = tabs.into_iter().collect();
    tabs.sort_by(|a, b| a.0.cmp(&b.0));
    let docs = sequence::load_docs(&faker, &sources)?;
    std::fs::create_dir_all(&args.out)?;
    // Each seed's work directory is removed before it runs, so a start inside
    // it would be deleted before it is copied. The copy reads the resolved
    // path checked here, not a link that a seed's cleanup could remove.
    if let Some(from) = &args.start_from {
        std::fs::create_dir_all(&args.work)?;
        let (from, work) = (from.canonicalize()?, args.work.canonicalize()?);
        if from.starts_with(&work) {
            return Err(rootcause::report!(
                "--start-from {} is inside --work {}",
                from.display(),
                work.display()
            ));
        }
        args.start_from = Some(from);
    }
    let end = args
        .seed
        .checked_add(args.count)
        .ok_or_else(|| rootcause::report!("--seed plus --count overflows u64"))?;
    for seed in args.seed..end {
        let generated = match &args.case {
            Some(path) => read_case(path)?,
            None => {
                let generator = sequence::Gen::new(&faker, &docs, &tabs, seed)
                    .wide_properties(args.wide_properties);
                let length = args
                    .ops
                    .unwrap_or_else(|| 60 + (rng::mix(seed, "length") % 241) as usize);
                generator.generate(length)
            }
        };
        if args.emit_case {
            let path = args.out.join(format!("{seed}.case.json"));
            std::fs::write(path, serde_json::to_vec(&generated)?)?;
            continue;
        }
        let work = args.work.join(seed.to_string());
        if work.exists() {
            std::fs::remove_dir_all(&work)?;
        }
        run(&args, seed, &sources, &generated, &work)?;
        if !args.keep {
            std::fs::remove_dir_all(&work)?;
        }
    }
    Ok(())
}

fn run(
    args: &Args,
    seed: u64,
    sources: &BTreeMap<String, String>,
    generated: &sequence::Generated,
    work: &Path,
) -> Result<(), rootcause::Report> {
    let mut trace = std::io::BufWriter::new(std::fs::File::create(
        args.out.join(format!("{seed}.trace")),
    )?);
    let mut full = match args.full {
        true => Some(std::io::BufWriter::new(std::fs::File::create(
            args.out.join(format!("{seed}.full")),
        )?)),
        false => None,
    };
    let started = std::time::Instant::now();
    if let Some(from) = &args.start_from {
        let db = work.join("db-0");
        std::fs::create_dir_all(&db)?;
        for entry in std::fs::read_dir(from)? {
            let entry = entry?;
            std::fs::copy(entry.path(), db.join(entry.file_name()))?;
        }
    }
    let mut exec = exec::Exec::new(
        sources,
        generated,
        work,
        match (args.decoded_records, args.mask_source_hashes) {
            (_, true) => normalize::SourceHashes::Masked,
            (true, false) => normalize::SourceHashes::Labelled,
            (false, false) => normalize::SourceHashes::Raw,
        },
        args.hot_capacity,
        args.interrupt_migration_after,
    )
    .map_err(|error| rootcause::report!("{error}"))?;
    exec.pause_ms = args.real_pause;
    exec.idle_hook = !args.no_idle_hook;
    exec.stage_hydrates = args.stage_hydrates;
    exec.concurrent_reads = args.concurrent_reads;
    exec.abandon_reads = args.abandon_reads;
    exec.fail_writes = (args.fail_writes, seed);
    if args.abandon_reads > 0.0 {
        exec.broad_out = Some(args.out.join(format!("{seed}.broad")));
    }
    let outcome = pollster::block_on(exec.run());
    let (lines, mut counters, path, mut normalizer) =
        exec.finish().map_err(|error| match &outcome {
            // The run's own failure is the one worth reporting.
            Err(cause) => rootcause::report!("{cause} (then: {error})"),
            Ok(()) => rootcause::report!("{error}"),
        })?;
    for line in &lines {
        let text = serde_json::to_string(&line.value)?;
        writeln!(
            trace,
            "{} {} {:016x}",
            line.index,
            line.kind,
            fnv(text.as_bytes())
        )?;
        if let Some(full) = &mut full {
            writeln!(full, "{} {} {text}", line.index, line.kind)?;
        }
    }
    if let Err(error) = &outcome {
        writeln!(trace, "abort {}", normalizer.text(error))?;
    }
    normalizer.freeze();
    let tables = dump::tables(
        &path,
        args.decoded_records,
        args.decoded_facts,
        args.decoded_search,
        &args.ignore_rows,
        &args.ignore_json_fact,
    )
    .map_err(|error| rootcause::report!("{error}"))?;
    for (table, rows) in tables {
        let rows: Vec<String> = rows.iter().map(|row| normalizer.text(row)).collect();
        let mut sorted = rows.clone();
        sorted.sort();
        let hash = fnv(sorted.join("\n").as_bytes());
        writeln!(trace, "dump {table} {} {hash:016x}", sorted.len())?;
        *counters.entry(format!("dump.rows.{table}")).or_default() += sorted.len() as u64;
        if let Some(full) = &mut full {
            for row in sorted {
                writeln!(full, "dump {table} {row}")?;
            }
        }
    }
    writeln!(trace, "end")?;
    trace.flush()?;
    if let Some(full) = &mut full {
        full.flush()?;
    }
    let mut kinds: BTreeMap<String, u64> = BTreeMap::new();
    for op in &generated.ops {
        let value = serde_json::to_value(op)?;
        let kind = value["op"].as_str().unwrap_or("?").to_owned();
        *kinds.entry(kind).or_default() += 1;
    }
    let stats = json!({
        "seed": seed,
        "ops": generated.ops.len(),
        "kinds": kinds,
        "counters": counters,
        "ms": started.elapsed().as_millis() as u64,
    });
    std::fs::write(
        args.out.join(format!("{seed}.stats.json")),
        serde_json::to_vec(&stats)?,
    )?;
    // A run that stopped early compared only a prefix: two builds that stop at
    // the same step would otherwise pass. The trace keeps where it stopped.
    outcome.map_err(|error| rootcause::report!("seed {seed} stopped early: {error}"))
}

/// `COLUMN=VALUE`, COLUMN of lowercase letters and `_`.
fn ignore_rows(text: &str) -> Result<(String, String), String> {
    match text.split_once('=') {
        Some((column, value))
            if !column.is_empty()
                && column
                    .bytes()
                    .all(|byte| byte.is_ascii_lowercase() || byte == b'_') =>
        {
            Ok((column.to_owned(), value.to_owned()))
        }
        _ => Err("expected COLUMN=VALUE, COLUMN of lowercase letters and `_`".to_owned()),
    }
}

/// A share from 0 to 1; NaN and anything outside fail to parse.
fn share(text: &str) -> Result<f64, String> {
    let value: f64 = text.parse().map_err(|error| format!("{error}"))?;
    if (0.0..=1.0).contains(&value) {
        Ok(value)
    } else {
        Err(format!("{value} is not between 0 and 1"))
    }
}

/// FNV-1a, so the hash is the same in every build.
fn fnv(bytes: &[u8]) -> u64 {
    bytes.iter().fold(0xcbf2_9ce4_8422_2325, |hash, byte| {
        (hash ^ u64::from(*byte)).wrapping_mul(0x0000_0100_0000_01b3)
    })
}

/// A case file. Filters nested to the engine's depth limits are deeper than
/// serde_json's default recursion limit, so it is lifted here.
fn read_case(path: &Path) -> Result<sequence::Generated, rootcause::Report> {
    let text = std::fs::read_to_string(path)?;
    let mut deserializer = serde_json::Deserializer::from_str(&text);
    deserializer.disable_recursion_limit();
    let generated = serde::Deserialize::deserialize(&mut deserializer)?;
    deserializer.end()?;
    Ok(generated)
}
