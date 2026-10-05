//! Compositing: the document's layers blended into pixels for any canvas
//! area at any power-of-two scale.
//!
//! Where the stored merged image is current ([`crate::model::Composite`]),
//! it is drawn as is; elsewhere the layers are composited: blend modes,
//! opacity and fill opacity, pixel and vector masks, clipping groups,
//! pass-through and isolated groups, adjustment and fill layers, Blend If,
//! and layer styles. Output is straight RGBA8 over transparency.

pub mod adjust;
pub mod blend;

use crate::model::{Document, LayerIdx};
use crate::raster::IRect;

/// Composites documents, keeping downscaled layers and other derived data
/// between calls.
#[derive(Default)]
pub struct Renderer {}

impl Renderer {
    /// A renderer with empty caches.
    pub fn new() -> Renderer {
        Renderer::default()
    }

    /// Composites `rect` of the canvas scaled down by `2^level` (so
    /// `rect` is in pixels of that scale): straight RGBA8, row by row.
    pub fn render(&mut self, doc: &Document, rect: IRect, level: u8) -> Vec<u8> {
        let _ = (doc, rect, level);
        todo!("Renderer::render")
    }

    /// One layer alone (with its masks, and its effects when `effects`),
    /// at `level`, over `rect`, for thumbnails and exports.
    pub fn render_layer(
        &mut self,
        doc: &Document,
        layer: LayerIdx,
        rect: IRect,
        level: u8,
        effects: bool,
    ) -> Vec<u8> {
        let _ = (doc, layer, rect, level, effects);
        todo!("Renderer::render_layer")
    }

    /// Drops everything cached (after an edit the renderer cannot track,
    /// such as resizing the canvas).
    pub fn clear(&mut self) {}
}

/// The canvas area a layer can change, effects and masks included (for a
/// group, everything in it): what to re-render after it changes.
pub fn visual_bounds(doc: &Document, layer: LayerIdx) -> Option<IRect> {
    let _ = (doc, layer);
    todo!("render::visual_bounds")
}
