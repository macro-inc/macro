use super::*;
use crate::model::{AntiAlias, ParagraphRun, TextOrientation, TextRun};

fn text(s: &str, size: f32, area: Option<[f64; 4]>) -> TextLayer {
    let len = s.encode_utf16().count() as u32;
    TextLayer {
        text: s.to_string(),
        runs: vec![TextRun {
            length: len,
            style: TextStyle {
                size,
                color: Rgb::new(1.0, 0.0, 0.0),
                ..TextStyle::default()
            },
        }],
        paragraphs: vec![ParagraphRun {
            length: len,
            align: TextAlign::Left,
        }],
        transform: [1.0, 0.0, 0.0, 1.0, 20.0, 50.0],
        area,
        orientation: TextOrientation::Horizontal,
        anti_alias: AntiAlias::Smooth,
        warped: false,
    }
}

#[test]
fn postscript_names_split_into_family_and_style() {
    assert_eq!(
        family_and_style("MyriadPro-BoldIt"),
        ("Myriad Pro".to_string(), "Bold Italic".to_string())
    );
    assert_eq!(
        family_and_style("ArialMT"),
        ("Arial".to_string(), "Regular".to_string())
    );
    assert_eq!(
        family_and_style("Arial-BoldMT"),
        ("Arial".to_string(), "Bold".to_string())
    );
    assert_eq!(
        family_and_style("Helvetica"),
        ("Helvetica".to_string(), "Regular".to_string())
    );
}

#[test]
fn point_text_sits_on_its_baseline() {
    let pixels = render(&text("Hello", 40.0, None));
    let b = pixels.content_bounds().expect("text draws");
    // The baseline is at y = 50: capitals rise above it, nothing hangs far
    // below it, and the text starts at the anchor.
    assert!(b.bottom() <= 52, "{b:?}");
    assert!(b.y < 30, "{b:?}");
    assert!((b.x - 20).abs() <= 4, "{b:?}");
    // Red, as styled.
    let mid = pixels.get(b.x + b.w / 4, b.y + b.h / 2);
    let any_red = (b.y..b.bottom()).any(|y| {
        let p = pixels.get(b.x + 2, y);
        p[3] > 200 && p[0] > 200 && p[1] < 50
    }) || mid[0] > 200;
    assert!(any_red);
}

#[test]
fn area_text_wraps_inside_its_box() {
    let long = "the quick brown fox jumps over the lazy dog again and again";
    let wrapped = render(&text(long, 20.0, Some([0.0, 0.0, 200.0, 400.0])));
    let b = wrapped.content_bounds().expect("text draws");
    assert!(b.right() <= 20 + 200 + 4, "{b:?}");
    // Several lines.
    assert!(b.h > 60, "{b:?}");
    let single = render(&text(long, 20.0, None));
    let s = single.content_bounds().expect("text draws");
    assert!(s.w > 400 && s.h < 40, "{s:?}");
}

#[test]
fn centered_point_text_straddles_its_anchor() {
    let mut t = text("Centered", 30.0, None);
    t.paragraphs[0].align = TextAlign::Center;
    let b = render(&t).content_bounds().expect("text draws");
    assert!(b.x < 20 && b.right() > 20, "{b:?}");
}

#[test]
fn empty_text_draws_nothing() {
    assert!(render(&text("", 20.0, None)).is_empty());
    assert!(render(&text("   ", 20.0, None)).is_empty());
}
