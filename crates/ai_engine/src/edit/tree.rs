//! Operations on the layer tree: creating, deleting, copying, moving,
//! grouping, clipping, layers, artboards, and placed images.

use super::nodes::{clip_of, outermost};
use super::{Ctx, NewNode, Position, shapes};
use crate::error::{AiError, Result};
use crate::geom::{Affine, PathData, Rect};
use crate::model::{
    AddedImage, Artboard, Document, ImageNode, ImageSource, Node, NodeIdx, NodeKind, PathNode,
    TextNode, doc_flags, flags,
};

/// The index a position puts a node at in a stack.
fn index_in(doc: &Document, stack: &[NodeIdx], position: Position) -> usize {
    let at = |id: u32| stack.iter().position(|&c| doc.node(c).id == id);
    match position {
        Position::Top => stack.len(),
        Position::Bottom => 0,
        Position::Above(id) => at(id).map_or(stack.len(), |k| k + 1),
        Position::Below(id) => at(id).unwrap_or(0),
    }
}

/// The container a new object goes in: the parent given, else the top
/// unlocked, shown layer (made when there is none).
fn target(ctx: &mut Ctx<'_>, parent: Option<u32>) -> Result<NodeIdx> {
    if let Some(id) = parent {
        let i = ctx.find(id)?;
        if !ctx.doc.node(i).is_container() {
            return Err(AiError::invalid("objects go in layers and groups"));
        }
        return Ok(i);
    }
    let layer = ctx.doc.layers.iter().rev().copied().find(|&l| {
        let n = ctx.doc.node(l);
        !n.removed && !n.locked && !n.hidden
    });
    match layer {
        Some(l) => Ok(l),
        None => new_layer(ctx, None, Position::Top),
    }
}

/// Puts a node into a container's children.
fn attach(ctx: &mut Ctx<'_>, i: NodeIdx, parent: Option<NodeIdx>, position: Position) {
    let stack: Vec<NodeIdx> = match parent {
        Some(p) => ctx.doc.node(p).children.clone(),
        None => ctx.doc.layers.clone(),
    };
    let at = index_in(ctx.doc, &stack, position).min(stack.len());
    match parent {
        Some(p) => {
            ctx.node(p).children.insert(at, i);
        }
        None => {
            ctx.doc.layers.insert(at, i);
            ctx.doc.edits |= doc_flags::LAYERS;
        }
    }
    let n = ctx.node(i);
    n.parent = parent;
    n.edits |= flags::PARENT;
    ctx.structure();
}

/// Takes a node out of its container's children.
fn detach(ctx: &mut Ctx<'_>, i: NodeIdx) {
    match ctx.doc.node(i).parent {
        Some(p) => ctx.node(p).children.retain(|&c| c != i),
        None => {
            ctx.doc.layers.retain(|&c| c != i);
            ctx.doc.edits |= doc_flags::LAYERS;
        }
    }
    ctx.structure();
}

/// The artboard a canvas rectangle is mostly on (the nearest when on
/// none).
pub fn artboard_for(doc: &Document, r: Rect) -> u32 {
    let live = || doc.artboards.iter().filter(|a| !a.removed);
    let best = live()
        .map(|a| (a.id, a.rect.intersect(&r)))
        .filter(|(_, o)| !o.is_empty())
        .max_by(|a, b| (a.1.width() * a.1.height()).total_cmp(&(b.1.width() * b.1.height())))
        .map(|(id, _)| id);
    best.or_else(|| {
        let c = r.center();
        live()
            .min_by(|a, b| {
                a.rect
                    .center()
                    .distance(c)
                    .total_cmp(&b.rect.center().distance(c))
            })
            .map(|a| a.id)
    })
    .unwrap_or(0)
}

/// Adds an object.
pub fn create(
    ctx: &mut Ctx<'_>,
    new: &NewNode,
    parent: Option<u32>,
    position: Position,
) -> Result<NodeIdx> {
    let container = target(ctx, parent)?;
    let path = |data: PathData, fill, stroke, even_odd| {
        NodeKind::Path(PathNode {
            data,
            fill,
            even_odd,
            stroke,
        })
    };
    let (kind, transform, name) = match new {
        NewNode::Path {
            data,
            fill,
            stroke,
            even_odd,
        } => (
            path(data.clone(), fill.clone(), stroke.clone(), *even_odd),
            Affine::IDENTITY,
            "Path",
        ),
        NewNode::Rect {
            rect,
            radius,
            fill,
            stroke,
        } => (
            path(
                shapes::rect(*rect, *radius),
                fill.clone(),
                stroke.clone(),
                false,
            ),
            Affine::IDENTITY,
            "Rectangle",
        ),
        NewNode::Ellipse { rect, fill, stroke } => (
            path(shapes::ellipse(*rect), fill.clone(), stroke.clone(), false),
            Affine::IDENTITY,
            "Ellipse",
        ),
        NewNode::Polygon {
            rect,
            sides,
            inner,
            fill,
            stroke,
        } => (
            path(
                shapes::polygon(*rect, *sides, *inner),
                fill.clone(),
                stroke.clone(),
                false,
            ),
            Affine::IDENTITY,
            if inner.is_some() { "Star" } else { "Polygon" },
        ),
        NewNode::Text {
            at,
            text,
            family,
            style,
            size,
            fill,
            width,
            align,
        } => (
            NodeKind::Text(TextNode {
                text: text.clone(),
                family: family.clone(),
                style: style.clone(),
                size: size.clamp(0.1, 10_000.0),
                fill: fill.clone(),
                stroke: None,
                align: *align,
                line_height: 1.2,
                tracking: 0.0,
                width: width.filter(|w| *w > 0.0),
                runs: None,
            }),
            Affine::translate(at.x, at.y),
            "",
        ),
    };
    let mut node = Node::new(0, kind);
    node.transform = transform;
    node.name = name.to_string();
    let i = ctx.push(node);
    if let Some(b) = crate::build::node_bounds(ctx.doc, i) {
        ctx.doc.node_mut(i).artboard = artboard_for(ctx.doc, b);
    }
    attach(ctx, i, Some(container), position);
    Ok(i)
}

/// Deletes nodes.
pub fn delete(ctx: &mut Ctx<'_>, ids: &[u32]) -> Result<()> {
    let nodes = outermost(ctx, &ctx.find_all(ids));
    for i in nodes {
        detach(ctx, i);
        let n = ctx.node(i);
        n.removed = true;
        n.edits |= flags::PARENT;
    }
    Ok(())
}

/// Copies a node and what it holds; returns the copy (not in the tree).
fn copy_tree(
    ctx: &mut Ctx<'_>,
    i: NodeIdx,
    parent: Option<NodeIdx>,
    offset: Option<&Affine>,
) -> NodeIdx {
    let mut n = ctx.doc.node(i).clone();
    let children = std::mem::take(&mut n.children);
    n.id = 0;
    n.parent = parent;
    n.edits |= flags::CREATED;
    if let Some(m) = offset {
        match &mut n.kind {
            NodeKind::Group { clip: Some(c), .. } => c.path = c.path.transform(m),
            NodeKind::Layer { .. } | NodeKind::Group { .. } => {}
            _ => {
                n.transform = n.transform.followed_by(m);
                n.edits |= flags::TRANSFORM;
            }
        }
    }
    let copy = ctx.push(n);
    for c in children {
        if ctx.doc.node(c).removed {
            continue;
        }
        let cc = copy_tree(ctx, c, Some(copy), offset);
        ctx.node(copy).children.push(cc);
    }
    copy
}

/// Copies nodes above themselves.
pub fn duplicate(ctx: &mut Ctx<'_>, ids: &[u32], offset: Option<[f64; 2]>) -> Result<()> {
    let m = offset.map(|[x, y]| Affine::translate(x, y));
    let nodes = outermost(ctx, &ctx.find_all(ids));
    for i in nodes {
        let parent = ctx.doc.node(i).parent;
        let id = ctx.doc.node(i).id;
        let copy = copy_tree(ctx, i, parent, m.as_ref());
        if ctx.doc.node(copy).is_layer() {
            let name = format!("{} copy", ctx.doc.node(copy).name);
            ctx.node(copy).name = name;
        }
        attach(ctx, copy, parent, super::Position::Above(id));
    }
    Ok(())
}

/// Moves nodes into a container (or reorders layers).
pub fn move_nodes(
    ctx: &mut Ctx<'_>,
    ids: &[u32],
    parent: Option<u32>,
    position: Position,
) -> Result<()> {
    let parent = match parent {
        Some(id) => {
            let p = ctx.find(id)?;
            if !ctx.doc.node(p).is_container() {
                return Err(AiError::invalid("objects go in layers and groups"));
            }
            Some(p)
        }
        None => None,
    };
    let nodes = outermost(ctx, &ctx.find_all(ids));
    for &i in &nodes {
        if parent.is_some_and(|p| ctx.doc.is_within(p, i)) {
            return Err(AiError::invalid("a group can't go inside itself"));
        }
        let layer = ctx.doc.node(i).is_layer();
        if layer != parent.is_none() {
            return Err(AiError::invalid(if layer {
                "layers stay at the top of the tree"
            } else {
                "objects go in layers and groups"
            }));
        }
    }
    // Moving relative to a node that is itself moving: place after the
    // others are out.
    for &i in &nodes {
        detach(ctx, i);
    }
    let mut position = position;
    for &i in &nodes {
        attach(ctx, i, parent, position);
        position = Position::Above(ctx.doc.node(i).id);
    }
    Ok(())
}

/// Groups nodes where the topmost of them is.
pub fn group(ctx: &mut Ctx<'_>, ids: &[u32]) -> Result<()> {
    let order = ctx.doc.paint_order();
    let mut nodes = outermost(ctx, &ctx.find_all(ids));
    nodes.retain(|&i| !ctx.doc.node(i).is_layer());
    if nodes.is_empty() {
        return Ok(());
    }
    nodes.sort_by_key(|i| order.iter().position(|o| o == i).unwrap_or(usize::MAX));
    let top = *nodes.last().expect("not empty");
    let parent = ctx.doc.node(top).parent;
    let artboard = ctx.doc.node(top).artboard;
    let mut g = Node::new(
        0,
        NodeKind::Group {
            clip: None,
            isolated: false,
            knockout: false,
        },
    );
    g.name = "Group".into();
    g.artboard = artboard;
    let g = ctx.push(g);
    let top_id = ctx.doc.node(top).id;
    attach(ctx, g, parent, Position::Above(top_id));
    for &i in &nodes {
        detach(ctx, i);
        attach(ctx, i, Some(g), Position::Top);
    }
    Ok(())
}

/// Moves groups' children out to where the groups were.
pub fn ungroup(ctx: &mut Ctx<'_>, ids: &[u32]) -> Result<()> {
    for i in ctx.find_all(ids) {
        let n = ctx.doc.node(i);
        if !matches!(n.kind, NodeKind::Group { .. }) {
            continue;
        }
        let parent = n.parent;
        let children = n.children.clone();
        let (opacity, id) = (n.opacity, n.id);
        let mut position = Position::Below(id);
        for &c in children.iter().rev() {
            if ctx.doc.node(c).removed {
                continue;
            }
            detach(ctx, c);
            attach(ctx, c, parent, position);
            position = Position::Below(ctx.doc.node(c).id);
            if opacity < 1.0 {
                let cn = ctx.node(c);
                cn.opacity *= opacity;
                cn.edits |= flags::APPEARANCE;
            }
        }
        detach(ctx, i);
        let n = ctx.node(i);
        n.removed = true;
        n.edits |= flags::PARENT;
    }
    Ok(())
}

/// Clips the nodes with the topmost one (a path).
pub fn make_clip(ctx: &mut Ctx<'_>, ids: &[u32]) -> Result<()> {
    let order = ctx.doc.paint_order();
    let mut nodes = outermost(ctx, &ctx.find_all(ids));
    nodes.sort_by_key(|i| order.iter().position(|o| o == i).unwrap_or(usize::MAX));
    let Some(&top) = nodes.last() else {
        return Ok(());
    };
    let clip = clip_of(ctx.doc.node(top))
        .ok_or_else(|| AiError::invalid("the top object must be a path"))?;
    if nodes.len() < 2 {
        return Err(AiError::invalid("select a path above what it clips"));
    }
    group(
        ctx,
        &nodes
            .iter()
            .map(|&i| ctx.doc.node(i).id)
            .collect::<Vec<_>>(),
    )?;
    let g = ctx
        .doc
        .node(top)
        .parent
        .ok_or_else(|| AiError::invalid("the clip has no group"))?;
    if let NodeKind::Group { clip: c, .. } = &mut ctx.node(g).kind {
        *c = Some(clip);
    }
    let gn = ctx.node(g);
    gn.name = "Clip Group".into();
    gn.edits |= flags::CLIP;
    detach(ctx, top);
    let t = ctx.node(top);
    t.removed = true;
    t.edits |= flags::PARENT;
    Ok(())
}

/// Turns clip groups' clips back into paths.
pub fn release_clip(ctx: &mut Ctx<'_>, ids: &[u32]) -> Result<()> {
    for i in ctx.find_all(ids) {
        let clip = match &ctx.doc.node(i).kind {
            NodeKind::Group { clip: Some(c), .. } => c.clone(),
            _ => continue,
        };
        let artboard = ctx.doc.node(i).artboard;
        if let NodeKind::Group { clip, .. } = &mut ctx.node(i).kind {
            *clip = None;
        }
        ctx.node(i).edits |= flags::CLIP;
        let mut p = Node::new(
            0,
            NodeKind::Path(PathNode {
                data: clip.path,
                fill: None,
                even_odd: clip.even_odd,
                stroke: None,
            }),
        );
        p.name = "Clipping Path".into();
        p.artboard = artboard;
        let p = ctx.push(p);
        attach(ctx, p, Some(i), Position::Top);
    }
    Ok(())
}

/// Adds a layer.
pub fn new_layer(ctx: &mut Ctx<'_>, name: Option<&str>, position: Position) -> Result<NodeIdx> {
    let count = ctx
        .doc
        .layers
        .iter()
        .filter(|&&l| !ctx.doc.node(l).removed)
        .count();
    let color = crate::build::LAYER_COLORS[count % crate::build::LAYER_COLORS.len()];
    let mut layer = Node::new(
        0,
        NodeKind::Layer {
            color,
            printable: true,
        },
    );
    layer.name = name.map_or_else(|| format!("Layer {}", count + 1), str::to_string);
    let i = ctx.push(layer);
    attach(ctx, i, None, position);
    Ok(i)
}

/// Renames or moves an artboard.
pub fn set_artboard(
    ctx: &mut Ctx<'_>,
    id: u32,
    name: Option<&str>,
    rect: Option<Rect>,
) -> Result<()> {
    let a = ctx
        .doc
        .artboards
        .iter_mut()
        .find(|a| a.id == id && !a.removed)
        .ok_or_else(|| AiError::invalid(format!("no artboard {id}")))?;
    let old = a.rect;
    if let Some(n) = name {
        a.name = n.to_string();
    }
    if let Some(r) = rect {
        if r.is_empty() || !r.width().is_finite() {
            return Err(AiError::invalid("an artboard needs a size"));
        }
        a.rect = r;
    }
    ctx.doc.edits |= doc_flags::ARTBOARDS;
    ctx.dirty(old);
    if let Some(r) = rect {
        ctx.dirty(r);
    }
    ctx.structure();
    Ok(())
}

/// Adds an artboard.
pub fn new_artboard(ctx: &mut Ctx<'_>, rect: Rect, name: Option<&str>) -> Result<()> {
    if rect.is_empty() {
        return Err(AiError::invalid("an artboard needs a size"));
    }
    let id = ctx.doc.allocate_id();
    let count = ctx.doc.artboards.iter().filter(|a| !a.removed).count();
    ctx.doc.artboards.push(Artboard {
        id,
        name: name.map_or_else(|| format!("Artboard {}", count + 1), str::to_string),
        rect,
        page: None,
        removed: false,
    });
    ctx.doc.edits |= doc_flags::ARTBOARDS;
    ctx.dirty(rect);
    ctx.structure();
    Ok(())
}

/// Removes an artboard.
pub fn delete_artboard(ctx: &mut Ctx<'_>, id: u32) -> Result<()> {
    if ctx.doc.artboards.iter().filter(|a| !a.removed).count() <= 1 {
        return Err(AiError::invalid("a document keeps one artboard"));
    }
    let a = ctx
        .doc
        .artboards
        .iter_mut()
        .find(|a| a.id == id && !a.removed)
        .ok_or_else(|| AiError::invalid(format!("no artboard {id}")))?;
    a.removed = true;
    let r = a.rect;
    ctx.doc.edits |= doc_flags::ARTBOARDS;
    ctx.dirty(r);
    ctx.structure();
    Ok(())
}

/// Places an image filling a rectangle.
pub fn place_image(
    ctx: &mut Ctx<'_>,
    name: &str,
    rect: Rect,
    parent: Option<u32>,
    hash: &str,
    image: Option<&AddedImage>,
) -> Result<()> {
    if let Some(img) = image {
        ctx.doc
            .images
            .entry(hash.to_string())
            .or_insert_with(|| img.clone());
    }
    let Some(img) = ctx.doc.images.get(hash) else {
        return Err(AiError::invalid("the image's pixels are missing"));
    };
    let (width, height) = (img.width, img.height);
    let container = target(ctx, parent)?;
    let mut node = Node::new(
        0,
        NodeKind::Image(ImageNode {
            source: ImageSource::Added {
                hash: hash.to_string(),
            },
            width,
            height,
        }),
    );
    // The unit square (y up) onto the rectangle.
    node.transform = Affine([rect.width(), 0.0, 0.0, -rect.height(), rect.x0, rect.y1]);
    node.name = name.to_string();
    node.artboard = artboard_for(ctx.doc, rect);
    let i = ctx.push(node);
    attach(ctx, i, Some(container), Position::Top);
    Ok(())
}
