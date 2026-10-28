//! What the editor asks about a document: the layers panel, a layer's
//! properties, what is under the pointer, thumbnails, colors, and fonts.

use crate::model::{
    Adjustment, Artboard, BlendMode, BlendRanges, Document, Effects, Fill, Guide, LayerIdx,
    LayerKind, Locks, SmartObject, TextLayer, VectorMask, VectorStroke,
};
use crate::raster::IRect;
use crate::render::Renderer;
use serde::Serialize;

/// A layers panel row.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LayerRow {
    /// Layer id.
    pub id: u32,
    /// Name.
    pub name: String,
    /// `pixel`, `group`, `text`, `fill`, `shape`, `adjustment`, or
    /// `smartObject`.
    pub kind: &'static str,
    /// Nesting depth (0 at the top level).
    pub depth: usize,
    /// The enclosing group's id.
    pub parent: Option<u32>,
    /// Its own visibility.
    pub visible: bool,
    /// Visible with every group it is in.
    pub shown: bool,
    /// Opacity, `0..=255`.
    pub opacity: u8,
    /// Fill opacity, `0..=255`.
    pub fill_opacity: u8,
    /// Blend mode.
    pub blend: BlendMode,
    /// Clipped to the layer below.
    pub clipping: bool,
    /// Locks.
    pub locks: Locks,
    /// Color tag.
    pub color_tag: u8,
    /// The document's Background.
    pub background: bool,
    /// Has a pixel mask.
    pub has_mask: bool,
    /// The pixel mask is off.
    pub mask_disabled: bool,
    /// Has a vector mask.
    pub has_vector_mask: bool,
    /// Has a layer style with something visible.
    pub has_effects: bool,
    /// A group is expanded.
    pub open: bool,
    /// Layers in a group.
    pub children: usize,
    /// Canvas bounds of what it draws.
    pub bounds: Option<IRect>,
    /// A group that is an artboard: its rectangle and background.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub artboard: Option<Artboard>,
}

fn kind_name(kind: &LayerKind, vector: bool) -> &'static str {
    match kind {
        LayerKind::Pixel => "pixel",
        LayerKind::Group { .. } => "group",
        LayerKind::Text { .. } => "text",
        LayerKind::Fill { .. } if vector => "shape",
        LayerKind::Fill { .. } => "fill",
        LayerKind::Adjustment { .. } => "adjustment",
        LayerKind::SmartObject { .. } => "smartObject",
    }
}

/// A layer's panel row.
pub fn row(doc: &Document, i: LayerIdx, depth: usize) -> LayerRow {
    let l = doc.layer(i);
    LayerRow {
        id: l.id,
        name: l.name.clone(),
        kind: kind_name(&l.kind, l.vector_mask.is_some()),
        depth,
        parent: l.parent.map(|p| doc.layer(p).id),
        visible: l.visible,
        shown: doc.is_shown(i),
        opacity: l.opacity,
        fill_opacity: l.fill_opacity,
        blend: l.blend,
        clipping: l.clipping,
        locks: l.locks,
        color_tag: l.color_tag,
        background: l.background,
        has_mask: l.mask.is_some(),
        mask_disabled: l.mask.as_ref().is_some_and(|m| m.disabled),
        has_vector_mask: l.vector_mask.is_some(),
        has_effects: l.effects.as_ref().is_some_and(Effects::any_visible),
        open: matches!(l.kind, LayerKind::Group { open: true, .. }),
        children: l.children.len(),
        bounds: crate::render::visual_bounds(doc, i),
        artboard: match &l.kind {
            LayerKind::Group { artboard, .. } => *artboard,
            _ => None,
        },
    }
}

/// Every layer, top to bottom as the layers panel lists them.
pub fn layers(doc: &Document) -> Vec<LayerRow> {
    doc.panel_order()
        .into_iter()
        .map(|(i, depth)| row(doc, i, depth))
        .collect()
}

/// A pixel mask's settings.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MaskInfo {
    /// Canvas rectangle of its pixels.
    pub rect: IRect,
    /// Value outside it.
    pub default_color: u8,
    /// Turned off.
    pub disabled: bool,
    /// Moves with the layer.
    pub linked: bool,
    /// Density.
    pub density: f32,
    /// Feather.
    pub feather: f32,
}

/// One layer's properties, for the properties panel.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LayerInfo {
    /// The panel row.
    #[serde(flatten)]
    pub row: LayerRow,
    /// Text content and styles.
    pub text: Option<TextLayer>,
    /// A fill or shape layer's fill.
    pub fill: Option<Fill>,
    /// A shape layer's stroke.
    pub stroke: Option<VectorStroke>,
    /// An adjustment layer's settings.
    pub adjustment: Option<Adjustment>,
    /// A smart object's placement.
    pub smart_object: Option<SmartObject>,
    /// The layer style.
    pub effects: Option<Effects>,
    /// The pixel mask.
    pub mask: Option<MaskInfo>,
    /// The vector mask.
    pub vector_mask: Option<VectorMask>,
    /// Blend If ranges.
    pub blend_ranges: Option<BlendRanges>,
    /// Knockout.
    pub knockout: u8,
    /// Blend Clipped Layers as Group.
    pub blend_clipped_as_group: bool,
    /// Blend Interior Effects as Group.
    pub blend_interior_as_group: bool,
    /// Transparency Shapes Layer.
    pub transparency_shapes: bool,
}

/// A layer's properties by id.
pub fn layer_info(doc: &Document, id: u32) -> Option<LayerInfo> {
    let i = doc.find(id).filter(|&i| !doc.layer(i).removed)?;
    let depth = doc
        .panel_order()
        .into_iter()
        .find(|(j, _)| *j == i)
        .map_or(0, |(_, d)| d);
    let l = doc.layer(i);
    let (text, fill, stroke, adjustment, smart_object) = match &l.kind {
        LayerKind::Text { text } => (Some((**text).clone()), None, None, None, None),
        LayerKind::Fill { fill, stroke } => (
            None,
            Some(fill.clone()),
            stroke.as_deref().cloned(),
            None,
            None,
        ),
        LayerKind::Adjustment { adjustment } => {
            (None, None, None, Some((**adjustment).clone()), None)
        }
        LayerKind::SmartObject { object } => (None, None, None, None, Some((**object).clone())),
        _ => (None, None, None, None, None),
    };
    Some(LayerInfo {
        row: row(doc, i, depth),
        text,
        fill,
        stroke,
        adjustment,
        smart_object,
        effects: l.effects.clone(),
        mask: l.mask.as_ref().map(|m| MaskInfo {
            rect: m.rect,
            default_color: m.default_color,
            disabled: m.disabled,
            linked: m.linked,
            density: m.density,
            feather: m.feather,
        }),
        vector_mask: l.vector_mask.clone(),
        blend_ranges: l.blend_ranges.clone(),
        knockout: l.knockout,
        blend_clipped_as_group: l.blend_clipped_as_group,
        blend_interior_as_group: l.blend_interior_as_group,
        transparency_shapes: l.transparency_shapes,
    })
}

/// The topmost shown layer that draws something at canvas `(x, y)` (its
/// own pixels, masks applied; not adjustment layers or groups), as the move
/// tool's auto-select picks.
pub fn hit_test(doc: &Document, renderer: &mut Renderer, x: i32, y: i32) -> Option<u32> {
    let point = IRect::new(x, y, 1, 1);
    for (i, _) in doc.panel_order() {
        let l = doc.layer(i);
        if l.is_group()
            || matches!(l.kind, LayerKind::Adjustment { .. })
            || !doc.is_shown(i)
            || l.opacity == 0
        {
            continue;
        }
        if crate::render::visual_bounds(doc, i).is_none_or(|b| !b.contains(x, y)) {
            continue;
        }
        let px = renderer.render_layer(doc, i, point, 0, false);
        if px.get(3).is_some_and(|&a| a > 25) {
            return Some(l.id);
        }
    }
    None
}

/// A layer drawn alone and fitted in `size` pixels, as PNG (empty when it
/// draws nothing).
pub fn thumbnail(doc: &Document, renderer: &mut Renderer, id: u32, size: u32) -> Vec<u8> {
    let Some(i) = doc.find(id) else {
        return Vec::new();
    };
    let Some(bounds) = crate::render::visual_bounds(doc, i)
        .map(|b| b.intersect(&doc.bounds()))
        .filter(|b| !b.is_empty())
    else {
        return Vec::new();
    };
    let size = size.clamp(8, 1024) as i32;
    let mut level = 0u8;
    while level < 12 && (bounds.w >> level > size * 2 || bounds.h >> level > size * 2) {
        level += 1;
    }
    let rect = bounds.at_level(level);
    let rgba = renderer.render_layer(doc, i, rect, level, true);
    encode_png(&rgba, rect.w as u32, rect.h as u32)
}

/// A layer's pixel mask over the canvas fitted in `size` pixels, as a gray
/// PNG (white shows, black hides); empty when the layer has no mask.
pub fn mask_thumbnail(doc: &Document, id: u32, size: u32) -> Vec<u8> {
    let Some(mask) = doc.find(id).and_then(|i| doc.layer(i).mask.as_ref()) else {
        return Vec::new();
    };
    let canvas = doc.bounds();
    let size = size.clamp(8, 1024) as f64;
    let scale = (size / f64::from(canvas.w.max(canvas.h).max(1))).min(1.0);
    let (w, h) = (
        ((f64::from(canvas.w) * scale).round() as u32).max(1),
        ((f64::from(canvas.h) * scale).round() as u32).max(1),
    );
    // Each thumbnail pixel averages a few samples of the canvas area it
    // covers.
    const SAMPLES: u32 = 3;
    let value = |x: i32, y: i32| {
        if mask.rect.contains(x, y) {
            u32::from(mask.raster.get(x, y)[0])
        } else {
            u32::from(mask.default_color)
        }
    };
    let mut rgba = Vec::with_capacity((w * h * 4) as usize);
    for ty in 0..h {
        for tx in 0..w {
            let mut sum = 0;
            for sy in 0..SAMPLES {
                for sx in 0..SAMPLES {
                    let fx = (f64::from(tx) + (f64::from(sx) + 0.5) / f64::from(SAMPLES)) / scale;
                    let fy = (f64::from(ty) + (f64::from(sy) + 0.5) / f64::from(SAMPLES)) / scale;
                    sum += value(canvas.x + fx as i32, canvas.y + fy as i32);
                }
            }
            let v = (sum / (SAMPLES * SAMPLES)) as u8;
            rgba.extend_from_slice(&[v, v, v, 255]);
        }
    }
    encode_png(&rgba, w, h)
}

/// The document's merged image fitted in `size` pixels, as PNG.
pub fn preview(doc: &Document, renderer: &mut Renderer, size: u32) -> Vec<u8> {
    let bounds = doc.bounds();
    let size = size.clamp(8, 4096) as i32;
    let mut level = 0u8;
    while level < 12 && (bounds.w >> level > size || bounds.h >> level > size) {
        level += 1;
    }
    let rect = bounds.at_level(level);
    let rgba = renderer.render(doc, rect, level);
    encode_png(&rgba, rect.w as u32, rect.h as u32)
}

/// Straight RGBA as a PNG.
pub fn encode_png(rgba: &[u8], width: u32, height: u32) -> Vec<u8> {
    let mut out = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut out, width.max(1), height.max(1));
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let Ok(mut writer) = encoder.write_header() else {
            return Vec::new();
        };
        if writer.write_image_data(rgba).is_err() {
            return Vec::new();
        }
    }
    out
}

/// The color at canvas `(x, y)`: of the merged image, or of one layer.
pub fn sample(
    doc: &Document,
    renderer: &mut Renderer,
    x: i32,
    y: i32,
    layer: Option<u32>,
) -> [u8; 4] {
    let point = IRect::new(x, y, 1, 1);
    let px = match layer.and_then(|id| doc.find(id)) {
        Some(i) => renderer.render_layer(doc, i, point, 0, false),
        None => renderer.render(doc, point, 0),
    };
    [
        px.first().copied().unwrap_or(0),
        px.get(1).copied().unwrap_or(0),
        px.get(2).copied().unwrap_or(0),
        px.get(3).copied().unwrap_or(0),
    ]
}

/// The document as the editor first needs it.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    /// Canvas width.
    pub width: u32,
    /// Canvas height.
    pub height: u32,
    /// The file's color mode.
    pub mode: crate::model::ColorMode,
    /// The file's bits per channel.
    pub depth: u16,
    /// Pixels per inch.
    pub resolution: f64,
    /// Live layers.
    pub layer_count: usize,
    /// Whether layers can be edited and saved (RGB or grayscale at 8 or
    /// 16 bits; others need Image > Mode > RGB first).
    pub editable: bool,
    /// Ruler guides.
    pub guides: Vec<Guide>,
    /// The file is a large document (`.psb`).
    pub large: bool,
}

/// The document's summary.
pub fn summary(doc: &Document) -> Summary {
    Summary {
        width: doc.width,
        height: doc.height,
        mode: doc.mode,
        depth: doc.depth,
        resolution: doc.resolution,
        layer_count: doc.layers.iter().filter(|l| !l.removed).count(),
        editable: matches!(
            doc.mode,
            crate::model::ColorMode::Rgb | crate::model::ColorMode::Grayscale
        ) && matches!(doc.depth, 8 | 16),
        guides: doc.guides.clone(),
        large: doc.source.as_ref().is_some_and(|s| s.header.is_psb()),
    }
}

/// A font text layers use and whether it is available.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FontUse {
    /// The PostScript name the file names.
    pub postscript: String,
    /// The family it is read as.
    pub family: String,
    /// The style it is read as.
    pub style: String,
    /// Whether the registry has it.
    pub status: fig_engine::text::FontStatus,
}

/// Every font the document's text layers use.
pub fn fonts(doc: &Document) -> Vec<FontUse> {
    let mut names: Vec<String> = Vec::new();
    for l in doc.layers.iter().filter(|l| !l.removed) {
        if let LayerKind::Text { text } = &l.kind {
            for run in &text.runs {
                if !names.contains(&run.style.font) {
                    names.push(run.style.font.clone());
                }
            }
        }
    }
    names
        .into_iter()
        .map(|postscript| {
            let (family, style) = crate::text::family_and_style(&postscript);
            let status = fig_engine::text::font_status(&family, &style);
            FontUse {
                postscript,
                family,
                style,
                status,
            }
        })
        .collect()
}

#[cfg(test)]
mod test;
