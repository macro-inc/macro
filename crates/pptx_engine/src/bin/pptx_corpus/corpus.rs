//! Corpus discovery, the fidelity baseline file, and a parallel map helper.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};

/// The default corpus directory (inside the crate).
pub fn default_corpus() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/corpus")
}

/// A deck in the corpus.
#[derive(Clone, Debug)]
pub struct Deck {
    /// Path relative to the corpus root, with `/` separators (`wild/x.pptx`).
    pub key: String,
    /// Absolute path.
    pub path: PathBuf,
}

impl Deck {
    /// File stem, used for reference and output directories.
    pub fn stem(&self) -> String {
        self.path
            .file_stem()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_default()
    }
}

/// Every `.pptx` under `root` (sorted), optionally filtered by substrings of the key.
pub fn discover(root: &Path, only: &[String]) -> std::io::Result<Vec<Deck>> {
    let mut out = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        for entry in std::fs::read_dir(&dir)? {
            let path = entry?.path();
            if path.is_dir() {
                stack.push(path);
            } else if path
                .extension()
                .is_some_and(|e| e.eq_ignore_ascii_case("pptx"))
            {
                let key = path
                    .strip_prefix(root)
                    .unwrap_or(&path)
                    .to_string_lossy()
                    .replace('\\', "/");
                if only.is_empty() || only.iter().any(|o| key.contains(o.as_str())) {
                    out.push(Deck { key, path });
                }
            }
        }
    }
    out.sort_by(|a, b| a.key.cmp(&b.key));
    Ok(out)
}

/// Whether a file is a Git LFS pointer rather than the real deck.
pub fn is_lfs_pointer(bytes: &[u8]) -> bool {
    bytes.starts_with(b"version https://git-lfs.github.com/spec/")
}

/// Recorded results for one slide.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct SlideBaseline {
    /// Render fingerprint at [`FINGERPRINT_WIDTH`].
    pub fingerprint: String,
    /// SSIM against the LibreOffice reference.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ssim: Option<f32>,
    /// Mismatched-pixel fraction against the reference.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mismatch: Option<f32>,
    /// Why this slide legitimately differs from LibreOffice (kept across updates).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    /// Skip the fingerprint check (content changes on its own, e.g. a live date field).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub unstable: bool,
}

/// The fidelity baseline (`tests/corpus/baseline.json`).
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Baseline {
    /// Format marker.
    pub schema: String,
    /// Render width of fingerprints.
    pub fingerprint_width: u32,
    /// Render width of reference comparisons.
    pub score_width: u32,
    /// LibreOffice version of the references the scores were measured against.
    #[serde(default)]
    pub reference: String,
    /// Per-deck, per-slide results.
    pub decks: BTreeMap<String, Vec<SlideBaseline>>,
}

/// Width of the renders fingerprints are taken from.
pub const FINGERPRINT_WIDTH: u32 = 320;
/// Schema marker of the baseline file.
pub const BASELINE_SCHEMA: &str = "pptx_engine fidelity baseline v1";

impl Baseline {
    /// Reads a baseline, or an empty one when the file does not exist.
    pub fn load(path: &Path) -> Result<Self, Box<dyn std::error::Error>> {
        if !path.exists() {
            return Ok(Self {
                schema: BASELINE_SCHEMA.into(),
                fingerprint_width: FINGERPRINT_WIDTH,
                score_width: 960,
                ..Self::default()
            });
        }
        Ok(serde_json::from_slice(&std::fs::read(path)?)?)
    }

    /// Writes the baseline with stable formatting.
    pub fn save(&self, path: &Path) -> std::io::Result<()> {
        let mut text = serde_json::to_string_pretty(self).map_err(std::io::Error::other)?;
        text.push('\n');
        std::fs::write(path, text)
    }
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
