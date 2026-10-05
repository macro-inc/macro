//! The engine's own SmartArt layouts: given the node tree and the frame
//! size, where each shape, connector, and text box goes, and the font sizes
//! that make every text fit (PowerPoint shrinks all the text of a diagram
//! together, so one long label makes every label smaller).
//!
//! Each layout follows its PowerPoint layout definition's proportions
//! (node aspect ratios, spacing, connector sizes) and is scaled to fit the
//! frame, keeping its aspect ratio, then centered.

mod cycle;
mod hierarchy;
mod lists;
mod process;
mod pyramid;

use super::catalog::Kind;
use crate::path::Rect;

/// Millimeters to points (layout definitions size boxes in millimeters per
/// point of font size).
pub(crate) const MM: f32 = 72.0 / 25.4;

/// The largest font size a layout starts from.
pub(crate) const MAX_FONT: f32 = 65.0;
/// The smallest font size text shrinks to.
pub(crate) const MIN_FONT: f32 = 5.0;

/// One node of the diagram being laid out.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct LNode {
    /// Model id.
    pub id: String,
    /// An assistant (organization charts).
    pub asst: bool,
    /// Parent index (`None` for top-level nodes).
    pub parent: Option<usize>,
    /// Child indexes, in order.
    pub children: Vec<usize>,
    /// 1 for top-level nodes.
    pub depth: usize,
}

/// The node tree, in text-pane order.
#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct Diagram {
    /// Nodes in pre-order.
    pub nodes: Vec<LNode>,
}

impl Diagram {
    /// Top-level node indexes.
    pub fn roots(&self) -> Vec<usize> {
        (0..self.nodes.len())
            .filter(|&i| self.nodes[i].parent.is_none())
            .collect()
    }

    /// The descendants of `i` in pre-order (without `i`).
    pub fn descendants(&self, i: usize) -> Vec<usize> {
        let mut out = Vec::new();
        let mut stack: Vec<usize> = self.nodes[i].children.iter().rev().copied().collect();
        while let Some(c) = stack.pop() {
            out.push(c);
            stack.extend(self.nodes[c].children.iter().rev().copied());
        }
        out
    }
}

/// What a text box shows.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum TextSource {
    /// A node's own text.
    Node(usize),
    /// A node's text followed by its descendants as bullets.
    NodeAndBelow(usize),
    /// A node's descendants as bullets.
    Below(usize),
}

/// Vertical text anchoring.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Anchor {
    /// Top.
    Top,
    /// Middle.
    Middle,
}

/// Paragraph alignment.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Align {
    /// Centered.
    Center,
    /// Left.
    Left,
}

/// A text box inside a shape.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct TextBox {
    /// What it shows.
    pub source: TextSource,
    /// The text rectangle (`dsp:txXfrm`), frame coordinates (points).
    pub rect: Rect,
    /// Margins `[left, top, right, bottom]` as multiples of the font size.
    pub margins: [f32; 4],
    /// Extra absolute margins `[left, top, right, bottom]` (points).
    pub pad: [f32; 4],
    /// Anchoring.
    pub anchor: Anchor,
    /// Alignment of the first paragraph (and of every paragraph without bullets).
    pub align: Align,
    /// Font group (0 primary, 1 secondary).
    pub group: usize,
}

impl TextBox {
    /// A text box over `rect` with uniform margins.
    pub fn new(source: TextSource, rect: Rect, margin: f32) -> Self {
        Self {
            source,
            rect,
            margins: [margin; 4],
            pad: [0.0; 4],
            anchor: Anchor::Middle,
            align: Align::Center,
            group: 0,
        }
    }

    /// The same box anchored at the top and left-aligned.
    pub fn top_left(mut self) -> Self {
        self.anchor = Anchor::Top;
        self.align = Align::Left;
        self
    }

    /// Margins in points at `size`.
    pub fn insets(&self, size: f32) -> [f32; 4] {
        std::array::from_fn(|i| self.margins[i] * size + self.pad[i])
    }
}

/// A shape's geometry.
#[derive(Clone, Debug, PartialEq)]
pub(crate) enum Geom {
    /// A preset with adjust values (`name`, value in 100000ths).
    Preset(&'static str, Vec<(&'static str, i64)>),
    /// Open polylines in shape coordinates (points), drawn as lines.
    Lines(Vec<Vec<(f32, f32)>>),
}

/// One shape of the laid-out diagram.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Placed {
    /// The node the shape stands for (its text, or the node a connector leads to).
    pub node: Option<usize>,
    /// Whether this is the node's main shape (selection and editing target).
    pub primary: bool,
    /// Geometry.
    pub geom: Geom,
    /// Box in frame coordinates (points).
    pub rect: Rect,
    /// Rotation in degrees.
    pub rot: f32,
    /// Horizontal flip.
    pub flip_h: bool,
    /// Vertical flip.
    pub flip_v: bool,
    /// Style label (`node1`, `sibTrans2D1`...).
    pub label: String,
    /// Index among the shapes of the same label, and their count.
    pub color: (usize, usize),
    /// Text, if any.
    pub text: Option<TextBox>,
}

impl Placed {
    /// A preset shape without text.
    pub fn shape(geom: &'static str, rect: Rect, label: &str) -> Self {
        Self {
            node: None,
            primary: false,
            geom: Geom::Preset(geom, Vec::new()),
            rect,
            rot: 0.0,
            flip_h: false,
            flip_v: false,
            label: label.to_owned(),
            color: (0, 1),
            text: None,
        }
    }

    /// A node's shape showing `text`.
    pub fn node(geom: &'static str, rect: Rect, label: &str, node: usize, text: TextBox) -> Self {
        Self {
            node: Some(node),
            primary: true,
            text: Some(text),
            ..Self::shape(geom, rect, label)
        }
    }

    /// Sets adjust values.
    pub fn adj(mut self, adj: &[(&'static str, i64)]) -> Self {
        if let Geom::Preset(_, a) = &mut self.geom {
            *a = adj.to_vec();
        }
        self
    }

    fn transform(&mut self, s: f32, dx: f32, dy: f32) {
        let r = |r: &Rect| Rect::from_xywh(r.x * s + dx, r.y * s + dy, r.w * s, r.h * s);
        self.rect = r(&self.rect);
        if let Some(t) = &mut self.text {
            t.rect = r(&t.rect);
        }
        if let Geom::Lines(lines) = &mut self.geom {
            for l in lines {
                for p in l {
                    *p = (p.0 * s, p.1 * s);
                }
            }
        }
    }
}

/// How text is measured (the fitting needs the real fonts and theme).
pub(crate) trait Measure {
    /// The height a text box needs at `size` when its rectangle is `width`
    /// wide (margins included), or `None` when a word does not fit the width.
    fn height(&mut self, text: &TextBox, width: f32, size: f32) -> Option<f32>;

    /// Whether a text box's text fits its rectangle at `size`.
    fn fits(&mut self, text: &TextBox, size: f32) -> bool {
        self.height(text, text.rect.w, size)
            .is_some_and(|h| h <= text.rect.h + 0.5)
    }
}

/// Font sizes by group.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct Sizes {
    /// Primary text.
    pub primary: f32,
    /// Secondary text (bullets under a header).
    pub secondary: f32,
}

impl Sizes {
    /// The size of a group.
    pub fn of(&self, group: usize) -> f32 {
        if group == 0 {
            self.primary
        } else {
            self.secondary
        }
    }
}

/// A laid-out diagram.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Laid {
    /// Shapes back to front.
    pub shapes: Vec<Placed>,
    /// Font sizes.
    pub sizes: Sizes,
}

/// Places shapes at font size `f`; `None` when the arrangement itself does
/// not fit the frame at that size.
type PlaceFn = fn(&Diagram, f32, f32, Sizes, &mut dyn Measure) -> Option<Vec<Placed>>;

/// The secondary size for a primary size, per layout.
fn secondary(kind: Kind, f: f32) -> f32 {
    match kind {
        Kind::VerticalBullets => (f * 0.78).round().max(MIN_FONT),
        _ => f,
    }
}

fn place_fn(kind: Kind) -> PlaceFn {
    match kind {
        Kind::BlockList => lists::block_list,
        Kind::VerticalBullets => lists::vertical_bullets,
        Kind::HorizontalBullets => lists::horizontal_bullets,
        Kind::Process => process::basic_process,
        Kind::Chevron => process::chevron,
        Kind::Cycle => cycle::basic_cycle,
        Kind::Radial => cycle::radial,
        Kind::Venn => cycle::venn,
        Kind::Hierarchy => hierarchy::hierarchy,
        Kind::OrgChart => hierarchy::org_chart,
        Kind::Pyramid => pyramid::pyramid,
    }
}

/// Lays a diagram out in a `w`×`h` frame, choosing the largest whole font
/// size at which everything fits.
pub(crate) fn lay_out(kind: Kind, d: &Diagram, w: f32, h: f32, m: &mut dyn Measure) -> Laid {
    let place = place_fn(kind);
    let sizes = |f: f32| Sizes {
        primary: f,
        secondary: secondary(kind, f),
    };
    let mut attempt = |f: f32| -> Option<Vec<Placed>> {
        let s = sizes(f);
        let shapes = place(d, w, h, s, m)?;
        shapes
            .iter()
            .filter_map(|p| p.text.as_ref())
            .all(|t| m.fits(t, s.of(t.group)))
            .then_some(shapes)
    };
    // Binary search on whole points: fitting is monotonic in the size.
    let (mut lo, mut hi) = (MIN_FONT as i32, MAX_FONT as i32);
    let mut best = None;
    while lo <= hi {
        let mid = (lo + hi) / 2;
        match attempt(mid as f32) {
            Some(shapes) => {
                best = Some((mid as f32, shapes));
                lo = mid + 1;
            }
            None => hi = mid - 1,
        }
    }
    let (f, shapes) = match best {
        Some(b) => b,
        // Nothing fits: the smallest size, overflowing.
        None => {
            let s = sizes(MIN_FONT);
            (MIN_FONT, place(d, w, h, s, m).unwrap_or_default())
        }
    };
    let mut shapes = shapes;
    number_colors(&mut shapes);
    Laid {
        shapes,
        sizes: sizes(f),
    }
}

/// Numbers the shapes of each style label in order (their color index).
fn number_colors(shapes: &mut [Placed]) {
    let mut counts: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
    for s in shapes.iter() {
        *counts.entry(s.label.clone()).or_default() += 1;
    }
    let mut seen: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
    for s in shapes.iter_mut() {
        let i = seen.entry(s.label.clone()).or_default();
        s.color = (*i, counts[&s.label]);
        *i += 1;
    }
}

/// Scales shapes laid out in a `cw`×`ch` canvas to fit `w`×`h`, keeping
/// the aspect ratio (never enlarging past `max_scale`), and centers them.
pub(crate) fn fit_canvas(shapes: &mut [Placed], cw: f32, ch: f32, w: f32, h: f32, max_scale: f32) {
    if cw <= 0.0 || ch <= 0.0 {
        return;
    }
    let s = (w / cw).min(h / ch).min(max_scale);
    let (dx, dy) = ((w - cw * s) / 2.0, (h - ch * s) / 2.0);
    for p in shapes {
        p.transform(s, dx, dy);
    }
}

/// The style label of a node at `depth` (PowerPoint's default: `node1`
/// for top-level nodes, `node2`... below, at most `node4`).
pub(crate) fn node_label(depth: usize) -> String {
    format!("node{}", depth.clamp(1, 4))
}

#[cfg(test)]
mod test;
