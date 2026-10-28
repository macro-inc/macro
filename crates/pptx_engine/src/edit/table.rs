//! Table edits: cell text bodies, merging and splitting cells, cell
//! formatting, styles and grid sizes, and row/column insertion and deletion,
//! keeping merged cells and the frame size consistent.
//!
//! Merged cells are written the way PowerPoint writes them: the top-left
//! (anchor) cell carries `gridSpan`/`rowSpan`; covered cells in the anchor's
//! row carry `hMerge` (and the `rowSpan`), covered cells in its column carry
//! `vMerge` (and the `gridSpan`), and the remaining covered cells both flags.

use super::ops::{BodyPatch, BorderEdges, BorderLine, CellBorders, CellRef, FillSpec};
use super::shapes::{DASHES, fill_element};
use super::text;
use super::xmlutil::{FILL_NAMES, LN_ORDER, find_shape, import_fragment, replace_fill, solid_fill};
use crate::error::{Error, Result};
use crate::units::pt_to_emu;
use crate::xml::{NodeId, Ns, XmlDoc};

/// Child order of `a:tc`.
const TC_ORDER: &[&str] = &["txBody", "tcPr", "extLst"];
/// Child order of `a:tcPr`.
const TC_PR_ORDER: &[&str] = &[
    "lnL",
    "lnR",
    "lnT",
    "lnB",
    "lnTlToBr",
    "lnBlToTr",
    "cell3D",
    "noFill",
    "solidFill",
    "gradFill",
    "blipFill",
    "pattFill",
    "grpFill",
    "headers",
    "extLst",
];
/// Child order of `a:tbl`.
const TBL_ORDER: &[&str] = &["tblPr", "tblGrid", "tr", "extLst"];
/// Child order of `a:tblPr`.
const TBL_PR_ORDER: &[&str] = &[
    "noFill",
    "solidFill",
    "gradFill",
    "blipFill",
    "pattFill",
    "grpFill",
    "effectLst",
    "effectDag",
    "tableStyleId",
    "extLst",
];
/// The attributes that describe merged cells.
const MERGE_ATTRS: [&str; 4] = ["gridSpan", "rowSpan", "hMerge", "vMerge"];
/// Cell border elements of `a:tcPr`.
const BORDERS: [&str; 6] = ["lnL", "lnR", "lnT", "lnB", "lnTlToBr", "lnBlToTr"];
/// Width of a border created without one (1 pt).
const DEFAULT_BORDER_EMU: i64 = 12_700;
/// Widest border or largest margin accepted, in points.
const MAX_POINTS: f32 = 1584.0;

/// The `a:tbl` of a graphic frame.
fn table_of(doc: &XmlDoc, frame: NodeId) -> Result<NodeId> {
    if doc.local(frame) != "graphicFrame" {
        return Err(Error::InvalidEdit("the shape is not a table".into()));
    }
    doc.path(frame, Ns::A, &["graphic", "graphicData", "tbl"])
        .ok_or_else(|| Error::InvalidEdit("the shape is not a table".into()))
}

fn rows(doc: &XmlDoc, tbl: NodeId) -> Vec<NodeId> {
    doc.children_named(tbl, Ns::A, "tr").collect()
}

fn cells(doc: &XmlDoc, tr: NodeId) -> Vec<NodeId> {
    doc.children_named(tr, Ns::A, "tc").collect()
}

fn grid_cols(doc: &XmlDoc, tbl: NodeId) -> Vec<NodeId> {
    doc.child(tbl, Ns::A, "tblGrid")
        .map(|g| doc.children_named(g, Ns::A, "gridCol").collect())
        .unwrap_or_default()
}

fn flag(doc: &XmlDoc, tc: NodeId, name: &str) -> bool {
    doc.attr_bool(tc, name).unwrap_or(false)
}

fn span(doc: &XmlDoc, tc: NodeId, name: &str) -> usize {
    doc.attr_i64(tc, name).unwrap_or(1).clamp(1, 10_000) as usize
}

/// A rectangle of grid cells: a merged cell, or a range an edit addresses.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Region {
    row: usize,
    col: usize,
    rows: usize,
    cols: usize,
}

impl Region {
    fn cell(row: usize, col: usize) -> Self {
        Self {
            row,
            col,
            rows: 1,
            cols: 1,
        }
    }

    fn end_row(&self) -> usize {
        self.row + self.rows
    }

    fn end_col(&self) -> usize {
        self.col + self.cols
    }

    fn merged(&self) -> bool {
        self.rows > 1 || self.cols > 1
    }

    fn contains(&self, row: usize, col: usize) -> bool {
        (self.row..self.end_row()).contains(&row) && (self.col..self.end_col()).contains(&col)
    }

    fn intersects(&self, o: &Region) -> bool {
        self.row < o.end_row()
            && o.row < self.end_row()
            && self.col < o.end_col()
            && o.col < self.end_col()
    }

    fn within(&self, outer: &Region) -> bool {
        self.row >= outer.row
            && self.end_row() <= outer.end_row()
            && self.col >= outer.col
            && self.end_col() <= outer.end_col()
    }

    fn union(&self, o: &Region) -> Region {
        let (row, col) = (self.row.min(o.row), self.col.min(o.col));
        Region {
            row,
            col,
            rows: self.end_row().max(o.end_row()) - row,
            cols: self.end_col().max(o.end_col()) - col,
        }
    }

    /// Grid positions in reading order.
    fn positions(self) -> impl Iterator<Item = (usize, usize)> {
        (self.row..self.end_row())
            .flat_map(move |r| (self.col..self.end_col()).map(move |c| (r, c)))
    }
}

/// A table's cells laid on its grid, with its merged cells.
struct Grid {
    /// `a:tr` elements.
    rows: Vec<NodeId>,
    /// `a:tc` elements per row (one per grid column in a well-formed table).
    tcs: Vec<Vec<NodeId>>,
    /// Number of grid columns.
    ncols: usize,
    /// Merged cells (regions of more than one grid cell).
    merges: Vec<Region>,
}

impl Grid {
    fn read(doc: &XmlDoc, tbl: NodeId) -> Grid {
        let rows = rows(doc, tbl);
        let tcs: Vec<Vec<NodeId>> = rows.iter().map(|&tr| cells(doc, tr)).collect();
        let ncols = grid_cols(doc, tbl).len();
        let nrows = rows.len();
        let mut taken = vec![vec![false; ncols]; nrows];
        let mut merges = Vec::new();
        for r in 0..nrows {
            for c in 0..ncols.min(tcs[r].len()) {
                if taken[r][c] {
                    continue;
                }
                taken[r][c] = true;
                let tc = tcs[r][c];
                // A covered cell no merge covers stands on its own.
                if flag(doc, tc, "hMerge") || flag(doc, tc, "vMerge") {
                    continue;
                }
                let want_cols = span(doc, tc, "gridSpan").min(ncols - c);
                let want_rows = span(doc, tc, "rowSpan").min(nrows - r);
                // Stop short of cells an earlier merge already covers.
                let cols = (1..want_cols)
                    .find(|&k| taken[r][c + k])
                    .unwrap_or(want_cols);
                let rows = (1..want_rows)
                    .find(|&k| (c..c + cols).any(|cc| taken[r + k][cc]))
                    .unwrap_or(want_rows);
                let region = Region {
                    row: r,
                    col: c,
                    rows,
                    cols,
                };
                if region.merged() {
                    for (rr, cc) in region.positions() {
                        taken[rr][cc] = true;
                    }
                    merges.push(region);
                }
            }
        }
        Grid {
            rows,
            tcs,
            ncols,
            merges,
        }
    }

    fn nrows(&self) -> usize {
        self.rows.len()
    }

    fn tc(&self, row: usize, col: usize) -> Option<NodeId> {
        self.tcs.get(row)?.get(col).copied()
    }

    /// The merged cell covering a grid position (itself when unmerged).
    fn region_at(&self, row: usize, col: usize) -> Region {
        self.merges
            .iter()
            .find(|m| m.contains(row, col))
            .copied()
            .unwrap_or(Region::cell(row, col))
    }

    fn check(&self, cell: CellRef) -> Result<()> {
        if cell.row >= self.nrows() || cell.col >= self.ncols.max(1) {
            return Err(Error::InvalidEdit(format!(
                "cell ({}, {}) is outside the table ({} rows × {} columns)",
                cell.row,
                cell.col,
                self.nrows(),
                self.ncols
            )));
        }
        Ok(())
    }

    /// The `a:tc` holding a cell's content: the anchor of its merged cell.
    fn anchor_tc(&self, cell: CellRef) -> Result<NodeId> {
        self.check(cell)?;
        let region = self.region_at(cell.row, cell.col);
        self.tc(region.row, region.col).ok_or_else(|| {
            Error::InvalidEdit(format!(
                "cell ({}, {}) is missing from the table",
                cell.row, cell.col
            ))
        })
    }

    /// The rectangle between two corner cells.
    fn range(&self, a: CellRef, b: CellRef) -> Result<Region> {
        self.check(a)?;
        self.check(b)?;
        let (row, col) = (a.row.min(b.row), a.col.min(b.col));
        Ok(Region {
            row,
            col,
            rows: a.row.max(b.row) - row + 1,
            cols: a.col.max(b.col) - col + 1,
        })
    }

    /// The smallest rectangle containing `r` and every merged cell it touches.
    fn widen(&self, mut r: Region) -> Region {
        loop {
            let grown = self
                .merges
                .iter()
                .filter(|m| m.intersects(&r))
                .fold(r, |acc, m| acc.union(m));
            if grown == r {
                return r;
            }
            r = grown;
        }
    }
}

/// Rewrites every cell's merge attributes to describe `merges`.
fn write_merges(doc: &mut XmlDoc, tcs: &[Vec<NodeId>], merges: &[Region]) {
    for &tc in tcs.iter().flatten() {
        for a in MERGE_ATTRS {
            doc.remove_attr(tc, a);
        }
    }
    for m in merges.iter().filter(|m| m.merged()) {
        for (r, c) in m.positions() {
            let Some(&tc) = tcs.get(r).and_then(|row| row.get(c)) else {
                continue;
            };
            let (first_row, first_col) = (r == m.row, c == m.col);
            if first_col && m.cols > 1 {
                doc.set_attr(tc, "gridSpan", &m.cols.to_string());
            }
            if first_row && m.rows > 1 {
                doc.set_attr(tc, "rowSpan", &m.rows.to_string());
            }
            if !first_col {
                doc.set_attr(tc, "hMerge", "1");
            }
            if !first_row {
                doc.set_attr(tc, "vMerge", "1");
            }
        }
    }
}

/// The cells of every row, re-read after rows or cells were added or removed.
fn all_cells(doc: &XmlDoc, tbl: NodeId) -> Vec<Vec<NodeId>> {
    rows(doc, tbl).iter().map(|&tr| cells(doc, tr)).collect()
}

/// Sizes the frame to the table's grid (columns × minimum row heights).
fn sync_frame(doc: &mut XmlDoc, frame: NodeId, tbl: NodeId) {
    let w: i64 = grid_cols(doc, tbl)
        .iter()
        .map(|&c| doc.attr_i64(c, "w").unwrap_or(0).max(0))
        .sum();
    let h: i64 = rows(doc, tbl)
        .iter()
        .map(|&r| doc.attr_i64(r, "h").unwrap_or(0).max(0))
        .sum();
    let Some(ext) = doc
        .child(frame, Ns::P, "xfrm")
        .and_then(|x| doc.child(x, Ns::A, "ext"))
    else {
        return;
    };
    doc.set_attr(ext, "cx", &w.to_string());
    doc.set_attr(ext, "cy", &h.to_string());
}

/// A cell's text body, created (with one empty paragraph) if missing.
fn ensure_body(doc: &mut XmlDoc, tc: NodeId) -> Result<NodeId> {
    let body = match doc.child(tc, Ns::A, "txBody") {
        Some(b) => b,
        None => {
            let body = import_fragment(doc, "<a:txBody><a:bodyPr/><a:lstStyle/></a:txBody>")?;
            doc.insert_in_order(tc, body, TC_ORDER);
            body
        }
    };
    if text::paragraphs(doc, body).is_empty() {
        let p = import_fragment(doc, "<a:p><a:endParaRPr lang=\"en-US\" dirty=\"0\"/></a:p>")?;
        doc.append_child(body, p);
    }
    Ok(body)
}

/// A cell's properties element, created if missing.
fn ensure_tc_pr(doc: &mut XmlDoc, tc: NodeId) -> NodeId {
    doc.ensure_child(tc, Ns::A, "tcPr", TC_ORDER)
}

fn body_is_empty(doc: &XmlDoc, body: NodeId) -> bool {
    text::paragraphs(doc, body)
        .iter()
        .all(|&p| text::para_len(doc, p) == 0)
}

/// The text body of a cell (a merged cell resolves to its anchor), created
/// with an empty paragraph if missing.
pub fn cell_body(doc: &mut XmlDoc, frame: NodeId, cell: CellRef) -> Result<NodeId> {
    let tbl = table_of(doc, frame)?;
    let tc = Grid::read(doc, tbl).anchor_tc(cell)?;
    ensure_body(doc, tc)
}

/// Empties a cell's text, keeping its formatting.
fn clear_cell(doc: &mut XmlDoc, tc: NodeId) -> Result<()> {
    if let Some(body) = doc.child(tc, Ns::A, "txBody") {
        text::set_text(doc, body, "")?;
    }
    Ok(())
}

/// Gives copied `a16:rowId` / `a16:colId` markers fresh values.
fn refresh_ids(doc: &mut XmlDoc, tbl: NodeId, copy: NodeId, local: &str) {
    let max = doc
        .descendants(tbl)
        .into_iter()
        .filter(|&n| doc.local(n) == local)
        .filter_map(|n| doc.attr_i64(n, "val"))
        .max()
        .unwrap_or(0);
    let mut next = max + 1;
    let mut nodes = vec![copy];
    nodes.extend(doc.descendants(copy));
    for n in nodes {
        if doc.local(n) == local {
            doc.set_attr(n, "val", &(next % 4_294_967_296).to_string());
            next += 1;
        }
    }
}

/// Moves a merged cell's content and formatting to the cell taking over as its anchor.
fn move_anchor(doc: &mut XmlDoc, from: NodeId, to: NodeId) {
    for name in ["txBody", "tcPr"] {
        let Some(node) = doc.child(from, Ns::A, name) else {
            continue;
        };
        doc.remove_children_named(to, Ns::A, name);
        doc.detach(node);
        doc.insert_in_order(to, node, TC_ORDER);
    }
}

/// Inserts a row at `at`, formatted like its neighbor. A merged cell the
/// new row falls inside grows over it.
pub fn insert_row(doc: &mut XmlDoc, frame: NodeId, at: usize) -> Result<()> {
    let tbl = table_of(doc, frame)?;
    let grid = Grid::read(doc, tbl);
    let n = grid.nrows();
    if at > n || n == 0 {
        return Err(Error::InvalidEdit(format!(
            "row index {at} is out of range"
        )));
    }
    let template = grid.rows[at.saturating_sub(1).min(n - 1)];
    let new = doc.deep_clone(template);
    refresh_ids(doc, tbl, new, "rowId");
    for tc in cells(doc, new) {
        clear_cell(doc, tc)?;
    }
    match grid.rows.get(at) {
        Some(&next) => doc.insert_before(next, new),
        None => doc.insert_after(grid.rows[n - 1], new),
    }
    let merges: Vec<Region> = grid
        .merges
        .iter()
        .map(|&m| {
            let mut m = m;
            if m.row < at && at < m.end_row() {
                m.rows += 1;
            } else if m.row >= at {
                m.row += 1;
            }
            m
        })
        .collect();
    write_merges(doc, &all_cells(doc, tbl), &merges);
    sync_frame(doc, frame, tbl);
    Ok(())
}

/// Deletes a row. Merged cells over it shrink; one anchored in it moves its
/// content to the next row.
pub fn delete_row(doc: &mut XmlDoc, frame: NodeId, row: usize) -> Result<()> {
    let tbl = table_of(doc, frame)?;
    let grid = Grid::read(doc, tbl);
    if row >= grid.nrows() {
        return Err(Error::InvalidEdit(format!("row {row} does not exist")));
    }
    if grid.nrows() == 1 {
        return Err(Error::InvalidEdit(
            "cannot delete the only row; delete the table instead".into(),
        ));
    }
    let mut merges = Vec::new();
    for &m in &grid.merges {
        let mut m = m;
        if m.contains(row, m.col) {
            if m.row == row
                && let (Some(from), Some(to)) = (grid.tc(row, m.col), grid.tc(row + 1, m.col))
            {
                move_anchor(doc, from, to);
            }
            m.rows -= 1;
        } else if m.row > row {
            m.row -= 1;
        }
        merges.push(m);
    }
    doc.detach(grid.rows[row]);
    write_merges(doc, &all_cells(doc, tbl), &merges);
    sync_frame(doc, frame, tbl);
    Ok(())
}

/// Inserts a column at `at`, formatted like its neighbor. A merged cell the
/// new column falls inside grows over it.
pub fn insert_column(doc: &mut XmlDoc, frame: NodeId, at: usize) -> Result<()> {
    let tbl = table_of(doc, frame)?;
    let grid = Grid::read(doc, tbl);
    let cols = grid_cols(doc, tbl);
    if at > cols.len() || cols.is_empty() {
        return Err(Error::InvalidEdit(format!(
            "column index {at} is out of range"
        )));
    }
    let template = at.saturating_sub(1).min(cols.len() - 1);
    let new_col = doc.deep_clone(cols[template]);
    refresh_ids(doc, tbl, new_col, "colId");
    match cols.get(at) {
        Some(&next) => doc.insert_before(next, new_col),
        None => doc.insert_after(cols[cols.len() - 1], new_col),
    }
    for (r, tcs) in grid.tcs.iter().enumerate() {
        let Some(&source) = tcs.get(template) else {
            continue;
        };
        let tc = doc.deep_clone(source);
        clear_cell(doc, tc)?;
        match tcs.get(at) {
            Some(&next) => doc.insert_before(next, tc),
            None => match tcs.last() {
                Some(&last) => doc.insert_after(last, tc),
                None => doc.append_child(grid.rows[r], tc),
            },
        }
    }
    let merges: Vec<Region> = grid
        .merges
        .iter()
        .map(|&m| {
            let mut m = m;
            if m.col < at && at < m.end_col() {
                m.cols += 1;
            } else if m.col >= at {
                m.col += 1;
            }
            m
        })
        .collect();
    write_merges(doc, &all_cells(doc, tbl), &merges);
    sync_frame(doc, frame, tbl);
    Ok(())
}

/// Deletes a column. Merged cells over it shrink; one anchored in it moves
/// its content to the next column.
pub fn delete_column(doc: &mut XmlDoc, frame: NodeId, col: usize) -> Result<()> {
    let tbl = table_of(doc, frame)?;
    let grid = Grid::read(doc, tbl);
    let cols = grid_cols(doc, tbl);
    if col >= cols.len() {
        return Err(Error::InvalidEdit(format!("column {col} does not exist")));
    }
    if cols.len() == 1 {
        return Err(Error::InvalidEdit(
            "cannot delete the only column; delete the table instead".into(),
        ));
    }
    let mut merges = Vec::new();
    for &m in &grid.merges {
        let mut m = m;
        if m.contains(m.row, col) {
            if m.col == col
                && let (Some(from), Some(to)) = (grid.tc(m.row, col), grid.tc(m.row, col + 1))
            {
                move_anchor(doc, from, to);
            }
            m.cols -= 1;
        } else if m.col > col {
            m.col -= 1;
        }
        merges.push(m);
    }
    for tcs in &grid.tcs {
        if let Some(&tc) = tcs.get(col) {
            doc.detach(tc);
        }
    }
    doc.detach(cols[col]);
    write_merges(doc, &all_cells(doc, tbl), &merges);
    sync_frame(doc, frame, tbl);
    Ok(())
}

/// Merges the rectangle between two cells into one cell.
pub fn merge_cells(doc: &mut XmlDoc, frame: NodeId, from: CellRef, to: CellRef) -> Result<()> {
    let tbl = table_of(doc, frame)?;
    let grid = Grid::read(doc, tbl);
    let rect = grid.range(from, to)?;
    if !rect.merged() {
        return Err(Error::InvalidEdit(
            "select at least two cells to merge".into(),
        ));
    }
    if let Some(m) = grid
        .merges
        .iter()
        .find(|m| m.intersects(&rect) && !m.within(&rect))
    {
        return Err(Error::InvalidEdit(format!(
            "the range cuts through the merged cell at ({}, {}) spanning {} rows × {} columns; include all of it or split it first",
            m.row, m.col, m.rows, m.cols
        )));
    }
    if let Some((r, c)) = rect.positions().find(|&(r, c)| grid.tc(r, c).is_none()) {
        return Err(Error::InvalidEdit(format!(
            "cell ({r}, {c}) is missing from the table"
        )));
    }
    let anchor = grid.tcs[rect.row][rect.col];
    let target = ensure_body(doc, anchor)?;
    let mut target_empty = body_is_empty(doc, target);
    // The text of every other cell (merged cells by their anchors), in reading order.
    let sources = rect.positions().filter(|&(r, c)| {
        let region = grid.region_at(r, c);
        (r, c) != (rect.row, rect.col) && (region.row, region.col) == (r, c)
    });
    for (r, c) in sources {
        let Some(body) = doc.child(grid.tcs[r][c], Ns::A, "txBody") else {
            continue;
        };
        if body_is_empty(doc, body) {
            continue;
        }
        if target_empty {
            for p in text::paragraphs(doc, target) {
                doc.detach(p);
            }
            target_empty = false;
        }
        for p in text::paragraphs(doc, body) {
            let copy = doc.deep_clone(p);
            doc.append_child(target, copy);
        }
        text::set_text(doc, body, "")?;
    }
    let mut merges: Vec<Region> = grid
        .merges
        .iter()
        .filter(|m| !m.within(&rect))
        .copied()
        .collect();
    merges.push(rect);
    write_merges(doc, &grid.tcs, &merges);
    Ok(())
}

/// Splits the merged cell covering `cell` back into grid cells.
pub fn split_cell(doc: &mut XmlDoc, frame: NodeId, cell: CellRef) -> Result<()> {
    let tbl = table_of(doc, frame)?;
    let grid = Grid::read(doc, tbl);
    grid.check(cell)?;
    let region = grid.region_at(cell.row, cell.col);
    if !region.merged() {
        return Err(Error::InvalidEdit(format!(
            "cell ({}, {}) is not merged",
            cell.row, cell.col
        )));
    }
    let anchor = grid.anchor_tc(cell)?;
    let anchor_pr = doc.child(anchor, Ns::A, "tcPr");
    for (r, c) in region.positions() {
        let Some(tc) = grid.tc(r, c) else { continue };
        if tc == anchor {
            continue;
        }
        // Revealed cells are empty and look like the merged cell, keeping
        // only the borders on its outline.
        let body = ensure_body(doc, tc)?;
        text::set_text(doc, body, "")?;
        doc.remove_children_named(tc, Ns::A, "tcPr");
        if let Some(pr) = anchor_pr {
            let copy = doc.deep_clone(pr);
            let inner = [
                ("lnL", c != region.col),
                ("lnR", c + 1 != region.end_col()),
                ("lnT", r != region.row),
                ("lnB", r + 1 != region.end_row()),
                ("lnTlToBr", true),
                ("lnBlToTr", true),
            ];
            for (name, drop) in inner {
                if drop {
                    doc.remove_children_named(copy, Ns::A, name);
                }
            }
            doc.insert_in_order(tc, copy, TC_ORDER);
        }
    }
    if let Some(pr) = anchor_pr {
        if region.cols > 1 {
            doc.remove_children_named(pr, Ns::A, "lnR");
        }
        if region.rows > 1 {
            doc.remove_children_named(pr, Ns::A, "lnB");
        }
    }
    let merges: Vec<Region> = grid
        .merges
        .iter()
        .filter(|&&m| m != region)
        .copied()
        .collect();
    write_merges(doc, &grid.tcs, &merges);
    Ok(())
}

/// Cell formatting for [`format_cells`] (`None` = unchanged).
pub struct CellFormat<'a> {
    /// Fill.
    pub fill: Option<&'a FillSpec>,
    /// Borders.
    pub borders: Option<&'a CellBorders>,
    /// `top`, `middle`, or `bottom`.
    pub anchor: Option<&'a str>,
    /// Margins `[left, top, right, bottom]` in points.
    pub margins: Option<[f32; 4]>,
}

/// The `a:tcPr/@anchor` value of a vertical alignment name.
fn anchor_value(anchor: &str) -> Result<&'static str> {
    match anchor {
        "top" => Ok("t"),
        "middle" => Ok("ctr"),
        "bottom" => Ok("b"),
        other => Err(Error::InvalidEdit(format!(
            "unknown anchor `{other}` (use top, middle, or bottom)"
        ))),
    }
}

fn check_margins(margins: [f32; 4]) -> Result<()> {
    if margins
        .iter()
        .any(|m| !m.is_finite() || !(0.0..=MAX_POINTS).contains(m))
    {
        return Err(Error::InvalidEdit(format!(
            "cell margins must be between 0 and {MAX_POINTS} pt"
        )));
    }
    Ok(())
}

fn set_margins(doc: &mut XmlDoc, pr: NodeId, margins: [f32; 4]) {
    for (name, v) in ["marL", "marT", "marR", "marB"].into_iter().zip(margins) {
        doc.set_attr(pr, name, &pt_to_emu(f64::from(v)).to_string());
    }
}

/// Formats the cells in the rectangle between two cells (widened to whole merged cells).
pub fn format_cells(
    doc: &mut XmlDoc,
    frame: NodeId,
    from: CellRef,
    to: CellRef,
    format: &CellFormat<'_>,
) -> Result<()> {
    let tbl = table_of(doc, frame)?;
    let grid = Grid::read(doc, tbl);
    let rect = grid.widen(grid.range(from, to)?);
    let anchor = format.anchor.map(anchor_value).transpose()?;
    if let Some(m) = format.margins {
        check_margins(m)?;
    }
    if let Some(b) = format.borders {
        check_line(&b.line)?;
    }
    let cell_props = format.fill.is_some() || anchor.is_some() || format.margins.is_some();
    // Covered cells get the change too, so a later split keeps it.
    let positions = rect.positions().filter(|_| cell_props);
    for tc in positions.filter_map(|(r, c)| grid.tc(r, c)) {
        let pr = ensure_tc_pr(doc, tc);
        if let Some(spec) = format.fill {
            let fill = fill_element(doc, spec)?;
            replace_fill(doc, pr, fill, TC_PR_ORDER);
        }
        if let Some(a) = anchor {
            doc.set_attr(pr, "anchor", a);
        }
        if let Some(m) = format.margins {
            set_margins(doc, pr, m);
        }
    }
    if let Some(b) = format.borders {
        set_borders(doc, &grid, rect, b)?;
    }
    Ok(())
}

fn check_line(line: &BorderLine) -> Result<()> {
    if let Some(w) = line.width
        && (!w.is_finite() || !(0.0..=MAX_POINTS).contains(&w))
    {
        return Err(Error::InvalidEdit(format!(
            "border width {w} is out of range (0-{MAX_POINTS} pt)"
        )));
    }
    if let Some(d) = &line.dash
        && !DASHES.contains(&d.as_str())
    {
        return Err(Error::InvalidEdit(format!(
            "unknown dash `{d}` (use one of {})",
            DASHES.join(", ")
        )));
    }
    Ok(())
}

/// Applies a border change to the chosen edges of `rect`. Each grid line
/// segment is the border of the cells on both sides, so both get the change.
fn set_borders(doc: &mut XmlDoc, grid: &Grid, rect: Region, b: &CellBorders) -> Result<()> {
    use BorderEdges as E;
    let e = b.edges;
    let top = matches!(e, E::All | E::Outside | E::Top);
    let bottom = matches!(e, E::All | E::Outside | E::Bottom);
    let left = matches!(e, E::All | E::Outside | E::Left);
    let right = matches!(e, E::All | E::Outside | E::Right);
    let inside_h = matches!(e, E::All | E::Inside | E::InsideHorizontal);
    let inside_v = matches!(e, E::All | E::Inside | E::InsideVertical);
    let (nrows, ncols) = (grid.nrows(), grid.ncols);
    let mut targets: Vec<(NodeId, &'static str)> = Vec::new();
    let add = |region: Region, name: &'static str, targets: &mut Vec<(NodeId, &'static str)>| {
        if let Some(tc) = grid.tc(region.row, region.col)
            && !targets.contains(&(tc, name))
        {
            targets.push((tc, name));
        }
    };
    for y in rect.row..=rect.end_row() {
        let wanted = if y == rect.row {
            top
        } else if y == rect.end_row() {
            bottom
        } else {
            inside_h
        };
        if !wanted {
            continue;
        }
        for c in rect.col..rect.end_col() {
            let above = (y > 0).then(|| grid.region_at(y - 1, c));
            let below = (y < nrows).then(|| grid.region_at(y, c));
            if above.is_some() && above == below {
                continue;
            }
            if let Some(a) = above {
                add(a, "lnB", &mut targets);
            }
            if let Some(b) = below {
                add(b, "lnT", &mut targets);
            }
        }
    }
    for x in rect.col..=rect.end_col() {
        let wanted = if x == rect.col {
            left
        } else if x == rect.end_col() {
            right
        } else {
            inside_v
        };
        if !wanted {
            continue;
        }
        for r in rect.row..rect.end_row() {
            let before = (x > 0).then(|| grid.region_at(r, x - 1));
            let after = (x < ncols).then(|| grid.region_at(r, x));
            if before.is_some() && before == after {
                continue;
            }
            if let Some(a) = before {
                add(a, "lnR", &mut targets);
            }
            if let Some(b) = after {
                add(b, "lnL", &mut targets);
            }
        }
    }
    for (tc, name) in targets {
        patch_border(doc, tc, name, &b.line)?;
    }
    Ok(())
}

/// Changes one border of a cell.
fn patch_border(doc: &mut XmlDoc, tc: NodeId, name: &str, line: &BorderLine) -> Result<()> {
    let pr = ensure_tc_pr(doc, tc);
    let created = doc.child(pr, Ns::A, name).is_none();
    let ln = doc.ensure_child(pr, Ns::A, name, TC_PR_ORDER);
    if line.none {
        let nf = doc.create_element(Ns::A, "noFill");
        replace_fill(doc, ln, nf, LN_ORDER);
        return Ok(());
    }
    let invisible = created || doc.child(ln, Ns::A, "noFill").is_some();
    match &line.color {
        Some(c) => {
            let f = solid_fill(doc, c, None)?;
            replace_fill(doc, ln, f, LN_ORDER);
        }
        None if invisible => {
            let f = solid_fill(doc, "tx1", None)?;
            replace_fill(doc, ln, f, LN_ORDER);
        }
        None => {}
    }
    match line.width {
        Some(w) => doc.set_attr(ln, "w", &pt_to_emu(f64::from(w)).to_string()),
        None if invisible && doc.attr(ln, "w").is_none() => {
            doc.set_attr(ln, "w", &DEFAULT_BORDER_EMU.to_string());
        }
        None => {}
    }
    if let Some(d) = &line.dash {
        doc.remove_children_named(ln, Ns::A, "custDash");
        let el = doc.ensure_child(ln, Ns::A, "prstDash", LN_ORDER);
        doc.set_attr(el, "val", d);
    }
    Ok(())
}

/// Text box changes for a cell: its vertical alignment and margins, which
/// live on the cell (`a:tcPr`), not on its text body.
pub fn format_cell_body(
    doc: &mut XmlDoc,
    frame: NodeId,
    cell: CellRef,
    props: &BodyPatch,
) -> Result<()> {
    if props.wrap.is_some() || props.autofit.is_some() || props.columns.is_some() {
        return Err(Error::InvalidEdit(
            "table cells always wrap their text and cannot autofit or use columns; a cell takes only `anchor`, `insets`, and `direction`".into(),
        ));
    }
    let anchor = props.anchor.as_deref().map(anchor_value).transpose()?;
    if let Some(m) = props.insets {
        check_margins(m)?;
    }
    let tbl = table_of(doc, frame)?;
    let tc = Grid::read(doc, tbl).anchor_tc(cell)?;
    let pr = ensure_tc_pr(doc, tc);
    if let Some(a) = anchor {
        doc.set_attr(pr, "anchor", a);
    }
    if let Some(m) = props.insets {
        set_margins(doc, pr, m);
    }
    if let Some(d) = props.direction {
        super::text_direction::write(doc, pr, d);
    }
    Ok(())
}

/// Which parts of a table its style emphasizes (`None` = unchanged).
#[derive(Clone, Copy, Debug, Default)]
pub struct StyleFlags {
    /// `firstRow`.
    pub first_row: Option<bool>,
    /// `lastRow`.
    pub last_row: Option<bool>,
    /// `firstCol`.
    pub first_col: Option<bool>,
    /// `lastCol`.
    pub last_col: Option<bool>,
    /// `bandRow`.
    pub band_row: Option<bool>,
    /// `bandCol`.
    pub band_col: Option<bool>,
}

/// Sets a table's style (`Some("")` removes it) and part flags. A style
/// change clears fills and borders set directly on cells.
pub fn set_style(
    doc: &mut XmlDoc,
    frame: NodeId,
    style: Option<&str>,
    flags: StyleFlags,
) -> Result<()> {
    let tbl = table_of(doc, frame)?;
    let current = crate::render::table::table_style_id(doc, tbl);
    let pr = doc.ensure_child(tbl, Ns::A, "tblPr", TBL_ORDER);
    let pairs = [
        ("firstRow", flags.first_row),
        ("lastRow", flags.last_row),
        ("firstCol", flags.first_col),
        ("lastCol", flags.last_col),
        ("bandRow", flags.band_row),
        ("bandCol", flags.band_col),
    ];
    for (name, value) in pairs {
        match value {
            Some(true) => doc.set_attr(pr, name, "1"),
            Some(false) => doc.remove_attr(pr, name),
            None => {}
        }
    }
    let Some(id) = style.map(str::trim) else {
        return Ok(());
    };
    let changed = match &current {
        Some(c) => !c.eq_ignore_ascii_case(id),
        None => !id.is_empty(),
    };
    if !changed {
        return Ok(());
    }
    if id.is_empty() {
        doc.remove_children_named(pr, Ns::A, "tableStyleId");
    } else {
        let el = doc.ensure_child(pr, Ns::A, "tableStyleId", TBL_PR_ORDER);
        doc.set_text(el, id);
    }
    clear_direct_formatting(doc, tbl);
    Ok(())
}

/// Removes fills and borders set directly on the table and its cells.
fn clear_direct_formatting(doc: &mut XmlDoc, tbl: NodeId) {
    let fills = |doc: &XmlDoc, parent: NodeId| -> Vec<NodeId> {
        doc.children(parent)
            .filter(|&c| doc.ns(c) == Ns::A && FILL_NAMES.contains(&doc.local(c)))
            .collect()
    };
    if let Some(pr) = doc.child(tbl, Ns::A, "tblPr") {
        for f in fills(doc, pr) {
            doc.detach(f);
        }
    }
    for tc in all_cells(doc, tbl).into_iter().flatten() {
        let Some(pr) = doc.child(tc, Ns::A, "tcPr") else {
            continue;
        };
        for f in fills(doc, pr) {
            doc.detach(f);
        }
        for name in BORDERS {
            doc.remove_children_named(pr, Ns::A, name);
        }
    }
}

/// Sets column widths and minimum row heights (points), resizing the frame.
pub fn set_grid(
    doc: &mut XmlDoc,
    frame: NodeId,
    widths: Option<&[f32]>,
    heights: Option<&[f32]>,
) -> Result<()> {
    let tbl = table_of(doc, frame)?;
    let check = |values: &[f32], what: &str, count: usize| -> Result<()> {
        if values.len() != count {
            return Err(Error::InvalidEdit(format!(
                "the table has {count} {what}s; give one size per {what}"
            )));
        }
        if values
            .iter()
            .any(|v| !v.is_finite() || *v <= 0.0 || *v > MAX_POINTS * 4.0)
        {
            return Err(Error::InvalidEdit(format!(
                "{what} sizes must be positive points"
            )));
        }
        Ok(())
    };
    let cols = grid_cols(doc, tbl);
    let trs = rows(doc, tbl);
    if let Some(w) = widths {
        check(w, "column", cols.len())?;
    }
    if let Some(h) = heights {
        check(h, "row", trs.len())?;
    }
    for (&col, &w) in cols.iter().zip(widths.unwrap_or_default()) {
        doc.set_attr(col, "w", &pt_to_emu(f64::from(w)).to_string());
    }
    for (&tr, &h) in trs.iter().zip(heights.unwrap_or_default()) {
        doc.set_attr(tr, "h", &pt_to_emu(f64::from(h)).to_string());
    }
    sync_frame(doc, frame, tbl);
    Ok(())
}

/// After shape `shape` was resized to `w` × `h` points, scales its columns
/// and minimum row heights to fill it, as PowerPoint does when a table's
/// frame is resized. Other shapes are left alone.
pub fn fit_frame(doc: &mut XmlDoc, shape: u32, w: Option<f32>, h: Option<f32>) -> Result<()> {
    let Some(frame) = find_shape(doc, shape) else {
        return Ok(());
    };
    let Ok(tbl) = table_of(doc, frame) else {
        return Ok(());
    };
    let scale = |nodes: &[NodeId], attr: &str, target: f32, doc: &mut XmlDoc| {
        let sizes: Vec<i64> = nodes
            .iter()
            .map(|&n| doc.attr_i64(n, attr).unwrap_or(0).max(0))
            .collect();
        let total: i64 = sizes.iter().sum();
        if total <= 0 {
            return;
        }
        let k = pt_to_emu(f64::from(target)) as f64 / total as f64;
        for (&n, s) in nodes.iter().zip(sizes) {
            doc.set_attr(n, attr, &((s as f64 * k).round() as i64).to_string());
        }
    };
    if let Some(w) = w {
        let cols = grid_cols(doc, tbl);
        scale(&cols, "w", w, doc);
    }
    if let Some(h) = h {
        let trs = rows(doc, tbl);
        scale(&trs, "h", h, doc);
    }
    sync_frame(doc, frame, tbl);
    Ok(())
}

#[cfg(test)]
mod test;
