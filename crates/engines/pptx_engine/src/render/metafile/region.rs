//! Clip regions in device space: exact set operations on rectangle lists,
//! with path clips (and approximations) for everything else.

use super::bytes::Bytes;
use crate::path::{Affine, Path, Point, Rect};
use std::sync::Arc;

/// `RGN_AND`: intersect with the current region.
pub(super) const RGN_AND: u32 = 1;
/// `RGN_OR`: union.
pub(super) const RGN_OR: u32 = 2;
/// `RGN_XOR`: symmetric difference.
pub(super) const RGN_XOR: u32 = 3;
/// `RGN_DIFF`: the current region minus the new one.
pub(super) const RGN_DIFF: u32 = 4;
/// `RGN_COPY`: replace the current region.
pub(super) const RGN_COPY: u32 = 5;

/// Rectangle lists larger than this are approximated.
pub(super) const MAX_RECTS: usize = 4096;
/// Clip constraints beyond this many are dropped (each one nests a layer).
const MAX_ITEMS: usize = 16;
/// Rectangle pairs one set operation may visit before it is approximated.
const MAX_PAIRS: usize = 1 << 20;
/// Paths with more segments than this are not flattened for region math.
const MAX_FLATTEN_ELS: usize = 100_000;

/// One clip constraint in device space.
#[derive(Clone, Debug)]
pub(super) enum Shape {
    /// The union of disjoint axis-aligned rectangles (empty = nothing visible).
    Rects(Vec<Rect>),
    /// A path filled with the non-zero rule.
    Path(Path),
}

impl Shape {
    /// Whether nothing is visible through this shape.
    pub(super) fn is_empty(&self) -> bool {
        match self {
            Shape::Rects(r) => r.is_empty(),
            Shape::Path(p) => p.is_empty(),
        }
    }

    /// The shape as a path.
    pub(super) fn to_path(&self) -> Path {
        match self {
            Shape::Rects(r) => rects_path(r),
            Shape::Path(p) => p.clone(),
        }
    }

    fn translated(&self, dx: f32, dy: f32) -> Shape {
        match self {
            Shape::Rects(r) => Shape::Rects(
                r.iter()
                    .map(|r| Rect::from_xywh(r.x + dx, r.y + dy, r.w, r.h))
                    .collect(),
            ),
            Shape::Path(p) => {
                Shape::Path(p.transform(&Affine::translate(f64::from(dx), f64::from(dy))))
            }
        }
    }
}

/// A clip state: the intersection of its items (no items = unclipped).
#[derive(Clone, Debug, Default)]
pub(super) struct Clip {
    /// Constraints, all of which apply (shared by saved states until changed).
    pub(super) items: Arc<Vec<Shape>>,
    /// Identifies this exact state so consecutive draws can share one clip group.
    pub(super) serial: u64,
}

impl Clip {
    /// Combines the region with `shape` using an `RGN_*` mode.
    pub(super) fn combine(&mut self, shape: Shape, mode: u32, universe: Rect, serial: u64) {
        self.serial = serial;
        let items = Arc::make_mut(&mut self.items);
        match mode {
            RGN_COPY => *items = vec![shape],
            RGN_AND => and(items, shape),
            RGN_OR | RGN_XOR | RGN_DIFF => {
                if items.is_empty() {
                    if mode == RGN_OR {
                        // Everything ∪ anything = everything.
                        return;
                    }
                    *items = vec![Shape::Rects(vec![universe])];
                }
                let exact = match (items.as_slice(), &shape) {
                    ([Shape::Rects(cur)], Shape::Rects(new)) => match mode {
                        RGN_OR => union_rects(cur, new),
                        RGN_XOR => xor_rects(cur, new),
                        _ => subtract_rects(cur, new),
                    },
                    _ => None,
                };
                if let Some(rects) = exact {
                    *items = vec![Shape::Rects(rects)];
                } else if mode == RGN_DIFF {
                    if items.len() < MAX_ITEMS {
                        items.push(Shape::Path(complement(&shape.to_path(), universe)));
                    }
                } else {
                    // OR / XOR of paths: approximated by the union of the first
                    // constraint and the new shape.
                    let mut p = items[0].to_path();
                    p.extend(&shape.to_path());
                    *items = vec![Shape::Path(p)];
                }
            }
            _ => {}
        }
    }

    /// Moves the region by a device-space offset.
    pub(super) fn offset(&mut self, dx: f32, dy: f32, serial: u64) {
        self.serial = serial;
        for item in Arc::make_mut(&mut self.items) {
            *item = item.translated(dx, dy);
        }
    }
}

/// Intersects the constraints with `shape`, merging rectangle lists exactly.
fn and(items: &mut Vec<Shape>, shape: Shape) {
    if let Shape::Rects(new) = &shape
        && let Some(Shape::Rects(cur)) = items.iter_mut().find(|s| matches!(s, Shape::Rects(_)))
        && cur.len().saturating_mul(new.len()) <= MAX_PAIRS
    {
        *cur = intersect_rects(cur, new);
        return;
    }
    if items.len() < MAX_ITEMS {
        items.push(shape);
    }
}

fn intersect(a: &Rect, b: &Rect) -> Option<Rect> {
    let (l, t) = (a.x.max(b.x), a.y.max(b.y));
    let (r, btm) = (a.right().min(b.right()), a.bottom().min(b.bottom()));
    (r > l && btm > t).then(|| Rect::from_ltrb(l, t, r, btm))
}

/// `a` minus `b` as up to four disjoint rectangles.
fn subtract_one(a: &Rect, b: &Rect, out: &mut Vec<Rect>) {
    let Some(i) = intersect(a, b) else {
        out.push(*a);
        return;
    };
    if i.y > a.y {
        out.push(Rect::from_ltrb(a.x, a.y, a.right(), i.y));
    }
    if i.bottom() < a.bottom() {
        out.push(Rect::from_ltrb(a.x, i.bottom(), a.right(), a.bottom()));
    }
    if i.x > a.x {
        out.push(Rect::from_ltrb(a.x, i.y, i.x, i.bottom()));
    }
    if i.right() < a.right() {
        out.push(Rect::from_ltrb(i.right(), i.y, a.right(), i.bottom()));
    }
}

/// Pairwise intersection of two disjoint rectangle lists (stays disjoint).
pub(super) fn intersect_rects(a: &[Rect], b: &[Rect]) -> Vec<Rect> {
    a.iter()
        .flat_map(|x| b.iter().filter_map(move |y| intersect(x, y)))
        .take(MAX_RECTS)
        .collect()
}

/// `a` minus `b`, or `None` if the result grows too large.
pub(super) fn subtract_rects(a: &[Rect], b: &[Rect]) -> Option<Vec<Rect>> {
    if a.len().max(MAX_RECTS).saturating_mul(b.len()) > MAX_PAIRS {
        return None;
    }
    let mut cur = a.to_vec();
    for s in b {
        let mut next = Vec::with_capacity(cur.len() + 4);
        for r in &cur {
            subtract_one(r, s, &mut next);
        }
        if next.len() > MAX_RECTS {
            return None;
        }
        cur = next;
    }
    Some(cur)
}

fn union_rects(a: &[Rect], b: &[Rect]) -> Option<Vec<Rect>> {
    let mut out = a.to_vec();
    out.extend(subtract_rects(b, a)?);
    (out.len() <= MAX_RECTS).then_some(out)
}

fn xor_rects(a: &[Rect], b: &[Rect]) -> Option<Vec<Rect>> {
    let mut out = subtract_rects(a, b)?;
    out.extend(subtract_rects(b, a)?);
    (out.len() <= MAX_RECTS).then_some(out)
}

/// A path covering disjoint rectangles (all wound the same way).
pub(super) fn rects_path(rects: &[Rect]) -> Path {
    let mut p = Path::new();
    for r in rects {
        p.extend(&Path::rect(*r));
    }
    p
}

fn signed_area(poly: &[Point]) -> f32 {
    let n = poly.len();
    (0..n)
        .map(|i| poly[i].x * poly[(i + 1) % n].y - poly[(i + 1) % n].x * poly[i].y)
        .sum::<f32>()
        / 2.0
}

/// `universe` minus `p` under the non-zero rule: the universe wound one way
/// and every sub-path of `p` the other way.
fn complement(p: &Path, universe: Rect) -> Path {
    let mut out = Path::rect(universe);
    if p.els.len() > MAX_FLATTEN_ELS {
        return out;
    }
    for poly in p.flatten(0.25) {
        if poly.len() < 3 {
            continue;
        }
        let pts: Vec<Point> = if signed_area(&poly) > 0.0 {
            poly.into_iter().rev().collect()
        } else {
            poly
        };
        out.move_to(pts[0]);
        for q in &pts[1..] {
            out.line_to(*q);
        }
        out.close();
    }
    out
}

/// Rectangles (left, top, right, bottom) of an EMF `RegionData` object at `at`.
pub(super) fn parse_rgndata(b: Bytes<'_>, at: usize) -> Option<Vec<[i32; 4]>> {
    let header_size = b.u32(at)? as usize;
    let count = b.u32(at + 8)? as usize;
    let first = at.checked_add(header_size.max(32))?;
    let available = b.len().saturating_sub(first) / 16;
    let n = count.min(available).min(MAX_RECTS);
    (0..n)
        .map(|i| {
            let o = first + i * 16;
            Some([b.i32(o)?, b.i32(o + 4)?, b.i32(o + 8)?, b.i32(o + 12)?])
        })
        .collect()
}

/// Rectangles (left, top, right, bottom) of a WMF `Region` object at `at`.
pub(super) fn parse_region16(b: Bytes<'_>, at: usize) -> Option<Vec<[i32; 4]>> {
    let scan_count = b.i16(at + 10)?.max(0) as usize;
    let bound = [
        i32::from(b.i16(at + 14)?),
        i32::from(b.i16(at + 16)?),
        i32::from(b.i16(at + 18)?),
        i32::from(b.i16(at + 20)?),
    ];
    let mut out = Vec::new();
    let mut o = at + 22;
    for _ in 0..scan_count {
        let count = usize::from(b.u16(o)?);
        let top = i32::from(b.i16(o + 2)?);
        let bottom = i32::from(b.i16(o + 4)?);
        for k in 0..count / 2 {
            let l = i32::from(b.i16(o + 6 + k * 4)?);
            let r = i32::from(b.i16(o + 8 + k * 4)?);
            if out.len() < MAX_RECTS {
                out.push([l, top, r, bottom]);
            }
        }
        o += 8 + count * 2;
    }
    if scan_count == 0 && bound[2] > bound[0] && bound[3] > bound[1] {
        out.push(bound);
    }
    Some(out)
}
