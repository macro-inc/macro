//! Corpus helpers for the CLI: the shared corpus types and a parallel map.

pub use pptx_engine::fidelity::corpus::*;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};

/// The default corpus directory (inside the crate). Lives in the binary, not
/// the library: `env!("CARGO_MANIFEST_DIR")` compiles this checkout's absolute
/// path in, and a library carrying it never shares a kache entry across
/// machines.
pub fn default_corpus() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/corpus")
}

/// Maps `f` over `items` on `jobs` threads, keeping order.
pub fn par_map<T: Sync, R: Send>(items: &[T], jobs: usize, f: impl Fn(&T) -> R + Sync) -> Vec<R> {
    let next = AtomicUsize::new(0);
    let mut results: Vec<Option<R>> = (0..items.len()).map(|_| None).collect();
    let slots = std::sync::Mutex::new(&mut results);
    std::thread::scope(|s| {
        for _ in 0..jobs.max(1) {
            s.spawn(|| {
                loop {
                    let i = next.fetch_add(1, Ordering::Relaxed);
                    let Some(item) = items.get(i) else { break };
                    let r = f(item);
                    slots.lock().map(|mut v| v[i] = Some(r)).ok();
                }
            });
        }
    });
    results
        .into_iter()
        .map(|r| r.expect("every item is processed"))
        .collect()
}

/// A sensible default worker count.
pub fn default_jobs() -> usize {
    std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4)
}
