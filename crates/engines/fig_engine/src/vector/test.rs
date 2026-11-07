use super::*;

/// Little-endian words, as Figma writes a network blob.
fn words(items: &[Word]) -> Vec<u8> {
    let mut out = Vec::new();
    for w in items {
        match w {
            Word::U(v) => out.extend_from_slice(&v.to_le_bytes()),
            Word::F(v) => out.extend_from_slice(&v.to_le_bytes()),
        }
    }
    out
}

enum Word {
    U(u32),
    F(f32),
}
use Word::{F, U};

/// A rounded rectangle the way Figma's networks draw one: a vertex at each
/// end of each straight side, curved segments around the corners, and one
/// even-odd region with the loop.
fn rounded_rect_blob() -> Vec<u8> {
    let (w, h, r, k) = (20.0, 10.0, 2.0, 1.1046);
    let vertices = [
        (0.0, r),
        (r, 0.0),
        (w - r, 0.0),
        (w, r),
        (w, h - r),
        (w - r, h),
        (r, h),
        (0.0, h - r),
    ];
    let mut items = vec![U(8), U(8), U(1)];
    for (x, y) in vertices {
        items.extend([U(0), F(x), F(y)]);
    }
    // Corners curve; sides are straight.
    let tangents = [
        ((0.0, -k), (-k, 0.0)),
        ((0.0, 0.0), (0.0, 0.0)),
        ((k, 0.0), (0.0, -k)),
        ((0.0, 0.0), (0.0, 0.0)),
        ((0.0, k), (k, 0.0)),
        ((0.0, 0.0), (0.0, 0.0)),
        ((-k, 0.0), (0.0, k)),
        ((0.0, 0.0), (0.0, 0.0)),
    ];
    for (i, (a, b)) in tangents.into_iter().enumerate() {
        items.extend([
            U(0),
            U(i as u32),
            F(a.0),
            F(a.1),
            U((i as u32 + 1) % 8),
            F(b.0),
            F(b.1),
        ]);
    }
    items.extend([U(0), U(1), U(8)]);
    items.extend((0..8).map(U));
    words(&items)
}

#[test]
fn decodes_and_encodes_figma_blobs() {
    let blob = rounded_rect_blob();
    let net = Network::decode(&blob).unwrap();
    assert_eq!(net.vertices.len(), 8);
    assert_eq!(net.segments.len(), 8);
    assert_eq!(net.regions.len(), 1);
    assert_eq!(net.regions[0].rule(), WindingRule::EvenOdd);
    assert_eq!(net.regions[0].loops, vec![(0..8).collect::<Vec<u32>>()]);
    assert_eq!(net.segments[0].tangent_start, Point { x: 0.0, y: -1.1046 });
    assert_eq!(net.vertices[2].x, 18.0);
    assert_eq!(net.encode(), blob, "encodes back to the same bytes");
}

#[test]
fn rejects_malformed_blobs() {
    let mut blob = rounded_rect_blob();
    blob.truncate(blob.len() - 4);
    assert!(Network::decode(&blob).is_none());
    // A segment pointing past the vertices.
    let bad = words(&[
        U(1),
        U(1),
        U(0),
        U(0),
        F(0.0),
        F(0.0),
        U(0),
        U(0),
        F(0.0),
        F(0.0),
        U(5),
        F(0.0),
        F(0.0),
    ]);
    assert!(Network::decode(&bad).is_none());
}

#[test]
fn fills_regions_and_strokes_every_segment() {
    let net = Network::decode(&rounded_rect_blob()).unwrap();
    let fills = net.fill_paths();
    assert_eq!(fills.len(), 1);
    let b = fills[0].0.compute_tight_bounds().unwrap();
    assert!((b.width() - 20.0).abs() < 1e-3 && (b.height() - 10.0).abs() < 1e-3);
    let stroke = net.stroke_path().unwrap();
    let closes = stroke
        .segments()
        .filter(|s| matches!(s, PathSegment::Close))
        .count();
    assert_eq!(closes, 1, "one closed loop");
    let bounds = net.bounds();
    assert!((bounds.w - 20.0).abs() < 1e-3 && (bounds.h - 10.0).abs() < 1e-3);
}

#[test]
fn open_paths_have_no_fill() {
    let net: Network = serde_json::from_str(
        r#"{"vertices":[{"x":0,"y":0},{"x":10,"y":0},{"x":10,"y":10}],
            "segments":[{"start":0,"end":1},{"start":1,"end":2,"tangentStart":{"x":5,"y":0},"tangentEnd":{"x":0,"y":-5}}]}"#,
    )
    .unwrap();
    assert!(net.is_valid());
    assert!(net.fill_paths().is_empty());
    let stroke = net.stroke_path().unwrap();
    assert!(
        stroke
            .segments()
            .any(|s| matches!(s, PathSegment::CubicTo(..)))
    );
    assert!(!stroke.segments().any(|s| matches!(s, PathSegment::Close)));
}

#[test]
fn closed_loops_fill_without_regions() {
    let net: Network = serde_json::from_str(
        r#"{"vertices":[{"x":0,"y":0},{"x":10,"y":0},{"x":5,"y":8}],
            "segments":[{"start":0,"end":1},{"start":1,"end":2},{"start":2,"end":0}]}"#,
    )
    .unwrap();
    let fills = net.fill_paths();
    assert_eq!(fills.len(), 1);
    assert_eq!(fills[0].1, WindingRule::NonZero);
}

#[test]
fn converts_paths_to_networks() {
    let rect = tiny_skia::Rect::from_xywh(0.0, 0.0, 10.0, 20.0).unwrap();
    let oval = PathBuilder::from_oval(rect).unwrap();
    let net = Network::from_path(&oval, WindingRule::NonZero);
    // tiny-skia draws an oval with eight quadratic arcs.
    assert_eq!(net.segments.len(), 8);
    assert_eq!(net.vertices.len(), 8, "the closing point joins the first");
    assert_eq!(net.regions[0].loops[0].len(), 8);
    let b = net.bounds();
    assert!((b.w - 10.0).abs() < 1e-3 && (b.h - 20.0).abs() < 1e-3);
    // And back: the same area.
    let filled = &net.fill_paths()[0].0;
    let fb = filled.compute_tight_bounds().unwrap();
    assert!((fb.width() - 10.0).abs() < 1e-3);
}

#[test]
fn transforms_vertices_and_tangents() {
    let net = Network::decode(&rounded_rect_blob()).unwrap();
    let moved = net.transformed(&Affine::translate(5.0, 0.0).mul(&Affine::scale(2.0, 1.0)));
    assert_eq!(moved.vertices[2].x, 41.0);
    assert_eq!(moved.segments[2].tangent_start.x, 2.0 * 1.1046);
}
