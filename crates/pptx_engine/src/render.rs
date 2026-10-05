//! Rendering: slide display lists and rasterization.

pub mod build;
pub mod chart;
pub mod image;
pub mod label;
pub mod metafile;
pub mod paint;
pub mod raster;
pub mod scene;
pub mod table;
pub mod text;

use crate::error::Result;
use crate::font::FontDb;
use crate::model::presentation::{PartRef, Presentation};
use crate::units::EMU_PER_PT;
pub use build::Layer;
use build::{Builder, PartLoader};
use paint::ImageSource;
use scene::{Node, Raster};
use std::sync::Arc;

/// Gives the slide builder access to parts and decoded pictures.
pub struct RenderLoader<'a> {
    /// The presentation being rendered.
    pub pres: &'a mut Presentation,
    /// Fonts (metafile text).
    pub fonts: &'a FontDb,
}

impl ImageSource for RenderLoader<'_> {
    fn raster(&mut self, part: &str) -> Option<Arc<Raster>> {
        if let Some(r) = self.pres.images.get(part) {
            return r.clone();
        }
        let decoded =
            self.pres
                .read_bytes(part)
                .ok()
                .and_then(|bytes| match image::sniff(&bytes) {
                    image::Format::Emf | image::Format::Wmf => metafile::parse(&bytes, self.fonts)
                        .ok()
                        .map(|m| Arc::new(metafile_raster(&m))),
                    _ => image::decode_raster(&bytes).ok().map(Arc::new),
                });
        self.pres.images.insert(part.to_owned(), decoded.clone());
        decoded
    }
}

impl PartLoader for RenderLoader<'_> {
    fn part(&mut self, name: &str) -> Option<PartRef> {
        self.pres.part(name).ok()
    }

    fn metafile(&mut self, part: &str) -> Option<Arc<metafile::Metafile>> {
        if let Some(m) = self.pres.metafiles.get(part) {
            return m.clone();
        }
        let parsed = self
            .pres
            .read_bytes(part)
            .ok()
            .and_then(|bytes| match image::sniff(&bytes) {
                image::Format::Emf | image::Format::Wmf => {
                    metafile::parse(&bytes, self.fonts).ok().map(Arc::new)
                }
                _ => None,
            });
        self.pres.metafiles.insert(part.to_owned(), parsed.clone());
        parsed
    }
}

/// Rasterizes a metafile at about 150 DPI (capped at 2048 pixels per side).
/// The longest side, in pixels, of a rendered slide.
const MAX_RASTER_SIDE: u32 = 16_384;
/// The most pixels a slide render allocates (128 MiB of RGBA).
const MAX_RASTER_PIXELS: u32 = 1 << 25;

fn metafile_raster(m: &metafile::Metafile) -> Raster {
    let scale = (150.0 / 72.0f32).min(2048.0 / m.width_pt.max(m.height_pt).max(1.0));
    let w = ((m.width_pt * scale).ceil() as u32).max(1);
    let h = ((m.height_pt * scale).ceil() as u32).max(1);
    raster::rasterize(&m.nodes, w, h, scale)
}

impl Presentation {
    /// The display list of slide `index` (scene units are points). Here and
    /// below, `index` may instead be the id of a slide master or layout
    /// (see [`crate::model::masters`]), which draws it as Slide Master view does.
    pub fn slide_display_list(&mut self, index: usize, fonts: &FontDb) -> Result<Vec<Node>> {
        self.layer_display_list(index, Layer::All, fonts)
    }

    /// The display list of one layer of slide `index`.
    pub fn layer_display_list(
        &mut self,
        index: usize,
        layer: Layer,
        fonts: &FontDb,
    ) -> Result<Vec<Node>> {
        let ctx = self.page_context(index)?;
        let mut loader = RenderLoader { pres: self, fonts };
        let mut b = Builder {
            fonts,
            loader: &mut loader,
        };
        Ok(b.slide_layer(&ctx, layer))
    }

    /// Renders slide `index` at `width_px` pixels wide (height follows the slide aspect).
    pub fn render_slide(&mut self, index: usize, width_px: u32, fonts: &FontDb) -> Result<Raster> {
        self.render_layer(index, Layer::All, width_px, fonts)
    }

    /// Renders one layer of slide `index` (transparent where nothing is drawn).
    pub fn render_layer(
        &mut self,
        index: usize,
        layer: Layer,
        width_px: u32,
        fonts: &FontDb,
    ) -> Result<Raster> {
        let nodes = self.layer_display_list(index, layer, fonts)?;
        let (cx, cy) = self.slide_size();
        let w_pt = cx as f32 / EMU_PER_PT as f32;
        let h_pt = cy as f32 / EMU_PER_PT as f32;
        let width_px = width_px.clamp(1, MAX_RASTER_SIDE);
        // Callers size the image from its width, so a slide too tall for the
        // pixel budget is drawn smaller rather than given a narrower raster.
        let max_height = (MAX_RASTER_PIXELS / width_px).min(MAX_RASTER_SIDE);
        let scale = (width_px as f32 / w_pt).min(max_height as f32 / h_pt);
        let height_px = (h_pt * scale).round().clamp(1.0, max_height as f32) as u32;
        Ok(raster::rasterize(&nodes, width_px, height_px, scale))
    }
}

#[cfg(test)]
mod test;
