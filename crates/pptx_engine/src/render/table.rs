//! Table rendering (`a:tbl` in a graphic frame), and the table layout the
//! editor shares with it so cell editors and hit testing line up with the
//! drawing.

use super::build::{Builder, text_layout_nodes};
use super::paint::{fill_paint, line_stroke};
use super::scene::Node;
use super::text::{LayoutParams, TextLayout, layout};
use crate::font::FontDb;
use crate::model::presentation::{PartRef, SlideContext};
use crate::model::shape::Shape;
use crate::model::table::{Cell, Edge, Table, find_table_style, resolve_table};
use crate::model::text::TextBody;
use crate::opc::rel_type;
use crate::path::{Affine, Path, Point, Rect};
use crate::xml::{NodeId, Ns, XmlDoc};

/// A table resolved and laid out the way it is drawn.
#[derive(Clone, Debug)]
pub struct TableLayout {
    /// The resolved table.
    pub table: Table,
    /// Column boundaries from the frame's left edge (points), one more than columns.
    pub xs: Vec<f32>,
    /// Row boundaries from the frame's top edge (points), rows grown to fit their text.
    pub ys: Vec<f32>,
}

impl TableLayout {
    /// The rectangle (frame space) of `rows × cols` grid cells from `(row, col)`,
    /// clipped to the grid.
    pub fn rect(&self, row: usize, col: usize, rows: usize, cols: usize) -> Rect {
        let last_col = self.xs.len().saturating_sub(1);
        let last_row = self.ys.len().saturating_sub(1);
        let (c0, r0) = (col.min(last_col), row.min(last_row));
        let (c1, r1) = ((col + cols).min(last_col), (row + rows).min(last_row));
        Rect::from_ltrb(self.xs[c0], self.ys[r0], self.xs[c1], self.ys[r1])
    }

    /// The rectangle of a resolved cell, including the cells it spans.
    pub fn cell_rect(&self, cell: &Cell) -> Rect {
        self.rect(cell.row, cell.col, cell.row_span, cell.grid_span)
    }

    /// Row heights after rows grew to fit their text (points).
    pub fn row_heights(&self) -> Vec<f32> {
        self.ys.windows(2).map(|w| w[1] - w[0]).collect()
    }
}

/// The deck's table styles part (`ppt/tableStyles.xml`), by name.
pub fn table_styles_part(ctx: &SlideContext) -> Option<String> {
    let rels = &ctx.presentation.rels;
    rels.first_of_type(rel_type::TABLE_STYLES)
        .map(|r| rels.resolve(r))
}

/// The style id (`a:tableStyleId`) a table uses.
pub fn table_style_id(doc: &XmlDoc, tbl: NodeId) -> Option<String> {
    doc.child(tbl, Ns::A, "tblPr")
        .and_then(|p| doc.child(p, Ns::A, "tableStyleId"))
        .map(|n| doc.text(n).trim().to_owned())
        .filter(|id| !id.is_empty())
}

/// Resolves a table and lays it out as the renderer draws it. `styles` is
/// the deck's table styles part (see [`table_styles_part`]).
pub fn layout_table(
    ctx: &SlideContext,
    styles: Option<&PartRef>,
    part: &PartRef,
    tbl: NodeId,
    fonts: &FontDb,
) -> TableLayout {
    let style = table_style_id(&part.doc, tbl).and_then(|id| find_table_style(ctx, styles, &id));
    let table = resolve_table(ctx, part, tbl, style.as_ref());
    let (xs, ys) = grid_positions(fonts, &table);
    TableLayout { table, xs, ys }
}

/// Lays out a cell's text in its rectangle; the layout's origin is the
/// rectangle's top-left corner.
pub fn cell_text_layout(text: &TextBody, rect: Rect, fonts: &FontDb) -> TextLayout {
    layout(text, rect.w, rect.h, fonts, LayoutParams::from_body(text))
}

/// Resolves and lays out the table of a graphic frame.
fn resolve(b: &mut Builder<'_>, ctx: &SlideContext, s: &Shape, tbl: NodeId) -> TableLayout {
    let styles = table_styles_part(ctx).and_then(|name| b.loader.part(&name));
    layout_table(ctx, styles.as_ref(), &s.part, tbl, b.fonts)
}

/// Column and row boundary offsets (points), rows grown to fit their text.
fn grid_positions(fonts: &FontDb, t: &Table) -> (Vec<f32>, Vec<f32>) {
    let mut xs = vec![0.0f32];
    for w in &t.cols {
        xs.push(xs.last().copied().unwrap_or(0.0) + w);
    }
    let ncols = t.cols.len();
    let mut heights: Vec<f32> = t.rows.iter().map(|r| r.height).collect();
    // Single-row cells first, then spanning cells add any deficit to their last row.
    for pass in 0..2 {
        for (r, row) in t.rows.iter().enumerate() {
            for cell in &row.cells {
                if cell.h_merge || cell.v_merge || cell.col >= ncols {
                    continue;
                }
                let spans_rows = cell.row_span > 1;
                if (pass == 0) == spans_rows {
                    continue;
                }
                let Some(text) = &cell.text else { continue };
                let end_col = (cell.col + cell.grid_span).min(ncols);
                let w = xs[end_col] - xs[cell.col];
                let lay = layout(text, w, 1.0e6, fonts, LayoutParams::from_body(text));
                let lines = lay
                    .lines
                    .last()
                    .map_or(0.0, |l| l.bottom - lay.lines[0].top);
                let needed = lines + cell.margins[1] + cell.margins[3];
                let end_row = (r + cell.row_span).min(heights.len());
                let have: f32 = heights[r..end_row].iter().sum();
                if needed > have + 0.01 {
                    heights[end_row - 1] += needed - have;
                }
            }
        }
    }
    let mut ys = vec![0.0f32];
    for h in heights {
        ys.push(ys.last().copied().unwrap_or(0.0) + h);
    }
    (xs, ys)
}

/// Appends the nodes of a table.
pub fn table_nodes(
    b: &mut Builder<'_>,
    ctx: &SlideContext,
    s: &Shape,
    tbl: NodeId,
    world: &Affine,
    out: &mut Vec<Node>,
) {
    let grid = resolve(b, ctx, s, tbl);
    let table = &grid.table;
    let ncols = table.cols.len();
    let nrows = table.rows.len();
    if ncols == 0 || nrows == 0 {
        return;
    }
    let total = Rect::from_xywh(0.0, 0.0, grid.xs[ncols], grid.ys[nrows]);
    if let Some(p) = fill_paint(&table.background, total, world, b.loader) {
        out.push(Node::Fill {
            path: Path::rect(total).transform(world),
            paint: p,
            even_odd: false,
        });
    }
    let visible = || {
        table
            .rows
            .iter()
            .flat_map(|row| row.cells.iter())
            .filter(|c| !c.h_merge && !c.v_merge && c.col < ncols && c.row < nrows)
    };
    for cell in visible() {
        let rect = grid.cell_rect(cell);
        if let Some(p) = fill_paint(&cell.fill, rect, world, b.loader) {
            out.push(Node::Fill {
                path: Path::rect(rect).transform(world),
                paint: p,
                even_odd: false,
            });
        }
    }
    for cell in visible() {
        let Some(text) = &cell.text else { continue };
        if text.is_empty() {
            continue;
        }
        let rect = grid.cell_rect(cell);
        let lay = cell_text_layout(text, rect, b.fonts);
        let t = world
            .pre_concat(&Affine::translate(f64::from(rect.x), f64::from(rect.y)))
            .pre_concat(&lay.transform);
        text_layout_nodes(
            b.fonts,
            &lay,
            &t,
            Rect::from_xywh(0.0, 0.0, rect.w, rect.h),
            b.loader,
            out,
        );
    }
    // Border weights are points: scaling a group does not change them.
    let scale = 1.0;
    for cell in visible() {
        let rect = grid.cell_rect(cell);
        let edges = [
            (
                Edge::Left,
                Point::new(rect.x, rect.y),
                Point::new(rect.x, rect.bottom()),
            ),
            (
                Edge::Top,
                Point::new(rect.x, rect.y),
                Point::new(rect.right(), rect.y),
            ),
            (
                Edge::Right,
                Point::new(rect.right(), rect.y),
                Point::new(rect.right(), rect.bottom()),
            ),
            (
                Edge::Bottom,
                Point::new(rect.x, rect.bottom()),
                Point::new(rect.right(), rect.bottom()),
            ),
            (
                Edge::TlBr,
                Point::new(rect.x, rect.y),
                Point::new(rect.right(), rect.bottom()),
            ),
            (
                Edge::BlTr,
                Point::new(rect.x, rect.bottom()),
                Point::new(rect.right(), rect.y),
            ),
        ];
        for (edge, a, z) in edges {
            let Some(line) = cell.border(edge).and_then(|l| l.resolve()) else {
                continue;
            };
            let Some(paint) = fill_paint(&line.fill, rect, world, b.loader) else {
                continue;
            };
            let mut p = Path::new();
            p.move_to(a);
            p.line_to(z);
            out.push(Node::Stroke {
                path: p.transform(world),
                paint,
                stroke: line_stroke(&line, scale),
            });
        }
    }
}
