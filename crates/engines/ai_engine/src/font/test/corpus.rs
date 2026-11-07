//! Fonts extracted from third-party PDF and Illustrator files, which are
//! not committed: `FONT_CORPUS_DIR` holds a directory per font with a
//! `spec.json` (the [`FontSpec`] fields; streams named by file) and the
//! streams. Each font's results are written next to it as `rust.json` for
//! comparison with other readers.

use super::super::*;
use serde_json::{Value, json};
use std::fs;
use std::path::Path as FsPath;

fn read_spec(dir: &FsPath) -> Option<FontSpec> {
    let v: Value = serde_json::from_slice(&fs::read(dir.join("spec.json")).ok()?).ok()?;
    let file = |name: &Value| -> Option<Vec<u8>> { fs::read(dir.join(name.as_str()?)).ok() };
    let f32s = |v: &Value| -> Vec<f32> {
        v.as_array()
            .map(|a| a.iter().map(|x| x.as_f64().unwrap_or(0.0) as f32).collect())
            .unwrap_or_default()
    };
    let subtype = match v["subtype"].as_str()? {
        "Type1" => FontSubtype::Type1,
        "MMType1" => FontSubtype::MmType1,
        "TrueType" => FontSubtype::TrueType,
        "Type3" => FontSubtype::Type3,
        "Type0" => FontSubtype::Type0,
        _ => return None,
    };
    let program = v["program"].as_object().and_then(|p| {
        let kind = match p["kind"].as_str()? {
            "Type1" => ProgramKind::Type1,
            "TrueType" => ProgramKind::TrueType,
            "Type1C" => ProgramKind::Type1C,
            "CidType0C" => ProgramKind::CidType0C,
            _ => ProgramKind::OpenType,
        };
        Some(Program {
            kind,
            data: file(&p["file"])?.into(),
            length1: p["length1"].as_u64().map(|n| n as usize),
            length2: p["length2"].as_u64().map(|n| n as usize),
        })
    });
    let encoding = v["encoding"].as_object().map(|e| EncodingSpec {
        base: e["base"].as_str().map(str::to_string),
        differences: e["differences"]
            .as_array()
            .map(|d| {
                d.iter()
                    .filter_map(|p| Some((p[0].as_u64()? as u32, p[1].as_str()?.to_string())))
                    .collect()
            })
            .unwrap_or_default(),
    });
    let cmap = v["cmap"].as_object().and_then(|c| match c.get("named") {
        Some(name) => Some(CMapSpec::Named(name.as_str()?.to_string())),
        None => Some(CMapSpec::Embedded(file(&c["embedded"])?)),
    });
    let cid = v["cid"].as_object().map(|c| CidSpec {
        cff: c["cff"].as_bool().unwrap_or(false),
        default_width: c["default_width"].as_f64().unwrap_or(1000.0) as f32,
        widths: c["widths"]
            .as_array()
            .map(|runs| {
                runs.iter()
                    .filter_map(|r| Some((r[0].as_u64()? as u32, f32s(&r[1]))))
                    .collect()
            })
            .unwrap_or_default(),
        cid_to_gid: match c["cid_to_gid"].as_str() {
            Some("identity") | None => CidToGid::Identity,
            Some(name) => CidToGid::Map(
                fs::read(dir.join(name))
                    .unwrap_or_default()
                    .chunks_exact(2)
                    .map(|p| u16::from_be_bytes([p[0], p[1]]))
                    .collect(),
            ),
        },
        collection: None,
    });
    Some(FontSpec {
        subtype,
        base_font: v["base_font"].as_str().unwrap_or_default().to_string(),
        first_char: v["first_char"].as_u64().unwrap_or(0) as u32,
        widths: f32s(&v["widths"]),
        missing_width: v["missing_width"].as_f64().unwrap_or(0.0) as f32,
        flags: v["flags"].as_u64().unwrap_or(0) as u32,
        italic_angle: v["italic_angle"].as_f64().unwrap_or(0.0) as f32,
        weight: v["weight"].as_f64().map(|w| w as f32),
        encoding,
        program,
        to_unicode: v["to_unicode"]
            .as_bool()
            .filter(|b| *b)
            .and_then(|_| fs::read(dir.join("tounicode.bin")).ok()),
        cmap,
        cid,
        font_matrix: v["font_matrix"].as_array().and_then(|m| {
            let m: Vec<f64> = m.iter().filter_map(Value::as_f64).collect();
            m.try_into().ok()
        }),
    })
}

/// The codes a font's dictionary covers: `Widths` for simple fonts (every
/// code without them), the CIDs `W` lists (through an identity CMap) for
/// Type 0 fonts.
fn codes(spec: &FontSpec) -> Vec<u32> {
    match &spec.cid {
        None if spec.widths.is_empty() => (0..=255).collect(),
        Some(cid) => cid
            .widths
            .iter()
            .flat_map(|(first, ws)| (*first..*first + ws.len() as u32).zip(ws))
            .filter(|(_, w)| **w > 0.0)
            .map(|(c, _)| c)
            .collect(),
        None => (0..spec.widths.len() as u32)
            .filter(|i| spec.widths[*i as usize] > 0.0)
            .map(|i| i + spec.first_char)
            .collect(),
    }
}

/// Names of glyphs that draw nothing.
fn blank(name: Option<&str>) -> bool {
    name.is_some_and(|n| {
        matches!(
            n,
            "space" | "nbspace" | "nonbreakingspace" | "uni00A0" | "uni0020" | ".notdef"
        ) || n.starts_with("uni200")
    })
}

/// The corpus's font directories, in order.
fn corpus() -> Vec<std::path::PathBuf> {
    let Some(root) = std::env::var_os("FONT_CORPUS_DIR") else {
        return Vec::new();
    };
    let mut dirs: Vec<_> = fs::read_dir(&root)
        .expect("corpus dir")
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.join("spec.json").exists())
        .collect();
    dirs.sort();
    dirs
}

#[test]
#[ignore = "needs FONT_CORPUS_DIR with fonts extracted from third-party files"]
fn corpus_fonts_survive_damage() {
    // xorshift: the same damage every run.
    let mut state = 0x2545_F491_4F6C_DD1Du64;
    let mut next = move || {
        state ^= state << 13;
        state ^= state >> 7;
        state ^= state << 17;
        state
    };
    let mut variants = 0;
    for dir in corpus() {
        let Some(spec) = read_spec(&dir) else {
            continue;
        };
        let Some(program) = spec.program.clone() else {
            continue;
        };
        // Skip the largest programs to keep the run short.
        if program.data.len() > 2 << 20 {
            continue;
        }
        for round in 0..6 {
            let mut data = program.data.to_vec();
            match round {
                0 => data.truncate(data.len() / 3),
                1 => data.truncate(data.len() * 9 / 10),
                _ => {
                    let flips = (data.len() / 500).max(4);
                    for _ in 0..flips {
                        let at = next() as usize % data.len().max(1);
                        if let Some(b) = data.get_mut(at) {
                            *b ^= next() as u8 | 1;
                        }
                    }
                }
            }
            let font = Font::load(FontSpec {
                program: Some(Program {
                    data: data.into(),
                    ..program.clone()
                }),
                ..spec.clone()
            });
            for code in codes(&spec).into_iter().take(300) {
                let _ = (font.outline(code), font.width(code), font.unicode(code));
            }
            variants += 1;
        }
    }
    println!("damaged programs loaded and drawn: {variants}");
}

#[test]
#[ignore = "needs FONT_CORPUS_DIR with fonts extracted from third-party files"]
fn corpus_fonts_parse_and_draw() {
    let dirs = corpus();
    let (mut fonts, mut embedded, mut parsed, mut glyphs, mut drawn) = (0, 0, 0, 0, 0);
    let (mut width_checked, mut width_ok) = (0, 0);
    let mut failures = Vec::new();
    let mut missing = Vec::new();
    for dir in &dirs {
        let Some(spec) = read_spec(dir) else {
            failures.push(format!("{}: spec", dir.display()));
            continue;
        };
        fonts += 1;
        let has_program = spec.program.is_some();
        let font = Font::load(spec.clone());
        // The same font without `ToUnicode`, for text from names alone.
        let no_map = Font::load(FontSpec {
            to_unicode: None,
            ..spec.clone()
        });
        if has_program {
            embedded += 1;
            if font.substituted() {
                failures.push(format!("{}: program did not parse", dir.display()));
            } else {
                parsed += 1;
            }
        }
        let mut rows = Vec::new();
        let mut font_missing = 0;
        for code in codes(&spec) {
            // Type 0 corpus fonts use identity CMaps, so CIDs are codes.
            let gid = font.gid(code);
            let name = gid.and_then(|g| font.glyphs.glyph_name(g)).or_else(|| {
                font.encoding
                    .as_ref()
                    .and_then(|e| e.name(code))
                    .map(str::to_string)
            });
            let outline = font.outline(code);
            let advance = gid.and_then(|g| font.glyphs.advance(g));
            if spec.subtype != FontSubtype::Type3 && !blank(name.as_deref()) {
                glyphs += 1;
                if outline.is_some() {
                    drawn += 1;
                } else {
                    font_missing += 1;
                }
            }
            if let Some(a) = advance {
                width_checked += 1;
                if (a * 1000.0 - font.width(code)).abs() <= 2.0 {
                    width_ok += 1;
                }
            }
            let bbox = outline.as_ref().map(|p| {
                let b = p.bounds();
                [b.left(), b.top(), b.right(), b.bottom()]
            });
            rows.push(json!({
                "code": code,
                "gid": gid,
                "name": name,
                "bbox": bbox,
                "advance": advance,
                "width": font.width(code),
                "unicode": font.unicode(code),
                "unicode_without_map": no_map.unicode(code),
            }));
        }
        if font_missing > 0 {
            missing.push(format!(
                "{}: {font_missing} glyphs without outlines",
                dir.display()
            ));
        }
        let out = json!({
            "substituted": font.substituted(),
            "stand_in": font.stand_in_family(),
            "glyphs": rows,
        });
        fs::write(dir.join("rust.json"), out.to_string()).expect("write results");
    }
    println!(
        "fonts {fonts}, embedded {embedded}, parsed {parsed}; glyphs {glyphs}, drawn {drawn}; \
         program advances matching Widths {width_ok}/{width_checked}"
    );
    for f in failures.iter().chain(&missing) {
        println!("  {f}");
    }
    assert!(failures.is_empty(), "{failures:#?}");
}
