//! Patched vs upstream loro-internal 1.17.1, seeded.
//!
//! LORO_DIFF_SEED=<n> replays one seed; LORO_DIFF_CASES, LORO_DIFF_LEN,
//! LORO_DIFF_BULK_CASES and LORO_DIFF_FIRST_SEED size the run.
//! LORO_DIFF_PROGRESS=1 prints each seed before it runs: an upstream panic
//! whose unwinding panics again aborts the process, and the last seed printed
//! names it. LORO_DIFF_UPSTREAM_FIRST=1 steps upstream first, to show such an
//! abort happens on upstream too.

use loro_editor_differential::{check, generate, generate_bulk, knob, Stats};

fn env(name: &str, default: u64) -> u64 {
    knob(name).and_then(|v| v.parse().ok()).unwrap_or(default)
}

fn report(label: &str, cases: u64, stats: &Stats, started: std::time::Instant) {
    eprintln!(
        "{label}: {cases} cases in {:.1?}: {stats:?}",
        started.elapsed()
    );
}

#[test]
fn random_scripts_match_upstream() {
    let started = std::time::Instant::now();
    let len = env("LORO_DIFF_LEN", 120) as usize;
    let seeds: Vec<u64> = match knob("LORO_DIFF_SEED").ok_or(()) {
        Ok(seed) => vec![seed.parse().expect("LORO_DIFF_SEED is a u64")],
        Err(_) => {
            let first = env("LORO_DIFF_FIRST_SEED", 0);
            (first..first + env("LORO_DIFF_CASES", 64)).collect()
        }
    };
    let mut stats = Stats::default();
    let progress = knob("LORO_DIFF_PROGRESS").is_some_and(|v| v == "1");
    for &seed in &seeds {
        if progress {
            eprintln!("case random {seed}");
        }
        if let Err(report) = check(&generate(seed, len, false), &mut stats) {
            panic!("{report}\nreplay: LORO_DIFF_SEED={seed} LORO_DIFF_LEN={len} cargo test --test differential random_scripts_match_upstream");
        }
    }
    report("random", seeds.len() as u64, &stats, started);
    assert!(
        stats.suppressed_commits > 0 || seeds.len() < 8,
        "suppressed path never taken: {stats:?}"
    );
    assert!(
        stats.projected_checkpoints > 0 || seeds.len() < 8,
        "projected checkpoint never taken: {stats:?}"
    );
}

#[test]
fn bulk_shallow_scripts_match_upstream() {
    let started = std::time::Instant::now();
    let len = env("LORO_DIFF_LEN", 120) as usize;
    let seeds: Vec<u64> = match knob("LORO_DIFF_BULK_SEED").ok_or(()) {
        Ok(seed) => vec![seed.parse().expect("LORO_DIFF_BULK_SEED is a u64")],
        Err(_) => {
            let first = env("LORO_DIFF_FIRST_SEED", 0);
            (first..first + env("LORO_DIFF_BULK_CASES", 4)).collect()
        }
    };
    let mut stats = Stats::default();
    let progress = knob("LORO_DIFF_PROGRESS").is_some_and(|v| v == "1");
    for &seed in &seeds {
        if progress {
            eprintln!("case bulk {seed}");
        }
        if let Err(report) = check(&generate_bulk(seed, len), &mut stats) {
            panic!("{report}\nreplay: LORO_DIFF_BULK_SEED={seed} LORO_DIFF_LEN={len} cargo test --test differential bulk_shallow_scripts_match_upstream");
        }
    }
    report("bulk", seeds.len() as u64, &stats, started);
    assert!(
        stats.cached_prefix_eligible > 0,
        "no cached-prefix-eligible shallow export: {stats:?}"
    );
}
