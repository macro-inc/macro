//! Table rendering (`a:tbl` in a graphic frame).

use super::build::{Builder, text_layout_nodes};
use super::paint::{fill_paint, line_stroke};
use super::scene::Node;
use super::text::{LayoutParams, layout};
use crate::model::presentation::SlideContext;
use crate::model::shape::Shape;
use crate::model::table::{Edge, Table, find_table_style, resolve_table};
use crate::opc::rel_type;
use crate::path::{Affine, Path, Point, Rect};
use crate::xml::{NodeId, Ns};

/// Resolves and lays out the table of a graphic frame.
pub fn resolve(
    b: &mut Builder<'_>,
    ctx: &SlideContext,
    s: &Shape,
    tbl: NodeId,
) -> (Table, Vec<f32>, Vec<f32>) {
    let doc = &s.part.doc;
    let style_id = doc
        .child(tbl, Ns::A, "tblPr")
        .and_then(|p| doc.child(p, Ns::A, "tableStyleId"))
        .map(|n| doc.text(n).trim().to_owned());
    let styles_part = ctx
        .presentation
        .rels
        .first_of_type(rel_type::TABLE_STYLES)
        .map(|r| ctx.presentation.rels.resolve(r))
        .and_then(|name| b.loader.part(&name));
    let style = style_id.and_then(|id| find_table_style(ctx, styles_part.as_ref(), &id));
    let table = resolve_table(ctx, &s.part, tbl, style.as_ref());
    let (xs, ys) = grid_positions(b, &table);
    (table, xs, ys)
}

/// Column and row boundary offsets (points), rows grown to fit their text.
fn grid_positions(b: &Builder<'_>, t: &Table) -> (Vec<f32>, Vec<f32>) {
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
                let lay = layout(text, w, 1.0e6, b.fonts, LayoutParams::from_body(text));
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
    let (table, xs, ys) = resolve(b, ctx, s, tbl);
    let ncols = table.cols.len();
    let nrows = table.rows.len();
    if ncols == 0 || nrows == 0 {
        return;
    }
    let total = Rect::from_xywh(0.0, 0.0, xs[ncols], ys[nrows]);
    if let Some(p) = fill_paint(&table.background, total, world, b.loader) {
        out.push(Node::Fill {
            path: Path::rect(total).transform(world),
            paint: p,
            even_odd: false,
        });
    }
    let cell_rect = |r: usize, c: usize, rs: usize, cs: usize| {
        let (c1, r1) = ((c + cs).min(ncols), (r + rs).min(nrows));
        Rect::from_ltrb(xs[c], ys[r], xs[c1], ys[r1])
    };
    let visible = || {
        table
            .rows
            .iter()
            .flat_map(|row| row.cells.iter())
            .filter(|c| !c.h_merge && !c.v_merge && c.col < ncols && c.row < nrows)
    };
    for cell in visible() {
        let rect = cell_rect(cell.row, cell.col, cell.row_span, cell.grid_span);
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
        let rect = cell_rect(cell.row, cell.col, cell.row_span, cell.grid_span);
        let lay = layout(text, rect.w, rect.h, b.fonts, LayoutParams::from_body(text));
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
    let scale = world.mean_scale() as f32;
    for cell in visible() {
        let rect = cell_rect(cell.row, cell.col, cell.row_span, cell.grid_span);
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
