//! Typesetting metrics: fractions on the axis, scripts shifted, delimiters
//! stretched, operators sized for display.

use super::super::preview::math_props;
use super::*;
use crate::model::color::Rgba;
use crate::path::Rect;

const SIZE: f32 = 20.0;
/// Cambria Math's axis height in points at `SIZE`.
const AXIS: f32 = 0.2856 * SIZE;

fn set(latex: &str, display: bool) -> MathBox {
    let eq = parse_latex(latex, display).unwrap();
    typeset(&eq, &math_props(SIZE, Rgba::BLACK), 1.0, fonts(), false)
}

/// Ink bounds of the glyphs (and rules) of a box.
fn ink(items: &[&MathItem]) -> Rect {
    let mut out: Option<Rect> = None;
    for item in items {
        let r = match item {
            MathItem::Glyph(g) => {
                let Some(b) = fonts().outline(g.face, g.glyph).and_then(|p| p.bounds()) else {
                    continue;
                };
                Rect::from_xywh(
                    g.x + b.x * g.size,
                    g.y + b.y * g.size,
                    b.w * g.size,
                    b.h * g.size,
                )
            }
            MathItem::Rule { rect, .. } => *rect,
            MathItem::Line { from, to, .. } => Rect::from_ltrb(
                from.x.min(to.x),
                from.y.min(to.y),
                from.x.max(to.x),
                from.y.max(to.y),
            ),
        };
        out = Some(out.map_or(r, |o| o.union(&r)));
    }
    out.unwrap_or_default()
}

fn glyphs(b: &MathBox) -> Vec<&MathGlyph> {
    b.items
        .iter()
        .filter_map(|i| match i {
            MathItem::Glyph(g) => Some(g),
            _ => None,
        })
        .collect()
}

fn rules(b: &MathBox) -> Vec<Rect> {
    b.items
        .iter()
        .filter_map(|i| match i {
            MathItem::Rule { rect, .. } => Some(*rect),
            _ => None,
        })
        .collect()
}

#[test]
fn fraction_bar_sits_on_the_math_axis() {
    let b = set(r"\frac{a}{b}", true);
    let bars = rules(&b);
    assert_eq!(bars.len(), 1);
    let bar = bars[0];
    let center = bar.y + bar.h / 2.0;
    assert!(
        (center + AXIS).abs() < 0.01,
        "bar center {center}, axis {}",
        -AXIS
    );
    let g = glyphs(&b);
    let num = ink(&[&MathItem::Glyph(g[0].clone())]);
    let den = ink(&[&MathItem::Glyph(g[1].clone())]);
    assert!(num.bottom() < bar.y, "numerator above the bar");
    assert!(den.y > bar.bottom(), "denominator below the bar");
    // Display fractions keep full-size parts; inline ones shrink them.
    assert_eq!(g[0].size, SIZE);
    let inline = set(r"\frac{a}{b}", false);
    assert!(glyphs(&inline)[0].size < SIZE);
    // The bar covers the wider part.
    assert!(bar.w >= num.w.max(den.w));
}

#[test]
fn operators_center_on_the_same_axis() {
    let b = set("+", false);
    let plus = ink(&b.items.iter().collect::<Vec<_>>());
    let center = plus.y + plus.h / 2.0;
    assert!(
        (center + AXIS).abs() < 0.03 * SIZE,
        "plus centered at {center}"
    );
    // An operator from the math font is lifted to the same axis.
    let b = set(r"\oplus", false);
    let oplus = ink(&b.items.iter().collect::<Vec<_>>());
    let center = oplus.y + oplus.h / 2.0;
    assert!(
        (center + AXIS).abs() < 0.03 * SIZE,
        "oplus centered at {center}"
    );
}

#[test]
fn scripts_are_raised_lowered_and_smaller() {
    let b = set("x^2", false);
    let g = glyphs(&b);
    assert_eq!(g[0].y, 0.0);
    assert!(g[1].y < -0.3 * SIZE, "superscript baseline {}", g[1].y);
    assert!((g[1].size - 0.73 * SIZE).abs() < 0.01);
    assert!(g[1].x >= g[0].x + 0.4 * SIZE, "after the base");
    let b = set("x_i", false);
    let g = glyphs(&b);
    assert!(g[1].y > 0.1 * SIZE, "subscript baseline {}", g[1].y);
    // Both: the superscript (placed first) stays above the subscript with a gap.
    let b = set("x_i^2", false);
    let g = glyphs(&b);
    let sup = ink(&[&MathItem::Glyph(g[1].clone())]);
    let sub = ink(&[&MathItem::Glyph(g[2].clone())]);
    assert!(sup.bottom() + 0.1 * SIZE < sub.y, "gap between scripts");
    // Primes stay at full size.
    let b = set("f'", false);
    assert_eq!(glyphs(&b)[1].size, SIZE);
}

#[test]
fn delimiters_grow_with_their_content() {
    let plain = set("(a)", false);
    let tall = set(r"\left(\frac{a}{b}\right)", true);
    let paren = |b: &MathBox| ink(&[&b.items[0]]);
    let content = ink(&tall.items[1..tall.items.len() - 1]
        .iter()
        .collect::<Vec<_>>());
    let p = paren(&tall);
    assert!(
        p.h > paren(&plain).h * 1.5,
        "{} vs {}",
        p.h,
        paren(&plain).h
    );
    assert!(p.y <= content.y + 0.05 * SIZE && p.bottom() >= content.bottom() - 0.05 * SIZE);
    // Centered on the axis.
    let center = p.y + p.h / 2.0;
    assert!(
        (center + AXIS).abs() < 0.05 * SIZE,
        "paren centered at {center}"
    );
    // Very tall content is covered by an assembly of parts.
    let huge = set(
        r"\left(\begin{matrix}a\\b\\c\\d\\e\\f\\g\\h\end{matrix}\right)",
        true,
    );
    assert!(glyphs(&huge).len() > 8 + 2, "assembled from parts");
    assert!(ink(&[&huge.items[0]]).h > 0.0);
}

#[test]
fn large_operators_are_larger_in_display() {
    let display = set(r"\sum_{i=1}^{n} i", true);
    let inline = set(r"\sum_{i=1}^{n} i", false);
    let op = |b: &MathBox| ink(&[&b.items[0]]);
    assert!(op(&display).h > op(&inline).h * 1.2);
    // Display limits sit under and over; inline ones to the side.
    let lowest = |b: &MathBox| {
        let g = glyphs(b);
        let last = g.iter().max_by(|a, b| a.y.total_cmp(&b.y)).unwrap();
        ink(&[&MathItem::Glyph((*last).clone())])
    };
    let sum = op(&display);
    assert!(
        lowest(&display).y > sum.bottom(),
        "lower limit under the sum"
    );
    assert!(
        lowest(&inline).x > op(&inline).x + op(&inline).w * 0.5,
        "lower limit beside the sum"
    );
}

#[test]
fn radicals_cover_their_body() {
    let b = set(r"\sqrt{\frac{a}{b}}", true);
    let r = rules(&b);
    // The vinculum (radical bar) is the topmost rule.
    let top = r.iter().map(|r| r.y).fold(f32::MAX, f32::min);
    // The sign comes first, then the body's glyphs.
    let body_items: Vec<MathItem> = glyphs(&b)[1..]
        .iter()
        .map(|g| MathItem::Glyph((*g).clone()))
        .collect();
    let body = ink(&body_items.iter().collect::<Vec<_>>());
    assert!(top < body.y, "rule above the body");
    assert!(b.ascent > -top);
}

#[test]
fn matrices_and_arrays_center_on_the_axis() {
    let b = set(r"\begin{matrix}a & b \\ c & d\end{matrix}", true);
    let center = (b.descent - b.ascent) / 2.0;
    assert!(
        (center + AXIS).abs() < 0.05 * SIZE,
        "matrix centered at {center}"
    );
    let g = glyphs(&b);
    assert!(g[0].y < g[2].y, "rows stacked");
    assert!(g[1].x > g[0].x, "columns side by side");
}

#[test]
fn accents_bars_and_braces_sit_over_or_under() {
    let b = set(r"\hat{x}", false);
    let g = glyphs(&b);
    assert!(
        ink(&[&MathItem::Glyph(g[1].clone())]).bottom()
            < ink(&[&MathItem::Glyph(g[0].clone())]).y + 0.05 * SIZE
    );
    let b = set(r"\overline{x}", false);
    assert!(rules(&b)[0].bottom() < -0.4 * SIZE);
    let b = set(r"\underline{x}", false);
    assert!(rules(&b)[0].y > 0.0);
    let b = set(r"\underbrace{a+b}_{n}", true);
    let g = glyphs(&b);
    let brace_and_label = ink(&g[3..]
        .iter()
        .map(|g| MathItem::Glyph((*g).clone()))
        .collect::<Vec<_>>()
        .iter()
        .collect::<Vec<_>>());
    assert!(brace_and_label.y > 0.0, "brace and label under the base");
}

#[test]
fn display_lines_stack_and_justify() {
    let mut eq = parse_latex(r"a=b \\ a+b+c=d", true).unwrap();
    let b = typeset(&eq, &math_props(SIZE, Rgba::BLACK), 1.0, fonts(), false);
    let g = glyphs(&b);
    assert!(g.last().unwrap().y > SIZE, "second line below");
    // Centered as a group: the lines start together.
    assert!(g[0].x.abs() < 0.01);
    // Centered: the short line is indented.
    eq.justify = Justify::Center;
    let b = typeset(&eq, &math_props(SIZE, Rgba::BLACK), 1.0, fonts(), false);
    assert!(glyphs(&b)[0].x > 0.5 * SIZE);
}

#[test]
fn placeholders_mark_empty_slots() {
    let eq = parse_latex(r"\frac{}{}", true).unwrap();
    let plain = typeset(&eq, &math_props(SIZE, Rgba::BLACK), 1.0, fonts(), false);
    let editing = typeset(&eq, &math_props(SIZE, Rgba::BLACK), 1.0, fonts(), true);
    assert_eq!(rules(&plain).len(), 1, "just the bar");
    assert!(rules(&editing).len() > 8, "dotted boxes");
}
