//! Corpus regression test: every deck in `tests/corpus` opens, renders every
//! slide, and matches the render fingerprints recorded in
//! `tests/corpus/baseline.json`; saving without edits keeps every part's bytes.
//!
//! After a deliberate rendering change, record new fingerprints (and SSIM
//! against LibreOffice references) with `pptx_corpus score --update`; see the
//! corpus README. Decks still stored as Git LFS pointers are skipped.

use pptx_engine::Presentation;
use pptx_engine::collab::Entries;
use pptx_engine::fidelity::corpus::{
    Baseline, Deck, FINGERPRINT_WIDTH, default_corpus, discover, fingerprint_changed,
    is_lfs_pointer,
};
use pptx_engine::fidelity::fingerprint;
use pptx_engine::font::FontDb;
use pptx_engine::opc::Package;
use std::sync::Mutex;
use std::sync::atomic::{AtomicUsize, Ordering};

/// The bundled fonts, read from the crate's `fonts/` directory.
fn fonts() -> FontDb {
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("fonts");
    let mut files: Vec<_> = std::fs::read_dir(&dir)
        .expect("the fonts directory")
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| {
            p.extension()
                .is_some_and(|e| e.eq_ignore_ascii_case("ttf") || e.eq_ignore_ascii_case("otf"))
        })
        .collect();
    files.sort();
    let mut db = FontDb::new();
    for file in files {
        db.register(std::fs::read(file).expect("a font file"));
    }
    db
}

/// Problems found in one deck (empty when it passes).
fn check(deck: &Deck, baseline: &Baseline, fonts: &FontDb) -> Result<Vec<String>, String> {
    let bytes = std::fs::read(&deck.path).map_err(|e| e.to_string())?;
    if is_lfs_pointer(&bytes) {
        return Err("Git LFS pointer (run `git lfs pull`)".into());
    }
    let mut problems = Vec::new();

    let original = Package::open(bytes.clone()).map_err(|e| e.to_string())?;
    let mut pres = Presentation::open(bytes).map_err(|e| e.to_string())?;
    let resaved =
        Package::open(pres.save().map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    for name in original.part_names() {
        if original.read(name).ok() != resaved.read(name).ok() {
            problems.push(format!("no-op save changed {name}"));
        }
    }

    let expected = baseline.decks.get(&deck.key);
    let count = pres.slides().len();
    match expected {
        None => problems
            .push("not in baseline.json (record it with `pptx_corpus score --update`)".into()),
        Some(slides) if slides.len() != count => {
            problems.push(format!("{count} slides, baseline has {}", slides.len()));
        }
        Some(_) => {}
    }
    for index in 0..count {
        let raster = match pres.render_slide(index, FINGERPRINT_WIDTH, fonts) {
            Ok(r) => r,
            Err(e) => {
                problems.push(format!("slide {} failed to render: {e}", index + 1));
                continue;
            }
        };
        let Some(recorded) = expected.and_then(|s| s.get(index)) else {
            continue;
        };
        if !recorded.unstable && fingerprint_changed(&recorded.fingerprint, &fingerprint(&raster)) {
            problems.push(format!(
                "slide {} renders differently from the baseline",
                index + 1
            ));
        }
    }
    Ok(problems)
}

#[test]
fn corpus_matches_baseline() {
    let root = default_corpus();
    let baseline = Baseline::load(&root.join("baseline.json")).expect("baseline.json");
    assert_eq!(
        baseline.fingerprint_width, FINGERPRINT_WIDTH,
        "baseline fingerprints were taken at another width"
    );
    let decks = discover(&root, &[]).expect("the corpus directory");
    assert!(!decks.is_empty(), "no decks in {}", root.display());
    let fonts = fonts();

    let next = AtomicUsize::new(0);
    let failures = Mutex::new(Vec::new());
    let skipped = Mutex::new(Vec::new());
    let workers = std::thread::available_parallelism().map_or(4, |n| n.get());
    std::thread::scope(|scope| {
        for _ in 0..workers {
            scope.spawn(|| {
                while let Some(deck) = decks.get(next.fetch_add(1, Ordering::Relaxed)) {
                    match check(deck, &baseline, &fonts) {
                        Ok(problems) => failures
                            .lock()
                            .unwrap()
                            .extend(problems.into_iter().map(|p| format!("{}: {p}", deck.key))),
                        Err(reason) => skipped
                            .lock()
                            .unwrap()
                            .push(format!("{}: {reason}", deck.key)),
                    }
                }
            });
        }
    });

    let skipped = skipped.into_inner().unwrap();
    for s in &skipped {
        eprintln!("skipped {s}");
    }
    let unreadable: Vec<&String> = skipped.iter().filter(|s| !s.contains("LFS")).collect();
    let mut failures = failures.into_inner().unwrap();
    failures.extend(
        unreadable
            .into_iter()
            .map(|s| format!("{s} (could not be opened)")),
    );
    failures.sort();
    assert!(
        failures.is_empty(),
        "{} corpus problems:\n{}\n\nIf a rendering change is deliberate, run \
         `cargo run --release -p pptx_engine --features cli --bin pptx_corpus -- score --update` \
         (see tests/corpus/README.md).",
        failures.len(),
        failures.join("\n")
    );
    assert!(
        skipped.len() < decks.len(),
        "every deck was skipped; fetch the corpus with `git lfs pull`"
    );
}

/// Problems after a deck goes through the collaborative entries: a peer that
/// opens the entries must render every slide as the original does, owe no
/// changes back, and save a valid package.
fn check_collab(deck: &Deck, fonts: &FontDb) -> Result<Vec<String>, String> {
    let bytes = std::fs::read(&deck.path).map_err(|e| e.to_string())?;
    if is_lfs_pointer(&bytes) {
        return Err("Git LFS pointer (run `git lfs pull`)".into());
    }
    let mut original = Presentation::open(bytes).map_err(|e| e.to_string())?;
    original.enable_collab(1);
    let changes = original.collab_changes().map_err(|e| e.to_string())?;
    let mut peer = Presentation::from_entries(Entries::from_changes(&changes), 2)
        .map_err(|e| format!("opening the entries: {e}"))?;
    let mut problems = Vec::new();
    let owed = peer.collab_changes().map_err(|e| e.to_string())?;
    if !owed.is_empty() {
        problems.push(format!(
            "{} changes owed after opening the entries",
            owed.len()
        ));
    }
    let count = original.slides().len();
    if peer.slides().len() != count {
        problems.push(format!(
            "{} slides, original has {count}",
            peer.slides().len()
        ));
    }
    for index in 0..count.min(peer.slides().len()) {
        let expected = original.render_slide(index, FINGERPRINT_WIDTH, fonts);
        let actual = peer.render_slide(index, FINGERPRINT_WIDTH, fonts);
        match (expected, actual) {
            (Ok(e), Ok(a)) if fingerprint_changed(&fingerprint(&e), &fingerprint(&a)) => {
                problems.push(format!("slide {} renders differently", index + 1));
            }
            (Ok(_), Err(e)) => problems.push(format!("slide {} failed to render: {e}", index + 1)),
            _ => {}
        }
    }
    let saved = peer.save().map_err(|e| e.to_string())?;
    let mut reopened = Presentation::open(saved).map_err(|e| e.to_string())?;
    let integrity = reopened.integrity_problems().map_err(|e| e.to_string())?;
    problems.extend(integrity.into_iter().map(|p| format!("saved package: {p}")));
    Ok(problems)
}

#[test]
fn corpus_round_trips_through_collaborative_entries() {
    let root = default_corpus();
    let decks = discover(&root, &[]).expect("the corpus directory");
    let fonts = fonts();
    let next = AtomicUsize::new(0);
    let failures = Mutex::new(Vec::new());
    let workers = std::thread::available_parallelism().map_or(4, |n| n.get());
    std::thread::scope(|scope| {
        for _ in 0..workers {
            scope.spawn(|| {
                while let Some(deck) = decks.get(next.fetch_add(1, Ordering::Relaxed)) {
                    match check_collab(deck, &fonts) {
                        Ok(problems) => failures
                            .lock()
                            .unwrap()
                            .extend(problems.into_iter().map(|p| format!("{}: {p}", deck.key))),
                        Err(reason) if reason.contains("LFS") => {}
                        Err(reason) => failures
                            .lock()
                            .unwrap()
                            .push(format!("{}: {reason}", deck.key)),
                    }
                }
            });
        }
    });
    let mut failures = failures.into_inner().unwrap();
    failures.sort();
    assert!(
        failures.is_empty(),
        "{} problems:\n{}",
        failures.len(),
        failures.join("\n")
    );
}
