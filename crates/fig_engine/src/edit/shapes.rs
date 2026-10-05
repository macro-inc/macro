//! Boolean operations, flattening, and vector networks.
//!
//! A boolean layer's children are its operands. Figma stores the combined
//! outline as the boolean's fill geometry; when the layer or its children
//! change, the outline is computed again ([`crate::boolean`]) and the
//! boolean refits it (its origin at the outline's top left, its size the
//! outline's), the way Figma keeps it. Vector layers keep their network
//! ([`crate::vector`]) in a blob; their fill and stroke geometry are drawn
//! from it whenever it, the stroke, or the size changes.

use super::{NewNode, Patch, Txn, flags};
use crate::boolean::{self, BoolOp, Operand};
use crate::document::{Document, NodeIdx};
use crate::error::Result;
use crate::geometry;
use crate::model::{
    Affine, BlendMode, Color, NodeType, Paint, PathRef, Props, StrokeAlign, Vec2, VectorData,
    WindingRule,
};
use crate::vector::{Network, node_network};
use std::sync::Arc;
use tiny_skia::{FillRule, Path, PathBuilder};

fn fill_rule(w: WindingRule) -> FillRule {
    match w {
        WindingRule::NonZero => FillRule::Winding,
        WindingRule::EvenOdd => FillRule::EvenOdd,
    }
}

fn winding(r: FillRule) -> WindingRule {
    match r {
        FillRule::Winding => WindingRule::NonZero,
        FillRule::EvenOdd => WindingRule::EvenOdd,
    }
}

fn mapped(path: &Path, t: &Affine) -> Option<Path> {
    path.clone().transform(t.to_skia())
}

/// The outline a shape draws from its size (rectangles, ellipses, lines)
/// when it has no stored geometry.
fn box_shape(props: &Props) -> Option<Path> {
    let size = props.size();
    match props.node_type() {
        NodeType::Ellipse => tiny_skia::Rect::from_xywh(0.0, 0.0, size.x as f32, size.y as f32)
            .and_then(PathBuilder::from_oval),
        NodeType::Line => {
            let w = props.stroke_weight().max(0.01);
            geometry::rect_path(0.0, -w / 2.0, size.x as f32, w)
        }
        _ => geometry::rounded_rect(
            size.x as f32,
            size.y as f32,
            props.radii(),
            props.corner_smoothing.unwrap_or(0.0),
        ),
    }
}

/// The filled outline of layer `i` and its contents, mapped by `to` (from
/// the layer's own space), as a boolean operation or flattening uses it.
pub fn operand(doc: &Document, i: NodeIdx, to: &Affine, out: &mut Operand) {
    let node = doc.node(i);
    let p = &node.props;
    if node.removed || !p.visible() {
        return;
    }
    let blob_paths = |refs: &[PathRef], out: &mut Operand| {
        for r in refs {
            if let Some(path) = doc.blobs.path(r.blob).and_then(|b| mapped(&b.path, to)) {
                out.push((path, fill_rule(r.winding)));
            }
        }
    };
    match p.node_type() {
        NodeType::BooleanOperation if !p.fill_geometry().is_empty() => {
            blob_paths(p.fill_geometry(), out);
        }
        NodeType::BooleanOperation => {
            if let Some(path) = combined(doc, i).and_then(|c| mapped(&c, to)) {
                out.push((path, FillRule::Winding));
            }
        }
        NodeType::Group => {
            for &c in &node.children {
                operand(doc, c, &to.mul(&doc.props(c).transform()), out);
            }
        }
        NodeType::Text => {
            let Some(layout) = &p.text_layout else { return };
            for g in layout.glyphs.iter() {
                let Some(path) = g.blob.and_then(|b| doc.blobs.path(b)) else {
                    continue;
                };
                let fs = f64::from(g.font_size);
                let glyph = to
                    .mul(&Affine::translate(f64::from(g.x), f64::from(g.y)))
                    .mul(&Affine::scale(fs, -fs));
                if let Some(path) = mapped(&path.path, &glyph) {
                    out.push((path, FillRule::Winding));
                }
            }
        }
        t if t.is_frame_like() => {
            if p.has_visible_fills()
                && let Some(path) = box_shape(p).and_then(|b| mapped(&b, to))
            {
                out.push((path, FillRule::Winding));
            }
            for &c in &node.children {
                operand(doc, c, &to.mul(&doc.props(c).transform()), out);
            }
        }
        _ => {
            // Figma combines what a layer paints: its fill's outline, or
            // for a layer with only strokes, the stroke's.
            let mut fill = Vec::new();
            fill_outline(doc, p, &Affine::IDENTITY, &mut fill);
            let strokes_only = p.has_visible_strokes() && !p.has_visible_fills();
            if strokes_only && let Some(stroke) = stroke_region(doc, p, &fill) {
                if let Some(path) = mapped(&stroke, to) {
                    out.push((path, FillRule::Winding));
                }
                return;
            }
            for (path, rule) in fill {
                if let Some(path) = mapped(&path, to) {
                    out.push((path, rule));
                }
            }
        }
    }
}

/// A shape's fill outline in its own space: its geometry, its network's
/// regions, or the shape its size draws (lines: their stroke).
fn fill_outline(doc: &Document, p: &Props, to: &Affine, out: &mut Operand) {
    let blob_paths = |refs: &[PathRef], out: &mut Operand| {
        for r in refs {
            if let Some(path) = doc.blobs.path(r.blob).and_then(|b| mapped(&b.path, to)) {
                out.push((path, fill_rule(r.winding)));
            }
        }
    };
    if !p.fill_geometry().is_empty() {
        blob_paths(p.fill_geometry(), out);
        return;
    }
    if let Some(net) = node_network(doc, p) {
        let regions = net.fill_paths();
        if !regions.is_empty() {
            for (path, rule) in regions {
                if let Some(path) = mapped(&path, to) {
                    out.push((path, fill_rule(rule)));
                }
            }
            return;
        }
    }
    if !p.stroke_geometry().is_empty() {
        blob_paths(p.stroke_geometry(), out);
    } else if let Some(path) = box_shape(p).and_then(|b| mapped(&b, to)) {
        out.push((path, FillRule::Winding));
    }
}

/// The area a shape's stroke covers, in its own space. Inside and outside
/// strokes are stored doubled and centered; the fill outline cuts them.
fn stroke_region(doc: &Document, p: &Props, fill: &Operand) -> Option<Path> {
    let stroke: Operand = if p.stroke_geometry().is_empty() {
        let path = node_network(doc, p)
            .and_then(|n| n.stroke_path())
            .or_else(|| fill.first().map(|f| f.0.clone()))?;
        vec![(stroke_outline(&path, p, false)?, FillRule::Winding)]
    } else {
        p.stroke_geometry()
            .iter()
            .filter_map(|g| {
                doc.blobs
                    .path(g.blob)
                    .map(|b| (b.path.clone(), fill_rule(g.winding)))
            })
            .collect()
    };
    let open = p.fill_geometry().is_empty() && p.node_type() == NodeType::Vector
        || p.node_type() == NodeType::Line;
    let op = match p.stroke_align() {
        _ if open || fill.is_empty() => BoolOp::Union,
        StrokeAlign::Center => BoolOp::Union,
        StrokeAlign::Inside => BoolOp::Intersect,
        StrokeAlign::Outside => BoolOp::Subtract,
    };
    if op == BoolOp::Union {
        return boolean::combine(op, &[stroke]);
    }
    boolean::combine(op, &[stroke, fill.clone()])
}

/// What a boolean layer's children combine to, in its space.
pub fn combined(doc: &Document, b: NodeIdx) -> Option<Path> {
    let op = doc
        .props(b)
        .boolean_operation
        .as_deref()
        .and_then(BoolOp::parse)
        .unwrap_or(BoolOp::Union);
    let operands: Vec<Operand> = doc
        .node(b)
        .children
        .iter()
        .map(|&c| {
            let mut o = Vec::new();
            operand(doc, c, &doc.props(c).transform(), &mut o);
            o
        })
        // Hidden and empty layers take no part (the first visible one is
        // what a subtraction starts from).
        .filter(|o| !o.is_empty())
        .collect();
    boolean::combine(op, &operands)
}

/// The outline Figma stores for a stroke along `path`: the stroke's own
/// width when centered, twice it for inside and outside strokes (drawing
/// clips the half that does not belong).
pub fn stroke_outline(path: &Path, props: &Props, open: bool) -> Option<Path> {
    let weight = props.stroke_weight();
    if weight <= 0.0 {
        return None;
    }
    let width = if open || props.stroke_align() == StrokeAlign::Center {
        weight
    } else {
        weight * 2.0
    };
    let stroke = tiny_skia::Stroke {
        width,
        line_cap: match props.stroke_cap.as_deref() {
            Some("ROUND") => tiny_skia::LineCap::Round,
            Some("SQUARE") => tiny_skia::LineCap::Square,
            _ => tiny_skia::LineCap::Butt,
        },
        line_join: match props.stroke_join.as_deref() {
            Some("ROUND") => tiny_skia::LineJoin::Round,
            Some("BEVEL") => tiny_skia::LineJoin::Bevel,
            _ => tiny_skia::LineJoin::Miter,
        },
        ..Default::default()
    };
    path.stroke(&stroke, 1.0)
}

fn bounds_of(path: &Path) -> Option<crate::model::Rect> {
    let b = path.compute_tight_bounds()?;
    Some(crate::model::Rect::new(
        f64::from(b.x()),
        f64::from(b.y()),
        f64::from(b.width()),
        f64::from(b.height()),
    ))
}

impl Txn<'_> {
    fn blob(&mut self, path: &Path) -> u32 {
        self.doc.blobs.push(&geometry::encode_blob(path))
    }

    /// Figma's boolean operations: the layers sharing the first one's parent
    /// become the operands of a new boolean layer, in their stacking order,
    /// which takes the bottom one's fills, strokes, and effects. A lone
    /// boolean layer changes its operation instead.
    pub(super) fn boolean(&mut self, ids: &[NodeIdx], op: BoolOp) -> Result<Option<NodeIdx>> {
        let Some(&first) = ids.first() else {
            return Ok(None);
        };
        if ids.len() == 1 && self.doc.props(first).node_type() == NodeType::BooleanOperation {
            self.edit(first, flags::BOOLEAN).boolean_operation = Some(op.figma_name().into());
            self.refit_boolean(first);
            return Ok(Some(first));
        }
        let parent = self.doc.node(first).parent;
        let siblings = parent.map(|p| self.doc.node(p).children.clone());
        let mut members: Vec<NodeIdx> = ids
            .iter()
            .copied()
            .filter(|&i| self.doc.node(i).parent == parent)
            .collect();
        if let Some(siblings) = &siblings {
            members.sort_by_key(|i| siblings.iter().position(|c| c == i));
        }
        let bottom = self.doc.props(members[0]).clone();
        let Some(b) = self.group(&members, false)? else {
            return Ok(None);
        };
        let p = self.edit(b, flags::TYPE | flags::NAME | flags::BOOLEAN);
        p.node_type = Some(NodeType::BooleanOperation);
        p.name = Some(op.label().into());
        p.boolean_operation = Some(op.figma_name().into());
        p.fills = bottom.fills.clone();
        p.strokes = bottom.strokes.clone();
        p.stroke_weight = bottom.stroke_weight;
        p.stroke_align = bottom.stroke_align;
        p.stroke_join = bottom.stroke_join.clone();
        p.effects = bottom.effects.clone();
        p.fill_style = bottom.fill_style;
        p.stroke_style = bottom.stroke_style;
        p.effect_style = bottom.effect_style;
        self.refit_boolean(b);
        Ok(Some(b))
    }

    /// Computes a boolean layer's outline again and fits the layer to it.
    pub(super) fn refit_boolean(&mut self, b: NodeIdx) {
        let Some(path) = combined(self.doc, b) else {
            let p = self.edit(b, flags::GEOMETRY);
            p.fill_geometry = Some(Arc::from([]));
            p.stroke_geometry = Some(Arc::from([]));
            return;
        };
        let Some(r) = bounds_of(&path) else { return };
        let mut path = path;
        if r.x.abs() > 1e-9 || r.y.abs() > 1e-9 {
            // Keep the origin at the outline's top left: the layer moves by
            // the offset and its children back by it.
            let t = self
                .doc
                .props(b)
                .transform()
                .mul(&Affine::translate(r.x, r.y));
            self.edit(b, flags::TRANSFORM).transform = Some(t);
            let back = Affine::translate(-r.x, -r.y);
            for c in self.doc.node(b).children.clone() {
                let ct = back.mul(&self.doc.props(c).transform());
                self.edit(c, flags::TRANSFORM).transform = Some(ct);
            }
            path = mapped(&path, &back).unwrap_or(path);
        }
        let size = Vec2::new(r.w.max(0.01), r.h.max(0.01));
        if self.doc.props(b).size() != size {
            self.edit(b, flags::SIZE).size = Some(size);
        }
        let fill = self.blob(&path);
        let stroke = if self.doc.props(b).strokes().is_empty() {
            None
        } else {
            stroke_outline(&path, self.doc.props(b), false).map(|s| self.blob(&s))
        };
        let p = self.edit(b, flags::GEOMETRY);
        p.fill_geometry = Some(Arc::from([PathRef {
            winding: WindingRule::NonZero,
            blob: fill,
        }]));
        p.stroke_geometry = Some(
            stroke
                .map(|blob| {
                    Arc::from([PathRef {
                        winding: WindingRule::NonZero,
                        blob,
                    }])
                })
                .unwrap_or_else(|| Arc::from([])),
        );
    }

    /// Refits the boolean layers whose operands the step changed (from the
    /// snapshots taken since `since`), innermost first.
    pub(super) fn refit_booleans(&mut self, since: usize) {
        let mut found: Vec<NodeIdx> = Vec::new();
        let changed: Vec<(NodeIdx, bool)> = self.before[since..]
            .iter()
            .map(|(i, old)| {
                let now = self.doc.node(*i);
                let own = old.children != now.children
                    || old.props.boolean_operation != now.props.boolean_operation
                    || old.props.size != now.props.size;
                (*i, own)
            })
            .collect();
        for (i, own) in changed {
            let is_boolean = self.doc.props(i).node_type() == NodeType::BooleanOperation;
            if own && is_boolean && !found.contains(&i) {
                found.push(i);
            }
            let mut at = self.doc.node(i).parent;
            while let Some(p) = at {
                if self.doc.props(p).node_type() == NodeType::BooleanOperation
                    && !found.contains(&p)
                {
                    found.push(p);
                }
                at = self.doc.node(p).parent;
            }
        }
        found.retain(|&b| !self.doc.node(b).removed);
        let depth = |doc: &Document, mut i: NodeIdx| {
            let mut d = 0;
            while let Some(p) = doc.node(i).parent {
                d += 1;
                i = p;
            }
            d
        };
        found.sort_by_key(|&b| std::cmp::Reverse(depth(self.doc, b)));
        for b in found {
            self.refit_boolean(b);
        }
    }

    /// Figma's "Flatten" (⌘E): the layers sharing the first one's parent
    /// become one vector layer where the topmost was, drawing what they
    /// filled, with the bottom one's look. A lone line or open vector keeps
    /// its path and stroke.
    pub(super) fn flatten(&mut self, ids: &[NodeIdx]) -> Result<Option<NodeIdx>> {
        let Some(&first) = ids.first() else {
            return Ok(None);
        };
        let Some(parent) = self.doc.node(first).parent else {
            return Ok(None);
        };
        let siblings = self.doc.node(parent).children.clone();
        let mut members: Vec<NodeIdx> = ids
            .iter()
            .copied()
            .filter(|&i| self.doc.node(i).parent == Some(parent))
            .collect();
        members.sort_by_key(|i| siblings.iter().position(|c| c == i));
        let bottom = members[0];
        let top_index = members
            .iter()
            .filter_map(|i| siblings.iter().position(|c| c == i))
            .max()
            .unwrap_or(0);
        let look = self.doc.props(bottom).clone();
        let single = members.len() == 1;
        let network = if single {
            self.flat_network(bottom)
        } else {
            let operands: Vec<Operand> = members
                .iter()
                .map(|&m| {
                    let mut o = Vec::new();
                    operand(self.doc, m, &self.doc.props(m).transform(), &mut o);
                    o
                })
                .filter(|o| !o.is_empty())
                .collect();
            boolean::combine(BoolOp::Union, &operands)
                .map(|p| Network::from_path(&p, WindingRule::NonZero))
        };
        let Some(network) = network else {
            return Ok(None);
        };
        let name = if single {
            look.name().to_owned()
        } else {
            "Vector".into()
        };
        let page_net = network.transformed(&self.doc.world(parent));
        let index = top_index + 1 - members.len().min(top_index + 1);
        for &m in &members {
            self.remove_tree(m);
        }
        let v = self.create_vector(
            parent,
            Some(index),
            &page_net,
            Some(name),
            &Patch::default(),
        )?;
        let p = self.edit(v, u32::MAX);
        p.fills = look.fills.clone();
        p.strokes = look.strokes.clone();
        p.stroke_weight = look.stroke_weight;
        p.stroke_align = look.stroke_align;
        p.stroke_cap = look.stroke_cap.clone();
        p.stroke_join = look.stroke_join.clone();
        p.effects = look.effects.clone();
        p.opacity = look.opacity;
        p.blend_mode = look.blend_mode;
        p.fill_style = look.fill_style;
        p.stroke_style = look.stroke_style;
        p.effect_style = look.effect_style;
        p.constraints = look.constraints.clone();
        self.vector_geometry(v);
        Ok(Some(v))
    }

    /// The network flattening one layer gives, in its parent's space.
    fn flat_network(&self, i: NodeIdx) -> Option<Network> {
        let p = self.doc.props(i);
        let t = p.transform();
        if let Some(net) = node_network(self.doc, p) {
            return Some(net.transformed(&t));
        }
        if p.node_type() == NodeType::Line {
            let len = p.size().x as f32;
            let net: Network = serde_json::from_value(serde_json::json!({
                "vertices": [{ "x": 0.0, "y": 0.0 }, { "x": len, "y": 0.0 }],
                "segments": [{ "start": 0, "end": 1 }],
            }))
            .ok()?;
            return Some(net.transformed(&t));
        }
        let mut o = Vec::new();
        let t_ = p.node_type();
        if matches!(
            t_,
            NodeType::Group | NodeType::BooleanOperation | NodeType::Text
        ) || t_.is_frame_like()
        {
            operand(self.doc, i, &t, &mut o);
        } else {
            // A shape keeps its path (and its stroke along it).
            fill_outline(self.doc, p, &t, &mut o);
        }
        match o.len() {
            0 => None,
            1 => Some(Network::from_path(&o[0].0, winding(o[0].1))),
            _ => boolean::combine(BoolOp::Union, &[o])
                .map(|p| Network::from_path(&p, WindingRule::NonZero)),
        }
    }

    /// Creates a vector layer in `parent` drawing `network` (page
    /// coordinates), with Figma's pen defaults: a 1 px black stroke and no
    /// fill.
    pub(super) fn create_vector(
        &mut self,
        parent: NodeIdx,
        index: Option<usize>,
        network: &Network,
        name: Option<String>,
        patch: &Patch,
    ) -> Result<NodeIdx> {
        let local = network.transformed(&self.doc.world(parent).invert().unwrap_or_default());
        let r = local.bounds();
        let spec = NewNode {
            node_type: "VECTOR".into(),
            name,
            x: 0.0,
            y: 0.0,
            width: r.w,
            height: r.h,
            props: Patch::default(),
        };
        let v = self.create(parent, index, &spec)?;
        let p = self.edit(v, u32::MAX);
        p.transform = Some(Affine::translate(r.x, r.y));
        p.size = Some(Vec2::new(r.w.max(0.01), r.h.max(0.01)));
        p.fills = Some(Arc::from([]));
        p.strokes = Some(Arc::from([Paint::solid(Color::BLACK)]));
        p.stroke_align = Some(StrokeAlign::Center);
        p.stroke_cap = Some("NONE".into());
        p.stroke_join = Some("MITER".into());
        p.blend_mode = Some(BlendMode::PassThrough);
        p.corner_radius = None;
        self.store_network(v, &local.transformed(&Affine::translate(-r.x, -r.y)));
        self.set(v, patch)?;
        Ok(v)
    }

    /// Replaces a layer's network with `network` (page coordinates), fitting
    /// the layer to it; other shapes become vector layers.
    pub(super) fn set_vector(&mut self, i: NodeIdx, network: &Network) -> Result<()> {
        let world = self.doc.world(i);
        let local = network.transformed(&world.invert().unwrap_or_default());
        let r = local.bounds();
        if self.doc.props(i).node_type() != NodeType::Vector {
            let p = self.edit(i, flags::TYPE | flags::RADIUS);
            p.node_type = Some(NodeType::Vector);
            p.corner_radius = Some(0.0);
            p.corner_radii = None;
        }
        if r.x.abs() > 1e-9 || r.y.abs() > 1e-9 {
            let t = self
                .doc
                .props(i)
                .transform()
                .mul(&Affine::translate(r.x, r.y));
            self.edit(i, flags::TRANSFORM).transform = Some(t);
        }
        self.edit(i, flags::SIZE).size = Some(Vec2::new(r.w.max(0.01), r.h.max(0.01)));
        self.store_network(i, &local.transformed(&Affine::translate(-r.x, -r.y)));
        Ok(())
    }

    /// Stores `network` (the layer's space, at its size) and draws it.
    fn store_network(&mut self, i: NodeIdx, network: &Network) {
        let blob = self.doc.blobs.push(&network.encode());
        let size = self.doc.props(i).size();
        self.edit(i, flags::VECTOR).vector_data = Some(Arc::new(VectorData {
            network_blob: Some(blob),
            normalized_size: Some(size),
        }));
        self.vector_geometry(i);
    }

    /// Draws a vector layer's fill and stroke geometry from its network.
    pub(super) fn vector_geometry(&mut self, i: NodeIdx) {
        let Some(net) = node_network(self.doc, self.doc.props(i)) else {
            return;
        };
        let fills: Vec<PathRef> = net
            .fill_paths()
            .iter()
            .map(|(path, rule)| PathRef {
                winding: *rule,
                blob: self.blob(path),
            })
            .collect();
        let open = fills.is_empty();
        let stroke = if self.doc.props(i).strokes().is_empty() {
            None
        } else {
            net.stroke_path()
                .and_then(|p| stroke_outline(&p, self.doc.props(i), open))
                .map(|s| self.blob(&s))
        };
        let p = self.edit(i, flags::GEOMETRY);
        p.fill_geometry = Some(fills.into());
        p.stroke_geometry = Some(
            stroke
                .map(|blob| PathRef {
                    winding: WindingRule::NonZero,
                    blob,
                })
                .into_iter()
                .collect(),
        );
    }

    /// Draws the stroke outline again after the stroke changed, for layers
    /// the engine draws itself (vectors and booleans); `false` for others.
    pub(super) fn redraw_stroke(&mut self, i: NodeIdx) -> bool {
        let props = self.doc.props(i);
        if props.vector_data.is_some() && node_network(self.doc, props).is_some() {
            self.vector_geometry(i);
            return true;
        }
        if props.node_type() == NodeType::BooleanOperation {
            let outline = props
                .fill_geometry()
                .first()
                .and_then(|g| self.doc.blobs.path(g.blob))
                .and_then(|p| stroke_outline(&p.path, props, false));
            let stroke = outline.map(|s| self.blob(&s));
            self.edit(i, flags::GEOMETRY).stroke_geometry = Some(
                stroke
                    .map(|blob| PathRef {
                        winding: WindingRule::NonZero,
                        blob,
                    })
                    .into_iter()
                    .collect(),
            );
            return true;
        }
        false
    }
}

#[cfg(test)]
mod test;
