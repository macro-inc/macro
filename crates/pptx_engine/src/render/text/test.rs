use super::*;
use crate::model::presentation::Presentation;
use crate::model::shape::{Inherit, WalkCtx, resolve_tree, sp_tree};
use crate::test_support::{deck, fonts, text_box};

fn lay(xml: &str, w_emu: i64) -> TextLayout {
    let sp = text_box(2, 0, 0, w_emu, 1_270_000, xml);
    let mut p = Presentation::open(deck(&[&sp])).unwrap();
    let ctx = p.slide_context(0).unwrap();
    let tree = sp_tree(&ctx.slide.doc).unwrap();
    let shapes = resolve_tree(
        &WalkCtx {
            ctx: &ctx,
            inherit: Inherit::Slide,
        },
        &ctx.slide,
        tree,
    );
    let body = shapes[0].text.clone().unwrap();
    let w = w_emu as f32 / 12700.0;
    layout(&body, w, 100.0, fonts(), LayoutParams::from_body(&body))
}

#[test]
fn wraps_at_word_boundaries() {
    let l = lay(
        "<a:p><a:r><a:rPr lang=\"en-US\" sz=\"1800\"/><a:t>The quick brown fox jumps over the lazy dog</a:t></a:r></a:p>",
        1_270_000,
    );
    assert!(l.lines.len() >= 2, "{} lines", l.lines.len());
    for line in &l.lines {
        let last = line.stops.last().unwrap().x;
        assert!(last <= 100.0 - 7.2 + 0.5, "line overflows: {last}");
    }
    // Single spacing is 1.2× the font size, whatever the font.
    let pitch = l.lines[1].baseline - l.lines[0].baseline;
    assert!((pitch - 18.0 * 1.2).abs() < 0.01, "pitch {pitch}");
    // The first baseline sits one font size below the top inset.
    assert!(
        (l.lines[0].baseline - (3.6 + 18.0)).abs() < 0.01,
        "{}",
        l.lines[0].baseline
    );
}

#[test]
fn caret_stops_cover_every_character() {
    let l = lay(
        "<a:p><a:r><a:rPr lang=\"en-US\"/><a:t>ab</a:t></a:r><a:br><a:rPr lang=\"en-US\"/></a:br><a:r><a:rPr lang=\"en-US\"/><a:t>c</a:t></a:r></a:p>",
        2_540_000,
    );
    assert_eq!(l.lines.len(), 2);
    let idx: Vec<usize> = l.lines[0].stops.iter().map(|s| s.index).collect();
    assert_eq!(idx, vec![0, 1, 2]);
    let idx: Vec<usize> = l.lines[1].stops.iter().map(|s| s.index).collect();
    assert_eq!(idx, vec![3, 4], "the break occupies index 2");
}

#[test]
fn alignment_and_bullets() {
    let centered = lay(
        "<a:p><a:pPr algn=\"ctr\"/><a:r><a:rPr lang=\"en-US\"/><a:t>Hi</a:t></a:r></a:p>",
        2_540_000,
    );
    let first = centered.lines[0].stops[0].x;
    let last = centered.lines[0].stops.last().unwrap().x;
    assert!(
        ((first + last) / 2.0 - 100.0).abs() < 0.5,
        "centered in the 200pt box"
    );
    let numbered = lay(
        "<a:p><a:pPr marL=\"342900\" indent=\"-342900\"><a:buFont typeface=\"+mj-lt\"/><a:buAutoNum type=\"arabicPeriod\"/></a:pPr><a:r><a:rPr lang=\"en-US\"/><a:t>One</a:t></a:r></a:p><a:p><a:pPr marL=\"342900\" indent=\"-342900\"><a:buAutoNum type=\"arabicPeriod\"/></a:pPr><a:r><a:rPr lang=\"en-US\"/><a:t>Two</a:t></a:r></a:p>",
        2_540_000,
    );
    assert!(
        (numbered.lines[0].stops[0].x - (7.2 + 27.0)).abs() < 0.01,
        "text starts at marL"
    );
    // "1." + "One" + "2." + "Two".
    let glyphs: usize = numbered.runs.iter().map(|r| r.glyphs.len()).sum();
    assert_eq!(glyphs, 10);
}

#[test]
fn autonumber_formats() {
    assert_eq!(autonum_text("arabicPeriod", 3), "3.");
    assert_eq!(autonum_text("romanUcPeriod", 4), "IV.");
    assert_eq!(autonum_text("alphaLcParenR", 28), "bb)");
    assert_eq!(autonum_text("arabicParenBoth", 1), "(1)");
    assert_eq!(autonum_text("circleNumDbPlain", 2), "\u{2461}");
}

/// A tab whose stop lies past the right edge moves to the next line, where
/// it still advances to the first stop (PowerPoint and LibreOffice agree).
#[test]
fn tabs_that_do_not_fit_start_the_next_line() {
    // 140 pt of text width: the second tab's stop (144 pt) is past the edge.
    let l = lay(
        "<a:p><a:r><a:rPr lang=\"en-US\" sz=\"1200\"/><a:t>\tAlpha beta \tend</a:t></a:r></a:p>",
        1_960_880,
    );
    assert_eq!(l.lines.len(), 2);
    let second = &l.lines[1];
    assert_eq!(
        second.stops.first().unwrap().index,
        12,
        "the tab opens line 2"
    );
    let end = second.stops.iter().find(|s| s.index == 13).unwrap();
    assert!((end.x - (7.2 + 72.0)).abs() < 0.5, "{}", end.x);
}
