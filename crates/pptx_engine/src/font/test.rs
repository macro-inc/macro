use super::*;
use crate::test_support::fonts;

#[test]
fn registers_bundled_families() {
    let db = fonts();
    assert_eq!(db.len(), 22);
    for fam in ["Carlito", "Caladea", "Liberation Sans", "Liberation Serif", "Liberation Mono", "DejaVu Sans"] {
        assert!(db.has_family(fam), "{fam}");
    }
}

#[test]
fn substitutes_metric_compatible_fonts() {
    let db = fonts();
    let c = db.select("Calibri", false, false).unwrap();
    assert_eq!(db.family(c.face), "Carlito");
    let b = db.select("Arial", true, false).unwrap();
    assert_eq!(db.family(b.face), "Liberation Sans");
    assert!(!b.synthetic_bold);
    let t = db.select("Times New Roman", false, true).unwrap();
    assert_eq!(db.family(t.face), "Liberation Serif");
    let unknown = db.select("Some Corporate Serif", false, false).unwrap();
    assert_eq!(db.family(unknown.face), "Liberation Serif");
    let dv = db.select("DejaVu Sans", false, true).unwrap();
    assert!(dv.synthetic_italic, "no italic DejaVu bundled");
    assert!(db.missing_families().iter().any(|f| f == "Calibri"));
}

#[test]
fn calibri_metrics_and_advances_match_calibri() {
    let db = fonts();
    let c = db.select("Calibri", false, false).unwrap();
    let m = db.metrics(c.face);
    // Calibri's Windows metrics: usWinAscent 1950, usWinDescent 550 (2048 upem);
    // Carlito exposes the same values (and the same 1.2207 em line height).
    assert!((m.win_ascent - 1950.0 / 2048.0).abs() < 1e-3, "{m:?}");
    assert!((m.win_descent - 550.0 / 2048.0).abs() < 1e-3);
    assert!((m.ascent + m.descent + m.line_gap - 2500.0 / 2048.0).abs() < 1e-3);
    let shaped = db.shape_chars(c.face, &['H', 'i']);
    // Calibri 'H' advance is 1276/2048 em.
    assert!((shaped[0].1 - 1276.0 / 2048.0).abs() < 1e-4, "{shaped:?}");
}

#[test]
fn kerning_pairs() {
    let db = fonts();
    let c = db.select("Arial", false, false).unwrap();
    let a = db.glyph(c.face, 'A').unwrap();
    let v = db.glyph(c.face, 'V').unwrap();
    assert!(db.kerning(c.face, a, v) < 0.0, "AV kerns tighter");
    let o = db.glyph(c.face, 'o').unwrap();
    assert_eq!(db.kerning(c.face, o, o), 0.0);
}

#[test]
fn outlines_are_cached_paths() {
    let db = fonts();
    let c = db.select("Calibri", false, false).unwrap();
    let g = db.glyph(c.face, 'O').unwrap();
    let p = db.outline(c.face, g).unwrap();
    let b = p.bounds().unwrap();
    assert!(b.y < 0.0 && b.bottom() > 0.0, "y down: glyph spans the baseline slightly ({b:?})");
    assert!(Arc::ptr_eq(&p, &db.outline(c.face, g).unwrap()));
    assert!(db.outline(c.face, db.glyph(c.face, ' ').unwrap()).is_none_or(|p| p.is_empty()));
}

#[test]
fn symbol_fonts_remap() {
    assert_eq!(remap_symbol(SymbolFont::Wingdings, '\u{a7}'), '\u{25AA}');
    assert_eq!(remap_symbol(SymbolFont::Wingdings, '\u{F0D8}'), '\u{27A2}');
    assert_eq!(remap_symbol(SymbolFont::Wingdings, '\u{fc}'), '\u{2713}');
    assert_eq!(remap_symbol(SymbolFont::Symbol, '\u{b7}'), '\u{2022}');
    assert_eq!(remap_symbol(SymbolFont::Symbol, 'a'), '\u{3b1}');
    assert_eq!(bundled_family_for("Calibri"), "Carlito");
    assert_eq!(bundled_family_for("Wingdings"), "DejaVu Sans");
    assert_eq!(bundled_family_for("Unknown Font"), "Liberation Sans");
}
