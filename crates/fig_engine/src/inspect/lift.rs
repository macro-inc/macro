//! Moving layers by compositing them apart from the rest of the page.
//!
//! A CPU rasterizer cannot redraw a page at every pointer move while layers
//! are dragged over it. Instead the editor lifts the layers it moves: it
//! renders what paints below them, the layers themselves, and what paints
//! above them (only where something does) once each, slides the layers'
//! pixels over the rest at every pointer move, and applies the move to the
//! document once, at the drop. [`lift_plan`] decides whether that composite
//! is exact for a set of layers and describes its parts:
//!
//! - runs: the moving layers grouped into runs of adjacent siblings, in
//!   paint order. A run renders by itself ([`Layers::Only`]) and moves; it
//!   shows only inside the outlines of the ancestors that clip it, which
//!   stay where they are.
//! - below: what paints before the first run ([`Layers::Window`] ending at
//!   it), on the page color.
//! - above each run: what paints after it and before the next run (or the
//!   end of the page), on transparency, with the bounds of what it holds so
//!   that only tiles holding something are rendered.
//!
//! The composite is exact when moving the layers changes no other pixels
//! and each part composites with plain source-over. Layers are refused
//! when:
//! - they are inside a component (its instances show the move), a boolean
//!   operation (its shape follows its operands), or an instance (their moves
//!   are overrides);
//! - their auto layout parent places its other children around them;
//! - they are a mask, or a mask applies to them;
//! - an ancestor composites its children as one (opacity, a blend mode, a
//!   drop shadow, or a layer blur), so the parts would not add up to it;
//! - they, or what paints above them, blend with or blur what is behind
//!   them (a blend mode or a background blur), which a part drawn on its
//!   own cannot know.
//!
//! [`Layers::Only`]: crate::render::Layers::Only
//! [`Layers::Window`]: crate::render::Layers::Window

use super::{Document, EffectKind, NodeType, Rect, Scene, SceneIdx, Serialize, Vec2, geometry};
use crate::model::Props;
use std::collections::HashSet;

/// Runs a plan may have: each is a part to render and composite.
const MAX_RUNS: usize = 16;
/// Bounds listed for what paints above a run; past this they are merged.
const MAX_ABOVE_RECTS: usize = 256;

/// How to draw moving layers apart from the rest of the page.
#[derive(Serialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct LiftPlan {
    /// Why the layers cannot be lifted (`None` when they can).
    pub refused: Option<&'static str>,
    /// The moving layers in runs, bottom first.
    pub runs: Vec<LiftRun>,
}

/// Adjacent sibling layers that move together.
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LiftRun {
    /// The run's layers, bottom first.
    pub ids: Vec<String>,
    /// Page bounds of everything they draw.
    pub bounds: Rect,
    /// Where the first of them is (its origin on the page): renders of the
    /// run anchored here draw it where the lift started, even after the
    /// document moved it (see `Layers::Only`).
    pub origin: Vec2,
    /// Outlines (SVG path data, page coordinates) of the ancestors that
    /// clip the run: it shows only inside all of them.
    pub clips: Vec<String>,
    /// Page bounds of what paints after this run and before the next one
    /// (or the end of the page).
    pub above: Vec<Rect>,
}

fn refuse(reason: &'static str) -> LiftPlan {
    LiftPlan {
        refused: Some(reason),
        runs: Vec::new(),
    }
}

/// Whether a node composites what it holds as one, so its children's
/// pixels cannot be drawn apart from each other.
fn isolates(props: &Props) -> bool {
    props.opacity() < 1.0
        || !props.blend_mode().is_normal()
        || props.effects().iter().any(|e| {
            e.is_visible()
                && match e.kind {
                    EffectKind::DropShadow => true,
                    EffectKind::LayerBlur => e.radius > 0.0,
                    _ => false,
                }
        })
}

fn has_background_blur(props: &Props) -> bool {
    props
        .effects()
        .iter()
        .any(|e| e.is_visible() && e.kind == EffectKind::BackgroundBlur && e.radius > 0.0)
}

/// What in the visible subtree of `i` reads the pixels behind it.
fn reads_backdrop(doc: &Document, scene: &Scene, i: SceneIdx) -> Option<&'static str> {
    let mut stack = vec![i];
    while let Some(n) = stack.pop() {
        let props = scene.props(doc, n);
        if !props.visible() {
            continue;
        }
        if !props.blend_mode().is_normal() {
            return Some("blend mode");
        }
        if has_background_blur(props) {
            return Some("background blur");
        }
        stack.extend(scene.node(n).below());
    }
    None
}

fn is_stack(props: &Props) -> bool {
    props.node_type().is_frame_like()
        && props.node_type() != NodeType::Instance
        && props.auto_layout.as_ref().is_some_and(|a| a.is_stack())
}

/// Why node `n` (a layer to move) cannot be lifted, if it cannot.
fn check(doc: &Document, scene: &Scene, n: SceneIdx) -> Option<&'static str> {
    let node = scene.node(n);
    let props = scene.props(doc, n);
    if node.path.is_some() {
        return Some("in an instance");
    }
    if props.is_mask() {
        return Some("mask");
    }
    if let Some(reason) = reads_backdrop(doc, scene, n) {
        return Some(reason);
    }
    if let Some(p) = node.parent
        && p != scene.root()
    {
        let parent = scene.props(doc, p);
        if is_stack(parent) && !props.layout_child.as_ref().is_some_and(|l| l.is_absolute()) {
            return Some("auto layout");
        }
    }
    // A mask masks the siblings after it.
    let mut at = n;
    while let Some(p) = scene.node(at).parent {
        let siblings = &scene.node(p).children;
        let index = siblings.iter().position(|&c| c == at).unwrap_or(0);
        if siblings[..index].iter().any(|&c| {
            let s = scene.props(doc, c);
            s.is_mask() && s.visible()
        }) {
            return Some("masked");
        }
        if p == scene.root() {
            break;
        }
        let ancestor = scene.props(doc, p);
        match ancestor.node_type() {
            NodeType::Symbol => return Some("in a component"),
            NodeType::BooleanOperation => return Some("in a boolean"),
            NodeType::Instance => return Some("in an instance"),
            _ => {}
        }
        if isolates(ancestor) {
            return Some("ancestor composites");
        }
        at = p;
    }
    None
}

/// Bounds of what paints in the exclusive [`Scene::paint_times`] window
/// `(lo, hi)`, or why it cannot be drawn on its own.
fn window_content(
    doc: &Document,
    scene: &Scene,
    (lo, hi): (u32, u32),
) -> Result<Vec<Rect>, &'static str> {
    let times = scene.paint_times();
    let mut rects = Vec::new();
    let mut stack = vec![scene.root()];
    while let Some(i) = stack.pop() {
        let props = scene.props(doc, i);
        if i != scene.root() && !props.visible() {
            continue;
        }
        let (enter, exit) = times[i as usize];
        if exit <= lo || enter >= hi {
            continue;
        }
        let node = scene.node(i);
        if enter > lo && exit < hi {
            if let Some(reason) = reads_backdrop(doc, scene, i) {
                return Err(reason);
            }
            if !node.bounds.is_empty() {
                rects.push(node.bounds);
            }
            continue;
        }
        // The node holds an end of the window: its own paint is in it at
        // whichever of its times are.
        if i != scene.root() {
            let entered = enter > lo && enter < hi;
            let left = exit > lo && exit < hi;
            let frame_like = props.node_type().is_frame_like();
            let strokes = props.has_visible_strokes();
            let container_stroke = frame_like && !props.clips_content();
            let paints_entering = props.has_visible_fills()
                || props.vector_styles.is_some()
                || (container_stroke && strokes)
                || props
                    .effects()
                    .iter()
                    .any(|e| e.is_visible() && e.kind == EffectKind::InnerShadow);
            if entered && has_background_blur(props) {
                return Err("background blur");
            }
            if (entered && paints_entering) || (left && strokes && !container_stroke) {
                let own = scene.own_bounds(doc, i);
                if !own.is_empty() {
                    rects.push(own);
                }
            }
        }
        stack.extend(node.below());
    }
    if rects.len() > MAX_ABOVE_RECTS {
        let all = rects.iter().fold(Rect::EMPTY, |acc, r| acc.union(r));
        rects = vec![all];
    }
    Ok(rects)
}

/// SVG path data (page coordinates) of what node `i` clips its children to.
fn clip_outline(doc: &Document, scene: &Scene, i: SceneIdx) -> String {
    let props = scene.props(doc, i);
    let world = scene.node(i).world;
    let mut out = String::new();
    for shape in crate::render::fill_shapes(doc, props) {
        geometry::to_svg(shape.path(), &world, &mut out);
    }
    out
}

/// How to move layers `ids` by compositing them apart from the rest of the
/// page (see the module documentation), or why that would not be exact.
pub fn lift_plan(doc: &Document, scene: &Scene, ids: &[String]) -> LiftPlan {
    let mut nodes = Vec::new();
    for id in ids {
        match scene.find(doc, id) {
            Some(n) if n != scene.root() => nodes.push(n),
            _ => return refuse("missing"),
        }
    }
    // Moving a layer moves what it holds: selected children of selected
    // layers move with them.
    let set: HashSet<SceneIdx> = nodes.iter().copied().collect();
    nodes.retain(|&n| {
        let mut at = scene.node(n).parent;
        while let Some(p) = at {
            if set.contains(&p) {
                return false;
            }
            at = scene.node(p).parent;
        }
        true
    });
    let times = scene.paint_times();
    nodes.sort_by_key(|&n| times[n as usize].0);
    nodes.dedup();
    if nodes.is_empty() {
        return refuse("missing");
    }
    for &n in &nodes {
        if let Some(reason) = check(doc, scene, n) {
            return refuse(reason);
        }
    }
    // Runs: siblings with nothing between them.
    let mut runs: Vec<Vec<SceneIdx>> = Vec::new();
    for &n in &nodes {
        let adjacent = runs.last().and_then(|run| run.last()).is_some_and(|&last| {
            let parent = scene.node(n).parent;
            parent.is_some()
                && parent == scene.node(last).parent
                && parent.is_some_and(|p| {
                    let siblings = &scene.node(p).children;
                    let a = siblings.iter().position(|&c| c == last);
                    let b = siblings.iter().position(|&c| c == n);
                    matches!((a, b), (Some(a), Some(b)) if b == a + 1)
                })
        });
        match runs.last_mut() {
            Some(run) if adjacent => run.push(n),
            _ => runs.push(vec![n]),
        }
    }
    if runs.len() > MAX_RUNS {
        return refuse("too many runs");
    }
    let mut out = Vec::with_capacity(runs.len());
    for (k, run) in runs.iter().enumerate() {
        let first = run[0];
        let last = *run.last().expect("runs are not empty");
        let lo = times[last as usize].1;
        let hi = runs
            .get(k + 1)
            .map_or(u32::MAX, |next| times[next[0] as usize].0);
        let above = match window_content(doc, scene, (lo, hi)) {
            Ok(rects) => rects,
            Err(reason) => return refuse(reason),
        };
        let mut clips = Vec::new();
        let mut at = scene.node(first).parent;
        while let Some(p) = at {
            if p == scene.root() {
                break;
            }
            if scene.props(doc, p).clips_content() {
                clips.push(clip_outline(doc, scene, p));
            }
            at = scene.node(p).parent;
        }
        let bounds = run
            .iter()
            .fold(Rect::EMPTY, |acc, &n| acc.union(&scene.node(n).bounds));
        if bounds.is_empty() {
            // Nothing to draw apart (hidden layers move as they are).
            return refuse("nothing drawn");
        }
        let world = scene.node(first).world;
        out.push(LiftRun {
            ids: run.iter().map(|&n| scene.id(doc, n)).collect(),
            bounds,
            origin: Vec2::new(world.m02, world.m12),
            clips,
            above,
        });
    }
    LiftPlan {
        refused: None,
        runs: out,
    }
}

#[cfg(test)]
mod test;
