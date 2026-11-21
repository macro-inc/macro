//! Times the browser's carry-forward and the first open of a storage 11 cache
//! on a retained production-size cache against an ordinary reopen of the same
//! cache, and the derived rebuilds that open runs alone. It needs the
//! databases that cache-turso's `upgrade_cost_on_a_retained_cache` keeps
//! (`CACHE_MIGRATION_OUT`), served with CORS under the URL compiled in as
//! `CACHE_MIGRATION_URL`.
use super::*;

/// The scope the cache bench writes its databases under.
const BENCH_SCOPE: &str = "cache-bench";
const RUNS: usize = 3;

/// Writes the body at `url` into the OPFS file `file`, or leaves it empty when
/// the server has none. Returns the bytes written.
async fn load_opfs_file(url: &str, file: &str) -> f64 {
    run_js(
        "return (async () => {
          const [url, file] = JSON.parse(name);
          const root = await navigator.storage.getDirectory();
          const handle = await root.getFileHandle(file, { create: true });
          const access = await handle.createSyncAccessHandle();
          try {
            access.truncate(0);
            const response = await fetch(url);
            let at = 0;
            if (response.ok) {
              const reader = response.body.getReader();
              for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                at += access.write(value, { at });
              }
            }
            access.flush();
            return at;
          } finally {
            access.close();
          }
        })()",
        &serde_json::json!([url, file]).to_string(),
    )
    .await
    .as_f64()
    .expect("bytes written")
}

async fn load_pair(base: &str, source: &str, identity: &str) -> f64 {
    load_opfs_file(&format!("{base}/{source}"), identity).await
        + load_opfs_file(&format!("{base}/{source}-wal"), &format!("{identity}-wal")).await
}

async fn now_ms() -> f64 {
    run_js("return Promise.resolve(performance.now())", "")
        .await
        .as_f64()
        .expect("a clock reading")
}

async fn timed_open() -> (f64, OpenReport) {
    let started = now_ms().await;
    let (engine, report) = open_cache_inner(BENCH_SCOPE.into(), None, false, None, false)
        .await
        .expect("the bench database opens");
    let elapsed = now_ms().await - started;
    resolved(engine.close()).await;
    (elapsed, report)
}

#[wasm_bindgen_test(async)]
#[ignore = "needs CACHE_MIGRATION_URL at build time; run with --include-ignored --nocapture"]
async fn carry_forward_and_upgrade_cost_on_a_retained_cache() {
    let Some(base) = option_env!("CACHE_MIGRATION_URL") else {
        return;
    };
    let own = database_identity(BENCH_SCOPE);
    let older = cache_database_name(BENCH_SCOPE, 11);
    let moved = Some(CarryForward::new(CarryForwardKind::Moved, 11));
    for run in 1..=RUNS {
        for identity in [&own, &older] {
            remove_opfs_pair(identity).await;
        }
        let bytes = load_pair(base, "current.turso", &own).await;
        let (reopen, report) = timed_open().await;
        assert_eq!(
            report,
            OpenReport {
                outcome: CacheOpenOutcome::OpenedExisting,
                carry_forward: None,
            }
        );

        // The same storage 12 database under the storage 11 name: the move
        // alone, with nothing to upgrade.
        remove_opfs_pair(&own).await;
        load_pair(base, "current.turso", &older).await;
        let (move_only, report) = timed_open().await;
        assert_eq!(
            report,
            OpenReport {
                outcome: CacheOpenOutcome::OpenedExisting,
                carry_forward: moved,
            }
        );

        // Storage 12 with the derived state a storage 11 build left: those
        // rebuilds alone, with no move and no step.
        remove_opfs_pair(&own).await;
        load_pair(base, "derived.turso", &own).await;
        let (rebuilds, report) = timed_open().await;
        assert_eq!(
            report,
            OpenReport {
                outcome: CacheOpenOutcome::OpenedExisting,
                carry_forward: None,
            }
        );

        remove_opfs_pair(&own).await;
        load_pair(base, "older.turso", &older).await;
        let (upgrade, report) = timed_open().await;
        assert_eq!(
            report,
            OpenReport {
                outcome: CacheOpenOutcome::UpgradedExisting {
                    from_storage_version: 11
                },
                carry_forward: moved,
            }
        );
        let (after, report) = timed_open().await;
        assert_eq!(report.outcome, CacheOpenOutcome::OpenedExisting);
        console_log!(
            "run {run} ({bytes} B): reopen at 12 {reopen:.1} ms, move and open at 12 \
             {move_only:.1} ms, derived rebuilds at 12 {rebuilds:.1} ms, move and upgrade from 11 \
             {upgrade:.1} ms, reopen after upgrade {after:.1} ms"
        );
    }
    destroy_cache(BENCH_SCOPE.into())
        .await
        .expect("destroy bench cache");
    remove_opfs_pair(&older).await;
}
