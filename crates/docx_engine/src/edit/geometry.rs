//! Where positions are on the pages: carets, selection highlights, hit
//! testing and caret movement by line.

use super::{Pos, Selection};
use crate::layout::inline::Kind;
use crate::layout::{Item, Layout, ParaBox, PlacedLine, StoryRef};
use crate::model::block::BlockId;
use serde::Serialize;
use std::collections::HashMap;

/// A caret: a vertical bar on a page (points).
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
pub struct CaretRect {
    /// Page index.
    pub page: usize,
    /// Left edge.
    pub x: f32,
    /// Top.
    pub y: f32,
    /// Height.
    pub height: f32,
}

/// A rectangle on a page (points).
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
pub struct PageRect {
    /// Page index.
    pub page: usize,
    /// Left.
    pub x: f32,
    /// Top.
    pub y: f32,
    /// Width.
    pub w: f32,
    /// Height.
    pub h: f32,
}

/// Body paragraphs' placed lines, for finding positions on pages.
#[derive(Debug, Default)]
pub struct ViewIndex {
    /// Placed lines of each paragraph in order: (page, item index).
    pub lines: HashMap<BlockId, Vec<(usize, usize)>>,
    /// Body lines of each page: item indices.
    pub page_lines: Vec<Vec<usize>>,
}

impl ViewIndex {
    /// Indexes a layout.
    pub fn build(layout: &Layout) -> Self {
        let mut index = ViewIndex::default();
        for (p, page) in layout.pages.iter().enumerate() {
            let mut on_page = Vec::new();
            for (i, item) in page.items.iter().enumerate() {
                if let Item::Line(l) = item
                    && l.para.story == StoryRef::Body
                {
                    index
                        .lines
                        .entry(l.para.block.clone())
                        .or_default()
                        .push((p, i));
                    on_page.push(i);
                }
            }
            index.page_lines.push(on_page);
        }
        index
    }
}

/// A place the caret can rest on a line.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct Stop {
    /// Content offset.
    pub offset: usize,
    /// X from the paragraph's text area left edge.
    pub x: f32,
    /// Cluster whose metrics size the caret.
    pub cluster: usize,
}

/// Caret stops of line `li` of a paragraph, left to right.
pub(crate) fn line_stops(pb: &ParaBox, li: usize) -> Vec<Stop> {
    let lines = &pb.lines;
    let Some(line) = lines.lines.get(li) else {
        return Vec::new();
    };
    let clusters = &pb.inline.clusters;
    let mut stops: Vec<Stop> = Vec::new();
    let mut last_visible: Option<usize> = None;
    for ci in line.start..line.end {
        let c = &clusters[ci];
        if ci < pb.inline.label_len || c.len == 0 && c.kind != Kind::End {
            continue;
        }
        if c.kind == Kind::Zero {
            continue;
        }
        if c.kind == Kind::End {
            stops.push(Stop {
                offset: c.offset as usize,
                x: lines.x[ci],
                cluster: ci,
            });
            last_visible = None;
            break;
        }
        stops.push(Stop {
            offset: c.offset as usize,
            x: lines.x[ci],
            cluster: ci,
        });
        last_visible = Some(ci);
    }
    // A wrapped line ends after its last character (the next line's start).
    if let Some(ci) = last_visible {
        let c = &clusters[ci];
        stops.push(Stop {
            offset: c.offset as usize + c.len as usize,
            x: lines.x[ci] + lines.adv[ci],
            cluster: ci,
        });
    }
    if stops.is_empty() {
        // Only hidden content: rest at the line's start.
        let ci = (line.start..line.end)
            .find(|&ci| clusters[ci].len > 0 || clusters[ci].kind == Kind::End)
            .unwrap_or(line.start.min(clusters.len().saturating_sub(1)));
        if let Some(c) = clusters.get(ci) {
            stops.push(Stop {
                offset: c.offset as usize,
                x: line.left,
                cluster: ci,
            });
        }
    }
    stops
}

/// Whether `li` is the paragraph's last line.
fn is_last_line(pb: &ParaBox, li: usize) -> bool {
    li + 1 >= pb.lines.lines.len()
}

/// The placed line at (page, item).
pub(crate) fn placed(layout: &Layout, at: (usize, usize)) -> Option<&PlacedLine> {
    match layout.pages.get(at.0)?.items.get(at.1)? {
        Item::Line(l) => Some(l),
        _ => None,
    }
}

/// Finds the placed line and stop showing `pos`.
pub(crate) fn locate<'a>(
    layout: &'a Layout,
    index: &ViewIndex,
    pos: &Pos,
) -> Option<(usize, &'a PlacedLine, Stop)> {
    let entries = index.lines.get(&pos.block)?;
    let mut best: Option<(usize, &PlacedLine, Stop)> = None;
    for (k, &(page, item)) in entries.iter().enumerate() {
        let Some(pl) = placed(layout, (page, item)) else {
            continue;
        };
        let stops = line_stops(&pl.para, pl.line);
        let (Some(first), Some(last)) = (stops.first(), stops.last()) else {
            continue;
        };
        let last_line = k + 1 == entries.len();
        if pos.offset < first.offset {
            // In hidden content before the line: show at its start.
            return Some((page, pl, *first));
        }
        if pos.offset >= first.offset && pos.offset <= last.offset {
            let at_wrap =
                pos.offset == last.offset && !last_line && !is_last_line(&pl.para, pl.line);
            if at_wrap && !pos.upstream {
                // Shown at the start of the next line.
                best = Some((page, pl, *last));
                continue;
            }
            let stop = stops
                .iter()
                .find(|s| s.offset >= pos.offset)
                .copied()
                .unwrap_or(*last);
            return Some((page, pl, stop));
        }
        best = Some((page, pl, *last));
    }
    best
}

/// The caret for a position.
pub fn caret(layout: &Layout, index: &ViewIndex, pos: &Pos) -> Option<CaretRect> {
    let (page, pl, stop) = locate(layout, index, pos)?;
    let line = pl.line();
    let pb = &pl.para;
    let run = pb
        .inline
        .clusters
        .get(stop.cluster)
        .and_then(|c| pb.inline.runs.get(c.run as usize));
    let (ascent, descent) = run.map_or((line.baseline, line.height - line.baseline), |r| {
        (r.ascent.max(1.0), r.descent.max(0.5))
    });
    let baseline = pl.y + line.baseline;
    let top = (baseline - ascent).max(pl.y);
    let bottom = (baseline + descent).min(pl.y + line.height.max(ascent + descent));
    Some(CaretRect {
        page,
        x: pl.x + stop.x,
        y: top,
        height: (bottom - top).max(4.0),
    })
}

/// Distance from (x, y) to a placed line's box, weighting vertical misses
/// more (a click beside a line belongs to it).
fn distance(pl: &PlacedLine, x: f32, y: f32) -> f32 {
    let line = pl.line();
    let (l, r) = (pl.x + line.left, pl.x + line.right.max(line.left + 1.0));
    let (t, b) = (pl.y, pl.y + line.height);
    let dx = if x < l {
        l - x
    } else if x > r {
        x - r
    } else {
        0.0
    };
    let dy = if y < t {
        t - y
    } else if y > b {
        y - b
    } else {
        0.0
    };
    dy * 4.0 + dx
}

/// The stop nearest to `x` on a placed line, with its affinity.
fn stop_at_x(pl: &PlacedLine, x: f32) -> (Stop, bool) {
    let stops = line_stops(&pl.para, pl.line);
    let rel = x - pl.x;
    let mut chosen = stops.first().copied();
    for w in stops.windows(2) {
        let mid = (w[0].x + w[1].x) / 2.0;
        if rel >= mid {
            chosen = Some(w[1]);
        }
    }
    let Some(stop) = chosen else {
        return (
            Stop {
                offset: 0,
                x: 0.0,
                cluster: 0,
            },
            false,
        );
    };
    let last = stops.last().is_some_and(|s| s.offset == stop.offset);
    let upstream = last && !is_last_line(&pl.para, pl.line);
    (stop, upstream)
}

/// The position at a point on a page (points), if the page shows body text.
pub fn hit_test(layout: &Layout, index: &ViewIndex, page: usize, x: f32, y: f32) -> Option<Pos> {
    let page_ref = layout.pages.get(page)?;
    let items = index.page_lines.get(page)?;
    let mut best: Option<(&PlacedLine, f32)> = None;
    for &i in items {
        if let Some(Item::Line(pl)) = page_ref.items.get(i) {
            let d = distance(pl, x, y);
            if best.is_none_or(|(_, bd)| d < bd) {
                best = Some((pl, d));
            }
        }
    }
    let (pl, _) = best?;
    let (stop, upstream) = stop_at_x(pl, x);
    Some(Pos {
        block: pl.para.block.clone(),
        offset: stop.offset,
        upstream,
    })
}

/// The page x of `offset` on a placed line (clamped to the line).
fn x_on_line(pl: &PlacedLine, offset: usize) -> f32 {
    let stops = line_stops(&pl.para, pl.line);
    let stop = stops
        .iter()
        .find(|s| s.offset >= offset)
        .or(stops.last())
        .copied();
    pl.x + stop.map_or(0.0, |s| s.x)
}

/// Highlight rectangles for the range between two ordered positions;
/// `paras` lists the paragraphs from `from.block` to `to.block` inclusive.
pub fn range_rects(
    layout: &Layout,
    index: &ViewIndex,
    from: &Pos,
    to: &Pos,
    paras: &[BlockId],
) -> Vec<PageRect> {
    let mut out = Vec::new();
    for (k, id) in paras.iter().enumerate() {
        let Some(entries) = index.lines.get(id) else {
            continue;
        };
        let first = k == 0;
        let last = k + 1 == paras.len();
        let s = if first { from.offset } else { 0 };
        let e = if last { to.offset } else { usize::MAX };
        for &(page, item) in entries {
            let Some(pl) = placed(layout, (page, item)) else {
                continue;
            };
            let stops = line_stops(&pl.para, pl.line);
            let (Some(a), Some(b)) = (stops.first(), stops.last()) else {
                continue;
            };
            let final_line = is_last_line(&pl.para, pl.line);
            let lo = s.max(a.offset);
            let hi = e.min(b.offset);
            if lo > hi || (!final_line && lo == b.offset) {
                // Nothing here, or the range starts at the wrap point,
                // which shows on the next line.
                continue;
            }
            // The paragraph mark is selected too: show it as a sliver.
            let mark = !last && final_line;
            if lo == hi && !mark {
                continue;
            }
            let x0 = x_on_line(pl, lo);
            let x1 = x_on_line(pl, hi) + if mark { 5.0 } else { 0.0 };
            let line = pl.line();
            out.push(PageRect {
                page,
                x: x0,
                y: pl.y,
                w: (x1 - x0).max(1.0),
                h: line.height,
            });
        }
    }
    out
}

/// Where vertical movement goes from a caret, at `goal_x`: the stop on
/// the nearest line above or below.
pub fn vertical(
    layout: &Layout,
    index: &ViewIndex,
    from: &CaretRect,
    goal_x: f32,
    down: bool,
) -> Option<Pos> {
    let center = from.y + from.height / 2.0;
    let mut page = from.page;
    let mut first_page = true;
    loop {
        let items = index.page_lines.get(page)?;
        let page_ref = &layout.pages[page];
        let mut best: Option<(&PlacedLine, f32)> = None;
        for &i in items {
            let Some(Item::Line(pl)) = page_ref.items.get(i) else {
                continue;
            };
            let line = pl.line();
            let (t, b) = (pl.y, pl.y + line.height);
            if first_page {
                let beyond = if down {
                    t > center + 0.5
                } else {
                    b < center - 0.5
                };
                if !beyond {
                    continue;
                }
            }
            let (l, r) = (pl.x + line.left, pl.x + line.right);
            let dx = if goal_x < l {
                l - goal_x
            } else if goal_x > r {
                goal_x - r
            } else {
                0.0
            };
            let dy = if down {
                if first_page { t - center } else { t }
            } else if first_page {
                center - b
            } else {
                page_ref.height - b
            };
            let score = dy + dx * 4.0;
            if best.is_none_or(|(_, s)| score < s) {
                best = Some((pl, score));
            }
        }
        if let Some((pl, _)) = best {
            let (stop, upstream) = stop_at_x(pl, goal_x);
            return Some(Pos {
                block: pl.para.block.clone(),
                offset: stop.offset,
                upstream,
            });
        }
        first_page = false;
        if down {
            page += 1;
            if page >= layout.pages.len() {
                return None;
            }
        } else {
            page = page.checked_sub(1)?;
        }
    }
}

/// The first and last stops of the line showing `pos`.
pub fn line_bounds(layout: &Layout, index: &ViewIndex, pos: &Pos) -> Option<(Pos, Pos)> {
    let (_, pl, _) = locate(layout, index, pos)?;
    let stops = line_stops(&pl.para, pl.line);
    let first = stops.first()?;
    let last = stops.last()?;
    let wrapped = !is_last_line(&pl.para, pl.line);
    Some((
        Pos {
            block: pos.block.clone(),
            offset: first.offset,
            upstream: false,
        },
        Pos {
            block: pos.block.clone(),
            offset: last.offset,
            upstream: wrapped,
        },
    ))
}

/// Every caret stop offset of a paragraph, ascending (from its laid-out
/// lines), or `None` when it is not on any page.
pub fn para_stops(layout: &Layout, index: &ViewIndex, block: &BlockId) -> Option<Vec<usize>> {
    let entries = index.lines.get(block)?;
    let mut out: Vec<usize> = Vec::new();
    for &(page, item) in entries {
        let Some(pl) = placed(layout, (page, item)) else {
            continue;
        };
        for s in line_stops(&pl.para, pl.line) {
            out.push(s.offset);
        }
    }
    out.sort_unstable();
    out.dedup();
    Some(out)
}

/// The selection's rectangles (empty for a caret).
pub fn selection_rects(
    layout: &Layout,
    index: &ViewIndex,
    sel: &Selection,
    ordered: (&Pos, &Pos),
    paras: &[BlockId],
) -> Vec<PageRect> {
    if sel.anchor.block == sel.focus.block && sel.anchor.offset == sel.focus.offset {
        return Vec::new();
    }
    range_rects(layout, index, ordered.0, ordered.1, paras)
}
