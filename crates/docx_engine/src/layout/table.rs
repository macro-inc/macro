//! Table geometry: grid columns, cell properties and borders, row boxes.

use super::format::{Formats, TableCtx};
use crate::model::block::{Block, BlockKind, Story};
use crate::model::props::{Border, BordersPr, TblPr, TcPr, TrPr, VMerge, Width};
use crate::model::styles::cell_conditions;
use crate::xml::{SnippetContext, parse_int};

/// A cell's resolved geometry and formatting.
#[derive(Clone, Debug)]
pub struct CellGeom {
    /// The cell block.
    pub id: crate::model::block::BlockId,
    /// First grid column.
    pub col: usize,
    /// Grid columns spanned.
    pub span: usize,
    /// Vertical merge state.
    pub v_merge: Option<VMerge>,
    /// Merged cell properties.
    pub tc: TcPr,
    /// Margins: top, left, bottom, right.
    pub margins: [f32; 4],
    /// Background.
    pub shading: Option<pptx_engine::model::color::Rgba>,
    /// Borders: top, left, bottom, right (`None` = no border).
    pub borders: [Option<Border>; 4],
    /// Diagonal borders: top-left to bottom-right, top-right to bottom-left.
    pub diagonals: [Option<Border>; 2],
    /// Formatting context for its paragraphs.
    pub ctx: TableCtx,
}

/// A row's resolved geometry.
#[derive(Clone, Debug)]
pub struct RowGeom {
    /// The row block.
    pub id: crate::model::block::BlockId,
    /// Row properties.
    pub tr: TrPr,
    /// Cells.
    pub cells: Vec<CellGeom>,
}

/// A table's resolved geometry.
#[derive(Clone, Debug)]
pub struct TableGeom {
    /// Grid column widths (points).
    pub cols: Vec<f32>,
    /// X of the table's left edge from the container's text area left.
    pub left: f32,
    /// Merged table properties.
    pub tbl: TblPr,
    /// Rows.
    pub rows: Vec<RowGeom>,
    /// Number of repeating header rows.
    pub header_rows: usize,
}

impl TableGeom {
    /// Total grid width.
    pub fn width(&self) -> f32 {
        self.cols.iter().sum()
    }

    /// X of grid column `c`'s left edge (from the table's left edge).
    pub fn col_x(&self, c: usize) -> f32 {
        self.cols[..c.min(self.cols.len())].iter().sum()
    }
}

fn read_props<T>(
    snippets: &SnippetContext,
    xml: &str,
    local: &str,
    read: impl Fn(&crate::xml::XmlTree, crate::xml::NodeId) -> T,
) -> Option<T> {
    if xml.is_empty() {
        return None;
    }
    let (tree, kids) = snippets.parse_many(xml).ok()?;
    kids.into_iter()
        .find(|&k| tree.is_w(k, local))
        .map(|k| read(&tree, k))
}

fn grid_cols(snippets: &SnippetContext, xml: &str) -> Vec<f32> {
    let Ok((tree, kids)) = snippets.parse_many(xml) else {
        return Vec::new();
    };
    let Some(grid) = kids.into_iter().find(|&k| tree.is_w(k, "tblGrid")) else {
        return Vec::new();
    };
    tree.children_named(grid, crate::xml::Ns::W, "gridCol")
        .map(|c| {
            tree.w_attr(c, "w")
                .and_then(parse_int)
                .map_or(0.0, crate::units::twips)
        })
        .collect()
}

/// Resolves a table's geometry within a container `avail` points wide.
pub fn geometry(story: &Story, table: &Block, formats: &Formats<'_>, avail: f32) -> TableGeom {
    let snippets = formats.snippets();
    let theme = formats.theme;
    let direct = read_props(snippets, &table.props, "tblPr", |t, n| {
        TblPr::read(t, n, theme)
    })
    .unwrap_or_default();
    let style = formats.styles.table_style(direct.style.as_deref());
    let mut tbl = TblPr::default();
    if let Some(s) = style {
        tbl.apply(&s.tbl);
    }
    tbl.apply(&direct);
    tbl.style = style.map(|s| s.id.clone());
    let look = tbl.look.unwrap_or_default();
    let bidi = tbl.bidi == Some(true);
    let mut cols = grid_cols(snippets, &table.props);

    // Rows and cells.
    let row_ids: Vec<_> = story
        .children(Some(&table.id))
        .iter()
        .filter(|r| story.get(r).is_some_and(|b| b.kind == BlockKind::Row))
        .cloned()
        .collect();
    struct RawRow {
        id: crate::model::block::BlockId,
        tr: TrPr,
        cells: Vec<(crate::model::block::BlockId, TcPr)>,
    }
    let mut raw: Vec<RawRow> = Vec::new();
    for rid in &row_ids {
        let Some(row) = story.get(rid) else {
            continue;
        };
        let tr =
            read_props(snippets, &row.props, "trPr", |t, n| TrPr::read(t, n)).unwrap_or_default();
        let cells = story
            .children(Some(rid))
            .iter()
            .filter_map(|c| {
                let cell = story.get(c)?;
                (cell.kind == BlockKind::Cell).then(|| {
                    let tc = read_props(snippets, &cell.props, "tcPr", |t, n| {
                        TcPr::read(t, n, theme)
                    })
                    .unwrap_or_default();
                    (c.clone(), tc)
                })
            })
            .collect();
        raw.push(RawRow {
            id: rid.clone(),
            tr,
            cells,
        });
    }
    // The grid must cover every row.
    let needed = raw
        .iter()
        .map(|r| {
            r.tr.grid_before.unwrap_or(0) as usize
                + r.cells
                    .iter()
                    .map(|(_, tc)| tc.grid_span.unwrap_or(1) as usize)
                    .sum::<usize>()
                + r.tr.grid_after.unwrap_or(0) as usize
        })
        .max()
        .unwrap_or(0);
    let total_width = match tbl.width {
        Some(Width::Abs(w)) if w > 1.0 => Some(w),
        Some(Width::Pct(p)) if p > 0.0 => Some(avail * p),
        _ => None,
    };
    if cols.len() < needed || cols.iter().all(|w| *w <= 0.0) {
        // No usable grid: share the width (or the cells' preferred widths).
        let first = raw.first();
        let mut widths: Vec<f32> = Vec::new();
        if let Some(r) = first {
            for (_, tc) in &r.cells {
                let span = tc.grid_span.unwrap_or(1).max(1) as usize;
                let w = match tc.width {
                    Some(Width::Abs(w)) if w > 0.0 => Some(w),
                    Some(Width::Pct(p)) => Some(total_width.unwrap_or(avail) * p),
                    _ => None,
                };
                for _ in 0..span {
                    widths.push(w.map_or(0.0, |w| w / span as f32));
                }
            }
        }
        widths.resize(needed.max(1), 0.0);
        let known: f32 = widths.iter().sum();
        let unknown = widths.iter().filter(|w| **w <= 0.0).count();
        let target = total_width.unwrap_or(avail);
        if unknown > 0 {
            let each = ((target - known) / unknown as f32).max(18.0);
            for w in &mut widths {
                if *w <= 0.0 {
                    *w = each;
                }
            }
        }
        cols = widths;
    }
    // A preferred table width wider or narrower than the grid scales autofit tables.
    if let Some(target) = total_width
        && tbl.fixed != Some(true)
    {
        let sum: f32 = cols.iter().sum();
        if sum > 0.0 && (sum - target).abs() > 1.0 && target <= avail * 1.5 {
            let k = target / sum;
            for c in &mut cols {
                *c *= k;
            }
        }
    }
    let rows_count = raw.len();
    let header_rows = raw.iter().take_while(|r| r.tr.header == Some(true)).count();
    let mut rows: Vec<RowGeom> = Vec::with_capacity(raw.len());
    let band_rows = tbl.row_band.unwrap_or(1) as usize;
    let band_cols = tbl.col_band.unwrap_or(1) as usize;
    for (ri, r) in raw.iter().enumerate() {
        let mut col = r.tr.grid_before.unwrap_or(0) as usize;
        let ncells = r.cells.len();
        let mut cells = Vec::with_capacity(ncells);
        for (ci, (id, direct_tc)) in r.cells.iter().enumerate() {
            let span = direct_tc.grid_span.unwrap_or(1).max(1) as usize;
            let conds = cell_conditions(
                &look,
                ri,
                rows_count,
                ci,
                ncells,
                header_rows.max(1),
                band_rows,
                band_cols,
            );
            let ctx = TableCtx {
                style: tbl.style.clone(),
                conds,
            };
            let styled = formats.cell_style(&ctx);
            let mut tc = styled.tc.clone();
            tc.apply(direct_tc);
            // Margins: cell, then table (direct over style), then Word's defaults.
            let mut cell_tbl = TblPr::default();
            cell_tbl.apply(&styled.tbl);
            cell_tbl.apply(&direct);
            let (dt, dl, db, dr) = cell_tbl.margins();
            let mut margins = [
                tc.margins.top.unwrap_or(dt),
                tc.margins.left.unwrap_or(dl),
                tc.margins.bottom.unwrap_or(db),
                tc.margins.right.unwrap_or(dr),
            ];
            // Borders: table edges or inside lines, overridden by the cell.
            let mut tb = BordersPr::default();
            tb.apply(&styled.tbl.borders);
            tb.apply(&direct.borders);
            let first_row = ri == 0;
            let last_row = ri + 1 == rows_count;
            let first_col = col == 0;
            let last_col = col + span >= cols.len();
            let edge = |own: Option<Option<Border>>,
                        outer: Option<Option<Border>>,
                        inner: Option<Option<Border>>,
                        is_outer: bool| {
                own.unwrap_or_else(|| {
                    if is_outer {
                        outer.flatten()
                    } else {
                        inner.flatten()
                    }
                })
            };
            let mut borders = [
                edge(tc.borders.top, tb.top, tb.inside_h, first_row),
                edge(tc.borders.left, tb.left, tb.inside_v, first_col),
                edge(tc.borders.bottom, tb.bottom, tb.inside_h, last_row),
                edge(tc.borders.right, tb.right, tb.inside_v, last_col),
            ];
            if bidi {
                // Left and right mean start and end: a right-to-left table
                // starts at the right.
                borders.swap(1, 3);
                margins.swap(1, 3);
            }
            let shading = tc.shading.flatten().or_else(|| cell_tbl.shading.flatten());
            cells.push(CellGeom {
                id: id.clone(),
                col,
                span,
                v_merge: tc.v_merge,
                diagonals: [tc.borders.tl2br.flatten(), tc.borders.tr2bl.flatten()],
                tc,
                margins,
                shading,
                borders,
                ctx,
            });
            col += span;
        }
        rows.push(RowGeom {
            id: r.id.clone(),
            tr: r.tr.clone(),
            cells,
        });
    }
    // Horizontal position.
    let width: f32 = cols.iter().sum();
    let first_margin = rows
        .first()
        .and_then(|r| r.cells.first())
        .map_or(5.4, |c| c.margins[if bidi { 3 } else { 1 }]);
    let indent = tbl.ind.unwrap_or(0.0);
    let compat = formats.settings.compat_mode;
    let mut left = if compat < 15 {
        indent - first_margin
    } else {
        indent
    };
    let jc = match (tbl.jc.as_deref(), bidi) {
        (Some("start"), false) | (Some("end"), true) => Some("left"),
        (Some("start"), true) | (Some("end"), false) => Some("right"),
        (jc, _) => jc,
    };
    match jc {
        Some("center") => left = (avail - width) / 2.0,
        Some("right") => left = avail - width,
        // A right-to-left table is indented from the right.
        None if bidi => left = avail - width - left,
        _ => {}
    }
    TableGeom {
        cols,
        left,
        tbl,
        rows,
        header_rows,
    }
}
