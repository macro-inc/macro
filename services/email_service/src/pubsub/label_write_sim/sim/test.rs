//! The seeded simulation. The smoke test runs a fixed set of seeds; the
//! ignored shards run more, configured by environment variables:
//!
//! ```text
//! SIM_SEEDS=4000 SIM_STEPS=30 SIM_OVERLAP=0 SIM_OUT=/tmp/sim-1.txt \
//!   cargo test -p email_service --lib label_write_sim::sim::test::randomized_shard_1 \
//!   -- --exact --ignored --nocapture
//! ```
//!
//! `SIM_OVERLAP=1` holds one operation at its Gmail call while 1–3 other
//! steps run. `SIM_BATCHES=1` has producers send label write batches instead
//! of one operation per message. `SIM_NO_REJECT=1` turns permanent Gmail rejections into 503s.
//! `SIM_START` picks the first seed, `SIM_TRACE=1` prints every seed's trace
//! and `SIM_VERBOSE=1` the traces of violating seeds.

use super::super::world::World;
use super::{Config, Sim, Stats};
use sqlx::PgPool;
use std::collections::BTreeMap;
use std::fmt::Write as _;

fn env_number(name: &str, default: u64) -> u64 {
    std::env::var(name)
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(default)
}

#[derive(Default)]
struct Summary {
    seeds: u64,
    clean: u64,
    by_invariant: BTreeMap<String, u64>,
    by_step: BTreeMap<String, u64>,
    examples: BTreeMap<String, Vec<(u64, String)>>,
    violating: Vec<String>,
    stats: Stats,
    lost_cell_seeds: u64,
}

impl Summary {
    fn add(&mut self, seed: u64, sim: &Sim<'_>) {
        self.seeds += 1;
        let stats = &sim.stats;
        let total = &mut self.stats;
        total.actions += stats.actions;
        total.failed_actions += stats.failed_actions;
        total.deliveries += stats.deliveries;
        total.syncs += stats.syncs;
        total.resyncs += stats.resyncs;
        total.gmail_writes += stats.gmail_writes;
        total.gmail_429 += stats.gmail_429;
        total.gmail_5xx += stats.gmail_5xx;
        total.gmail_400 += stats.gmail_400;
        total.skipped_superseded += stats.skipped_superseded;
        total.transient_stale_applies += stats.transient_stale_applies;
        total.dead_letters += stats.dead_letters;
        total.overlaps += stats.overlaps;
        total.expiries += stats.expiries;
        if !sim.lost_cells.is_empty() {
            self.lost_cell_seeds += 1;
        }
        let Some(first) = sim.violations.first() else {
            self.clean += 1;
            return;
        };
        *self
            .by_invariant
            .entry(first.invariant.to_string())
            .or_default() += 1;
        *self
            .by_step
            .entry(format!("{} after {}", first.invariant, first.step_kind()))
            .or_default() += 1;
        let detail: String = first.detail.chars().take(240).collect();
        self.violating.push(format!(
            "seed {seed} [{}] step {}: {detail}",
            first.invariant, first.step
        ));
        let examples = self
            .examples
            .entry(first.invariant.to_string())
            .or_default();
        if examples.len() < 3 {
            examples.push((seed, sim.report()));
        }
    }

    fn render(&self, config: Config, start: u64) -> String {
        let mut out = String::new();
        let _ = writeln!(
            out,
            "seeds={}..{} steps={} overlap={} batches={} clean={} violating={}",
            start,
            start + self.seeds,
            config.steps,
            config.overlap,
            config.label_write_batches,
            self.clean,
            self.seeds - self.clean
        );
        let _ = writeln!(out, "stats: {:?}", self.stats);
        let _ = writeln!(
            out,
            "seeds with a dead-lettered write: {}",
            self.lost_cell_seeds
        );
        for (invariant, count) in &self.by_invariant {
            let _ = writeln!(out, "first violation {invariant}: {count} seeds");
        }
        for (key, count) in &self.by_step {
            let _ = writeln!(out, "  {key}: {count}");
        }
        let _ = writeln!(out, "all violating seeds:");
        for line in &self.violating {
            let _ = writeln!(out, "  {line}");
        }
        for (invariant, examples) in &self.examples {
            for (seed, report) in examples {
                let _ = writeln!(out, "--- example {invariant} seed {seed}\n{report}");
            }
        }
        out
    }
}

async fn run_seeds(pool: PgPool, shard: u32, start: u64, seeds: u64, config: Config) -> Summary {
    let mut world = World::new(pool, shard, config.label_write_batches).await;
    let mut summary = Summary::default();
    for seed in start..start + seeds {
        world.reset().await;
        let mut sim = Sim::new(&mut world, seed);
        sim.run(config).await;
        summary.add(seed, &sim);
        if std::env::var("SIM_TRACE").is_ok()
            || (std::env::var("SIM_VERBOSE").is_ok() && !sim.violations.is_empty())
        {
            println!("seed {seed}:\n{}", sim.report());
        }
    }
    summary
}

async fn fifty_random_seeds(pool: PgPool, shard: u32, label_write_batches: bool) {
    let config = Config {
        steps: 30,
        overlap: false,
        label_write_batches,
    };
    let summary = run_seeds(pool, shard, 1_000_000, 50, config).await;
    assert_eq!(
        summary.clean,
        summary.seeds,
        "{}",
        summary.render(config, 1_000_000)
    );
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn fifty_random_seeds_keep_gmail_the_database_and_the_user_in_agreement(pool: PgPool) {
    fifty_random_seeds(pool, 50, false).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn fifty_random_seeds_agree_with_label_write_batches(pool: PgPool) {
    fifty_random_seeds(pool, 51, true).await;
}

async fn run_shard(pool: PgPool, shard: u32) {
    let seeds = env_number("SIM_SEEDS", 50);
    let start = env_number("SIM_START", u64::from(shard) * 1_000_000);
    let config = Config {
        steps: env_number("SIM_STEPS", 30) as usize,
        overlap: env_number("SIM_OVERLAP", 0) == 1,
        label_write_batches: env_number("SIM_BATCHES", 0) == 1,
    };
    let started = std::time::Instant::now();
    let summary = run_seeds(pool, shard, start, seeds, config).await;
    let rendered = summary.render(config, start);
    println!("{rendered}elapsed={:?}", started.elapsed());
    if let Ok(path) = std::env::var("SIM_OUT") {
        std::fs::write(path, &rendered).unwrap();
    }
}

// One test per shard: sqlx names each test's database after the test, so
// parallel processes need different tests.
#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
#[ignore = "seeded simulation, configured by SIM_* environment variables"]
async fn randomized_shard_1(pool: PgPool) {
    run_shard(pool, 1).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
#[ignore = "seeded simulation, configured by SIM_* environment variables"]
async fn randomized_shard_2(pool: PgPool) {
    run_shard(pool, 2).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
#[ignore = "seeded simulation, configured by SIM_* environment variables"]
async fn randomized_shard_3(pool: PgPool) {
    run_shard(pool, 3).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
#[ignore = "seeded simulation, configured by SIM_* environment variables"]
async fn randomized_shard_4(pool: PgPool) {
    run_shard(pool, 4).await;
}
