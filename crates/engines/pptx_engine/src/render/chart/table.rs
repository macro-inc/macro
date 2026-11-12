//! Data tables (`c:dTable`): a grid under the plot with a column per category
//! and a row of values per series, drawn in place of the category labels.

use super::canvas::{Block, Canvas, LINE_HEIGHT};
use super::legend::{Entry, KeyKind, draw_key};
use super::numfmt;
use super::plot::{Mapping, Plot};
use super::style::{Role, apply};
use crate::path::{Path, Point, Rect};
use crate::render::label::{HAlign, LabelStyle};

/// Widest series-name column, as a fraction of the chart width.
const MAX_HEAD: f32 = 0.3;
/// Most series rows shown.
const MAX_ROWS: usize = 64;

/// A laid-out data table.
#[derive(Clone, Debug)]
pub(crate) struct Table {
    /// The category axis whose labels the table replaces.
    pub axis: usize,
    /// Category headers, wrapped to the column width.
    header: Vec<Block>,
    header_h: f32,
    rows: Vec<Row>,
    row_h: f32,
    /// Width of the series-name column left of the plot.
    pub head_w: f32,
    pad: f32,
    style: LabelStyle,
}

/// One series row: its legend key, name, and a cell per category.
#[derive(Clone, Debug)]
struct Row {
    key: Option<Entry>,
    name: Block,
    cells: Vec<Option<Block>>,
}

impl Table {
    /// Height of the table below the plot.
    pub fn height(&self) -> f32 {
        self.header_h + self.row_h * self.rows.len() as f32
    }
}

impl Plot<'_> {
    /// The horizontal category axis a data table attaches to.
    pub(crate) fn table_axis(&self) -> Option<usize> {
        self.m.data_table.as_ref()?;
        self.groups.iter().map(|&(_, ca, _)| ca).find(|&ca| {
            let a = &self.axes[ca];
            matches!(a.map, Mapping::Cat { .. }) && !a.vertical && !a.model.deleted
        })
    }

    /// Lays out the data table for the current plot width.
    pub(crate) fn layout_table(&mut self, cv: &Canvas<'_>) {
        self.table = self.table_axis().and_then(|ai| self.build_table(cv, ai));
    }

    fn build_table(&self, cv: &Canvas<'_>, ai: usize) -> Option<Table> {
        let m = self.m;
        let dt = m.data_table.as_ref()?;
        let a = &self.axes[ai];
        let Mapping::Cat { count: n, .. } = a.map else {
            return None;
        };
        let style = apply(&dt.text.props, &m.base_text(Role::Other));
        let pad = style.size * 0.3;
        let line_h = style.size * LINE_HEIGHT;
        let slot = self.len(ai) / n.max(1) as f32;
        let header: Vec<Block> = a
            .cat_text
            .iter()
            .take(n)
            .map(|t| cv.plain(t, &style, (slot - 2.0 * pad).max(1.0), HAlign::Center))
            .collect();
        let header_h = header.iter().map(|b| b.height).fold(line_h, f32::max) + 2.0 * pad;
        let max_name = cv.chart.w * MAX_HEAD;
        let key_w = style.size * 0.6;
        let mut rows = Vec::new();
        for &(gi, ca, _) in &self.groups {
            if ca != ai {
                continue;
            }
            let g = &m.groups[gi];
            let kind = if g.filled() {
                KeyKind::Rect
            } else {
                KeyKind::Line
            };
            for s in &g.series {
                if rows.len() >= MAX_ROWS {
                    break;
                }
                let text = s
                    .name
                    .clone()
                    .unwrap_or_else(|| format!("Series{}", s.idx + 1));
                let fmt = s
                    .val
                    .as_ref()
                    .and_then(|v| v.format.clone())
                    .unwrap_or_else(|| "General".to_owned());
                let cells = (0..n)
                    .map(|i| {
                        s.value(i).map(|v| {
                            let text = numfmt::format(v, &fmt, m.date1904);
                            cv.plain(&text, &style, f32::INFINITY, HAlign::Center)
                        })
                    })
                    .collect();
                let key = dt.keys.then(|| Entry {
                    text: String::new(),
                    look: m.look(g, s, None),
                    kind,
                    style: style.clone(),
                });
                rows.push(Row {
                    key,
                    name: cv.plain(&text, &style, max_name, HAlign::Left),
                    cells,
                });
            }
        }
        let key_room = if dt.keys { key_w * 2.0 + pad } else { 0.0 };
        let head_w = rows
            .iter()
            .map(|r| r.name.width)
            .fold(0.0, f32::max)
            .min(max_name)
            + key_room
            + 2.0 * pad;
        let row_h = rows
            .iter()
            .flat_map(|r| {
                std::iter::once(r.name.height).chain(r.cells.iter().flatten().map(|c| c.height))
            })
            .fold(line_h, f32::max)
            + 2.0 * pad;
        Some(Table {
            axis: ai,
            header,
            header_h,
            rows,
            row_h,
            head_w,
            pad,
            style,
        })
    }

    /// Draws the data table: grid lines, headers, keys, names, and values.
    pub(crate) fn draw_table(&self, cv: &mut Canvas<'_>) {
        let (Some(t), Some(dt)) = (&self.table, &self.m.data_table) else {
            return;
        };
        let r = self.inner;
        let n = t.header.len().max(1);
        let slot = r.w / n as f32;
        let (top, head_bottom) = (r.bottom(), r.bottom() + t.header_h);
        let bottom = top + t.height();
        let left = r.x - t.head_w;
        // Grid.
        if let Some(line) = self
            .m
            .element_line(Some(&dt.shape), Some(self.m.auto_axis_line()))
        {
            let mut p = Path::new();
            let mut seg = |a: Point, b: Point| {
                p.move_to(a);
                p.line_to(b);
            };
            if dt.horz {
                for k in 0..t.rows.len() {
                    let y = head_bottom + t.row_h * k as f32;
                    let x0 = if k == 0 { r.x } else { left };
                    seg(Point::new(x0, y), Point::new(r.right(), y));
                }
            }
            if dt.vert {
                for i in 0..n {
                    let x = r.x + slot * i as f32;
                    seg(Point::new(x, top), Point::new(x, bottom));
                }
            }
            if dt.outline {
                seg(Point::new(r.x, top), Point::new(r.right(), top));
                seg(Point::new(r.right(), top), Point::new(r.right(), bottom));
                seg(Point::new(left, bottom), Point::new(r.right(), bottom));
                seg(Point::new(left, head_bottom), Point::new(left, bottom));
                seg(Point::new(left, head_bottom), Point::new(r.x, head_bottom));
                seg(Point::new(r.x, top), Point::new(r.x, head_bottom));
            }
            cv.stroke(&p, &line);
        }
        // Headers.
        for (i, b) in t.header.iter().enumerate() {
            let cx = r.x + slot * (i as f32 + 0.5);
            cv.block(b, Point::new(cx, top + t.header_h / 2.0), 0.0);
        }
        // Rows.
        let key_w = t.style.size * 0.6;
        for (k, row) in t.rows.iter().enumerate() {
            let cy = head_bottom + t.row_h * (k as f32 + 0.5);
            let mut x = left + t.pad;
            if let Some(e) = &row.key {
                let w = if e.kind == KeyKind::Line {
                    key_w * 2.0
                } else {
                    key_w
                };
                draw_key(cv, e, Rect::from_xywh(x, cy - key_w / 2.0, w, key_w));
                x += key_w * 2.0 + t.pad;
            }
            cv.block(&row.name, Point::new(x + row.name.width / 2.0, cy), 0.0);
            for (i, cell) in row.cells.iter().enumerate() {
                if let Some(b) = cell {
                    cv.block(b, Point::new(r.x + slot * (i as f32 + 0.5), cy), 0.0);
                }
            }
        }
    }
}
