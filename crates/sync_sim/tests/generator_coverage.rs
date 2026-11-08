//! T0 coverage uses500 reproducible draws and observed paths, never requested faults.
use std::sync::atomic::{AtomicU64, Ordering};
use sync_sim::{RunStats, Sim, generate::*, invariants};

#[test]
fn generator_coverage() {
    let mut reached = [0u64; 16];
    let mut applied = 0;
    let mut skipped = 0;
    // Parallelism belongs only to this test host. Each world owns its clock,
    // RNG, storage and cores on one thread; every seed still runs every query.
    let next_seed = AtomicU64::new(0);
    let mut runs = std::thread::scope(|scope| {
        let workers = (0..4)
            .map(|_| {
                let next_seed = &next_seed;
                scope.spawn(move || {
                    std::iter::from_fn(|| {
                        let seed = next_seed.fetch_add(1, Ordering::Relaxed);
                        (seed < 500).then_some(seed)
                    })
                    .map(|seed| {
                        let draw = seeded_script(seed, ScriptShape::forms());
                        let (config, script) = draw.materialize(seed);
                        assert!(
                            script.len() <= 200,
                            "coverage seed{seed}: {} steps",
                            script.len()
                        );
                        let outcome = Sim::new(config).run(&script);
                        let failure = invariants::check_all(&outcome).err().map(|failures| {
                            format!(
                                "coverage seed{seed}: {failures:#?}\n{}",
                                outcome.failure_report()
                            )
                        });
                        (seed, outcome.stats, failure)
                    })
                    .collect::<Vec<_>>()
                })
            })
            .collect::<Vec<_>>();
        workers
            .into_iter()
            .flat_map(|worker| worker.join().expect("coverage worker panicked"))
            .collect::<Vec<_>>()
    });
    runs.sort_by_key(|(seed, _, _)| *seed);
    assert!(runs.iter().map(|(seed, _, _)| *seed).eq(0..500));
    let mut failures = Vec::new();
    for (_, stats, failure) in runs {
        if let Some(failure) = failure {
            failures.push(failure);
        }
        let stats: &RunStats = &stats;
        let paths = [
            stats.crashes > 0 || stats.profile_crashes > 0,
            stats.resets > 0,
            stats.pending_imports > 0,
            stats.adoptions > 0,
            stats.foreign_rows > 0,
            stats.gave_up > 0,
            stats.acks_lost > 0,
            stats.multi_frame_messages > 0,
            stats.access_changes > 0,
            stats.server_crashes > 0,
            stats.rebases > 0,
            stats.multi_edit_tab_profiles > 0,
            stats.parked_rows_at_end > 0,
            stats.late_commits_after_lock_release > 0,
            stats.d1_outages > 0 || stats.storage_outages > 0,
            stats.close_in_window > 0,
        ];
        for (count, hit) in reached.iter_mut().zip(paths) {
            *count += u64::from(hit);
        }
        applied += stats.ops_by_kind.values().sum::<u64>();
        skipped += stats.skipped_ops;
    }
    // S8 §9.1 T0 half-floors, rounded up across500 runs. Undo/backspace
    // floors need the explicitly deferred editor adapter and are not claimed.
    let names = [
        "crash",
        "reset",
        "pending",
        "adoption",
        "foreign",
        "gave_up",
        "lost_ack",
        "multi_frame",
        "access",
        "server_crash",
        "rebase",
        "multi_edit",
        "parked",
        "late_commit",
        "outage",
        "close_window",
    ];
    let floors = [50, 8, 25, 13, 13, 3, 25, 13, 5, 5, 25, 25, 5, 5, 8, 13];
    println!(
        "coverage: {:#?}",
        names.iter().zip(reached).collect::<Vec<_>>()
    );
    println!("skipped{skipped}/{}", applied + skipped);
    assert!(failures.is_empty(), "{}", failures.join("\n\n"));
    for ((name, count), floor) in names.iter().zip(reached).zip(floors) {
        assert!(count >= floor, "{name}: {count}/500, needs{floor}");
    }
    assert!(
        skipped * 100 <= (applied + skipped) * 15,
        "skipped{skipped}/{} exceeds15%",
        applied + skipped
    );
}
