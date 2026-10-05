//! Rectangular patterns render their source as a reusable transparent tile.

use super::{Painter, RenderOptions, Shape, Surface};
use crate::document::Document;
use crate::images::ImageStore;
use crate::model::{Affine, Guid, PatternAlign, PatternLayout, PatternPaint, Rect, Vec2};
use crate::scene::Scene;
use tiny_skia::{FilterQuality, Mask, Pattern, Pixmap, SpreadMode};

const MAX_PATTERN_DEPTH: usize = 8;
const MAX_TILE_SIDE: u32 = 2048;
const MAX_OVERLAP: i32 = 8;

/// One transparent, repeatable cell, also used by SVG export.
pub(crate) struct Tile {
    pub pixmap: Pixmap,
    pub step: Vec2,
    pub source_size: Vec2,
}

impl Tile {
    pub(crate) fn transform(&self, pattern: &PatternPaint, size: Vec2) -> Affine {
        let scale = f64::from(pattern.scale);
        let offset = |alignment, layer, source| match alignment {
            PatternAlign::Start => 0.0,
            PatternAlign::Center => (layer - source * scale) / 2.0,
            PatternAlign::End => layer - source * scale,
        };
        Affine::translate(
            offset(pattern.horizontal, size.x, self.source_size.x),
            offset(pattern.vertical, size.y, self.source_size.y),
        )
        .mul(&Affine::scale(
            self.step.x * scale / f64::from(self.pixmap.width()),
            self.step.y * scale / f64::from(self.pixmap.height()),
        ))
    }
}

pub(crate) fn render_tile(
    doc: &Document,
    images: &mut ImageStore,
    pattern: &PatternPaint,
    density: f64,
    active: &[Guid],
) -> Option<Tile> {
    if active.len() >= MAX_PATTERN_DEPTH
        || active.contains(&pattern.source)
        || !pattern.scale.is_finite()
        || pattern.scale <= 0.0
    {
        return None;
    }
    let source = doc.find(pattern.source)?;
    let source_size = doc.props(source).size();
    let step = Vec2::new(
        source_size.x * (1.0 + pattern.spacing.x),
        source_size.y * (1.0 + pattern.spacing.y),
    );
    if !step.x.is_finite() || !step.y.is_finite() || step.x <= 0.0 || step.y <= 0.0 {
        return None;
    }
    let pitch = step;
    let rows: i32 = match pattern.layout {
        PatternLayout::Rectangular => 1,
        PatternLayout::HorizontalHexagonal => 2,
    };
    let step = Vec2::new(step.x, step.y * f64::from(rows));
    // Supersample small vector tiles so fractional (including negative)
    // spacing does not snap to whole pixels at ordinary canvas zoom.
    let density = density.max(4.0);
    let w = (step.x * density)
        .ceil()
        .clamp(1.0, f64::from(MAX_TILE_SIDE)) as u32;
    let h = (step.y * density)
        .ceil()
        .clamp(1.0, f64::from(MAX_TILE_SIDE)) as u32;
    let mut tile = Surface::new(0, 0, w, h)?;
    let scene = Scene::build_instance(doc, source);
    let &source_node = scene.node(scene.root()).children.first()?;
    let to_local = scene.node(source_node).world.invert()?;
    let raster = Affine::scale(f64::from(w) / step.x, f64::from(h) / step.y);
    let overlap_x = (source_size.x / step.x).ceil() as i32;
    let overlap_y = (source_size.y / pitch.y).ceil() as i32;
    if overlap_x > MAX_OVERLAP || overlap_y > MAX_OVERLAP {
        return None;
    }
    let mut active_patterns = active.to_vec();
    active_patterns.push(pattern.source);
    let mut painter = Painter {
        doc,
        scene: &scene,
        images,
        opts: RenderOptions::default(),
        base: Affine::IDENTITY,
        scale: raster.scale_factor(),
        region: Rect::new(0.0, 0.0, f64::from(w), f64::from(h)),
        margin: 0.0,
        reach: 0.0,
        masks: Vec::new(),
        active_patterns,
    };
    // Neighboring copies contribute when spacing is negative. Rendering
    // them into one period makes the shader repeat seamlessly.
    for y in -overlap_y..=rows {
        for x in -overlap_x..=1 {
            let stagger =
                if pattern.layout == PatternLayout::HorizontalHexagonal && y.rem_euclid(2) == 1 {
                    pitch.x / 2.0
                } else {
                    0.0
                };
            painter.base = raster
                .mul(&Affine::translate(
                    f64::from(x) * pitch.x + stagger,
                    f64::from(y) * pitch.y,
                ))
                .mul(&to_local);
            painter.draw_node(source_node, &mut tile, None);
        }
    }
    Some(Tile {
        pixmap: tile.pixmap,
        step,
        source_size,
    })
}

impl Painter<'_> {
    #[expect(
        clippy::too_many_arguments,
        reason = "matches the paint renderer's fill interface"
    )]
    pub(super) fn fill_pattern(
        &mut self,
        surface: &mut Surface,
        shape: &Shape,
        ts: &Affine,
        pattern: &PatternPaint,
        size: Vec2,
        alpha: f32,
        blend: tiny_skia::BlendMode,
        clip: Option<&Mask>,
    ) {
        let density = ts.scale_factor() * f64::from(pattern.scale);
        let Some(tile) = render_tile(
            self.doc,
            self.images,
            pattern,
            density,
            &self.active_patterns,
        ) else {
            return;
        };
        let paint = tiny_skia::Paint {
            shader: Pattern::new(
                tile.pixmap.as_ref(),
                SpreadMode::Repeat,
                FilterQuality::Bilinear,
                alpha,
                tile.transform(pattern, size).to_skia(),
            ),
            blend_mode: blend,
            anti_alias: true,
            force_hq_pipeline: false,
        };
        surface
            .pixmap
            .fill_path(shape.path(), &paint, shape.rule(), ts.to_skia(), clip);
    }
}

#[cfg(test)]
mod test;
