//! Legend entries, layout, and drawing.

use super::canvas::{Block, Canvas};
use super::look::Look;
use super::model::{ChartModel, Grouping, Kind, LegendModel, LegendPos};
use super::numfmt;
use super::style::{Role, apply, resolve_fill, resolve_line};
use crate::path::{Path, Point, Rect};
use crate::render::label::{HAlign, LabelStyle};

/// How an entry's key is drawn.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum KeyKind {
    /// A filled square (bars, areas, slices).
    Rect,
    /// A line segment with an optional marker.
    Line,
    /// A filled circle (bubbles).
    Circle,
}

/// One legend entry.
#[derive(Clone, Debug)]
pub(crate) struct Entry {
    pub text: String,
    pub look: Look,
    pub kind: KeyKind,
    pub style: LabelStyle,
}

/// A placed legend.
#[derive(Clone, Debug)]
pub(crate) struct Placed {
    pub rect: Rect,
    /// Key rectangle and text block of each entry.
    items: Vec<(Rect, Block, Point)>,
}

/// Collects the legend entries in display order.
pub(crate) fn entries(m: &ChartModel, legend: &LegendModel) -> Vec<Entry> {
    let base = apply(&legend.text.props, &m.base_text(Role::Other));
    let mut out: Vec<Entry> = Vec::new();
    let mut vertical_stack = false;
    for g in &m.groups {
        let kind = match g.kind {
            Kind::Bubble => KeyKind::Circle,
            _ if g.filled() => KeyKind::Rect,
            _ => KeyKind::Line,
        };
        if matches!(g.kind, Kind::Bar | Kind::Area)
            && matches!(g.grouping, Grouping::Stacked | Grouping::Percent)
            || g.kind == Kind::Bar && g.horizontal
        {
            vertical_stack = true;
        }
        if m.varies(g) {
            let Some(s) = g.series.first() else { continue };
            let cats = s.cat.as_ref();
            for i in 0..s.len() {
                let text = cats
                    .map(|c| category_text(m, c, i))
                    .unwrap_or_else(|| (i + 1).to_string());
                out.push(Entry {
                    text,
                    look: m.look(g, s, Some(i)),
                    kind,
                    style: base.clone(),
                });
            }
        } else {
            for s in &g.series {
                let text = s
                    .name
                    .clone()
                    .unwrap_or_else(|| format!("Series{}", s.idx + 1));
                out.push(Entry {
                    text,
                    look: m.look(g, s, None),
                    kind,
                    style: base.clone(),
                });
            }
        }
    }
    // Trendline entries follow every series entry.
    for g in m.groups.iter().filter(|g| super::trend::supported(g)) {
        for s in &g.series {
            for t in &s.trendlines {
                out.push(Entry {
                    text: super::trend::legend_text(t, s),
                    look: Look {
                        fill: None,
                        line: super::trend::line(m, g, s, t),
                        marker: None,
                    },
                    kind: KeyKind::Line,
                    style: base.clone(),
                });
            }
        }
    }
    let mut kept: Vec<Entry> = Vec::new();
    for (i, mut e) in out.into_iter().enumerate() {
        if legend.deleted.contains(&i) {
            continue;
        }
        if let Some((_, spec)) = legend.entry_text.iter().find(|(k, _)| *k == i) {
            e.style = apply(&spec.props, &e.style);
        }
        kept.push(e);
    }
    let vertical = matches!(
        legend.pos,
        LegendPos::Right | LegendPos::Left | LegendPos::TopRight
    );
    if vertical && vertical_stack && m.groups.len() == 1 {
        kept.reverse();
    }
    kept
}

/// Text of category `i` of a category reference.
pub(crate) fn category_text(m: &ChartModel, c: &super::model::DataRef, i: usize) -> String {
    if let (true, Some(v), Some(f)) = (c.numeric, c.num(i), c.format.as_deref()) {
        return numfmt::format(v, f, m.date1904);
    }
    c.label(i).map(str::to_owned).unwrap_or_default()
}

fn key_width(e: &Entry) -> f32 {
    match e.kind {
        KeyKind::Rect | KeyKind::Circle => e.style.size * 0.6,
        KeyKind::Line => e.style.size * 1.6,
    }
}

const PAD: f32 = 0.25;
const KEY_GAP: f32 = 0.3;

/// Lays out the legend for `pos` within `avail` (a manual `rect` wins).
pub(crate) fn place(
    cv: &Canvas<'_>,
    entries: &[Entry],
    pos: LegendPos,
    avail: Rect,
    manual: Option<Rect>,
) -> Option<Placed> {
    if entries.is_empty() {
        return None;
    }
    let size = entries.iter().map(|e| e.style.size).fold(1.0f32, f32::max);
    let pad = size * PAD;
    let vertical = matches!(
        pos,
        LegendPos::Right | LegendPos::Left | LegendPos::TopRight
    );
    let max_text = if vertical {
        (avail.w * 0.4).max(size * 4.0)
    } else {
        (avail.w * 0.8).max(size * 4.0)
    };
    let blocks: Vec<Block> = entries
        .iter()
        .map(|e| cv.plain(&e.text, &e.style, max_text, HAlign::Left))
        .collect();
    let item_w =
        |i: usize| key_width(&entries[i]) + entries[i].style.size * KEY_GAP + blocks[i].width;
    let item_h = |i: usize| blocks[i].height.max(entries[i].style.size * 1.25);
    let mut items = Vec::new();
    let (w, h);
    if vertical || manual.is_some_and(|r| r.h > r.w * 1.5) {
        let key_col = entries.iter().map(key_width).fold(0.0f32, f32::max);
        let text_x = key_col + size * KEY_GAP;
        w = (0..entries.len())
            .map(|i| text_x + blocks[i].width)
            .fold(0.0f32, f32::max)
            + 2.0 * pad;
        let mut y = pad;
        for i in 0..entries.len() {
            let ih = item_h(i);
            let kw = key_width(&entries[i]);
            let key = Rect::from_xywh(pad + (key_col - kw) / 2.0, y, kw, ih);
            items.push((
                key,
                blocks[i].clone(),
                Point::new(pad + text_x, y + ih / 2.0),
            ));
            y += ih;
        }
        h = y + pad;
    } else {
        // Rows of entries, wrapped to the available width.
        let limit = manual.map_or(avail.w, |r| r.w) - 2.0 * pad;
        let gap = size * 0.9;
        let mut rows: Vec<Vec<usize>> = vec![Vec::new()];
        let mut x = 0.0;
        for i in 0..entries.len() {
            let iw = item_w(i);
            let row = rows.last_mut().expect("non-empty");
            if !row.is_empty() && x + gap + iw > limit {
                rows.push(vec![i]);
                x = iw;
            } else {
                x += if row.is_empty() { iw } else { gap + iw };
                row.push(i);
            }
        }
        let row_w = |r: &[usize]| {
            r.iter().map(|&i| item_w(i)).sum::<f32>() + gap * r.len().saturating_sub(1) as f32
        };
        w = rows.iter().map(|r| row_w(r)).fold(0.0f32, f32::max) + 2.0 * pad;
        let mut y = pad;
        for r in &rows {
            let rh = r.iter().map(|&i| item_h(i)).fold(0.0f32, f32::max);
            let mut x = pad + (w - 2.0 * pad - row_w(r)) / 2.0;
            for &i in r {
                let kw = key_width(&entries[i]);
                let key = Rect::from_xywh(x, y, kw, rh);
                items.push((
                    key,
                    blocks[i].clone(),
                    Point::new(x + kw + entries[i].style.size * KEY_GAP, y + rh / 2.0),
                ));
                x += item_w(i) + gap;
            }
            y += rh;
        }
        h = y + pad;
    }
    let rect = match manual {
        Some(r) => Rect::from_xywh(r.x, r.y, r.w.max(w), r.h.max(h)),
        None => match pos {
            LegendPos::Right => {
                Rect::from_xywh(avail.right() - w, avail.y + (avail.h - h) / 2.0, w, h)
            }
            LegendPos::Left => Rect::from_xywh(avail.x, avail.y + (avail.h - h) / 2.0, w, h),
            LegendPos::Top => Rect::from_xywh(avail.x + (avail.w - w) / 2.0, avail.y, w, h),
            LegendPos::Bottom => {
                Rect::from_xywh(avail.x + (avail.w - w) / 2.0, avail.bottom() - h, w, h)
            }
            LegendPos::TopRight => Rect::from_xywh(avail.right() - w, avail.y, w, h),
        },
    };
    // Center the content inside a larger manual rectangle.
    let (dx, dy) = ((rect.w - w) / 2.0, (rect.h - h) / 2.0);
    let items = items
        .into_iter()
        .map(|(k, b, p)| {
            (
                Rect::from_xywh(k.x + rect.x + dx, k.y + rect.y + dy, k.w, k.h),
                b,
                Point::new(p.x + rect.x + dx, p.y + rect.y + dy),
            )
        })
        .collect();
    Some(Placed { rect, items })
}

/// Draws a placed legend.
pub(crate) fn draw(
    cv: &mut Canvas<'_>,
    m: &ChartModel,
    legend: &LegendModel,
    entries: &[Entry],
    placed: &Placed,
) {
    let fill = resolve_fill(&legend.shape, None);
    let line = resolve_line(legend.shape.line.as_ref(), None);
    cv.shape(
        &Path::rect(placed.rect),
        fill.as_ref(),
        line.as_ref(),
        placed.rect,
    );
    let _ = m;
    for (e, (key, block, text_at)) in entries.iter().zip(&placed.items) {
        draw_key(cv, e, *key);
        cv.block(
            block,
            Point::new(text_at.x + block.width / 2.0, text_at.y),
            0.0,
        );
    }
}

/// Draws an entry key inside `r` (vertically centered).
pub(crate) fn draw_key(cv: &mut Canvas<'_>, e: &Entry, r: Rect) {
    let cy = r.y + r.h / 2.0;
    match e.kind {
        KeyKind::Rect | KeyKind::Circle => {
            let s = r.w;
            let sq = Rect::from_xywh(r.x, cy - s / 2.0, s, s);
            let path = if e.kind == KeyKind::Circle {
                Path::ellipse(sq)
            } else {
                Path::rect(sq)
            };
            // Thick slice borders would swallow a small key.
            let line = e.look.line.clone().map(|mut l| {
                l.width = l.width.min(s * 0.1);
                l
            });
            cv.shape(&path, e.look.fill.as_ref(), line.as_ref(), sq);
        }
        KeyKind::Line => {
            if let Some(l) = &e.look.line {
                let mut p = Path::new();
                p.move_to(Point::new(r.x, cy));
                p.line_to(Point::new(r.right(), cy));
                let mut l = l.clone();
                l.width = l.width.min(e.style.size * 0.4);
                cv.stroke(&p, &l);
            }
            if let Some(mk) = &e.look.marker {
                let size = mk.size.min(e.style.size * 1.2);
                cv.marker(
                    mk.symbol,
                    Point::new(r.x + r.w / 2.0, cy),
                    size,
                    mk.fill.as_ref(),
                    mk.line.as_ref(),
                );
            }
        }
    }
}
