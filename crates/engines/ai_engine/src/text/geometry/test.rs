use super::*;
use crate::model::TextAlign;

fn text(content: &str, align: TextAlign, width: Option<f64>) -> TextNode {
    TextNode {
        text: content.into(),
        family: "Inter".into(),
        style: "Regular".into(),
        size: 20.0,
        fill: None,
        stroke: None,
        align,
        line_height: 1.2,
        tracking: 0.0,
        width,
        runs: None,
    }
}

fn increasing(xs: &[f64]) -> bool {
    xs.windows(2).all(|w| w[1] >= w[0])
}

#[test]
fn lines_include_their_breaks() {
    let g = geometry(
        &text("Hi\nyou", TextAlign::Left, None),
        Affine::translate(10.0, 20.0),
    );
    assert_eq!(g.length, 6);
    assert_eq!(g.transform, Affine::translate(10.0, 20.0));
    assert_eq!(g.lines.len(), 2);
    let (first, second) = (&g.lines[0], &g.lines[1]);
    assert_eq!((first.start, first.end), (0, 3));
    assert_eq!((second.start, second.end), (3, 6));
    // A stop before each character and one at the end.
    assert_eq!(first.xs.len(), 4);
    assert_eq!(second.xs.len(), 4);
    assert_eq!(first.xs[0], 0.0);
    assert!(increasing(&first.xs) && increasing(&second.xs));
    // The break stands where the line ends.
    assert_eq!(first.xs[2], first.xs[3]);
    assert!(first.xs[2] > 0.0);
    // Lines are a line height apart, their boxes around the baselines.
    assert_eq!(first.baseline, 0.0);
    assert!((second.baseline - 24.0).abs() < 1e-9);
    assert!(first.top < 0.0 && first.top + first.height > 0.0);
}

#[test]
fn wrapped_lines_meet_without_a_break() {
    let g = geometry(
        &text("aaa bbb ccc", TextAlign::Left, Some(50.0)),
        Affine::IDENTITY,
    );
    assert!(g.lines.len() >= 2, "{:?}", g.lines);
    for pair in g.lines.windows(2) {
        assert_eq!(pair[0].end, pair[1].start);
        assert_eq!(pair[0].xs.len(), pair[0].end - pair[0].start + 1);
        assert!(pair[1].baseline > pair[0].baseline);
    }
    assert_eq!(g.lines.last().map(|l| l.end), Some(11));
    // Every wrapped line starts at the left edge.
    assert!(g.lines.iter().all(|l| l.xs[0] == 0.0));
}

#[test]
fn alignment_moves_the_stops() {
    let left = geometry(&text("Hello", TextAlign::Left, None), Affine::IDENTITY);
    let center = geometry(&text("Hello", TextAlign::Center, None), Affine::IDENTITY);
    let right = geometry(&text("Hello", TextAlign::Right, None), Affine::IDENTITY);
    let width = left.lines[0].xs[5];
    assert!(width > 0.0);
    // Point text is aligned around its anchor.
    assert!((center.lines[0].xs[0] + width / 2.0).abs() < 1e-6);
    assert!((right.lines[0].xs[5]).abs() < 1e-6);
}

#[test]
fn stops_count_utf16_units() {
    let g = geometry(&text("a😀b", TextAlign::Left, None), Affine::IDENTITY);
    assert_eq!(g.length, 4);
    let line = &g.lines[0];
    assert_eq!((line.start, line.end), (0, 4));
    assert_eq!(line.xs.len(), 5);
    // Both halves of the pair stand before the emoji.
    assert_eq!(line.xs[1], line.xs[2]);
    assert!(line.xs[3] > line.xs[2] && line.xs[4] > line.xs[3]);
}

#[test]
fn empty_text_has_one_stop() {
    let g = geometry(&text("", TextAlign::Left, None), Affine::IDENTITY);
    assert_eq!(g.length, 0);
    assert_eq!(g.lines.len(), 1);
    assert_eq!(g.lines[0].xs, vec![0.0]);
    assert!(g.lines[0].height > 0.0);
}

#[test]
fn a_trailing_break_starts_an_empty_line() {
    let g = geometry(&text("Hi\n", TextAlign::Left, None), Affine::IDENTITY);
    assert_eq!(g.lines.len(), 2);
    assert_eq!((g.lines[0].start, g.lines[0].end), (0, 3));
    assert_eq!((g.lines[1].start, g.lines[1].end), (3, 3));
    assert_eq!(g.lines[1].xs, vec![0.0]);
}
