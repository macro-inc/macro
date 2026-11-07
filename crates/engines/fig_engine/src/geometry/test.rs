use super::*;
use crate::testing::path_blob;

fn square() -> ParsedPath {
    parse_blob(&path_blob(&[
        (1, &[0.0, 0.0]),
        (2, &[10.0, 0.0]),
        (2, &[10.0, 10.0]),
        (2, &[0.0, 10.0]),
        (0, &[]),
    ]))
    .unwrap()
}

#[test]
fn parses_command_blobs() {
    let p = square();
    let b = p.bounds();
    assert_eq!((b.x, b.y, b.w, b.h), (0.0, 0.0, 10.0, 10.0));
    assert!(p.contains(Vec2::new(5.0, 5.0), WindingRule::NonZero));
    assert!(!p.contains(Vec2::new(15.0, 5.0), WindingRule::NonZero));
}

#[test]
fn parses_curves() {
    let p = parse_blob(&path_blob(&[
        (1, &[0.0, 0.0]),
        (3, &[5.0, 10.0, 10.0, 0.0]),
        (4, &[10.0, -5.0, 0.0, -5.0, 0.0, 0.0]),
        (0, &[]),
    ]))
    .unwrap();
    let b = p.bounds();
    assert!(b.w > 9.9 && b.h > 5.0);
}

#[test]
fn rejects_truncated_blobs() {
    // A line command missing its second coordinate.
    let mut bytes = path_blob(&[(1, &[0.0, 0.0]), (2, &[10.0])]);
    bytes.truncate(bytes.len() - 1);
    assert!(parse_blob(&bytes).is_none());
    assert!(parse_blob(&[]).is_none());
}

#[test]
fn builds_rounded_rectangles() {
    let radii = CornerRadii {
        top_left: 4.0,
        top_right: 4.0,
        bottom_right: 4.0,
        bottom_left: 4.0,
    };
    let p = rounded_rect(20.0, 10.0, radii, 0.0).unwrap();
    let b = p.bounds();
    assert_eq!((b.width(), b.height()), (20.0, 10.0));
    // The corner itself is cut away.
    let corner = Vec2::new(0.2, 0.2);
    assert!(distance_to_outline(&p, corner) > 0.5);
    assert!(rounded_rect(0.0, 10.0, radii, 0.0).is_none());
}

#[test]
fn writes_svg_paths() {
    let mut out = String::new();
    to_svg(&square().path, &Affine::translate(1.0, 2.0), &mut out);
    assert!(out.starts_with("M1.00 2.00L11.00 2.00"), "{out}");
    assert!(out.contains('Z'));
}
