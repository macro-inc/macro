//! What the viewer asks about a page: layers, a layer's properties, hit
//! testing, outlines, and search. Results serialize to JSON for the web app.

use crate::document::Document;
use crate::geometry;
use crate::model::{
    Affine, Effect, EffectKind, GradientKind, NodeType, Paint, PaintKind, Props, Rect, Vec2,
};
use crate::scene::{Scene, SceneIdx};
use serde::Serialize;

mod colors;
pub use colors::page_colors;

/// One row of the layers panel.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LayerRow {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub node_type: NodeType,
    pub visible: bool,
    pub locked: bool,
    pub child_count: usize,
    pub is_mask: bool,
    /// Inside an instance (Figma shows these rows in purple).
    pub in_instance: bool,
}

/// A page-level frame, for frame navigation and zoom to fit.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FrameRow {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub node_type: NodeType,
    pub bounds: Rect,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PaintInfo {
    #[serde(rename = "type")]
    pub kind: String,
    pub visible: bool,
    pub opacity: f32,
    pub blend_mode: String,
    /// Solid color as `RRGGBB`.
    pub color: Option<String>,
    /// The color's own alpha (0..1), separate from the paint opacity.
    pub alpha: Option<f32>,
    pub stops: Option<Vec<StopInfo>>,
    /// Gradient start and end in node coordinates.
    pub handles: Option<[Vec2; 2]>,
    pub scale_mode: Option<String>,
    pub image_hash: Option<String>,
}

#[derive(Serialize)]
pub struct StopInfo {
    pub color: String,
    pub alpha: f32,
    pub position: f32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EffectInfo {
    #[serde(rename = "type")]
    pub kind: EffectKind,
    pub visible: bool,
    pub color: String,
    pub alpha: f32,
    pub x: f64,
    pub y: f64,
    pub radius: f32,
    pub spread: f32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextInfo {
    pub characters: String,
    pub truncated: bool,
    #[serde(flatten)]
    pub style: crate::model::TextStyle,
    /// Fonts used by character style runs, beyond the base style.
    pub fonts: Vec<String>,
    /// Whether the layer's own font is available for layout.
    pub font_status: crate::text::FontStatus,
    /// Style run id per character (UTF-16 unit); missing ids are 0, the
    /// layer's style.
    pub style_ids: Vec<u32>,
    /// The character styles, by id.
    pub runs: Vec<RunInfo>,
}

/// A character style: what it sets differently from its layer.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunInfo {
    pub id: u32,
    pub font_family: Option<String>,
    pub font_style: Option<String>,
    pub font_size: Option<f32>,
    pub decoration: Option<String>,
    pub letter_spacing: Option<(f32, String)>,
    pub line_height: Option<(f32, String)>,
    pub case: Option<String>,
    pub fills: Option<Vec<PaintInfo>>,
    pub font_status: crate::text::FontStatus,
}

/// A text layer's lines for the text editor's caret and selection, and
/// where the layer is on the page.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextGeometryInfo {
    /// Layer to page: `[a, b, c, d, e, f]` mapping `(x, y)` to
    /// `(a x + c y + e, b x + d y + f)`.
    pub transform: [f64; 6],
    #[serde(flatten)]
    pub geometry: crate::text::TextGeometry,
}

/// The caret geometry of text layer `i`.
pub fn text_geometry(doc: &Document, scene: &Scene, i: SceneIdx) -> Option<TextGeometryInfo> {
    let props = scene.props(doc, i);
    let geometry = crate::text::geometry(props)?;
    let w = &scene.node(i).world;
    Some(TextGeometryInfo {
        transform: [w.m00, w.m10, w.m01, w.m11, w.m02, w.m12],
        geometry,
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeInfo {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub node_type: NodeType,
    pub type_label: &'static str,
    /// Relative to the containing frame (or page), as Figma shows them.
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub rotation: f64,
    /// Page-space bounds of the node's frame.
    pub bounds: Rect,
    pub opacity: f32,
    pub blend_mode: String,
    pub visible: bool,
    pub locked: bool,
    pub corner_radius: Option<crate::model::CornerRadii>,
    pub corner_smoothing: Option<f32>,
    pub clips_content: bool,
    pub fills: Vec<PaintInfo>,
    pub strokes: Vec<PaintInfo>,
    pub stroke_weight: Option<f32>,
    pub stroke_align: Option<crate::model::StrokeAlign>,
    pub dash_pattern: Option<Vec<f32>>,
    pub effects: Vec<EffectInfo>,
    pub text: Option<TextInfo>,
    pub auto_layout: Option<crate::model::AutoLayout>,
    /// How the width and height follow auto layout: `FIXED`, `HUG`, or
    /// `FILL` (layers outside instances).
    pub sizing: Option<(&'static str, &'static str)>,
    /// The layer is in an auto layout frame's flow (or `ABSOLUTE`ly
    /// positioned in one).
    pub layout_parent: Option<&'static str>,
    /// The layer is in a frame whose resizing its constraints follow.
    pub constrained: bool,
    pub constraints: Option<(String, String)>,
    pub export_settings: Vec<crate::model::ExportSetting>,
    /// For instances: the main component's name.
    pub main_component: Option<String>,
    pub description: Option<String>,
    pub component_properties: Vec<crate::model::PropDef>,
    pub boolean_operation: Option<String>,
    pub is_mask: bool,
    pub child_count: usize,
}

fn enum_name<T: Serialize>(v: &T) -> String {
    serde_json::to_value(v)
        .ok()
        .and_then(|v| v.as_str().map(str::to_owned))
        .unwrap_or_default()
}

fn paint_info(p: &Paint, size: Vec2) -> PaintInfo {
    let mut info = PaintInfo {
        kind: String::new(),
        visible: p.visible,
        opacity: p.opacity,
        blend_mode: enum_name(&p.blend_mode),
        color: None,
        alpha: None,
        stops: None,
        handles: None,
        scale_mode: None,
        image_hash: None,
    };
    match &p.kind {
        PaintKind::Solid(c) => {
            info.kind = "SOLID".into();
            info.color = Some(c.hex());
            info.alpha = Some(c.a);
        }
        PaintKind::Gradient {
            kind,
            stops,
            transform,
        } => {
            info.kind = match kind {
                GradientKind::Linear => "GRADIENT_LINEAR",
                GradientKind::Radial => "GRADIENT_RADIAL",
                GradientKind::Angular => "GRADIENT_ANGULAR",
                GradientKind::Diamond => "GRADIENT_DIAMOND",
            }
            .into();
            info.stops = Some(
                stops
                    .iter()
                    .map(|s| StopInfo {
                        color: s.color.hex(),
                        alpha: s.color.a,
                        position: s.position,
                    })
                    .collect(),
            );
            if let Some(inv) = transform.invert() {
                let to_node = Affine::scale(size.x, size.y).mul(&inv);
                let (start, end) = match kind {
                    GradientKind::Linear => (Vec2::new(0.0, 0.5), Vec2::new(1.0, 0.5)),
                    _ => (Vec2::new(0.5, 0.5), Vec2::new(1.0, 0.5)),
                };
                info.handles = Some([to_node.apply(start), to_node.apply(end)]);
            }
        }
        PaintKind::Image(img) => {
            info.kind = "IMAGE".into();
            info.scale_mode = Some(enum_name(&img.scale_mode));
            info.image_hash = img.hash.as_deref().map(str::to_owned);
        }
        PaintKind::Unsupported(kind) => info.kind = kind.to_ascii_uppercase(),
    }
    info
}

fn effect_info(e: &Effect) -> EffectInfo {
    EffectInfo {
        kind: e.kind,
        visible: e.visible,
        color: e.color.hex(),
        alpha: e.color.a,
        x: e.offset.x,
        y: e.offset.y,
        radius: e.radius,
        spread: e.spread,
    }
}

const MAX_TEXT: usize = 20_000;

/// The nearest frame-like ancestor (Figma reports positions relative to it).
fn coordinate_parent(scene: &Scene, doc: &Document, i: SceneIdx) -> Option<SceneIdx> {
    let mut at = scene.node(i).parent?;
    loop {
        if at == scene.root() {
            return None;
        }
        let t = scene.props(doc, at).node_type();
        if t.is_frame_like() || t == NodeType::BooleanOperation {
            return Some(at);
        }
        at = scene.node(at).parent?;
    }
}

pub fn node_info(doc: &Document, scene: &Scene, i: SceneIdx) -> NodeInfo {
    let props = scene.props(doc, i);
    let node = scene.node(i);
    let size = props.size();
    let origin = node.world.apply(Vec2::default());
    let (x, y) = match coordinate_parent(scene, doc, i) {
        Some(p) => {
            let inv = scene.node(p).world.invert().unwrap_or_default();
            let local = inv.apply(origin);
            (local.x, local.y)
        }
        None => (origin.x, origin.y),
    };
    let node_type = props.node_type();
    let main_component = (node_type == NodeType::Instance)
        .then(|| {
            let id = props
                .swapped_symbol
                .or_else(|| props.symbol.as_ref().and_then(|s| s.symbol_id))?;
            let sym = doc.find(id)?;
            let name = doc.props(sym).name().to_owned();
            // Variants are named "Prop=Value, …" inside their component set.
            let set = doc.node(sym).parent.map(|p| doc.props(p));
            Some(match set {
                Some(set) if set.is_state_group == Some(true) => {
                    format!("{} / {}", set.name(), name)
                }
                _ => name,
            })
        })
        .flatten();
    let text = (node_type == NodeType::Text).then(|| {
        let content = props.text_content.as_ref();
        let chars = content.map(|c| c.characters.as_ref()).unwrap_or("");
        let truncated = chars.len() > MAX_TEXT;
        let mut end = chars.len().min(MAX_TEXT);
        while !chars.is_char_boundary(end) {
            end -= 1;
        }
        let mut fonts: Vec<String> = Vec::new();
        if let Some(c) = content {
            for run in c.styles.iter() {
                if let Some(f) = &run.font_family {
                    let label = match &run.font_style {
                        Some(s) => format!("{f} {s}"),
                        None => f.to_string(),
                    };
                    if !fonts.contains(&label) {
                        fonts.push(label);
                    }
                }
            }
        }
        let style = props.text_style.as_deref().cloned().unwrap_or_default();
        let family = style
            .font_family
            .as_deref()
            .unwrap_or(crate::text::DEFAULT_FAMILY);
        let font_style = style.font_style.as_deref().unwrap_or("Regular");
        let units = chars[..end].encode_utf16().count();
        let style_ids: Vec<u32> = content
            .map(|c| c.style_ids.iter().take(units).copied().collect())
            .unwrap_or_default();
        let runs = content
            .map(|c| {
                c.styles
                    .iter()
                    .filter(|r| style_ids.contains(&r.id))
                    .map(|r| RunInfo {
                        id: r.id,
                        font_family: r.font_family.as_deref().map(str::to_owned),
                        font_style: r.font_style.as_deref().map(str::to_owned),
                        font_size: r.font_size,
                        decoration: r.decoration.as_deref().map(str::to_owned),
                        letter_spacing: r.letter_spacing.as_ref().map(|(v, u)| (*v, u.to_string())),
                        line_height: r.line_height.as_ref().map(|(v, u)| (*v, u.to_string())),
                        case: r.case.as_deref().map(str::to_owned),
                        fills: r
                            .fills
                            .as_ref()
                            .map(|f| f.iter().map(|p| paint_info(p, props.size())).collect()),
                        font_status: crate::text::font_status(
                            r.font_family.as_deref().unwrap_or(family),
                            r.font_style.as_deref().unwrap_or(font_style),
                        ),
                    })
                    .collect()
            })
            .unwrap_or_default();
        TextInfo {
            characters: chars[..end].to_owned(),
            truncated,
            font_status: crate::text::font_status(family, font_style),
            style,
            fonts,
            style_ids,
            runs,
        }
    });
    let radii = props.radii();
    NodeInfo {
        id: scene.id(doc, i),
        name: props.name().to_owned(),
        node_type,
        type_label: node_type.label(),
        x,
        y,
        width: size.x,
        height: size.y,
        rotation: node.world.rotation_degrees(),
        bounds: scene.frame_bounds(doc, i),
        opacity: props.opacity(),
        blend_mode: enum_name(&props.blend_mode()),
        visible: props.visible(),
        locked: props.locked.unwrap_or(false),
        corner_radius: (!radii.is_zero()).then_some(radii),
        corner_smoothing: props.corner_smoothing.filter(|s| *s > 0.0),
        clips_content: props.clips_content(),
        fills: if node_type == NodeType::Canvas {
            Vec::new()
        } else {
            props.fills().iter().map(|p| paint_info(p, size)).collect()
        },
        strokes: props
            .strokes()
            .iter()
            .map(|p| paint_info(p, size))
            .collect(),
        stroke_weight: (!props.strokes().is_empty()).then(|| props.stroke_weight()),
        stroke_align: (!props.strokes().is_empty()).then(|| props.stroke_align()),
        dash_pattern: props
            .dash_pattern
            .as_deref()
            .filter(|d| !d.is_empty())
            .map(<[f32]>::to_vec),
        effects: props.effects().iter().map(effect_info).collect(),
        text,
        auto_layout: props.auto_layout.as_deref().cloned(),
        sizing: node.path.is_none().then(|| {
            (
                crate::edit::layout::axis_sizing(doc, node.src, true),
                crate::edit::layout::axis_sizing(doc, node.src, false),
            )
        }),
        constrained: node.path.is_none()
            && doc.node(node.src).parent.is_some_and(|p| {
                let pp = doc.props(p);
                let t = pp.node_type();
                t.is_frame_like()
                    && t != NodeType::Instance
                    && (pp.auto_layout.as_ref().is_none_or(|a| !a.is_stack())
                        || props.layout_child.as_ref().is_some_and(|c| c.is_absolute()))
            }),
        layout_parent: node
            .path
            .is_none()
            .then(|| doc.node(node.src).parent)
            .flatten()
            .filter(|&p| {
                doc.props(p)
                    .auto_layout
                    .as_ref()
                    .is_some_and(|a| a.mode == "HORIZONTAL" || a.mode == "VERTICAL")
            })
            .map(|_| {
                let absolute = props.layout_child.as_ref().is_some_and(|c| c.is_absolute());
                if absolute { "ABSOLUTE" } else { "AUTO" }
            }),
        constraints: props
            .constraints
            .as_ref()
            .map(|(h, v)| (h.to_string(), v.to_string())),
        export_settings: props.export_settings.as_deref().unwrap_or(&[]).to_vec(),
        main_component,
        description: props.description.as_deref().map(str::to_owned),
        component_properties: props.prop_defs.as_deref().unwrap_or(&[]).to_vec(),
        boolean_operation: props.boolean_operation.as_deref().map(str::to_owned),
        is_mask: props.is_mask(),
        child_count: node.children.len(),
    }
}

/// Children of `parent` (the page when `None`) for the layers panel,
/// top-most first as Figma lists them.
pub fn layer_rows(doc: &Document, scene: &Scene, parent: SceneIdx) -> Vec<LayerRow> {
    scene
        .node(parent)
        .children
        .iter()
        .rev()
        .map(|&c| layer_row(doc, scene, c))
        .collect()
}

pub fn layer_row(doc: &Document, scene: &Scene, i: SceneIdx) -> LayerRow {
    let props = scene.props(doc, i);
    let node = scene.node(i);
    LayerRow {
        id: scene.id(doc, i),
        name: props.name().to_owned(),
        node_type: props.node_type(),
        visible: props.visible(),
        locked: props.locked.unwrap_or(false),
        child_count: if props.node_type() == NodeType::BooleanOperation
            || props.node_type().draws_children()
        {
            node.children.len()
        } else {
            0
        },
        is_mask: props.is_mask(),
        in_instance: node.path.is_some(),
    }
}

/// Top-level frames (and other top-level layers) of the page.
pub fn frames(doc: &Document, scene: &Scene) -> Vec<FrameRow> {
    scene
        .node(scene.root())
        .children
        .iter()
        .filter(|&&c| scene.props(doc, c).visible())
        .map(|&c| FrameRow {
            id: scene.id(doc, c),
            name: scene.props(doc, c).name().to_owned(),
            node_type: scene.props(doc, c).node_type(),
            bounds: scene.frame_bounds(doc, c),
        })
        .collect()
}

fn hits_self(doc: &Document, scene: &Scene, i: SceneIdx, p: Vec2, tolerance: f64) -> bool {
    let props = scene.props(doc, i);
    let node = scene.node(i);
    let Some(inv) = node.world.invert() else {
        return false;
    };
    let local = inv.apply(p);
    let size = props.size();
    let tol = tolerance / node.world.scale_factor().max(1e-9);
    let in_box =
        local.x >= -tol && local.y >= -tol && local.x <= size.x + tol && local.y <= size.y + tol;
    match props.node_type() {
        t if t.is_frame_like() => in_box,
        NodeType::Text => in_box,
        NodeType::Group | NodeType::Canvas | NodeType::Document => false,
        _ => {
            let mut geometry = props
                .fill_geometry()
                .iter()
                .chain(props.stroke_geometry())
                .peekable();
            if geometry.peek().is_none() {
                return in_box;
            }
            geometry.any(|g| {
                doc.blobs.path(g.blob).is_some_and(|path| {
                    path.contains(local, g.winding)
                        || geometry::distance_to_outline(&path.path, local) <= tol.max(0.5)
                })
            })
        }
    }
}

/// The chain of layers under `p` (page coordinates), from the page's child
/// down to the deepest hit layer. `tolerance` is in page units.
pub fn hit_test(doc: &Document, scene: &Scene, p: Vec2, tolerance: f64) -> Vec<SceneIdx> {
    let mut chain = Vec::new();
    hit_children(doc, scene, scene.root(), p, tolerance, &mut chain);
    chain
}

fn hit_children(
    doc: &Document,
    scene: &Scene,
    parent: SceneIdx,
    p: Vec2,
    tolerance: f64,
    chain: &mut Vec<SceneIdx>,
) -> bool {
    for &c in scene.node(parent).children.iter().rev() {
        let props = scene.props(doc, c);
        if !props.visible() || props.locked.unwrap_or(false) || props.is_mask() {
            continue;
        }
        let node = scene.node(c);
        let reach = node
            .bounds
            .union(&scene.frame_bounds(doc, c))
            .outset(tolerance);
        if !reach.contains(p) {
            continue;
        }
        chain.push(c);
        let clipped_out = props.clips_content() && !hits_self(doc, scene, c, p, 0.0);
        let descend =
            props.node_type().draws_children() || props.node_type() == NodeType::BooleanOperation;
        if descend && !clipped_out && hit_children(doc, scene, c, p, tolerance, chain) {
            return true;
        }
        if hits_self(doc, scene, c, p, tolerance) {
            return true;
        }
        chain.pop();
    }
    false
}

/// Layers whose frames intersect `rect` (page coordinates), among the
/// children of `parent` (marquee selection).
pub fn in_rect(doc: &Document, scene: &Scene, parent: SceneIdx, rect: &Rect) -> Vec<SceneIdx> {
    scene
        .node(parent)
        .children
        .iter()
        .copied()
        .filter(|&c| {
            let props = scene.props(doc, c);
            props.visible() && !props.locked.unwrap_or(false) && {
                let b = scene.frame_bounds(doc, c);
                b.intersects(rect)
            }
        })
        .collect()
}

/// SVG path data (page coordinates) of the layer's outline, for hover
/// highlights: its geometry, or its frame.
pub fn outline(doc: &Document, scene: &Scene, i: SceneIdx) -> String {
    let props = scene.props(doc, i);
    let world = scene.node(i).world;
    let mut out = String::new();
    let node_type = props.node_type();
    let use_geometry =
        !(node_type.is_frame_like() || matches!(node_type, NodeType::Text | NodeType::Group));
    if use_geometry {
        for g in props.fill_geometry() {
            if let Some(p) = doc.blobs.path(g.blob) {
                geometry::to_svg(&p.path, &world, &mut out);
            }
        }
        if out.is_empty() {
            // Lines and open vectors: the stroke's centerline is not stored,
            // so outline the stroke itself.
            for g in props.stroke_geometry() {
                if let Some(p) = doc.blobs.path(g.blob) {
                    geometry::to_svg(&p.path, &world, &mut out);
                }
            }
        }
    }
    if out.is_empty() {
        let c = scene.frame_corners(doc, i);
        out = format!(
            "M{:.2} {:.2}L{:.2} {:.2}L{:.2} {:.2}L{:.2} {:.2}Z",
            c[0].x, c[0].y, c[1].x, c[1].y, c[2].x, c[2].y, c[3].x, c[3].y
        );
    }
    out
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub node_type: NodeType,
    /// A snippet of matching text content.
    pub text: Option<String>,
}

/// Layers whose name or text contains `query` (case-insensitive).
pub fn search(doc: &Document, scene: &Scene, query: &str, limit: usize) -> Vec<SearchHit> {
    let q = query.to_lowercase();
    if q.is_empty() {
        return Vec::new();
    }
    let mut hits = Vec::new();
    for i in 1..scene.nodes.len() as SceneIdx {
        let props = scene.props(doc, i);
        let name_hit = props.name().to_lowercase().contains(&q);
        let text = props
            .text_content
            .as_ref()
            .map(|t| t.characters.as_ref())
            .filter(|t| t.to_lowercase().contains(&q));
        if name_hit || text.is_some() {
            hits.push(SearchHit {
                id: scene.id(doc, i),
                name: props.name().to_owned(),
                node_type: props.node_type(),
                text: text.map(|t| t.chars().take(120).collect()),
            });
            if hits.len() >= limit {
                break;
            }
        }
    }
    hits
}

/// Whether the layer is a container the canvas selects into with a click
/// (frames), rather than as a unit (groups, instances need a double click).
pub fn is_container(props: &Props) -> bool {
    matches!(
        props.node_type(),
        NodeType::Frame | NodeType::Section | NodeType::Symbol | NodeType::Canvas
    )
}

pub fn effect_kinds(props: &Props) -> impl Iterator<Item = EffectKind> + '_ {
    props.effects().iter().map(|e| e.kind)
}

#[cfg(test)]
mod test;

/// A component, for the assets list.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentInfo {
    pub id: String,
    pub name: String,
    /// The component set a variant belongs to.
    pub set: Option<String>,
    pub page: usize,
    pub width: f64,
    pub height: f64,
}

/// Every component in the document, in page and layer order.
pub fn components(doc: &Document) -> Vec<ComponentInfo> {
    let mut out = Vec::new();
    for (page, &p) in doc.pages.iter().enumerate() {
        let mut stack: Vec<crate::NodeIdx> = doc.node(p).children.iter().rev().copied().collect();
        while let Some(i) = stack.pop() {
            let node = doc.node(i);
            if node.removed {
                continue;
            }
            let props = doc.props(i);
            if props.node_type() == NodeType::Symbol {
                let set = node
                    .parent
                    .filter(|&s| doc.props(s).is_state_group == Some(true))
                    .map(|s| doc.props(s).name().to_owned());
                out.push(ComponentInfo {
                    id: props.guid.map(|g| g.to_string()).unwrap_or_default(),
                    name: props.name().to_owned(),
                    set,
                    page,
                    width: props.size().x,
                    height: props.size().y,
                });
                continue;
            }
            if props.node_type() != NodeType::Instance {
                stack.extend(node.children.iter().rev().copied());
            }
        }
    }
    out
}
