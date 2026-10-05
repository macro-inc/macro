//! Layout grids and guides for the canvas overlay and the design panel.

use crate::document::Document;
use crate::model::{Axis, GridAlign, GridPattern, Guide, LayoutGrid};
use crate::scene::{Scene, SceneIdx};
use serde::Serialize;

/// A layout grid as the design panel shows it.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GridInfo {
    pub pattern: GridPattern,
    pub axis: Axis,
    pub align: GridAlign,
    pub visible: bool,
    /// Columns or rows; 0 for "Auto" (as many as fit).
    pub count: i32,
    pub offset: f32,
    pub section_size: f32,
    pub gutter: f32,
    /// `RRGGBB`.
    pub color: String,
    pub alpha: f32,
}

/// Counts at or above this are Figma's "Auto".
const AUTO: i32 = 1 << 20;

pub fn grid_info(g: &LayoutGrid) -> GridInfo {
    GridInfo {
        pattern: g.pattern,
        axis: g.axis,
        align: g.align,
        visible: g.visible,
        count: if g.count <= 0 || g.count >= AUTO {
            0
        } else {
            g.count
        },
        offset: g.offset,
        section_size: g.section_size,
        gutter: g.gutter,
        color: g.color.hex(),
        alpha: g.color.a,
    }
}

/// A guide: a vertical line at x = `offset` (`X`) or a horizontal one.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct GuideInfo {
    pub axis: Axis,
    pub offset: f32,
}

fn guide_info(g: &Guide) -> GuideInfo {
    GuideInfo {
        axis: g.axis,
        offset: g.offset,
    }
}

/// A frame's grids and guides, and where the frame is.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FrameAids {
    pub id: String,
    /// Frame → page: `[a, b, c, d, e, f]` mapping `(x, y)` to
    /// `(a x + c y + e, b x + d y + f)`.
    pub transform: [f64; 6],
    pub width: f64,
    pub height: f64,
    pub grids: Vec<GridInfo>,
    pub guides: Vec<GuideInfo>,
}

/// The page's guides and every visible frame with grids or guides.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct LayoutAids {
    pub guides: Vec<GuideInfo>,
    pub frames: Vec<FrameAids>,
}

pub fn layout_aids(doc: &Document, scene: &Scene) -> LayoutAids {
    let page = doc.props(scene.page);
    let mut frames = Vec::new();
    let mut stack: Vec<SceneIdx> = scene.node(scene.root()).children.clone();
    stack.reverse();
    while let Some(i) = stack.pop() {
        let props = scene.props(doc, i);
        if !props.visible() {
            continue;
        }
        let grids = props.layout_grids.as_deref().unwrap_or(&[]);
        let guides = props.guides.as_deref().unwrap_or(&[]);
        if !grids.is_empty() || !guides.is_empty() {
            let w = &scene.node(i).world;
            let size = props.size();
            frames.push(FrameAids {
                id: scene.id(doc, i),
                transform: [w.m00, w.m10, w.m01, w.m11, w.m02, w.m12],
                width: size.x,
                height: size.y,
                grids: grids.iter().map(grid_info).collect(),
                guides: guides.iter().map(guide_info).collect(),
            });
        }
        let children = &scene.node(i).children;
        stack.extend(children.iter().rev().copied());
    }
    LayoutAids {
        guides: page
            .guides
            .as_deref()
            .unwrap_or(&[])
            .iter()
            .map(guide_info)
            .collect(),
        frames,
    }
}

/// A layer with export presets (Dev Mode's assets).
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Exportable {
    pub id: String,
    pub name: String,
    pub settings: Vec<crate::model::ExportSetting>,
}

/// At most this many exportable layers are listed.
const MAX_EXPORTABLES: usize = 200;

/// Layer `i` and the visible layers inside it that have export presets,
/// in layer order.
pub fn exportables(doc: &Document, scene: &Scene, i: SceneIdx) -> Vec<Exportable> {
    let mut out = Vec::new();
    let mut stack = vec![i];
    while let Some(n) = stack.pop() {
        if out.len() >= MAX_EXPORTABLES {
            break;
        }
        let props = scene.props(doc, n);
        if !props.visible() {
            continue;
        }
        let settings = props.export_settings.as_deref().unwrap_or(&[]);
        if !settings.is_empty() {
            out.push(Exportable {
                id: scene.id(doc, n),
                name: props.name().to_owned(),
                settings: settings.to_vec(),
            });
        }
        stack.extend(scene.node(n).children.iter().rev().copied());
    }
    out
}
