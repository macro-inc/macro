//! Table edits: cell text bodies and row/column insertion and deletion,
//! keeping merged cells and the frame size consistent.

use super::ops::CellRef;
use super::text;
use super::xmlutil::import_fragment;
use crate::error::{Error, Result};
use crate::xml::{Ns, NodeId, XmlDoc};

/// Child order of `a:tc`.
const TC_ORDER: &[&str] = &["txBody", "tcPr", "extLst"];

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
    doc.child(tbl, Ns::A, "tblGrid").map(|g| doc.children_named(g, Ns::A, "gridCol").collect()).unwrap_or_default()
}

fn flag(doc: &XmlDoc, tc: NodeId, name: &str) -> bool {
    doc.attr_bool(tc, name).unwrap_or(false)
}

fn span(doc: &XmlDoc, tc: NodeId, name: &str) -> i64 {
    doc.attr_i64(tc, name).unwrap_or(1).max(1)
}

fn set_span(doc: &mut XmlDoc, tc: NodeId, name: &str, value: i64) {
    if value > 1 {
        doc.set_attr(tc, name, &value.to_string());
    } else {
        doc.remove_attr(tc, name);
    }
}

/// The text body of a cell (merged cells resolve to their anchor), created if missing.
pub fn cell_body(doc: &mut XmlDoc, frame: NodeId, cell: CellRef) -> Result<NodeId> {
    let tbl = table_of(doc, frame)?;
    let all = rows(doc, tbl);
    let mut r = cell.row;
    let mut c = cell.col;
    let out_of_range = || Error::InvalidEdit(format!("cell ({}, {}) is outside the table", cell.row, cell.col));
    let mut tc = all.get(r).and_then(|tr| cells(doc, *tr).get(c).copied()).ok_or_else(out_of_range)?;
    // Walk to the anchor of a merged region.
    while flag(doc, tc, "hMerge") && c > 0 {
        c -= 1;
        tc = cells(doc, all[r])[c];
    }
    while flag(doc, tc, "vMerge") && r > 0 {
        r -= 1;
        tc = *cells(doc, all[r]).get(c).ok_or_else(out_of_range)?;
    }
    if let Some(b) = doc.child(tc, Ns::A, "txBody") {
        return Ok(b);
    }
    let body = import_fragment(doc, "<a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang=\"en-US\" dirty=\"0\"/></a:p></a:txBody>")?;
    doc.insert_in_order(tc, body, TC_ORDER);
    Ok(body)
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

/// Grows (or shrinks) the frame's extent by `dx` × `dy` EMU.
fn resize_frame(doc: &mut XmlDoc, frame: NodeId, dx: i64, dy: i64) {
    let Some(ext) = doc.path(frame, Ns::P, &["xfrm"]).and_then(|x| doc.child(x, Ns::A, "ext")) else { return };
    let cx = (doc.attr_i64(ext, "cx").unwrap_or(0) + dx).max(0);
    let cy = (doc.attr_i64(ext, "cy").unwrap_or(0) + dy).max(0);
    doc.set_attr(ext, "cx", &cx.to_string());
    doc.set_attr(ext, "cy", &cy.to_string());
}

/// Inserts a row at `at`, formatted like its neighbor.
pub fn insert_row(doc: &mut XmlDoc, frame: NodeId, at: usize) -> Result<()> {
    let tbl = table_of(doc, frame)?;
    let all = rows(doc, tbl);
    if at > all.len() || all.is_empty() {
        return Err(Error::InvalidEdit(format!("row index {at} is out of range")));
    }
    let template = all[at.saturating_sub(1).min(all.len() - 1)];
    let new = doc.deep_clone(template);
    refresh_ids(doc, tbl, new, "rowId");
    let new_cells = cells(doc, new);
    for (col, &tc) in new_cells.iter().enumerate() {
        doc.remove_attr(tc, "rowSpan");
        doc.remove_attr(tc, "vMerge");
        clear_cell(doc, tc)?;
        // A vertical merge spanning the insertion point grows over the new row.
        if at > 0 && at < all.len() {
            if let Some(anchor) = vertical_anchor(doc, &all, at, col) {
                let n = span(doc, anchor, "rowSpan");
                set_span(doc, anchor, "rowSpan", n + 1);
                doc.set_attr(tc, "vMerge", "1");
            }
        }
    }
    match all.get(at) {
        Some(&next) => doc.insert_before(next, new),
        None => doc.insert_after(all[all.len() - 1], new),
    }
    let h = doc.attr_i64(new, "h").unwrap_or(0);
    resize_frame(doc, frame, 0, h);
    Ok(())
}

/// The anchor of a vertical merge that covers both row `at - 1` and row `at` in `col`.
fn vertical_anchor(doc: &XmlDoc, all: &[NodeId], at: usize, col: usize) -> Option<NodeId> {
    let below = *cells(doc, all[at]).get(col)?;
    if !flag(doc, below, "vMerge") {
        return None;
    }
    (0..at).rev().find_map(|r| {
        let tc = *cells(doc, all[r]).get(col)?;
        (!flag(doc, tc, "vMerge")).then_some(tc)
    })
}

/// Deletes a row.
pub fn delete_row(doc: &mut XmlDoc, frame: NodeId, row: usize) -> Result<()> {
    let tbl = table_of(doc, frame)?;
    let all = rows(doc, tbl);
    if row >= all.len() {
        return Err(Error::InvalidEdit(format!("row {row} does not exist")));
    }
    if all.len() == 1 {
        return Err(Error::InvalidEdit("cannot delete the only row; delete the table instead".into()));
    }
    let tr = all[row];
    for (col, tc) in cells(doc, tr).into_iter().enumerate() {
        let row_span = span(doc, tc, "rowSpan");
        if row_span > 1 && !flag(doc, tc, "vMerge") {
            // The anchor moves down: the cell below takes over text and span.
            if let Some(below) = all.get(row + 1).and_then(|n| cells(doc, *n).get(col).copied()) {
                if let Some(body) = doc.child(tc, Ns::A, "txBody") {
                    doc.remove_children_named(below, Ns::A, "txBody");
                    doc.insert_in_order(below, body, TC_ORDER);
                }
                doc.remove_attr(below, "vMerge");
                set_span(doc, below, "rowSpan", row_span - 1);
            }
        } else if flag(doc, tc, "vMerge") {
            if let Some(anchor) = (0..row).rev().find_map(|r| {
                let a = *cells(doc, all[r]).get(col)?;
                (!flag(doc, a, "vMerge")).then_some(a)
            }) {
                let n = span(doc, anchor, "rowSpan");
                set_span(doc, anchor, "rowSpan", n - 1);
            }
        }
    }
    let h = doc.attr_i64(tr, "h").unwrap_or(0);
    doc.detach(tr);
    resize_frame(doc, frame, 0, -h);
    Ok(())
}

/// Inserts a column at `at`, formatted like its neighbor.
pub fn insert_column(doc: &mut XmlDoc, frame: NodeId, at: usize) -> Result<()> {
    let tbl = table_of(doc, frame)?;
    let cols = grid_cols(doc, tbl);
    if at > cols.len() || cols.is_empty() {
        return Err(Error::InvalidEdit(format!("column index {at} is out of range")));
    }
    let template = at.saturating_sub(1).min(cols.len() - 1);
    let new_col = doc.deep_clone(cols[template]);
    refresh_ids(doc, tbl, new_col, "colId");
    match cols.get(at) {
        Some(&next) => doc.insert_before(next, new_col),
        None => doc.insert_after(cols[cols.len() - 1], new_col),
    }
    for tr in rows(doc, tbl) {
        let tcs = cells(doc, tr);
        let Some(&source) = tcs.get(template) else { continue };
        let tc = doc.deep_clone(source);
        for a in ["gridSpan", "hMerge", "rowSpan", "vMerge"] {
            doc.remove_attr(tc, a);
        }
        clear_cell(doc, tc)?;
        // A horizontal merge spanning the insertion point grows over the new column.
        if at > 0 && at < tcs.len() && flag(doc, tcs[at], "hMerge") {
            if let Some(anchor) = (0..at).rev().map(|c| tcs[c]).find(|&c| !flag(doc, c, "hMerge")) {
                let n = span(doc, anchor, "gridSpan");
                set_span(doc, anchor, "gridSpan", n + 1);
                doc.set_attr(tc, "hMerge", "1");
            }
        }
        match tcs.get(at) {
            Some(&next) => doc.insert_before(next, tc),
            None => match tcs.last() {
                Some(&last) => doc.insert_after(last, tc),
                None => doc.append_child(tr, tc),
            },
        }
    }
    let w = doc.attr_i64(new_col, "w").unwrap_or(0);
    resize_frame(doc, frame, w, 0);
    Ok(())
}

/// Deletes a column.
pub fn delete_column(doc: &mut XmlDoc, frame: NodeId, col: usize) -> Result<()> {
    let tbl = table_of(doc, frame)?;
    let cols = grid_cols(doc, tbl);
    if col >= cols.len() {
        return Err(Error::InvalidEdit(format!("column {col} does not exist")));
    }
    if cols.len() == 1 {
        return Err(Error::InvalidEdit("cannot delete the only column; delete the table instead".into()));
    }
    for tr in rows(doc, tbl) {
        let tcs = cells(doc, tr);
        let Some(&tc) = tcs.get(col) else { continue };
        let grid_span = span(doc, tc, "gridSpan");
        if grid_span > 1 && !flag(doc, tc, "hMerge") {
            // The anchor moves right.
            if let Some(&right) = tcs.get(col + 1) {
                if let Some(body) = doc.child(tc, Ns::A, "txBody") {
                    doc.remove_children_named(right, Ns::A, "txBody");
                    doc.insert_in_order(right, body, TC_ORDER);
                }
                doc.remove_attr(right, "hMerge");
                set_span(doc, right, "gridSpan", grid_span - 1);
                for a in ["rowSpan", "vMerge"] {
                    match doc.attr(tc, a).map(str::to_owned) {
                        Some(v) => doc.set_attr(right, a, &v),
                        None => doc.remove_attr(right, a),
                    }
                }
            }
        } else if flag(doc, tc, "hMerge") {
            if let Some(anchor) = (0..col).rev().map(|c| tcs[c]).find(|&c| !flag(doc, c, "hMerge")) {
                let n = span(doc, anchor, "gridSpan");
                set_span(doc, anchor, "gridSpan", n - 1);
            }
        }
        doc.detach(tc);
    }
    let w = doc.attr_i64(cols[col], "w").unwrap_or(0);
    doc.detach(cols[col]);
    resize_frame(doc, frame, -w, 0);
    Ok(())
}
