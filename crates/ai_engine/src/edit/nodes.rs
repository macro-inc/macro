//! Operations on nodes' properties: names, visibility, opacity, paints,
//! outlines, text, and transforms; text to outlines; boolean combination.

use super::{BooleanMode, Ctx, NodePatch, TextPatch};
use crate::error::{AiError, Result};
use crate::geom::{Affine, PathData};
use crate::model::{Clip, Node, NodeIdx, NodeKind, Paint, PathNode, Stroke, flags};

/// Sets node properties.
pub fn set_node(ctx: &mut Ctx<'_>, ids: &[u32], patch: &NodePatch) -> Result<()> {
    for id in ids {
        let i = ctx.find(*id)?;
        let n = ctx.node(i);
        if let Some(name) = &patch.name {
            n.name = name.clone();
            n.edits |= flags::NAME;
        }
        if let Some(h) = patch.hidden {
            n.hidden = h;
            n.edits |= flags::VISIBILITY;
        }
        if let Some(l) = patch.locked {
            n.locked = l;
            n.edits |= flags::VISIBILITY;
        }
        if let Some(o) = patch.opacity {
            n.opacity = o.clamp(0.0, 1.0);
            n.edits |= flags::APPEARANCE;
        }
        if let Some(b) = patch.blend {
            n.blend = b;
            n.edits |= flags::APPEARANCE;
        }
        if let Some(c) = patch.color
            && let NodeKind::Layer { color, .. } = &mut n.kind
        {
            *color = c;
            n.edits |= flags::NAME;
        }
        if patch.name.is_some() || patch.hidden.is_some() || patch.locked.is_some() {
            ctx.structure();
        }
    }
    Ok(())
}

/// The paths and text in nodes (groups and layers expanded).
fn leaves(ctx: &Ctx<'_>, ids: &[u32]) -> Vec<NodeIdx> {
    let mut out = Vec::new();
    fn walk(doc: &crate::model::Document, i: NodeIdx, out: &mut Vec<NodeIdx>) {
        let n = doc.node(i);
        if n.removed || (n.locked && !n.is_layer()) {
            return;
        }
        match n.kind {
            NodeKind::Path(_) | NodeKind::Text(_) => out.push(i),
            NodeKind::Layer { .. } | NodeKind::Group { .. } => {
                for &c in &n.children {
                    walk(doc, c, out);
                }
            }
            _ => {}
        }
    }
    for i in ctx.find_all(ids) {
        walk(ctx.doc, i, &mut out);
    }
    out
}

/// Sets fills.
pub fn set_fill(ctx: &mut Ctx<'_>, ids: &[u32], fill: Option<&Paint>) -> Result<()> {
    for i in leaves(ctx, ids) {
        let n = ctx.node(i);
        match &mut n.kind {
            NodeKind::Path(p) => p.fill = fill.cloned(),
            NodeKind::Text(t) => {
                t.fill = fill.cloned();
                for run in t.runs.iter_mut().flatten() {
                    run.fill = fill.cloned();
                }
            }
            _ => continue,
        }
        n.edits |= flags::FILL;
    }
    Ok(())
}

/// Sets strokes.
pub fn set_stroke(ctx: &mut Ctx<'_>, ids: &[u32], stroke: Option<&Stroke>) -> Result<()> {
    for i in leaves(ctx, ids) {
        let n = ctx.node(i);
        match &mut n.kind {
            NodeKind::Path(p) => p.stroke = stroke.cloned(),
            NodeKind::Text(t) => {
                t.stroke = stroke.cloned();
                for run in t.runs.iter_mut().flatten() {
                    run.stroke = stroke.cloned();
                }
            }
            _ => continue,
        }
        n.edits |= flags::STROKE;
    }
    Ok(())
}

/// Replaces a path's outline.
pub fn set_path(ctx: &mut Ctx<'_>, id: u32, data: &PathData, even_odd: Option<bool>) -> Result<()> {
    let i = ctx.find(id)?;
    let n = ctx.node(i);
    let NodeKind::Path(p) = &mut n.kind else {
        return Err(AiError::invalid("not a path"));
    };
    p.data = data.clone();
    if let Some(e) = even_odd {
        p.even_odd = e;
    }
    n.edits |= flags::GEOMETRY;
    Ok(())
}

/// Changes text (laid out again from then on).
pub fn set_text(ctx: &mut Ctx<'_>, id: u32, patch: &TextPatch) -> Result<()> {
    let i = ctx.find(id)?;
    let n = ctx.node(i);
    let NodeKind::Text(t) = &mut n.kind else {
        return Err(AiError::invalid("not text"));
    };
    if let Some(v) = &patch.text {
        t.text = v.clone();
    }
    if let Some(v) = &patch.family {
        t.family = v.clone();
    }
    if let Some(v) = &patch.style {
        t.style = v.clone();
    }
    if let Some(v) = patch.size {
        t.size = v.clamp(0.1, 10_000.0);
    }
    if let Some(v) = patch.align {
        t.align = v;
    }
    if let Some(v) = patch.line_height {
        t.line_height = v.clamp(0.1, 100.0);
    }
    if let Some(v) = patch.tracking {
        t.tracking = v;
    }
    if let Some(v) = patch.width {
        t.width = v.filter(|w| *w > 0.0);
    }
    if t.runs.is_some() {
        // From now on the text is laid out here: start from the file's
        // position for the first line (the runs' first baseline is the
        // text space origin already).
        t.runs = None;
    }
    n.edits |= flags::TEXT;
    Ok(())
}

/// Applies a canvas transform to a node and what it holds.
pub fn transform_node(ctx: &mut Ctx<'_>, i: NodeIdx, m: &Affine) {
    let n = ctx.doc.node(i);
    if n.removed {
        return;
    }
    let children = n.children.clone();
    let container = n.is_container();
    {
        let n = ctx.node(i);
        match &mut n.kind {
            NodeKind::Group { clip, .. } => {
                if let Some(c) = clip {
                    c.path = c.path.transform(m);
                    n.edits |= flags::CLIP;
                }
            }
            NodeKind::Layer { .. } => {}
            _ => {
                n.transform = n.transform.followed_by(m);
                n.edits |= flags::TRANSFORM;
            }
        }
    }
    if container {
        for c in children {
            transform_node(ctx, c, m);
        }
    }
}

/// Transforms nodes on the canvas.
pub fn transform(ctx: &mut Ctx<'_>, ids: &[u32], m: &Affine) -> Result<()> {
    if !m.is_finite() || m.det().abs() < 1e-12 {
        return Err(AiError::invalid("the transform flattens or is not finite"));
    }
    let nodes = outermost(ctx, &ctx.find_all(ids));
    for i in nodes {
        transform_node(ctx, i, m);
    }
    Ok(())
}

/// Sets a node's transform.
pub fn set_transform(ctx: &mut Ctx<'_>, id: u32, t: &Affine) -> Result<()> {
    let i = ctx.find(id)?;
    if !t.is_finite() || t.det().abs() < 1e-12 {
        return Err(AiError::invalid("the transform flattens or is not finite"));
    }
    if ctx.doc.node(i).is_container() {
        return Err(AiError::invalid("groups have no transform of their own"));
    }
    let n = ctx.node(i);
    n.transform = *t;
    n.edits |= flags::TRANSFORM;
    Ok(())
}

/// The nodes not inside another of them.
pub fn outermost(ctx: &Ctx<'_>, nodes: &[NodeIdx]) -> Vec<NodeIdx> {
    nodes
        .iter()
        .copied()
        .filter(|&i| !nodes.iter().any(|&j| j != i && ctx.doc.is_within(i, j)))
        .collect()
}

/// A text object's outlines, in its own space, with the paint of each
/// part (one per glyph run for text from a file).
pub fn text_outlines(
    doc: &crate::model::Document,
    n: &Node,
) -> Vec<(PathData, Option<Paint>, Option<Stroke>)> {
    let NodeKind::Text(t) = &n.kind else {
        return Vec::new();
    };
    let Some(runs) = &t.runs else {
        return vec![(crate::text::outlines(t), t.fill.clone(), t.stroke.clone())];
    };
    let Some(file) = &doc.file else {
        return Vec::new();
    };
    let fonts = match file.fonts.lock() {
        Ok(f) => f,
        Err(e) => e.into_inner(),
    };
    let mut out = Vec::new();
    for run in runs {
        let Some(font) = fonts.get(&run.font) else {
            continue;
        };
        let mut data = PathData::default();
        for g in &run.glyphs {
            if let Some(outline) = font.font.outline(g.code) {
                let m = Affine::translate(g.x, 0.0).followed_by(&run.matrix);
                data.segs
                    .extend(PathData::from_skia(&outline).transform(&m).segs);
            }
        }
        if !data.is_empty() {
            out.push((data, run.fill.clone(), run.stroke.clone()));
        }
    }
    out
}

/// Turns text into paths (a group of them when the text had several
/// paints).
pub fn outline(ctx: &mut Ctx<'_>, ids: &[u32]) -> Result<()> {
    for i in ctx.find_all(ids) {
        let n = ctx.doc.node(i).clone();
        if !matches!(n.kind, NodeKind::Text(_)) {
            continue;
        }
        let parts = text_outlines(ctx.doc, &n);
        if parts.is_empty() {
            continue;
        }
        let Some(parent) = n.parent else { continue };
        let at = ctx
            .doc
            .node(parent)
            .children
            .iter()
            .position(|&c| c == i)
            .unwrap_or(0);
        let make = |data: PathData, fill: Option<Paint>, stroke: Option<Stroke>| {
            let mut p = Node::new(
                0,
                NodeKind::Path(PathNode {
                    data,
                    fill,
                    even_odd: false,
                    stroke,
                }),
            );
            p.transform = n.transform;
            p.opacity = n.opacity;
            p.blend = n.blend;
            p.artboard = n.artboard;
            p.name = n.name.clone();
            p
        };
        let replacement = if parts.len() == 1 {
            let (data, fill, stroke) = parts.into_iter().next().expect("one part");
            let p = ctx.push(make(data, fill, stroke));
            ctx.node(p).parent = Some(parent);
            p
        } else {
            let mut g = Node::new(
                0,
                NodeKind::Group {
                    clip: None,
                    isolated: false,
                    knockout: false,
                },
            );
            g.artboard = n.artboard;
            g.name = n.name.clone();
            let g = ctx.push(g);
            ctx.node(g).parent = Some(parent);
            for (data, fill, stroke) in parts {
                let p = ctx.push(make(data, fill, stroke));
                let pn = ctx.node(p);
                pn.parent = Some(g);
                pn.opacity = 1.0;
                pn.blend = crate::model::BlendMode::Normal;
                ctx.node(g).children.push(p);
            }
            let gn = ctx.node(g);
            gn.opacity = n.opacity;
            gn.blend = n.blend;
            g
        };
        let siblings = &mut ctx.node(parent).children;
        siblings[at] = replacement;
        let old = ctx.node(i);
        old.removed = true;
        old.edits |= flags::PARENT;
        ctx.structure();
    }
    Ok(())
}

/// Combines paths into one (taking the bottom one's paint).
pub fn boolean(ctx: &mut Ctx<'_>, ids: &[u32], mode: BooleanMode) -> Result<()> {
    let nodes: Vec<NodeIdx> = ctx
        .find_all(ids)
        .into_iter()
        .filter(|&i| matches!(ctx.doc.node(i).kind, NodeKind::Path(_) | NodeKind::Text(_)))
        .collect();
    if nodes.len() < 2 {
        return Err(AiError::invalid("select two or more paths"));
    }
    // Paint order: the bottom one first.
    let order = ctx.doc.paint_order();
    let mut nodes = nodes;
    nodes.sort_by_key(|i| order.iter().position(|o| o == i).unwrap_or(usize::MAX));
    let bottom = ctx.doc.node(nodes[0]).clone();
    let mut operands = Vec::new();
    for &i in &nodes {
        let n = ctx.doc.node(i);
        let mut operand = Vec::new();
        match &n.kind {
            NodeKind::Path(p) => {
                if let Some(path) = p.data.transform(&n.transform).to_skia() {
                    let rule = if p.even_odd {
                        tiny_skia::FillRule::EvenOdd
                    } else {
                        tiny_skia::FillRule::Winding
                    };
                    operand.push((path, rule));
                }
            }
            NodeKind::Text(_) => {
                for (data, _, _) in text_outlines(ctx.doc, n) {
                    if let Some(path) = data.transform(&n.transform).to_skia() {
                        operand.push((path, tiny_skia::FillRule::Winding));
                    }
                }
            }
            _ => {}
        }
        operands.push(operand);
    }
    let op = match mode {
        BooleanMode::Unite => fig_engine::boolean::BoolOp::Union,
        BooleanMode::Subtract => fig_engine::boolean::BoolOp::Subtract,
        BooleanMode::Intersect => fig_engine::boolean::BoolOp::Intersect,
        BooleanMode::Exclude => fig_engine::boolean::BoolOp::Exclude,
    };
    let data = fig_engine::boolean::combine(op, &operands)
        .map(|p| PathData::from_skia(&p))
        .unwrap_or_default();
    // The result takes the bottom object's place and paint, in canvas
    // space.
    let (fill, stroke) = match &bottom.kind {
        NodeKind::Path(p) => (p.fill.clone(), p.stroke.clone()),
        NodeKind::Text(t) => (t.fill.clone(), t.stroke.clone()),
        _ => (None, None),
    };
    let scale = bottom.transform.scale_factor();
    let mut result = Node::new(
        0,
        NodeKind::Path(PathNode {
            data,
            fill: fill.map(|f| to_canvas_paint(f, &bottom.transform)),
            even_odd: false,
            stroke: stroke.map(|mut s| {
                s.width *= scale;
                s.paint = to_canvas_paint(s.paint, &bottom.transform);
                s
            }),
        }),
    );
    result.opacity = bottom.opacity;
    result.blend = bottom.blend;
    result.artboard = bottom.artboard;
    let parent = bottom
        .parent
        .ok_or_else(|| AiError::invalid("layers can't be combined"))?;
    let top = *nodes.last().expect("two or more");
    let at = {
        let siblings = &ctx.doc.node(parent).children;
        siblings
            .iter()
            .position(|&c| c == top)
            .unwrap_or(siblings.len())
    };
    let r = ctx.push(result);
    ctx.node(r).parent = Some(parent);
    for &i in &nodes {
        if let Some(p) = ctx.doc.node(i).parent {
            ctx.node(p).children.retain(|&c| c != i);
        }
        ctx.node(i).removed = true;
    }
    let siblings = &mut ctx.node(parent).children;
    let at = at.min(siblings.len());
    siblings.insert(at, r);
    ctx.structure();
    Ok(())
}

/// A paint defined in an object's space, in canvas space.
fn to_canvas_paint(p: Paint, transform: &Affine) -> Paint {
    match p {
        Paint::Gradient { mut gradient } => {
            gradient.transform = gradient.transform.followed_by(transform);
            Paint::Gradient { gradient }
        }
        p => p,
    }
}

/// A clip in canvas space for a path node.
pub fn clip_of(n: &Node) -> Option<Clip> {
    match &n.kind {
        NodeKind::Path(p) => Some(Clip {
            path: p.data.transform(&n.transform),
            even_odd: p.even_odd,
        }),
        _ => None,
    }
}
