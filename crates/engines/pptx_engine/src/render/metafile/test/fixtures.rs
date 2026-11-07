//! Committed fixtures (LibreOffice, Office, and generated files) and the
//! corpus decks' embedded metafiles.

use super::{fixture_files, near, px, render};
use crate::test_support::fonts;

/// Share of pixels with any ink.
fn coverage(r: &crate::render::scene::Raster) -> f64 {
    let inked = r.pixels.chunks_exact(4).filter(|p| p[3] > 0).count();
    inked as f64 / (r.width * r.height).max(1) as f64
}

#[test]
fn committed_fixtures_render() {
    let files = fixture_files();
    assert!(files.len() >= 8, "fixtures present: {}", files.len());
    for (name, bytes) in files {
        let m = super::super::parse(&bytes, fonts()).unwrap_or_else(|e| panic!("{name}: {e}"));
        assert!(
            m.width_pt > 10.0 && m.height_pt > 10.0 && m.width_pt < 2000.0,
            "{name}: {} x {}",
            m.width_pt,
            m.height_pt
        );
        assert!(!m.nodes.is_empty(), "{name}: no nodes");
        let r = render(&m, 200.0 / m.width_pt);
        let c = coverage(&r);
        assert!(c > 0.02, "{name}: blank output ({c})");
    }
}

/// Renders a fixture at `scale` pixels per point.
fn fixture(name: &str, scale: f32) -> crate::render::scene::Raster {
    let bytes = fixture_files()
        .into_iter()
        .find(|(n, _)| n == name)
        .unwrap_or_else(|| panic!("missing {name}"))
        .1;
    render(&super::load(&bytes), scale)
}

#[test]
fn libreoffice_shapes_emf_pixels() {
    // 279 × 204 pt: blue rectangle top-left, orange ellipse, green triangle, yellow rounded square.
    let r = fixture("lo-shapes.emf", 1.0);
    assert!(
        near(px(&r, 40, 30), [0x33, 0x66, 0xCC]),
        "{:?}",
        px(&r, 40, 30)
    );
    assert!(near(px(&r, 140, 30), [0xFF, 0x99, 0x00]));
    assert!(
        near(px(&r, 255, 50), [0x33, 0xAA, 0x33]),
        "{:?}",
        px(&r, 255, 50)
    );
    assert!(near(px(&r, 260, 180), [0xFF, 0xFF, 0x66]));
}

#[test]
fn libreoffice_wmf_matches_its_embedded_emf() {
    let a = fixture("lo-shapes.wmf", 1.0);
    let b = fixture("lo-shapes-records.wmf", 1.0);
    for (x, y, rgb) in [
        (40, 30, [0x33, 0x66, 0xCC]),
        (140, 30, [0xFF, 0x99, 0x00]),
        (260, 180, [0xFF, 0xFF, 0x66]),
    ] {
        assert!(
            near(px(&a, x, y), rgb),
            "embedded EMF at {x},{y}: {:?}",
            px(&a, x, y)
        );
        assert!(
            near(px(&b, x, y), rgb),
            "WMF records at {x},{y}: {:?}",
            px(&b, x, y)
        );
    }
}

#[test]
fn office_icon_blends_and_masks() {
    // ALPHABLEND with per-pixel alpha: transparent around the icon.
    let r = fixture("office-icon-alpha.emf", 4.0);
    assert_eq!(px(&r, 4, 4)[3], 0, "corner is transparent");
    assert!(px(&r, 160, 30)[3] > 200, "icon body is opaque");
    // SRCAND + SRCINVERT mask pair: transparent around the page outline.
    let r = fixture("office-icon-mask.emf", 4.0);
    assert_eq!(px(&r, 4, 4)[3], 0);
    assert!(
        r.pixels.chunks_exact(4).any(|p| p[3] > 200 && p[0] < 60),
        "black outline drawn"
    );
}

#[test]
fn generated_feature_fixtures() {
    // features.emf: 480 × 360 pt; red square with a 3 px pen, hatches, text, bitmaps.
    let r = fixture("features.emf", 1.0);
    assert!(near(px(&r, 40, 40), [220, 40, 40]));
    assert!(
        near(px(&r, 7, 40), [0, 0, 0]),
        "geometric pen outline: {:?}",
        px(&r, 7, 40)
    );
    assert!(
        near(px(&r, 330, 262), [255, 0, 0]),
        "stretched DIB: {:?}",
        px(&r, 330, 262)
    );
    // transform.emf: ALTERNATE leaves the first star open, WINDING fills the second.
    let r = fixture("transform.emf", 1.0);
    assert_eq!(px(&r, 45, 50)[3], 0);
    assert!(near(px(&r, 135, 50), [250, 120, 0]));
    // features.wmf: object slot reuse keeps the blue ellipse blue.
    let r = fixture("features.wmf", 1.0);
    assert!(
        near(px(&r, 216, 40), [50, 90, 220]),
        "{:?}",
        px(&r, 216, 40)
    );
}

#[test]
fn corpus_metafiles_render() {
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/corpus");
    let mut decks = Vec::new();
    let mut stack = vec![dir];
    while let Some(d) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&d) else {
            continue;
        };
        for e in entries.flatten() {
            let p = e.path();
            if p.is_dir() {
                stack.push(p);
            } else if p.extension().is_some_and(|x| x == "pptx") {
                decks.push(p);
            }
        }
    }
    let mut seen = 0;
    for deck in decks {
        let Ok(bytes) = std::fs::read(&deck) else {
            continue;
        };
        let Ok(zip) = crate::zip::Archive::parse(&bytes) else {
            continue;
        };
        for entry in zip.entries() {
            let lower = entry.name.to_lowercase();
            if !(lower.ends_with(".emf") || lower.ends_with(".wmf")) {
                continue;
            }
            let Ok(data) = zip.read(entry) else { continue };
            let name = format!("{}:{}", deck.display(), entry.name);
            let m = match super::super::parse(&data, fonts()) {
                Ok(m) => m,
                Err(crate::Error::Unsupported(_)) => continue,
                Err(e) => panic!("{name}: {e}"),
            };
            let r = render(&m, 160.0 / m.width_pt.max(m.height_pt));
            assert!(coverage(&r) > 0.001, "{name}: blank output");
            seen += 1;
        }
    }
    eprintln!("rendered {seen} corpus metafiles");
}
