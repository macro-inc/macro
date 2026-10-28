//! The corpus check (ignored by default): every `.pdf` and `.ai` file under
//! `PDF_CORPUS_DIR` (third-party files, kept out of the repository) is
//! opened, its pages listed, every object resolved, every stream decoded,
//! and every page's content parsed and written back, with counts and
//! timings reported. With `PDF_CORPUS_OUT` set, each file's pages and
//! content stream hashes are written there as JSON, with the file
//! rewritten whole (`write::file`) and updated incrementally
//! (`write::incremental`), for comparison with another reader.
//!
//! `PDF_CORPUS_DIR=… cargo test -p ai_engine --release -- --ignored --nocapture corpus`

use super::*;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

#[derive(Default)]
struct Totals {
    files: usize,
    failed: usize,
    repaired: usize,
    pages: usize,
    objects: usize,
    streams: usize,
    images: usize,
    stream_errors: usize,
    ops: usize,
    mismatches: usize,
    time: Duration,
}

#[test]
#[ignore = "reads a local corpus: set PDF_CORPUS_DIR"]
fn corpus() {
    let Some(dir) = std::env::var_os("PDF_CORPUS_DIR") else {
        eprintln!("PDF_CORPUS_DIR is not set; skipping");
        return;
    };
    let out = std::env::var_os("PDF_CORPUS_OUT").map(PathBuf::from);
    if let Some(out) = &out {
        std::fs::create_dir_all(out).unwrap();
    }
    let dir = PathBuf::from(dir);
    let mut files = Vec::new();
    collect(&dir, &mut files);
    files.sort();
    let mut totals = Totals::default();
    // `open`: reading the cross-reference; `first`: that, the page list,
    // and page 1's content decoded and parsed; `all`: every object
    // resolved, every stream decoded (`MB out`), every page parsed and
    // written back.
    println!(
        "{:<48} {:>9} {:>7} {:>7} {:>5} {:>6} {:>7} {:>4} {:>4} {:>7} {:>7} {:>8} {:>8}",
        "file",
        "bytes",
        "open ms",
        "1st ms",
        "pages",
        "objs",
        "streams",
        "img",
        "err",
        "MB out",
        "ops",
        "all ms",
        "rewrite"
    );
    for path in &files {
        let name = path
            .strip_prefix(&dir)
            .unwrap_or(path)
            .to_string_lossy()
            .into_owned();
        let bytes: Arc<[u8]> = Arc::from(std::fs::read(path).unwrap());
        totals.files += 1;
        let size = bytes.len();
        let start = Instant::now();
        let pdf = match Pdf::open(bytes.clone()) {
            Ok(pdf) => pdf,
            Err(e) => {
                totals.failed += 1;
                println!("{:<48} {size:>9} failed: {e}", short(&name));
                continue;
            }
        };
        let open = start.elapsed();
        if let Some(page) = pdf.pages().first() {
            let streams = content_streams(&pdf, &page.dict);
            std::hint::black_box(content::parse(&joined(&streams)));
        }
        let first = start.elapsed();
        let start = Instant::now();
        let c = check(&pdf);
        let all = start.elapsed();
        totals.time += all;
        totals.repaired += usize::from(pdf.repaired());
        totals.pages += c.pages.len();
        totals.objects += c.objects;
        totals.streams += c.streams;
        totals.images += c.images;
        totals.stream_errors += c.stream_errors;
        totals.ops += c.ops;
        totals.mismatches += c.mismatches;
        let rewrite = match &out {
            Some(out) => rewrite(&pdf, &bytes, &c.pages, out, &name),
            None => "-".into(),
        };
        println!(
            "{:<48} {size:>9} {:>7.1} {:>7.1} {:>5} {:>6} {:>7} {:>4} {:>4} {:>7.1} {:>7} {:>8.1} {:>8}{}{}",
            short(&name),
            open.as_secs_f64() * 1e3,
            first.as_secs_f64() * 1e3,
            c.pages.len(),
            c.objects,
            c.streams,
            c.images,
            c.stream_errors,
            c.decoded as f64 / 1e6,
            c.ops,
            all.as_secs_f64() * 1e3,
            rewrite,
            if pdf.repaired() { " repaired" } else { "" },
            if c.mismatches > 0 {
                format!(" {} round-trip mismatches", c.mismatches)
            } else {
                String::new()
            },
        );
    }
    println!(
        "\n{} files ({} failed to open, {} repaired): {} pages, {} objects, {} streams \
         ({} image codecs, {} errors), {} operators, {} content round-trip mismatches; \
         reading took {:.0} ms",
        totals.files,
        totals.failed,
        totals.repaired,
        totals.pages,
        totals.objects,
        totals.streams,
        totals.images,
        totals.stream_errors,
        totals.ops,
        totals.mismatches,
        totals.time.as_secs_f64() * 1e3
    );
}

/// The corpus files damaged: bytes changed, removed, and inserted, and the
/// files cut short, each read through without panicking.
#[test]
#[ignore = "reads a local corpus: set PDF_CORPUS_DIR"]
fn corpus_damage() {
    let Some(dir) = std::env::var_os("PDF_CORPUS_DIR") else {
        eprintln!("PDF_CORPUS_DIR is not set; skipping");
        return;
    };
    const MUTATIONS: usize = 40;
    const MAX_SIZE: usize = 4 << 20;
    let mut files = Vec::new();
    collect(Path::new(&dir), &mut files);
    files.sort();
    let mut rng = super::damage::Rng(0x2545_f491_4f6c_dd1d);
    let start = Instant::now();
    let mut walks = 0;
    for path in &files {
        let base = std::fs::read(path).unwrap();
        if base.is_empty() || base.len() > MAX_SIZE {
            continue;
        }
        for _ in 0..MUTATIONS {
            let mut bytes = base.clone();
            for _ in 0..1 + rng.below(8) {
                let at = rng.below(bytes.len());
                match rng.below(3) {
                    0 => bytes[at] = rng.next() as u8,
                    1 => {
                        bytes.remove(at);
                    }
                    _ => bytes.insert(at, rng.next() as u8),
                }
            }
            super::damage::walk(&bytes);
            walks += 1;
        }
        for _ in 0..8 {
            super::damage::walk(&base[..rng.below(base.len())]);
            walks += 1;
        }
    }
    println!(
        "{walks} damaged files read in {:.0} ms",
        start.elapsed().as_secs_f64() * 1e3
    );
}

fn collect(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect(&path, out);
        } else if path
            .extension()
            .is_some_and(|e| e.eq_ignore_ascii_case("pdf") || e.eq_ignore_ascii_case("ai"))
        {
            out.push(path);
        }
    }
}

fn short(name: &str) -> String {
    let chars: Vec<char> = name.chars().collect();
    let start = chars.len().saturating_sub(48);
    chars[start..].iter().collect()
}

/// What reading a whole file found.
struct Checked {
    /// Each page's content streams: object number and decoded data.
    pages: Vec<Vec<(u32, Vec<u8>)>>,
    objects: usize,
    streams: usize,
    images: usize,
    stream_errors: usize,
    /// Bytes the streams decoded to.
    decoded: usize,
    ops: usize,
    mismatches: usize,
}

fn check(pdf: &Pdf) -> Checked {
    let mut c = Checked {
        pages: Vec::new(),
        objects: 0,
        streams: 0,
        images: 0,
        stream_errors: 0,
        decoded: 0,
        ops: 0,
        mismatches: 0,
    };
    for r in pdf.object_refs() {
        let Some(o) = pdf.get(r) else {
            continue;
        };
        c.objects += 1;
        if let Object::Stream(s) = o {
            c.streams += 1;
            match pdf.decode_stream(&s) {
                Ok((data, codec)) => {
                    c.decoded += data.len();
                    c.images += usize::from(codec.is_some());
                }
                Err(_) => c.stream_errors += 1,
            }
        }
    }
    for page in pdf.pages() {
        let streams = content_streams(pdf, &page.dict);
        let ops = content::parse(&joined(&streams));
        c.ops += ops.len();
        let again = content::parse(&content::write(&ops));
        if ops.len() != again.len() || ops.iter().zip(&again).any(|(a, b)| !same_op(a, b)) {
            c.mismatches += 1;
        }
        c.pages.push(streams);
    }
    c
}

/// Content streams joined as one (a line break between them).
fn joined(streams: &[(u32, Vec<u8>)]) -> Vec<u8> {
    streams
        .iter()
        .flat_map(|(_, d)| d.iter().copied().chain([b'\n']))
        .collect()
}

/// A page's content streams, by object number.
fn content_streams(pdf: &Pdf, page: &Dict) -> Vec<(u32, Vec<u8>)> {
    let refs: Vec<ObjRef> = match page.get("Contents") {
        Some(Object::Ref(r)) => match pdf.get(*r) {
            Some(Object::Array(a)) => a.iter().filter_map(Object::as_ref).collect(),
            Some(Object::Stream(_)) => vec![*r],
            _ => Vec::new(),
        },
        Some(Object::Array(a)) => a.iter().filter_map(Object::as_ref).collect(),
        _ => Vec::new(),
    };
    refs.into_iter()
        .filter_map(|r| match pdf.get(r) {
            Some(Object::Stream(s)) => Some((r.num, pdf.stream_data(&s).unwrap_or_default())),
            _ => None,
        })
        .collect()
}

fn same_op(a: &content::Op, b: &content::Op) -> bool {
    a.operator == b.operator
        && a.operands.len() == b.operands.len()
        && a.operands.iter().zip(&b.operands).all(|(x, y)| same(x, y))
        && match (&a.inline_image, &b.inline_image) {
            (Some(x), Some(y)) => {
                x.data == y.data
                    && same(&Object::Dict(x.dict.clone()), &Object::Dict(y.dict.clone()))
            }
            (None, None) => true,
            _ => false,
        }
}

/// Equal, numbers within what compact writing keeps.
fn same(a: &Object, b: &Object) -> bool {
    match (a, b) {
        (Object::Array(x), Object::Array(y)) => {
            x.len() == y.len() && x.iter().zip(y).all(|(p, q)| same(p, q))
        }
        (Object::Dict(x), Object::Dict(y)) => {
            x.len() == y.len()
                && x.iter()
                    .zip(y.iter())
                    .all(|((k1, v1), (k2, v2))| k1 == k2 && same(v1, v2))
        }
        _ => match (a.as_f64(), b.as_f64()) {
            (Some(x), Some(y)) => (x - y).abs() <= 1e-5_f64.max(x.abs() * 1e-4),
            _ => a == b,
        },
    }
}

/// FNV-1a, 64 bits.
fn fnv(data: &[u8]) -> u64 {
    data.iter().fold(0xcbf2_9ce4_8422_2325, |h, &b| {
        (h ^ u64::from(b)).wrapping_mul(0x0100_0000_01b3)
    })
}

/// Writes the file's page summary and its two rewrites; returns how the
/// rewrites read back here (`ok`, or what differs).
fn rewrite(
    pdf: &Pdf,
    bytes: &[u8],
    pages: &[Vec<(u32, Vec<u8>)>],
    out: &Path,
    name: &str,
) -> String {
    let stem: String = name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '.' || c == '-' {
                c
            } else {
                '_'
            }
        })
        .collect();
    let summary = serde_json::json!({
        "file": name,
        "repaired": pdf.repaired(),
        "pages": pages
            .iter()
            .map(|streams| streams.iter().map(|(num, d)| serde_json::json!([num, d.len(), fnv(d).to_string()])).collect::<Vec<_>>())
            .collect::<Vec<_>>(),
    });
    std::fs::write(out.join(format!("{stem}.json")), summary.to_string()).unwrap();

    // Whole: every object but cross-reference and object streams.
    let objects: Vec<(ObjRef, Object)> = pdf
        .object_refs()
        .into_iter()
        .filter_map(|r| Some((r, pdf.get(r)?)))
        .filter(|(_, o)| !matches!(o, Object::Stream(s) if s.dict.is("Type", "XRef") || s.dict.is("Type", "ObjStm")))
        .collect();
    let full = write::file(&pdf.version(), &objects, pdf.trailer());
    std::fs::write(out.join(format!("{stem}.full.pdf")), &full).unwrap();

    // Incremental: the catalog changed and an object added.
    let root = pdf.trailer().get("Root").and_then(Object::as_ref);
    let mut update = Vec::new();
    if let (Some(root), Some(mut catalog)) = (root, pdf.catalog()) {
        catalog.set("AiEngineCheck", true);
        update.push((root, Object::Dict(catalog)));
    }
    let next = pdf.object_refs().last().map_or(1, |r| r.num + 1).max(
        pdf.trailer()
            .i64("Size")
            .and_then(|s| u32::try_from(s).ok())
            .unwrap_or(0),
    );
    update.push((
        ObjRef::new(next, 0),
        Object::String(b"added by the ai_engine corpus check".to_vec()),
    ));
    let incremental = write::incremental(bytes, &update, pdf.trailer());
    std::fs::write(out.join(format!("{stem}.incr.pdf")), &incremental).unwrap();

    let mut problems = Vec::new();
    for (label, rewritten) in [("full", full), ("incr", incremental)] {
        match Pdf::open(Arc::from(rewritten)) {
            Ok(again) => {
                let c = check(&again);
                if c.pages != pages {
                    problems.push(format!("{label}: pages differ"));
                }
                if label == "incr" && again.get(ObjRef::new(next, 0)).is_none() {
                    problems.push("incr: added object missing".into());
                }
            }
            Err(e) => problems.push(format!("{label}: {e}")),
        }
    }
    if problems.is_empty() {
        "ok".into()
    } else {
        problems.join("; ")
    }
}
