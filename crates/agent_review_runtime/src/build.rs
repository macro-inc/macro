//! Reuse immutable file results; bound expensive structural and line alignment.
use crate::{domain::ports::DiffEngine, outbound::difft::Difftastic};
use diffd_core::{
    build::{FileInput, build_file, snapshot},
    difft::EngineDiff,
    model::{FileDiff, Omitted, Row, Snapshot, Symbol},
    text::split_lines,
};
use rayon::prelude::*;
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    time::{Duration, Instant},
};

#[derive(Default)]
pub(crate) struct CaptureCache(HashMap<[u8; 32], (FileDiff, Vec<Symbol>)>);

/// Build complete file pairs using diffd, with a bounded structural alignment budget.
/// Call from a blocking worker. Workspace captures also reuse unchanged file results.
pub fn build(inputs: Vec<FileInput>) -> Result<Snapshot, String> {
    build_cached(inputs, &mut CaptureCache::default())
}

pub(crate) fn build_cached(
    mut inputs: Vec<FileInput>,
    cache: &mut CaptureCache,
) -> Result<Snapshot, String> {
    if inputs.len() > 10_000 {
        return Err("Comparison contains more than 10,000 files".into());
    }
    // Source bytes alone do not bound millions of tiny rows or token vectors.
    let mut remaining = 512 * 1024 * 1024usize;
    let mut remaining_lines = 1_000_000usize;
    for input in &mut inputs {
        let (bytes, lines) = [&input.old, &input.new].into_iter().flatten().fold(
            (0usize, 0usize),
            |(bytes, lines), text| {
                (
                    bytes.saturating_add(text.len()),
                    lines.saturating_add(text.bytes().filter(|b| *b == b'\n').count() + 1),
                )
            },
        );
        let expanded = bytes
            .saturating_mul(24)
            .saturating_add(lines.saturating_mul(128));
        if input.omitted.is_none()
            && (lines > 250_000
                || lines > remaining_lines
                || expanded > 192 * 1024 * 1024
                || expanded > remaining)
        {
            input.old = None;
            input.new = None;
            input.omitted = Some(Omitted::TooLarge);
            input
                .details
                .push("Contents exceed the review's line or memory budget".into());
        } else {
            remaining = remaining.saturating_sub(expanded);
            remaining_lines = remaining_lines.saturating_sub(lines);
        }
    }
    let engine = Difftastic::detect();
    let pool = rayon::ThreadPoolBuilder::new()
        .num_threads(4)
        .build()
        .map_err(|e| e.to_string())?;
    let deadline = Instant::now() + Duration::from_secs(12);
    let results: Vec<_> = pool.install(|| inputs.par_iter().map(|input| {
        // Include metadata as well as both byte streams; a rename/mode-only
        // change must not accidentally reuse a previous file's presentation.
        let bytes = serde_json::to_vec(&(&input.path, &input.old_path, input.status, &input.old, &input.new, input.omitted, &input.details, &input.collapsed)).map_err(|e| e.to_string())?;
        let key: [u8; 32] = Sha256::digest(bytes).into();
        if let Some((file, symbols)) = cache.0.get(&key) { return Ok((key, file.clone(), symbols.clone())); }
        let structural = match (&input.old, &input.new, &engine) {
            (Some(old), Some(new), Some(engine)) if input.omitted.is_none() && Instant::now() < deadline && old.len() + new.len() <= 1024 * 1024 => engine.diff(&input.path, old, new),
            _ => None,
        }.filter(|diff| !diff.unchanged && !matches!(diff.language.as_deref(), Some("Plain Text" | "Text")));
        let fallback = structural.is_none() && input.old.is_some() && input.new.is_some() && input.omitted.is_none();
        let alignment = structural.or_else(|| Some(bounded_lines(input.old.as_deref()?, input.new.as_deref()?)));
        let mut file = build_file(input, alignment);
        if fallback { file.details.push("Line alignment (structural engine unavailable, unsupported, or capture budget reached)".into()); }
        let mut result = snapshot(1, std::slice::from_ref(input), vec![file]);
        Ok::<_, String>((key, result.files.remove(0), result.symbols))
    }).collect::<Result<Vec<_>, _>>())?;
    let mut files = Vec::with_capacity(results.len());
    let mut symbols = Vec::new();
    let mut next = HashMap::with_capacity(results.len());
    let mut remaining_cache = 128 * 1024 * 1024usize;
    for (index, (key, file, definitions)) in results.into_iter().enumerate() {
        let heap = file_heap(&file)
            + definitions
                .iter()
                .map(|symbol| std::mem::size_of::<Symbol>() + symbol.name.len() + symbol.kind.len())
                .sum::<usize>();
        if heap <= remaining_cache {
            remaining_cache -= heap;
            next.insert(key, (file.clone(), definitions.clone()));
        }
        files.push(file);
        symbols.extend(definitions.into_iter().map(|mut symbol| {
            symbol.file = index as u32;
            symbol
        }));
    }
    cache.0 = next;
    Ok(Snapshot {
        revision: 1,
        files,
        symbols,
    })
}

// Count retained vector/string storage before duplicating a body into the cache.
fn file_heap(file: &FileDiff) -> usize {
    std::mem::size_of::<FileDiff>()
        + file.path.len()
        + file.rows.len() * std::mem::size_of::<Row>()
        + file.since.len() * 4
        + [&file.old, &file.new]
            .into_iter()
            .flatten()
            .map(|side| {
                side.lines
                    .iter()
                    .map(|line| std::mem::size_of::<String>() + line.len())
                    .sum::<usize>()
                    + [&side.syntax, &side.novel]
                        .into_iter()
                        .map(|spans| {
                            spans
                                .iter()
                                .map(|line| std::mem::size_of::<Vec<u32>>() + line.len() * 4)
                                .sum::<usize>()
                        })
                        .sum::<usize>()
            })
            .sum::<usize>()
}

/// Keep full source while limiting alignment work. Replaced rows mark the
/// changed byte range; diffd converts these offsets to UTF-16 for the reader.
fn bounded_lines(old: &str, new: &str) -> EngineDiff {
    use similar::{Algorithm, DiffOp, capture_diff_slices_deadline};
    let old = split_lines(old);
    let new = split_lines(new);
    let mut diff = EngineDiff {
        rows: vec![],
        novel_old: vec![vec![]; old.len()],
        novel_new: vec![vec![]; new.len()],
        ..EngineDiff::default()
    };
    for op in capture_diff_slices_deadline(
        Algorithm::Patience,
        &old,
        &new,
        Some(Instant::now() + Duration::from_millis(100)),
    ) {
        let (a, b) = (op.old_range(), op.new_range());
        if matches!(op, DiffOp::Equal { .. }) {
            for (a, b) in a.zip(b) {
                diff.rows.push(Row(Some(a as u32), Some(b as u32)));
            }
            continue;
        }
        for offset in 0..a.len().max(b.len()) {
            let i = (offset < a.len()).then_some(a.start + offset);
            let j = (offset < b.len()).then_some(b.start + offset);
            diff.rows
                .push(Row(i.map(|i| i as u32), j.map(|j| j as u32)));
            // A deadline can coalesce the remaining range into a replacement.
            // Identical aligned lines still must not be painted as changed.
            if i.zip(j).is_some_and(|(i, j)| old[i] == new[j]) {
                continue;
            }
            if let Some(i) = i {
                diff.novel_old[i] = vec![(0, old[i].len())];
            }
            if let Some(j) = j {
                diff.novel_new[j] = vec![(0, new[j].len())];
            }
        }
    }
    diff
}
