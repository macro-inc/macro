//! Tables: inserting them, and adding or removing rows and columns.

use super::Pos;
use super::text;
use super::txn::Txn;
use super::xmledit::{Element, TBLPR_ORDER, TCPR_ORDER, split_siblings};
use crate::model::block::{Block, BlockId, BlockKind};
use crate::xml::SnippetContext;

fn q(w: &str, l: &str) -> String {
    if w.is_empty() {
        l.to_owned()
    } else {
        format!("{w}:{l}")
    }
}

/// Table properties for a new table: the "Table Grid" style when the
/// document has it, single borders otherwise.
fn table_props(w: &str, grid_style: Option<&str>, cols: &[i64]) -> String {
    let mut tbl_pr = format!("<{}>", q(w, "tblPr"));
    match grid_style {
        Some(style) => tbl_pr.push_str(&format!(
            "<{} {}=\"{style}\"/>",
            q(w, "tblStyle"),
            q(w, "val")
        )),
        None => {}
    }
    tbl_pr.push_str(&format!(
        "<{} {}=\"0\" {}=\"auto\"/>",
        q(w, "tblW"),
        q(w, "w"),
        q(w, "type")
    ));
    if grid_style.is_none() {
        tbl_pr.push_str(&format!("<{}>", q(w, "tblBorders")));
        for side in ["top", "left", "bottom", "right", "insideH", "insideV"] {
            tbl_pr.push_str(&format!(
                "<{} {}=\"single\" {}=\"4\" {}=\"0\" {}=\"auto\"/>",
                q(w, side),
                q(w, "val"),
                q(w, "sz"),
                q(w, "space"),
                q(w, "color")
            ));
        }
        tbl_pr.push_str(&format!("</{}>", q(w, "tblBorders")));
    }
    tbl_pr.push_str(&format!(
        "<{} {}=\"04A0\" {}=\"1\" {}=\"0\" {}=\"1\" {}=\"0\" {}=\"0\" {}=\"1\"/>",
        q(w, "tblLook"),
        q(w, "val"),
        q(w, "firstRow"),
        q(w, "lastRow"),
        q(w, "firstColumn"),
        q(w, "lastColumn"),
        q(w, "noHBand"),
        q(w, "noVBand")
    ));
    tbl_pr.push_str(&format!("</{}>", q(w, "tblPr")));
    tbl_pr.push_str(&grid_xml(w, cols));
    tbl_pr
}

fn grid_xml(w: &str, cols: &[i64]) -> String {
    let mut s = format!("<{}>", q(w, "tblGrid"));
    for c in cols {
        s.push_str(&format!("<{} {}=\"{c}\"/>", q(w, "gridCol"), q(w, "w")));
    }
    s.push_str(&format!("</{}>", q(w, "tblGrid")));
    s
}

fn cell_props(w: &str, width: i64) -> String {
    format!(
        "<{tcPr}><{tcW} {w_a}=\"{width}\" {type_a}=\"dxa\"/></{tcPr}>",
        tcPr = q(w, "tcPr"),
        tcW = q(w, "tcW"),
        w_a = q(w, "w"),
        type_a = q(w, "type")
    )
}

/// Inserts a `rows` × `cols` table at `at` (splitting the paragraph when
/// the caret is inside it) spanning `width` twips. Returns the first cell's
/// position.
pub(super) fn insert_table(
    txn: &mut Txn<'_>,
    at: &Pos,
    rows: usize,
    cols: usize,
    width: i64,
    grid_style: Option<&str>,
) -> Option<Pos> {
    let rows = rows.clamp(1, 200);
    let cols = cols.clamp(1, 63);
    let w = txn.doc.w_prefix().to_owned();
    let p = txn.get(&at.block)?.clone();
    let len = p.content.len();
    // Where the table goes: before the paragraph at its start, after it
    // at its end, between its halves in the middle.
    let (parent, after) = if at.offset == 0 && len > 0 {
        let prev = {
            let kids = txn.story().children(p.parent.as_ref());
            let i = kids.iter().position(|k| *k == p.id)?;
            i.checked_sub(1).map(|j| kids[j].clone())
        };
        (p.parent.clone(), prev)
    } else if at.offset >= len {
        (p.parent.clone(), Some(p.id.clone()))
    } else {
        text::split(txn, at)?;
        (p.parent.clone(), Some(p.id.clone()))
    };
    let col_w = (width / cols as i64).max(200);
    let grid: Vec<i64> = vec![col_w; cols];
    let order = txn.story().key_after(parent.as_ref(), after.as_ref());
    let table_id = txn.new_id();
    let mut table = Block::new(table_id.clone(), BlockKind::Table, parent.clone(), order);
    table.props = table_props(&w, grid_style, &grid);
    txn.insert(table);
    let row_keys = crate::model::block::initial_keys(rows);
    let cell_keys = crate::model::block::initial_keys(cols);
    let mut first: Option<BlockId> = None;
    for rk in row_keys {
        let row_id = txn.new_id();
        txn.insert(Block::new(
            row_id.clone(),
            BlockKind::Row,
            Some(table_id.clone()),
            rk,
        ));
        for ck in &cell_keys {
            let cell_id = txn.new_id();
            let mut cell = Block::new(
                cell_id.clone(),
                BlockKind::Cell,
                Some(row_id.clone()),
                ck.clone(),
            );
            cell.props = cell_props(&w, col_w);
            txn.insert(cell);
            let para_id = txn.new_id();
            let key = crate::model::block::initial_keys(1).remove(0);
            txn.insert(Block::new(
                para_id.clone(),
                BlockKind::Paragraph,
                Some(cell_id),
                key,
            ));
            first.get_or_insert(para_id);
        }
    }
    // A table never ends its container: a paragraph follows it.
    let kids = txn.story().children(parent.as_ref()).to_vec();
    if kids.last() == Some(&table_id) {
        let order = txn.story().key_after(parent.as_ref(), Some(&table_id));
        let id = txn.new_id();
        txn.insert(Block::new(id, BlockKind::Paragraph, parent.clone(), order));
    }
    first.map(|b| Pos::new(b, 0))
}

/// The cell, row and table around a paragraph.
pub(super) fn enclosing(txn: &Txn<'_>, para: &BlockId) -> Option<(BlockId, BlockId, BlockId)> {
    let mut at = txn.get(para)?.parent.clone();
    while let Some(id) = at {
        let b = txn.get(&id)?;
        if b.kind == BlockKind::Cell {
            let row = b.parent.clone()?;
            let table = txn.get(&row)?.parent.clone()?;
            return Some((id, row, table));
        }
        at = b.parent.clone();
    }
    None
}

/// An empty copy of a cell (its properties without merge markers, one
/// paragraph with the first paragraph's properties).
fn empty_cell_like(txn: &mut Txn<'_>, cell: &BlockId, row: &BlockId, order: String) -> BlockId {
    let w = txn.doc.w_prefix().to_owned();
    let decls = std::sync::Arc::clone(txn.doc.decls());
    let props = txn.get(cell).map(|c| c.props.clone()).unwrap_or_default();
    let mut e = Element::open(&props, "tcPr", &w, &decls, TCPR_ORDER);
    e.set("vMerge", None);
    e.set("hMerge", None);
    let first_ppr = txn
        .story()
        .children(Some(cell))
        .iter()
        .filter_map(|k| txn.get(k))
        .find(|b| b.kind == BlockKind::Paragraph)
        .map(|b| b.props.clone())
        .unwrap_or_default();
    let id = txn.new_id();
    let mut c = Block::new(id.clone(), BlockKind::Cell, Some(row.clone()), order);
    c.props = e.finish(true);
    txn.insert(c);
    let pid = txn.new_id();
    let mut p = Block::new(
        pid,
        BlockKind::Paragraph,
        Some(id.clone()),
        crate::model::block::initial_keys(1).remove(0),
    );
    p.props = first_ppr;
    txn.insert(p);
    id
}

/// Inserts a row above or below the one holding `para`; returns its first
/// paragraph.
pub(super) fn insert_row(txn: &mut Txn<'_>, para: &BlockId, below: bool) -> Option<Pos> {
    let (_, row, table) = enclosing(txn, para)?;
    let order = if below {
        txn.story().key_after(Some(&table), Some(&row))
    } else {
        txn.story().key_before(Some(&table), &row)
    };
    let source = txn.get(&row)?.clone();
    let id = txn.new_id();
    let mut r = Block::new(id.clone(), BlockKind::Row, Some(table.clone()), order);
    r.props = source.props.clone();
    r.attrs = text::strip_ids(&source.attrs);
    txn.insert(r);
    let cells: Vec<BlockId> = txn.story().children(Some(&row)).to_vec();
    let keys = crate::model::block::initial_keys(cells.len());
    for (c, k) in cells.iter().zip(keys) {
        empty_cell_like(txn, c, &id, k);
    }
    let first_cell = txn.story().children(Some(&id)).first().cloned()?;
    let p = txn.story().children(Some(&first_cell)).first().cloned()?;
    Some(Pos::new(p, 0))
}

/// Removes the row holding `para` (the whole table when it is the last).
/// Returns where the caret goes.
pub(super) fn delete_row(txn: &mut Txn<'_>, para: &BlockId) -> Option<Pos> {
    let (_, row, table) = enclosing(txn, para)?;
    let rows: Vec<BlockId> = txn.story().children(Some(&table)).to_vec();
    if rows.len() <= 1 {
        return delete_table(txn, para);
    }
    let i = rows.iter().position(|r| *r == row)?;
    let next = rows
        .get(i + 1)
        .or_else(|| i.checked_sub(1).and_then(|j| rows.get(j)))
        .cloned()?;
    txn.remove(&row);
    let cell = txn.story().children(Some(&next)).first().cloned()?;
    let p = txn.story().children(Some(&cell)).first().cloned()?;
    Some(Pos::new(p, 0))
}

/// Removes the table holding `para`; the caret goes to the block after it.
pub(super) fn delete_table(txn: &mut Txn<'_>, para: &BlockId) -> Option<Pos> {
    let (_, _, table) = enclosing(txn, para)?;
    let parent = txn.get(&table)?.parent.clone();
    let kids: Vec<BlockId> = txn.story().children(parent.as_ref()).to_vec();
    let i = kids.iter().position(|k| *k == table)?;
    txn.remove(&table);
    // The paragraph after the table, or before it, or a new one.
    let near = kids
        .get(i + 1)
        .into_iter()
        .chain(i.checked_sub(1).and_then(|j| kids.get(j)))
        .find(|k| txn.get(k).is_some_and(|b| b.kind == BlockKind::Paragraph))
        .cloned();
    let p = match near {
        Some(p) => p,
        None => {
            let order = txn.story().key_after(parent.as_ref(), None);
            let id = txn.new_id();
            txn.insert(Block::new(id.clone(), BlockKind::Paragraph, parent, order));
            id
        }
    };
    Some(Pos::new(p, 0))
}

/// The table's grid column widths and the rest of its properties.
fn grid(txn: &Txn<'_>, table: &BlockId) -> (Vec<i64>, Vec<super::xmledit::Child>) {
    let decls = txn.doc.decls();
    let props = txn.get(table).map(|t| t.props.clone()).unwrap_or_default();
    let parts = split_siblings(&props, decls);
    let mut cols = Vec::new();
    if let Some(g) = parts.iter().find(|c| c.local() == "tblGrid")
        && let Ok(t) = SnippetContext::new(decls).parse(&g.xml)
    {
        for c in t.children(t.root()) {
            cols.push(
                t.w_attr(c, "w")
                    .and_then(crate::xml::parse_int)
                    .unwrap_or(0),
            );
        }
    }
    (cols, parts)
}

fn set_grid(txn: &mut Txn<'_>, table: &BlockId, cols: &[i64], parts: Vec<super::xmledit::Child>) {
    let w = txn.doc.w_prefix().to_owned();
    let mut out = String::new();
    let mut wrote = false;
    for p in parts {
        if p.local() == "tblGrid" {
            out.push_str(&grid_xml(&w, cols));
            wrote = true;
        } else {
            out.push_str(&p.xml);
        }
    }
    if !wrote {
        out.push_str(&grid_xml(&w, cols));
    }
    if let Some(t) = txn.block_mut(table) {
        t.props = out;
    }
}

/// Column index of a cell (counting spans).
fn column_of(txn: &Txn<'_>, row: &BlockId, cell: &BlockId) -> usize {
    let decls = txn.doc.decls();
    let mut col = 0;
    for c in txn.story().children(Some(row)) {
        if c == cell {
            return col;
        }
        let span = txn
            .get(c)
            .and_then(|b| SnippetContext::new(decls).parse(&b.props).ok())
            .and_then(|t| {
                t.w_child(t.root(), "gridSpan")
                    .and_then(|g| t.val(g))
                    .and_then(crate::xml::parse_int)
            })
            .unwrap_or(1)
            .max(1) as usize;
        col += span;
    }
    col
}

/// The cell of `row` covering grid column `col`.
fn cell_at(txn: &Txn<'_>, row: &BlockId, col: usize) -> Option<BlockId> {
    let cells: Vec<BlockId> = txn.story().children(Some(row)).to_vec();
    let mut best = None;
    for c in cells {
        if column_of(txn, row, &c) <= col {
            best = Some(c);
        }
    }
    best
}

/// Inserts a column left or right of the one holding `para`, narrowing the
/// others so the table keeps its width.
pub(super) fn insert_column(txn: &mut Txn<'_>, para: &BlockId, right: bool) -> Option<Pos> {
    let (cell, row, table) = enclosing(txn, para)?;
    let col = column_of(txn, &row, &cell);
    let (mut cols, parts) = grid(txn, &table);
    let total: i64 = cols.iter().sum();
    let new_w = cols.get(col).copied().unwrap_or(1440).max(400);
    let at = if right { col + 1 } else { col };
    cols.insert(at.min(cols.len()), new_w);
    if total > 0 {
        let sum: i64 = cols.iter().sum();
        for c in &mut cols {
            *c = (*c * total / sum).max(200);
        }
    }
    let rows: Vec<BlockId> = txn.story().children(Some(&table)).to_vec();
    let mut result = None;
    for r in rows {
        let Some(source) = cell_at(txn, &r, col) else {
            continue;
        };
        let order = if right {
            txn.story().key_after(Some(&r), Some(&source))
        } else {
            txn.story().key_before(Some(&r), &source)
        };
        let id = empty_cell_like(txn, &source, &r, order);
        if r == row {
            let p = txn.story().children(Some(&id)).first().cloned();
            result = p.map(|p| Pos::new(p, 0));
        }
    }
    resize_cells(txn, &table, &cols);
    set_grid(txn, &table, &cols, parts);
    result
}

/// Removes the column holding `para` (the table when it is the last).
pub(super) fn delete_column(txn: &mut Txn<'_>, para: &BlockId) -> Option<Pos> {
    let (cell, row, table) = enclosing(txn, para)?;
    let col = column_of(txn, &row, &cell);
    let (mut cols, parts) = grid(txn, &table);
    if cols.len() <= 1 || txn.story().children(Some(&row)).len() <= 1 {
        return delete_table(txn, para);
    }
    let removed_w = if col < cols.len() {
        cols.remove(col)
    } else {
        0
    };
    let total: i64 = cols.iter().sum();
    if total > 0 {
        for c in &mut cols {
            *c += removed_w * *c / total;
        }
    }
    let rows: Vec<BlockId> = txn.story().children(Some(&table)).to_vec();
    for r in &rows {
        if let Some(c) = cell_at(txn, r, col) {
            if txn.story().children(Some(r)).len() > 1 {
                txn.remove(&c);
            }
        }
    }
    resize_cells(txn, &table, &cols);
    set_grid(txn, &table, &cols, parts);
    let target = cell_at(txn, &row, col.saturating_sub(1))?;
    let p = txn.story().children(Some(&target)).first().cloned()?;
    Some(Pos::new(p, 0))
}

/// Sets each cell's width from the grid.
fn resize_cells(txn: &mut Txn<'_>, table: &BlockId, cols: &[i64]) {
    let w = txn.doc.w_prefix().to_owned();
    let decls = std::sync::Arc::clone(txn.doc.decls());
    let rows: Vec<BlockId> = txn.story().children(Some(table)).to_vec();
    for r in rows {
        let cells: Vec<BlockId> = txn.story().children(Some(&r)).to_vec();
        let mut col = 0;
        for c in cells {
            let props = txn.get(&c).map(|b| b.props.clone()).unwrap_or_default();
            let span = SnippetContext::new(&decls)
                .parse(&props)
                .ok()
                .and_then(|t| {
                    t.w_child(t.root(), "gridSpan")
                        .and_then(|g| t.val(g))
                        .and_then(crate::xml::parse_int)
                })
                .unwrap_or(1)
                .max(1) as usize;
            let width: i64 = cols.iter().skip(col).take(span).sum();
            col += span;
            let mut e = Element::open(&props, "tcPr", &w, &decls, TCPR_ORDER);
            e.set_attrs(
                "tcW",
                &[
                    ("w", Some(width.to_string())),
                    ("type", Some("dxa".to_owned())),
                ],
                &decls,
            );
            let xml = e.finish(false);
            if xml != props
                && let Some(b) = txn.block_mut(&c)
            {
                b.props = xml;
            }
        }
    }
    let _ = TBLPR_ORDER;
}
