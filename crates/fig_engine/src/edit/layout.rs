//! Auto layout: re-placing the children of stack frames after an edit, as
//! Figma does. Files store the result of Figma's layout, so the engine only
//! lays out frames an edit affected: their children are sized (fill,
//! stretch) and placed in order with the frame's gap, padding, and
//! alignment, and a frame that hugs its content takes the content's size,
//! which can in turn re-lay out its own auto layout parent.
//!
//! The rules follow what Figma stores in its files (`fig_render relayout`
//! checks them against real ones): hidden frames keep their layout, lines
//! and turned layers that fill are centred in their space, rows can align
//! on text baselines, and strokes take up room when a frame includes them.
//!
//! Wrapping stacks and grids keep the positions Figma stored.

mod settings;

pub use settings::axis_sizing;

use super::{Patch, Txn, flags};
use crate::document::NodeIdx;
use crate::model::{Affine, AutoLayout, LayoutChild, NodeType, Rect, StrokeAlign, Vec2};
use std::collections::HashSet;

/// One child taking part in the flow.
struct Item {
    i: NodeIdx,
    /// Bounds in the frame's space (with its outer strokes when the frame
    /// counts strokes in its layout).
    bounds: Rect,
    /// What the bounds add to the layer's own width and height.
    extra: Vec2,
    child: LayoutChild,
    /// Being dragged: it keeps its place on screen, and the others make
    /// room for it.
    floating: bool,
    /// The length the child takes up along the main axis when that differs
    /// from its own (a line filling the frame keeps no width and sits in
    /// the middle of its share).
    slot: Option<f64>,
}

const EPS: f64 = 1e-6;

/// Main-axis and cross-axis components of a vector.
fn split(v: Vec2, horizontal: bool) -> (f64, f64) {
    if horizontal { (v.x, v.y) } else { (v.y, v.x) }
}

fn centre_of(r: &Rect) -> Vec2 {
    Vec2::new(r.x + r.w / 2.0, r.y + r.h / 2.0)
}

fn join(main: f64, cross: f64, horizontal: bool) -> Vec2 {
    if horizontal {
        Vec2::new(main, cross)
    } else {
        Vec2::new(cross, main)
    }
}

/// Whether a transform turns its layer by an odd number of quarter turns
/// (`Some(true)`, swapping width and height in its parent) or an even one;
/// `None` at any other angle.
fn quarter_turns(t: &Affine) -> Option<bool> {
    if t.m01.abs() < EPS && t.m10.abs() < EPS {
        Some(false)
    } else if t.m00.abs() < EPS && t.m11.abs() < EPS {
        Some(true)
    } else {
        None
    }
}

/// The lengths of the children that fill the main axis (`None` for the
/// others), sharing `free` by their grow factors. A child its size limits
/// stop takes the limit, and the others share what is left, as in CSS
/// flexbox; Figma keeps squeezed fill children at least a pixel.
fn fill_lengths(items: &[Item], free: f64, h: bool) -> Vec<Option<f64>> {
    let extra = |it: &Item| split(it.extra, h).0;
    let mut frozen: Vec<Option<f64>> = vec![None; items.len()];
    loop {
        let taken: f64 = items
            .iter()
            .zip(&frozen)
            .filter_map(|(it, f)| f.map(|l| l + extra(it)))
            .sum();
        let open = |k: usize| items[k].child.fills_primary() && frozen[k].is_none();
        let grow: f64 = (0..items.len())
            .filter(|&k| open(k))
            .map(|k| f64::from(items[k].child.grow.unwrap_or(1.0)))
            .sum();
        let share = |k: usize| {
            let it = &items[k];
            (free - taken).max(0.0) * f64::from(it.child.grow.unwrap_or(1.0)) / grow - extra(it)
        };
        let limited: Vec<(usize, f64)> = (0..items.len())
            .filter(|&k| open(k))
            .filter_map(|k| {
                let want = share(k);
                let got = items[k].child.clamp(want, h);
                ((got - want).abs() > EPS).then_some((k, got))
            })
            .collect();
        if limited.is_empty() {
            return (0..items.len())
                .map(|k| {
                    if !items[k].child.fills_primary() {
                        None
                    } else {
                        Some(frozen[k].unwrap_or_else(|| share(k)).max(1.0))
                    }
                })
                .collect();
        }
        for (k, got) in limited {
            frozen[k] = Some(got);
        }
    }
}

/// The fixed gaps between `n` children: none with Figma's automatic gap,
/// which spreads the free space instead of the stored spacing.
fn fixed_gaps(al: &AutoLayout, n: usize) -> f64 {
    let auto_gap = matches!(
        al.primary_align.as_deref(),
        Some("SPACE_BETWEEN" | "SPACE_EVENLY")
    );
    if auto_gap || n == 0 {
        0.0
    } else {
        f64::from(al.spacing) * (n - 1) as f64
    }
}

impl Txn<'_> {
    /// The node's box in its parent's space.
    fn local_bounds(&self, i: NodeIdx) -> Rect {
        let p = self.doc.props(i);
        let s = p.size();
        p.transform().map_rect(&Rect::new(0.0, 0.0, s.x, s.y))
    }

    /// The stroke weights a layer's visible strokes reach (top, right,
    /// bottom, left): outside its box (`outer`), or inside it.
    fn stroke_reach(&self, i: NodeIdx, outer: bool) -> [f64; 4] {
        let p = self.doc.props(i);
        if !p.has_visible_strokes() {
            return [0.0; 4];
        }
        if p.node_type() == NodeType::Line {
            // Figma lays a line out as its stroke's thickness, above it.
            return if outer {
                [f64::from(p.stroke_weight()), 0.0, 0.0, 0.0]
            } else {
                [0.0; 4]
            };
        }
        let share = match (p.stroke_align(), outer) {
            (StrokeAlign::Center, _) => 0.5,
            (StrokeAlign::Outside, true) | (StrokeAlign::Inside, false) => 1.0,
            _ => 0.0,
        };
        let w = p.stroke_weight();
        p.stroke_sides
            .unwrap_or([w; 4])
            .map(|side| f64::from(side) * share)
    }

    /// A child's box in the flow: its bounds, and its outer strokes when
    /// the frame counts strokes in its layout (`strokes`). Returns the box
    /// and what it adds to the layer's width and height.
    fn flow_box(&self, i: NodeIdx, strokes: bool) -> (Rect, Vec2) {
        let b = self.local_bounds(i);
        // Strokes of a turned layer stay out of it.
        if !strokes || quarter_turns(&self.doc.props(i).transform()) != Some(false) {
            return (b, Vec2::new(0.0, 0.0));
        }
        let [top, right, bottom, left] = self.stroke_reach(i, true);
        let extra = Vec2::new(left + right, top + bottom);
        (
            Rect::new(b.x - left, b.y - top, b.w + extra.x, b.h + extra.y),
            extra,
        )
    }

    /// The frame's padding (top, right, bottom, left), with its own inner
    /// strokes when it counts strokes in its layout.
    fn padding(&self, frame: NodeIdx, al: &AutoLayout) -> [f64; 4] {
        let pad = [
            al.padding_top,
            al.padding_right,
            al.padding_bottom,
            al.padding_left,
        ]
        .map(f64::from);
        if !al.strokes_in_layout {
            return pad;
        }
        let inner = self.stroke_reach(frame, false);
        [0, 1, 2, 3].map(|k| pad[k] + inner[k])
    }

    fn flow_children(&self, frame: NodeIdx) -> Vec<Item> {
        let strokes = self
            .doc
            .props(frame)
            .auto_layout
            .as_ref()
            .is_some_and(|al| al.strokes_in_layout);
        self.doc
            .node(frame)
            .children
            .iter()
            .copied()
            .filter(|&c| {
                let n = self.doc.node(c);
                !n.removed && n.props.visible()
            })
            .filter_map(|c| {
                let child = self.doc.props(c).layout_child.clone().unwrap_or_default();
                (!child.is_absolute()).then(|| {
                    let (bounds, extra) = self.flow_box(c, strokes);
                    Item {
                        i: c,
                        bounds,
                        extra,
                        child,
                        floating: self.floating.contains(&c),
                        slot: None,
                    }
                })
            })
            .collect()
    }

    /// Lays out the auto layout frames that `changed` nodes affect: their
    /// parents (and, when those hug their content and change size, the
    /// parents' parents), and any changed frame that is itself a stack.
    ///
    /// `changed` pairs each node with whether its own content changed (size,
    /// children, or auto layout settings) rather than only its place.
    pub(super) fn reflow_after(&mut self, changed: &[(NodeIdx, bool)]) {
        let mut frames: Vec<NodeIdx> = Vec::new();
        let mut seen = HashSet::new();
        for &(i, own) in changed {
            let node = self.doc.node(i);
            if own && !node.removed && self.is_stack(i) && seen.insert(i) {
                frames.push(i);
            }
            if let Some(p) = node.parent
                && self.is_stack(p)
                && seen.insert(p)
            {
                frames.push(p);
            }
        }
        // Deepest first, so a frame sees its children's final sizes.
        frames.sort_by_key(|&f| std::cmp::Reverse(self.depth(f)));
        let mut k = 0;
        while k < frames.len() {
            let f = frames[k];
            k += 1;
            if self.doc.node(f).removed {
                continue;
            }
            let resized = self.reflow(f);
            if resized
                && let Some(p) = self.doc.node(f).parent
                && self.is_stack(p)
                && !frames[k..].contains(&p)
            {
                frames.push(p);
                frames[k..].sort_by_key(|&f| std::cmp::Reverse(self.depth(f)));
            }
        }
    }

    fn depth(&self, mut i: NodeIdx) -> usize {
        let mut d = 0;
        while let Some(p) = self.doc.node(i).parent {
            d += 1;
            i = p;
        }
        d
    }

    pub(super) fn is_stack(&self, i: NodeIdx) -> bool {
        let p = self.doc.props(i);
        p.node_type().is_frame_like()
            && p.node_type() != NodeType::Instance
            && p.auto_layout.as_ref().is_some_and(|a| a.is_stack())
    }

    /// Lays out one stack frame's children. Returns whether the frame's own
    /// size changed.
    ///
    /// A hidden frame keeps its layout, as in Figma, which lays out hidden
    /// frames only once they are shown again.
    pub(super) fn reflow(&mut self, frame: NodeIdx) -> bool {
        if !self.doc.props(frame).visible() {
            return false;
        }
        let Some(al) = self.doc.props(frame).auto_layout.clone() else {
            return false;
        };
        if !al.is_stack() {
            return false;
        }
        let h = al.horizontal();
        let [top, right, bottom, left] = self.padding(frame, &al);
        let (pad_start, pad_end, cross_start, cross_end) = if h {
            (left, right, top, bottom)
        } else {
            (top, bottom, left, right)
        };
        let spacing = f64::from(al.spacing);
        let old_size = self.doc.props(frame).size();
        let (mut main_size, mut cross_size) = split(old_size, h);

        // A dragged child takes the slot its centre is over.
        let mut items = self.flow_children(frame);
        if let Some(f) = items.iter().position(|it| it.floating) {
            let item = items.remove(f);
            let centre = split(centre_of(&item.bounds), h).0;
            let slot = items
                .iter()
                .position(|it| centre < split(centre_of(&it.bounds), h).0)
                .unwrap_or(items.len());
            items.insert(slot, item);
            self.reorder_flow(frame, &items);
        }
        if items.is_empty() {
            return false;
        }
        let gaps = fixed_gaps(&al, items.len());
        // The frame's own size limits apply to what it hugs before its
        // children are placed in it.
        let limits = self
            .doc
            .props(frame)
            .layout_child
            .clone()
            .unwrap_or_default();

        // Main axis: fill children share what fixed ones leave.
        let main_of = |it: &Item| split(Vec2::new(it.bounds.w, it.bounds.h), h).0;
        if al.hugs_primary() {
            main_size = pad_start + pad_end + gaps + items.iter().map(main_of).sum::<f64>();
            main_size = limits.clamp(main_size, h);
        } else {
            let grow: f64 = items
                .iter()
                .filter(|it| it.child.fills_primary())
                .map(|it| f64::from(it.child.grow.unwrap_or(1.0)))
                .sum();
            if grow > 0.0 {
                let fixed: f64 = items
                    .iter()
                    .filter(|it| !it.child.fills_primary())
                    .map(main_of)
                    .sum();
                let free = (main_size - pad_start - pad_end - gaps - fixed).max(0.0);
                let lengths = fill_lengths(&items, free, h);
                for (item, length) in items.iter_mut().zip(lengths) {
                    let Some(length) = length else {
                        continue;
                    };
                    let extra = split(item.extra, h).0;
                    let i = item.i;
                    if self.keeps_size(i, main_of(item) - extra) {
                        item.slot = Some(length + extra);
                        continue;
                    }
                    let (w, ht) = if h {
                        (Some(length), None)
                    } else {
                        (None, Some(length))
                    };
                    self.size_child(i, w, ht);
                    item.bounds = self.flow_box(i, al.strokes_in_layout).0;
                    if self.turned(i) {
                        item.slot = Some(length + extra);
                    }
                }
            }
        }

        // Cross axis: the frame hugs its tallest (or widest) child unless
        // fixed; a stretched stack counts with what its own content needs.
        // Stretched children then take the inner size.
        let cross_of = |it: &Item| split(Vec2::new(it.bounds.w, it.bounds.h), h).1;
        // Rows aligned on their baseline line up their children's first
        // baselines (a child without text, its bottom): `bases` are the
        // baselines from the top of each child's box, `top` the row's.
        let bases: Option<Vec<f64>> = (h && al.counter_align.as_deref() == Some("BASELINE"))
            .then(|| items.iter().map(|it| self.baseline_in_box(it)).collect());
        let top = bases
            .as_ref()
            .map_or(0.0, |b| b.iter().copied().fold(0.0, f64::max));
        if al.hugs_counter() {
            let tallest = items
                .iter()
                .enumerate()
                .filter_map(|(k, it)| {
                    if it.child.stretches() {
                        self.stretched_need(it, !h)
                    } else {
                        let below = bases.as_ref().map_or(0.0, |b| top - b[k]);
                        Some(below + cross_of(it))
                    }
                })
                .fold(None, |m: Option<f64>, v| Some(m.map_or(v, |m| m.max(v))));
            if let Some(t) = tallest {
                cross_size = limits.clamp(t + cross_start + cross_end, !h);
            }
        }
        // Padding can leave less than nothing inside; children are still
        // aligned against it, and stretched ones keep at least a pixel.
        let inner_cross = cross_size - cross_start - cross_end;
        for item in items.iter_mut() {
            let extra = split(item.extra, h).1;
            let stretch_to = (inner_cross - extra).max(1.0);
            if item.child.stretches()
                && (cross_of(item) - extra - stretch_to).abs() > EPS
                && !self.keeps_size(item.i, cross_of(item) - extra)
            {
                let i = item.i;
                let v = item.child.clamp(stretch_to, !h);
                let (w, ht) = if h { (None, Some(v)) } else { (Some(v), None) };
                self.size_child(i, w, ht);
                item.bounds = self.flow_box(i, al.strokes_in_layout).0;
            }
        }

        // Place them.
        let slot_of = |it: &Item| it.slot.unwrap_or_else(|| main_of(it));
        let used: f64 = items.iter().map(slot_of).sum();
        let free = main_size - pad_start - pad_end - used;
        let n = items.len() as f64;
        let (mut at, gap) = match al.primary_align.as_deref() {
            Some("CENTER") => (pad_start + (free - gaps) / 2.0, spacing),
            Some("MAX") => (pad_start + free - gaps, spacing),
            // Figma stores its "auto" gap as SPACE_EVENLY; it spaces like CSS
            // space-between, and centres a lone child (which SPACE_BETWEEN
            // leaves at the start). With SPACE_BETWEEN children that
            // overflow touch; the automatic gap overlaps them.
            Some("SPACE_EVENLY") if items.len() > 1 => (pad_start, free / (n - 1.0)),
            Some("SPACE_BETWEEN") if items.len() > 1 => (pad_start, (free / (n - 1.0)).max(0.0)),
            Some("SPACE_EVENLY") => (pad_start + free / 2.0, 0.0),
            Some("SPACE_EVENLY_CSS") => (pad_start + free / (n + 1.0), free / (n + 1.0)),
            Some("SPACE_AROUND") => (pad_start + free / (2.0 * n), free / n),
            _ => (pad_start, spacing),
        };
        for (k, it) in items.iter().enumerate() {
            let (main, cross, slot) = (main_of(it), cross_of(it), slot_of(it));
            if !it.floating {
                let align = match it.child.align.as_deref() {
                    Some(a @ ("MIN" | "CENTER" | "MAX")) => Some(a),
                    // A line or a turned layer stretched across sits in the
                    // middle.
                    Some("STRETCH")
                        if self.turned(it.i)
                            || self.keeps_size(it.i, cross - split(it.extra, h).1) =>
                    {
                        Some("CENTER")
                    }
                    _ => al.counter_align.as_deref(),
                };
                let offset = match (align, &bases) {
                    (Some("CENTER"), _) => (inner_cross - cross) / 2.0,
                    (Some("MAX"), _) => inner_cross - cross,
                    (Some("BASELINE"), Some(b)) => top - b[k],
                    _ => 0.0,
                };
                let target = join(at + (slot - main) / 2.0, cross_start + offset, h);
                let d = Vec2::new(target.x - it.bounds.x, target.y - it.bounds.y);
                if d.x.abs() > EPS || d.y.abs() > EPS {
                    let mut t = self.doc.props(it.i).transform();
                    t.m02 += d.x;
                    t.m12 += d.y;
                    self.edit(it.i, flags::TRANSFORM).transform = Some(t);
                }
            }
            at += slot + gap;
        }

        let size = join(main_size, cross_size, h);
        let size = Vec2::new(
            limits.clamp(size.x, true).max(0.01),
            limits.clamp(size.y, false).max(0.01),
        );
        if (size.x - old_size.x).abs() > EPS || (size.y - old_size.y).abs() > EPS {
            self.resize(frame, Some(size.x), Some(size.y));
            true
        } else {
            false
        }
    }

    /// Whether a layer `extent` long along an axis keeps its size where the
    /// layout would fill or stretch it, and is centred in the space instead
    /// (as Figma does): a line (or a flat vector) has no thickness to
    /// scale, and a layer turned at an angle cannot take a box's size.
    fn keeps_size(&self, i: NodeIdx, extent: f64) -> bool {
        // Turned lines keep a trace of width from rounding in their
        // rotation.
        const THIN: f64 = 1e-3;
        let t = self.doc.props(i).node_type();
        extent.abs() < THIN && !t.is_frame_like() && t != NodeType::Text
    }

    /// Whether a layer is turned at an angle other than quarter turns: it
    /// fills or stretches along its own nearer axis, and its bounds are
    /// centred in the space.
    fn turned(&self, i: NodeIdx) -> bool {
        quarter_turns(&self.doc.props(i).transform()).is_none()
    }

    /// A layer's first baseline, from its top: a text layer's first line,
    /// or the first one among a stack's children. `None` without text.
    fn baseline(&self, i: NodeIdx) -> Option<f64> {
        let p = self.doc.props(i);
        if p.node_type() == NodeType::Text {
            let layout = p.text_layout.as_ref()?;
            return layout
                .first_baseline
                .or_else(|| layout.glyphs.first().map(|g| g.y))
                .map(f64::from);
        }
        if !self.is_stack(i) {
            return None;
        }
        self.flow_children(i).iter().find_map(|it| {
            let b = self.baseline(it.i)?;
            Some(self.doc.props(it.i).transform().m12 + b)
        })
    }

    /// A child's baseline from the top of its box in the flow; a child
    /// without text (or turned) aligns its bottom.
    fn baseline_in_box(&self, it: &Item) -> f64 {
        let t = self.doc.props(it.i).transform();
        match self.baseline(it.i) {
            Some(b) if quarter_turns(&t) == Some(false) && t.m11 > 0.0 => t.m12 + b - it.bounds.y,
            _ => it.bounds.h,
        }
    }

    /// What a stack's content needs along one axis (`x` or not), padding
    /// included: the size it would hug. `None` for other layers.
    fn content_size(&self, i: NodeIdx, x: bool) -> Option<f64> {
        if !self.is_stack(i) {
            return None;
        }
        let al = self.doc.props(i).auto_layout.clone()?;
        let items = self.flow_children(i);
        let size = |it: &Item| if x { it.bounds.w } else { it.bounds.h };
        let [top, right, bottom, left] = self.padding(i, &al);
        let pad = if x { left + right } else { top + bottom };
        let content = if al.horizontal() == x {
            fixed_gaps(&al, items.len()) + items.iter().map(size).sum::<f64>()
        } else {
            items
                .iter()
                .filter_map(|it| {
                    if it.child.stretches() {
                        self.stretched_need(it, x)
                    } else {
                        Some(size(it))
                    }
                })
                .fold(0.0, f64::max)
        };
        Some(pad + content)
    }

    /// What a stretched child needs across a hugging frame (along `x` or
    /// not): a stack that hugs that way needs its content, one fixed that
    /// way its current size; other layers need nothing.
    fn stretched_need(&self, it: &Item, x: bool) -> Option<f64> {
        let extra = if x { it.extra.x } else { it.extra.y };
        let current = if x { it.bounds.w } else { it.bounds.h } - extra;
        let p = self.doc.props(it.i);
        if p.node_type() == NodeType::Instance {
            // Laid out from its component: its size is what it needs.
            return Some(it.child.clamp(current, x) + extra);
        }
        let al = p.auto_layout.clone()?;
        if !self.is_stack(it.i) {
            return None;
        }
        let hugs = if al.horizontal() == x {
            al.hugs_primary()
        } else {
            al.hugs_counter()
        };
        let need = if hugs {
            self.content_size(it.i, x)?
        } else {
            current
        };
        Some(it.child.clamp(need, x) + extra)
    }

    /// Resizes a child the layout sized: text re-wraps, and a child that is
    /// itself a stack lays out its own children.
    fn size_child(&mut self, i: NodeIdx, width: Option<f64>, height: Option<f64>) {
        // The sizes are in the frame's space: a quarter-turned child swaps
        // them, and one at another angle takes them along its nearer axes.
        let t = self.doc.props(i).transform();
        let swap = quarter_turns(&t).unwrap_or(t.m01.abs() > t.m00.abs());
        let (width, height) = if swap {
            (height, width)
        } else {
            (width, height)
        };
        // Files store sizes as 32-bit floats: what differs from them by
        // less than this is the same size, and resizing (an instance laid
        // out again, outlines rescaled) would only add noise.
        const SAME: f64 = 1e-3;
        let size = self.doc.props(i).size();
        let width = width.filter(|w| (w - size.x).abs() > SAME);
        let height = height.filter(|h| (h - size.y).abs() > SAME);
        if width.is_none() && height.is_none() {
            return;
        }
        let patch = Patch {
            width,
            height,
            ..Patch::default()
        };
        // Sizing never fails for a live node; ignore the impossible error.
        let _ = self.set(i, &patch);
        if self.is_stack(i) {
            self.reflow(i);
        }
    }

    /// Orders the frame's children as `items` (the flow order), keeping the
    /// out-of-flow children where they are.
    fn reorder_flow(&mut self, frame: NodeIdx, items: &[Item]) {
        let current = self.doc.node(frame).children.clone();
        let flow: HashSet<NodeIdx> = items.iter().map(|it| it.i).collect();
        let mut order = items.iter().map(|it| it.i);
        let next: Vec<NodeIdx> = current
            .iter()
            .map(|&c| {
                if flow.contains(&c) {
                    order.next().unwrap_or(c)
                } else {
                    c
                }
            })
            .collect();
        if next == current {
            return;
        }
        for (index, &c) in next.iter().enumerate() {
            if self.doc.node(frame).children.get(index) != Some(&c) {
                self.attach(c, frame, index, false);
            }
        }
    }
}

impl Txn<'_> {
    /// Moves and resizes the children of `i` as their constraints say, as
    /// `i` goes from `old` to `new` size. Groups and boolean operations scale
    /// their children; stacks lay out theirs (only absolutely positioned
    /// children follow constraints).
    pub(super) fn apply_constraints(&mut self, i: NodeIdx, old: Vec2, new: Vec2) {
        let node_type = self.doc.props(i).node_type();
        let scales = matches!(node_type, NodeType::Group | NodeType::BooleanOperation);
        if !(scales || node_type.is_frame_like()) || node_type == NodeType::Instance {
            return;
        }
        let stack = self.is_stack(i);
        let children = self.doc.node(i).children.clone();
        for c in children {
            let props = self.doc.props(c);
            if self.doc.node(c).removed {
                continue;
            }
            let absolute = props.layout_child.as_ref().is_some_and(|l| l.is_absolute());
            if stack && !absolute {
                continue;
            }
            let (h, v) = if scales {
                ("SCALE".into(), "SCALE".into())
            } else {
                props
                    .constraints
                    .clone()
                    .unwrap_or_else(|| ("MIN".into(), "MIN".into()))
            };
            let b = self.local_bounds(c);
            let (x, w) = constrain(&h, b.x, b.w, old.x, new.x);
            let (y, ht) = constrain(&v, b.y, b.h, old.y, new.y);
            if (w - b.w).abs() > EPS || (ht - b.h).abs() > EPS {
                let width = ((w - b.w).abs() > EPS).then_some(w.max(0.01));
                let height = ((ht - b.h).abs() > EPS).then_some(ht.max(0.01));
                self.size_child(c, width, height);
            }
            let now = self.local_bounds(c);
            let (dx, dy) = (x - now.x, y - now.y);
            if dx.abs() > EPS || dy.abs() > EPS {
                let mut t = self.doc.props(c).transform();
                t.m02 += dx;
                t.m12 += dy;
                self.edit(c, flags::TRANSFORM).transform = Some(t);
            }
        }
    }
}

/// A child's new start and length on one axis, for a constraint, when its
/// frame goes from `old` to `new` long.
fn constrain(constraint: &str, pos: f64, len: f64, old: f64, new: f64) -> (f64, f64) {
    let d = new - old;
    match constraint {
        "MAX" => (pos + d, len),
        "CENTER" => (pos + d / 2.0, len),
        "STRETCH" => (pos, len + d),
        "SCALE" if old > 0.0 => {
            let k = new / old;
            (pos * k, len * k)
        }
        _ => (pos, len),
    }
}

#[cfg(test)]
mod test;
