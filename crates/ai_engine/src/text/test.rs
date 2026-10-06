use super::*;
use crate::model::Paint;

fn text(s: &str, width: Option<f64>, align: TextAlign) -> TextNode {
    TextNode {
        text: s.into(),
        family: "Inter".into(),
        style: "Regular".into(),
        size: 20.0,
        fill: Some(Paint::Solid {
            color: crate::model::Color::BLACK,
        }),
        stroke: None,
        align,
        line_height: 1.5,
        tracking: 0.0,
        width,
        runs: None,
    }
}

#[test]
fn point_text_breaks_at_returns() {
    let l = layout(&text("one\ntwo three", None, TextAlign::Left));
    assert_eq!(l.lines.len(), 2);
    assert_eq!(l.lines[1].baseline, 30.0);
    assert!(l.lines[1].x1 > l.lines[0].x1);
    assert_eq!((l.lines[1].start, l.lines[1].end), (4, 13));
}

#[test]
fn area_text_wraps_at_its_width() {
    let t = text("lorem ipsum dolor sit amet", Some(80.0), TextAlign::Left);
    let l = layout(&t);
    assert!(l.lines.len() >= 3, "{}", l.lines.len());
    for line in &l.lines {
        assert!(line.x1 - line.x0 <= 80.0 + 1e-6, "{line:?}");
    }
    assert!(bounds(&t).expect("bounds").width() >= 80.0);
}

#[test]
fn alignment_moves_lines() {
    let left = layout(&text("abc", None, TextAlign::Left));
    let center = layout(&text("abc", None, TextAlign::Center));
    let right = layout(&text("abc", None, TextAlign::Right));
    let w = left.lines[0].x1;
    assert!((center.lines[0].x0 + w / 2.0).abs() < 1e-6);
    assert!((right.lines[0].x0 + w).abs() < 1e-6);
}

#[test]
fn outlines_and_hits() {
    let t = text("Hi", None, TextAlign::Left);
    let o = outlines(&t);
    let b = o.bounds().expect("glyphs draw");
    assert!(
        b.y1 <= 1.0 && b.y0 < -10.0,
        "above the baseline, y down: {b:?}"
    );
    assert_eq!(hit(&t, crate::geom::Point::new(-5.0, -5.0)), 0);
    assert_eq!(hit(&t, crate::geom::Point::new(500.0, -5.0)), 2);
}
