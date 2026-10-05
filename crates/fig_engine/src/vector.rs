//! Vector networks: the editable geometry of Figma's vector layers.
//!
//! A network is vertices joined by segments (straight, or cubic with a
//! tangent at each end, relative to its vertex) and regions, each a list of
//! closed loops of segments filled with a winding rule. Figma stores it as
//! a blob (`vectorData.vectorNetworkBlob`) of little-endian 32-bit words:
//! the vertex, segment, and region counts; each vertex (`styleID`, x, y);
//! each segment (`styleID`, start vertex, start tangent x and y, end vertex,
//! end tangent x and y); and each region (`styleID << 1 | nonzero`, its
//! loop count, then each loop's segment count and segment indices).
//! Coordinates are in the space of `vectorData.normalizedSize`, which the
//! layer's size scales.
//!
//! Without regions, Figma fills the network's closed loops (nonzero).

use crate::document::Document;
use crate::model::{Affine, Props, Rect, Vec2, WindingRule};
use serde::{Deserialize, Serialize};
use tiny_skia::{Path, PathBuilder, PathSegment};

#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Point {
    pub x: f32,
    pub y: f32,
}

impl Point {
    fn is_zero(&self) -> bool {
        self.x == 0.0 && self.y == 0.0
    }
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Vertex {
    pub x: f32,
    pub y: f32,
    /// An entry of `vectorData.styleOverrideTable` (a corner radius, say).
    #[serde(default)]
    pub style: u32,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Segment {
    pub start: u32,
    pub end: u32,
    /// Control points relative to the start and end vertices; both zero for
    /// a straight segment.
    #[serde(default)]
    pub tangent_start: Point,
    #[serde(default)]
    pub tangent_end: Point,
    #[serde(default)]
    pub style: u32,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Region {
    /// `NONZERO` or `EVENODD`.
    pub winding_rule: String,
    /// Closed loops of segment indices.
    pub loops: Vec<Vec<u32>>,
    #[serde(default)]
    pub style: u32,
}

impl Region {
    pub fn rule(&self) -> WindingRule {
        if self.winding_rule == "EVENODD" || self.winding_rule == "ODD" {
            WindingRule::EvenOdd
        } else {
            WindingRule::NonZero
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Network {
    pub vertices: Vec<Vertex>,
    pub segments: Vec<Segment>,
    #[serde(default)]
    pub regions: Vec<Region>,
}

/// A run of segments drawn as one subpath: indices with their direction
/// (`true`: from the segment's start to its end).
type Chain = (Vec<(u32, bool)>, bool);

impl Network {
    /// Parses a `vectorNetworkBlob`; `None` when it is malformed.
    pub fn decode(bytes: &[u8]) -> Option<Network> {
        let mut at = 0;
        let mut word = || -> Option<u32> {
            let b = bytes.get(at..at + 4)?;
            at += 4;
            Some(u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
        };
        let (nv, ns, nr) = (word()? as usize, word()? as usize, word()? as usize);
        if nv > bytes.len() / 12 || ns > bytes.len() / 28 {
            return None;
        }
        let float = |w: u32| {
            let f = f32::from_bits(w);
            if f.is_finite() { f } else { 0.0 }
        };
        let mut net = Network::default();
        for _ in 0..nv {
            let style = word()?;
            let (x, y) = (float(word()?), float(word()?));
            net.vertices.push(Vertex { x, y, style });
        }
        for _ in 0..ns {
            let style = word()?;
            let start = word()?;
            let tangent_start = Point {
                x: float(word()?),
                y: float(word()?),
            };
            let end = word()?;
            let tangent_end = Point {
                x: float(word()?),
                y: float(word()?),
            };
            if start as usize >= nv || end as usize >= nv {
                return None;
            }
            net.segments.push(Segment {
                start,
                end,
                tangent_start,
                tangent_end,
                style,
            });
        }
        for _ in 0..nr {
            let flags = word()?;
            let count = word()? as usize;
            let mut loops = Vec::new();
            for _ in 0..count.min(bytes.len() / 4) {
                let n = word()? as usize;
                let mut l = Vec::with_capacity(n.min(ns));
                for _ in 0..n {
                    let s = word()?;
                    if s as usize >= ns {
                        return None;
                    }
                    l.push(s);
                }
                loops.push(l);
            }
            net.regions.push(Region {
                winding_rule: if flags & 1 == 1 { "NONZERO" } else { "EVENODD" }.into(),
                loops,
                style: flags >> 1,
            });
        }
        Some(net)
    }

    /// The `vectorNetworkBlob` encoding.
    pub fn encode(&self) -> Vec<u8> {
        let mut out = Vec::new();
        let mut word = |w: u32| out.extend_from_slice(&w.to_le_bytes());
        word(self.vertices.len() as u32);
        word(self.segments.len() as u32);
        word(self.regions.len() as u32);
        for v in &self.vertices {
            word(v.style);
            word(v.x.to_bits());
            word(v.y.to_bits());
        }
        for s in &self.segments {
            word(s.style);
            word(s.start);
            word(s.tangent_start.x.to_bits());
            word(s.tangent_start.y.to_bits());
            word(s.end);
            word(s.tangent_end.x.to_bits());
            word(s.tangent_end.y.to_bits());
        }
        for r in &self.regions {
            let nonzero = u32::from(r.rule() == WindingRule::NonZero);
            word(r.style << 1 | nonzero);
            word(r.loops.len() as u32);
            for l in &r.loops {
                word(l.len() as u32);
                for &s in l {
                    word(s);
                }
            }
        }
        out
    }

    /// Whether every index points at something.
    pub fn is_valid(&self) -> bool {
        let nv = self.vertices.len() as u32;
        let ns = self.segments.len() as u32;
        self.vertices
            .iter()
            .all(|v| v.x.is_finite() && v.y.is_finite())
            && self.segments.iter().all(|s| s.start < nv && s.end < nv)
            && self
                .regions
                .iter()
                .all(|r| r.loops.iter().flatten().all(|&s| s < ns))
    }

    fn vertex(&self, i: u32) -> (f32, f32) {
        let v = &self.vertices[i as usize];
        (v.x, v.y)
    }

    /// Appends segment `s` (reversed when not `forward`) to `pb`, which is at
    /// its first point.
    fn draw_segment(&self, pb: &mut PathBuilder, s: u32, forward: bool) {
        let seg = &self.segments[s as usize];
        let (a, b, ta, tb) = if forward {
            (seg.start, seg.end, seg.tangent_start, seg.tangent_end)
        } else {
            (seg.end, seg.start, seg.tangent_end, seg.tangent_start)
        };
        let (ax, ay) = self.vertex(a);
        let (bx, by) = self.vertex(b);
        if ta.is_zero() && tb.is_zero() {
            pb.line_to(bx, by);
        } else {
            pb.cubic_to(ax + ta.x, ay + ta.y, bx + tb.x, by + tb.y, bx, by);
        }
    }

    /// Draws `chain` as one subpath.
    fn draw_chain(&self, pb: &mut PathBuilder, (chain, closed): &Chain) {
        let Some(&(first, forward)) = chain.first() else {
            return;
        };
        let seg = &self.segments[first as usize];
        let (x, y) = self.vertex(if forward { seg.start } else { seg.end });
        pb.move_to(x, y);
        for &(s, f) in chain {
            self.draw_segment(pb, s, f);
        }
        if *closed {
            pb.close();
        }
    }

    /// A loop's segments in order, each with the direction that continues
    /// from the previous one.
    fn orient_loop(&self, segments: &[u32]) -> Vec<(u32, bool)> {
        let mut out = Vec::with_capacity(segments.len());
        let Some(&first) = segments.first() else {
            return out;
        };
        let s0 = &self.segments[first as usize];
        // Start at the end the next segment does not touch.
        let forward = match segments.get(1).map(|&n| &self.segments[n as usize]) {
            Some(n) => n.start == s0.end || n.end == s0.end,
            None => true,
        };
        let mut at = if forward { s0.end } else { s0.start };
        out.push((first, forward));
        for &s in &segments[1..] {
            let seg = &self.segments[s as usize];
            let f = seg.start == at || seg.end != at;
            at = if f { seg.end } else { seg.start };
            out.push((s, f));
        }
        out
    }

    /// Maximal runs of segments through vertices joining exactly two:
    /// open ones end at loose ends and junctions; the rest are closed loops.
    fn chains(&self) -> Vec<Chain> {
        let nv = self.vertices.len();
        let mut at: Vec<Vec<u32>> = vec![Vec::new(); nv];
        for (k, s) in self.segments.iter().enumerate() {
            at[s.start as usize].push(k as u32);
            if s.end != s.start {
                at[s.end as usize].push(k as u32);
            }
        }
        let mut used = vec![false; self.segments.len()];
        let mut out = Vec::new();
        let walk = |start_vertex: u32, first: u32, used: &mut [bool]| -> Chain {
            let mut chain = Vec::new();
            let mut v = start_vertex;
            let mut s = first;
            loop {
                used[s as usize] = true;
                let seg = &self.segments[s as usize];
                let forward = seg.start == v;
                chain.push((s, forward));
                v = if forward { seg.end } else { seg.start };
                if v == start_vertex {
                    return (chain, true);
                }
                let around = &at[v as usize];
                if around.len() != 2 {
                    return (chain, false);
                }
                match around.iter().copied().find(|&n| !used[n as usize]) {
                    Some(n) => s = n,
                    None => return (chain, false),
                }
            }
        };
        // Open runs first, from their loose ends and junctions.
        for v in 0..nv {
            if at[v].len() == 2 {
                continue;
            }
            for &s in &at[v].clone() {
                if !used[s as usize] {
                    out.push(walk(v as u32, s, &mut used));
                }
            }
        }
        for s in 0..self.segments.len() {
            if !used[s] {
                let start = self.segments[s].start;
                out.push(walk(start, s as u32, &mut used));
            }
        }
        out
    }

    /// The filled areas, one path per region (or, without regions, the
    /// closed loops filled nonzero).
    pub fn fill_paths(&self) -> Vec<(Path, WindingRule)> {
        if self.regions.is_empty() {
            let mut pb = PathBuilder::new();
            for chain in self.chains().iter().filter(|c| c.1) {
                self.draw_chain(&mut pb, chain);
            }
            return pb
                .finish()
                .map(|p| vec![(p, WindingRule::NonZero)])
                .unwrap_or_default();
        }
        self.regions
            .iter()
            .filter_map(|r| {
                let mut pb = PathBuilder::new();
                for l in &r.loops {
                    self.draw_chain(&mut pb, &(self.orient_loop(l), true));
                }
                pb.finish().map(|p| (p, r.rule()))
            })
            .collect()
    }

    /// Every segment, as the strokes follow them.
    pub fn stroke_path(&self) -> Option<Path> {
        let mut pb = PathBuilder::new();
        for chain in self.chains() {
            self.draw_chain(&mut pb, &chain);
        }
        pb.finish()
    }

    /// The network with `t` applied (tangents by its linear part).
    pub fn transformed(&self, t: &Affine) -> Network {
        let mut net = self.clone();
        for v in &mut net.vertices {
            let p = t.apply(Vec2::new(f64::from(v.x), f64::from(v.y)));
            v.x = p.x as f32;
            v.y = p.y as f32;
        }
        let linear = |p: &mut Point| {
            let (x, y) = (f64::from(p.x), f64::from(p.y));
            p.x = (t.m00 * x + t.m01 * y) as f32;
            p.y = (t.m10 * x + t.m11 * y) as f32;
        };
        for s in &mut net.segments {
            linear(&mut s.tangent_start);
            linear(&mut s.tangent_end);
        }
        net
    }

    /// Tight bounds of the drawn segments (and lone vertices).
    pub fn bounds(&self) -> Rect {
        let mut r = Rect::EMPTY;
        for v in &self.vertices {
            r = r.union(&Rect::new(f64::from(v.x), f64::from(v.y), 0.0, 0.0));
        }
        if let Some(b) = self.stroke_path().and_then(|p| p.compute_tight_bounds()) {
            r = r.union(&Rect::new(
                f64::from(b.x()),
                f64::from(b.y()),
                f64::from(b.width()),
                f64::from(b.height()),
            ));
        }
        r
    }

    /// The network drawing `path`: each subpath a run of segments, closed
    /// ones as loops of one region filled with `rule`.
    pub fn from_path(path: &Path, rule: WindingRule) -> Network {
        let mut net = Network::default();
        let mut loops = Vec::new();
        let mut contour_start: Option<u32> = None;
        let mut last: Option<u32> = None;
        let mut current: Vec<u32> = Vec::new();
        let add_vertex = |net: &mut Network, x: f32, y: f32| {
            net.vertices.push(Vertex { x, y, style: 0 });
            (net.vertices.len() - 1) as u32
        };
        let push = |net: &mut Network, current: &mut Vec<u32>, seg: Segment| {
            net.segments.push(seg);
            current.push((net.segments.len() - 1) as u32);
        };
        for seg in path.segments() {
            match seg {
                PathSegment::MoveTo(p) => {
                    let v = add_vertex(&mut net, p.x, p.y);
                    contour_start = Some(v);
                    last = Some(v);
                    current.clear();
                }
                PathSegment::LineTo(p) => {
                    let Some(a) = last else { continue };
                    let b = add_vertex(&mut net, p.x, p.y);
                    push(
                        &mut net,
                        &mut current,
                        Segment {
                            start: a,
                            end: b,
                            ..Segment::default()
                        },
                    );
                    last = Some(b);
                }
                PathSegment::QuadTo(c, p) => {
                    let Some(a) = last else { continue };
                    let (ax, ay) = net.vertex(a);
                    let b = add_vertex(&mut net, p.x, p.y);
                    push(
                        &mut net,
                        &mut current,
                        Segment {
                            start: a,
                            end: b,
                            tangent_start: Point {
                                x: (c.x - ax) * 2.0 / 3.0,
                                y: (c.y - ay) * 2.0 / 3.0,
                            },
                            tangent_end: Point {
                                x: (c.x - p.x) * 2.0 / 3.0,
                                y: (c.y - p.y) * 2.0 / 3.0,
                            },
                            style: 0,
                        },
                    );
                    last = Some(b);
                }
                PathSegment::CubicTo(c1, c2, p) => {
                    let Some(a) = last else { continue };
                    let (ax, ay) = net.vertex(a);
                    let b = add_vertex(&mut net, p.x, p.y);
                    push(
                        &mut net,
                        &mut current,
                        Segment {
                            start: a,
                            end: b,
                            tangent_start: Point {
                                x: c1.x - ax,
                                y: c1.y - ay,
                            },
                            tangent_end: Point {
                                x: c2.x - p.x,
                                y: c2.y - p.y,
                            },
                            style: 0,
                        },
                    );
                    last = Some(b);
                }
                PathSegment::Close => {
                    let (Some(start), Some(end)) = (contour_start, last) else {
                        continue;
                    };
                    if current.is_empty() {
                        continue;
                    }
                    let (sx, sy) = net.vertex(start);
                    let (ex, ey) = net.vertex(end);
                    if (sx - ex).abs() < 1e-4 && (sy - ey).abs() < 1e-4 && end != start {
                        // The last segment ends on the first point: join them.
                        let k = *current.last().expect("checked above") as usize;
                        net.segments[k].end = start;
                        net.vertices.pop();
                    } else {
                        push(
                            &mut net,
                            &mut current,
                            Segment {
                                start: end,
                                end: start,
                                ..Segment::default()
                            },
                        );
                    }
                    loops.push(std::mem::take(&mut current));
                    last = Some(start);
                }
            }
        }
        if !loops.is_empty() {
            net.regions.push(Region {
                winding_rule: match rule {
                    WindingRule::NonZero => "NONZERO",
                    WindingRule::EvenOdd => "EVENODD",
                }
                .into(),
                loops,
                style: 0,
            });
        }
        net
    }
}

/// A layer's network in its own coordinates (scaled from the stored
/// normalized size to its size), if it has one.
pub fn node_network(doc: &Document, props: &Props) -> Option<Network> {
    let data = props.vector_data.as_deref()?;
    let net = Network::decode(doc.blobs.bytes(data.network_blob?)?)?;
    let size = props.size();
    let normalized = data.normalized_size.unwrap_or(size);
    let sx = if normalized.x > 0.0 {
        size.x / normalized.x
    } else {
        1.0
    };
    let sy = if normalized.y > 0.0 {
        size.y / normalized.y
    } else {
        1.0
    };
    if (sx - 1.0).abs() < 1e-9 && (sy - 1.0).abs() < 1e-9 {
        return Some(net);
    }
    Some(net.transformed(&Affine::scale(sx, sy)))
}

#[cfg(test)]
mod test;
