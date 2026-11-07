//! Builders and checks shared by the compositor's tests: synthetic
//! documents of solid layers, and pixel comparisons.

use crate::model::{BlendMode, Document, Layer, LayerIdx, LayerKind};
use crate::raster::{IRect, Raster};

/// An RGBA raster of one color over `rect`.
pub(crate) fn solid(rect: IRect, rgba: [u8; 4]) -> Raster {
    let data: Vec<u8> = rgba
        .iter()
        .copied()
        .cycle()
        .take(rect.area() as usize * 4)
        .collect();
    Raster::from_region(4, rect, &data)
}

/// A raster from a function of canvas position.
pub(crate) fn painted(rect: IRect, f: impl Fn(i32, i32) -> [u8; 4]) -> Raster {
    let mut data = Vec::with_capacity(rect.area() as usize * 4);
    for y in rect.y..rect.bottom() {
        for x in rect.x..rect.right() {
            data.extend_from_slice(&f(x, y));
        }
    }
    Raster::from_region(4, rect, &data)
}

/// Adds a layer at the top of the document.
pub(crate) fn add(doc: &mut Document, mut layer: Layer) -> LayerIdx {
    layer.id = doc.allocate_id();
    let idx = doc.push_layer(layer);
    doc.roots.push(idx);
    idx
}

/// Adds a pixel layer of one color over `rect` at the top.
pub(crate) fn add_solid(doc: &mut Document, rect: IRect, rgba: [u8; 4]) -> LayerIdx {
    let mut l = Layer::new(0, "solid");
    l.pixels = solid(rect, rgba);
    add(doc, l)
}

/// Moves top-level layers (bottom to top) into a new group at the top.
pub(crate) fn group(doc: &mut Document, children: &[LayerIdx], blend: BlendMode) -> LayerIdx {
    let mut g = Layer::new(0, "group");
    g.kind = LayerKind::Group {
        open: true,
        artboard: None,
    };
    g.blend = blend;
    g.children = children.to_vec();
    let gi = add(doc, g);
    doc.roots.retain(|r| !children.contains(r));
    for &c in children {
        doc.layer_mut(c).parent = Some(gi);
    }
    gi
}

/// The pixel at `(x, y)` of a render of `rect`.
pub(crate) fn px(out: &[u8], rect: IRect, x: i32, y: i32) -> [u8; 4] {
    let i = (((y - rect.y) * rect.w) + (x - rect.x)) as usize * 4;
    [out[i], out[i + 1], out[i + 2], out[i + 3]]
}

/// Asserts two pixels match within `tol` per channel.
#[track_caller]
pub(crate) fn assert_px(actual: [u8; 4], expected: [u8; 4], tol: u8) {
    let ok = actual
        .iter()
        .zip(&expected)
        .all(|(a, e)| a.abs_diff(*e) <= tol);
    assert!(ok, "pixel {actual:?} != {expected:?} (±{tol})");
}

/// Renders a document area with a fresh renderer.
pub(crate) fn render(doc: &Document, rect: IRect, level: u8) -> Vec<u8> {
    super::Renderer::new().render(doc, rect, level)
}
