//! T0 randomized sessions: independent host runners retain ordinary shrinking.
use proptest::prelude::*;
use proptest::test_runner::{Config, FileFailurePersistence, RngSeed, TestRunner};
use sync_sim::{Sim, generate::*, invariants};

#[path = "generator_coverage.rs"]
mod coverage;

#[test]
fn random_sessions_converge() {
    let base = Config::default();
    let total = base.cases;
    let counts = std::array::from_fn::<_, 4, _>(|shard| {
        total / 4 + u32::from(u32::try_from(shard).unwrap() < total % 4)
    });
    assert_eq!(counts.iter().sum::<u32>(), total);
    let persistence = [
        "regressions",
        "regressions-1",
        "regressions-2",
        "regressions-3",
    ];
    let results = std::thread::scope(|scope| {
        let workers = counts
            .into_iter()
            .enumerate()
            .map(|(shard, cases)| {
                let mut config = Config {
                    cases,
                    max_shrink_iters: 8_192,
                    source_file: Some(concat!(
                        env!("CARGO_MANIFEST_DIR"),
                        "/tests/random_sessions.rs"
                    )),
                    test_name: Some("random_sessions_converge"),
                    failure_persistence: Some(Box::new(FileFailurePersistence::WithSource(
                        persistence[shard],
                    ))),
                    ..base.clone()
                };
                if let RngSeed::Fixed(master) = base.rng_seed {
                    config.rng_seed = RngSeed::Fixed(
                        master.wrapping_add(
                            u64::try_from(shard)
                                .unwrap()
                                .wrapping_mul(0x9e37_79b9_7f4a_7c15),
                        ),
                    );
                }
                scope.spawn(move || {
                    eprintln!(
                        "proptest shard{shard}: {cases}/{total} cases; RNG {:?}",
                        config.rng_seed
                    );
                    if cases == 0 {
                        return Ok(());
                    }
                    let mut runner = TestRunner::new(config);
                    let result = runner.run(
                        &(any::<u64>(), script_strategy(ScriptShape::forms())),
                        |(seed, draw)| {
                            let (config, script) = draw.materialize(seed);
                            prop_assert!(script.len() <= 200, "{} steps", script.len());
                            let outcome = Sim::new(config).run(&script);
                            if let Err(failures) = invariants::check_all(&outcome) {
                                static FIRST_FAILURE: std::sync::Once = std::sync::Once::new();
                                FIRST_FAILURE.call_once(|| {
                                    eprintln!(
                                        "Initial failing world before shrinking: {failures:#?}\n{}",
                                        outcome.failure_report()
                                    );
                                });
                                return Err(TestCaseError::fail(format!(
                                    "{failures:#?}\n{}",
                                    outcome.failure_report()
                                )));
                            }
                            if seed % 16 == 0
                                && let Err(error) = outcome.check_replay()
                            {
                                return Err(TestCaseError::fail(format!(
                                    "{error:#?}\n{}",
                                    outcome.failure_report()
                                )));
                            }
                            Ok(())
                        },
                    );
                    result.map_err(|error| format!("proptest shard{shard}: {error}"))
                })
            })
            .collect::<Vec<_>>();
        workers
            .into_iter()
            .map(|worker| worker.join().expect("proptest host panicked"))
            .collect::<Vec<_>>()
    });
    let failures = results
        .into_iter()
        .filter_map(Result::err)
        .collect::<Vec<_>>();
    assert!(failures.is_empty(), "{}", failures.join("\n\n"));
}
