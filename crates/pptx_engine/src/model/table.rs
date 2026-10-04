//! Tables (`a:tbl`): grid, cells, merges, and table-style resolution.

use super::color::{ColorContext, Rgba, find_color};
use super::fill::{Fill, LineProps, find_fill, parse_fill, parse_line};
use super::presentation::{PartRef, SlideContext};
use super::text::{Anchor, CellTextStyle, TextBody, Vert, resolve_cell_text};
use crate::units::emu_to_pt;
use crate::xml::{NodeId, Ns, XmlDoc};
use std::sync::Arc;

/// Which table parts are switched on (`a:tblPr` flags).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct TableFlags {
    /// Header row.
    pub first_row: bool,
    /// Total row.
    pub last_row: bool,
    /// First column.
    pub first_col: bool,
    /// Last column.
    pub last_col: bool,
    /// Banded rows.
    pub band_row: bool,
    /// Banded columns.
    pub band_col: bool,
}

/// A borders' edge.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Edge {
    /// Left.
    Left,
    /// Top.
    Top,
    /// Right.
    Right,
    /// Bottom.
    Bottom,
    /// Diagonal from top-left to bottom-right.
    TlBr,
    /// Diagonal from bottom-left to top-right.
    BlTr,
}

const EDGES: [Edge; 6] = [
    Edge::Left,
    Edge::Top,
    Edge::Right,
    Edge::Bottom,
    Edge::TlBr,
    Edge::BlTr,
];

/// One table cell with everything resolved.
#[derive(Clone, Debug)]
pub struct Cell {
    /// The `a:tc` element.
    pub node: NodeId,
    /// Row index.
    pub row: usize,
    /// Column index.
    pub col: usize,
    /// Columns spanned.
    pub grid_span: usize,
    /// Rows spanned.
    pub row_span: usize,
    /// Covered by a horizontal merge (not drawn).
    pub h_merge: bool,
    /// Covered by a vertical merge (not drawn).
    pub v_merge: bool,
    /// Fill.
    pub fill: Fill,
    /// Borders in [`EDGES`] order (`None` = no line).
    pub borders: [Option<LineProps>; 6],
    /// Left, top, right, bottom margins (points).
    pub margins: [f32; 4],
    /// Vertical anchor.
    pub anchor: Anchor,
    /// Text direction.
    pub vert: Vert,
    /// Text.
    pub text: Option<TextBody>,
}

impl Cell {
    /// The border of an edge.
    pub fn border(&self, e: Edge) -> Option<&LineProps> {
        self.borders[EDGES.iter().position(|x| *x == e).unwrap_or(0)].as_ref()
    }
}

/// A table row.
#[derive(Clone, Debug)]
pub struct Row {
    /// Minimum height (points).
    pub height: f32,
    /// Cells, one per grid column.
    pub cells: Vec<Cell>,
}

/// A resolved table.
#[derive(Clone, Debug)]
pub struct Table {
    /// Column widths (points).
    pub cols: Vec<f32>,
    /// Rows.
    pub rows: Vec<Row>,
    /// Part flags.
    pub flags: TableFlags,
    /// Table background.
    pub background: Fill,
}

#[derive(Clone, Debug, Default)]
struct StylePart {
    text: CellTextStyle,
    borders: Vec<(String, Option<LineProps>)>,
    fill: Option<Fill>,
}

/// A parsed table style.
#[derive(Clone, Debug, Default)]
pub struct TableStyle {
    parts: Vec<(String, StylePart)>,
    background: Option<Fill>,
}

fn style_part(
    doc: &XmlDoc,
    node: NodeId,
    ctx: &ColorContext<'_>,
    theme: &super::theme::Theme,
) -> StylePart {
    let mut p = StylePart::default();
    if let Some(tx) = doc.child(node, Ns::A, "tcTxStyle") {
        let on_off = |a: &str| {
            doc.attr(tx, a).and_then(|v| match v {
                "on" => Some(true),
                "off" => Some(false),
                _ => None,
            })
        };
        p.text.bold = on_off("b");
        p.text.italic = on_off("i");
        if let Some(fr) = doc.child(tx, Ns::A, "fontRef") {
            let collection = if doc.attr(fr, "idx") == Some("major") {
                &theme.major
            } else {
                &theme.minor
            };
            if !collection.latin.is_empty() {
                p.text.latin = Some(collection.latin.clone());
            }
        }
        if let Some(f) = doc.child(tx, Ns::A, "font")
            && let Some(tf) = doc
                .child(f, Ns::A, "latin")
                .and_then(|l| doc.attr(l, "typeface"))
        {
            p.text.latin = Some(theme.resolve_typeface(tf).to_owned());
        }
        p.text.color = find_color(doc, tx, ctx);
    }
    if let Some(st) = doc.child(node, Ns::A, "tcStyle") {
        if let Some(bdr) = doc.child(st, Ns::A, "tcBdr") {
            for e in doc.children(bdr) {
                let name = doc.local(e).to_owned();
                let line = if let Some(l) = doc.child(e, Ns::A, "ln") {
                    let lp = parse_line(doc, l, ctx, &|_| None);
                    Some(lp)
                } else if let Some(r) = doc.child(e, Ns::A, "lnRef") {
                    let idx = doc.attr_i64(r, "idx").unwrap_or(0).max(0) as u32;
                    let color = find_color(doc, r, ctx);
                    theme
                        .line_style(idx)
                        .map(|n| parse_line(&theme.doc, n, &ctx.with_ph(color), &|_| None))
                } else {
                    None
                };
                p.borders.push((name, line));
            }
        }
        if let Some(f) = doc.child(st, Ns::A, "fill") {
            p.fill = find_fill(doc, f, ctx, &|_| None);
        }
        if let Some(r) = doc.child(st, Ns::A, "fillRef") {
            let idx = doc.attr_i64(r, "idx").unwrap_or(0).max(0) as u32;
            let color = find_color(doc, r, ctx);
            p.fill = theme.fill_style(idx).map(|n| {
                parse_fill(&theme.doc, n, &ctx.with_ph(color), &|id| {
                    theme.target_part(id)
                })
            });
        }
    }
    p
}

impl TableStyle {
    /// Parses an `a:tblStyle` element.
    pub fn parse(
        doc: &XmlDoc,
        node: NodeId,
        ctx: &ColorContext<'_>,
        theme: &super::theme::Theme,
    ) -> Self {
        let mut s = TableStyle::default();
        for c in doc.children(node) {
            match doc.local(c) {
                "tblBg" => s.background = find_fill(doc, c, ctx, &|_| None),
                name => s
                    .parts
                    .push((name.to_owned(), style_part(doc, c, ctx, theme))),
            }
        }
        s
    }

    fn part(&self, name: &str) -> Option<&StylePart> {
        self.parts.iter().find(|(n, _)| n == name).map(|(_, p)| p)
    }
}

/// Finds the table style `id`: from `tableStyles.xml`, else a built-in definition.
pub fn find_table_style(
    ctx: &SlideContext,
    styles_part: Option<&PartRef>,
    id: &str,
) -> Option<TableStyle> {
    let colors = ctx.colors();
    if let Some(p) = styles_part {
        let doc = &p.doc;
        if let Some(n) = doc.children(doc.root()).find(|&c| {
            doc.attr(c, "styleId")
                .is_some_and(|s| s.eq_ignore_ascii_case(id))
        }) {
            return Some(TableStyle::parse(doc, n, &colors, &ctx.theme));
        }
    }
    let xml = super::table_style::builtin_style_xml(id)?;
    let doc = XmlDoc::parse(xml.as_bytes(), "builtin table style").ok()?;
    Some(TableStyle::parse(&doc, doc.root(), &colors, &ctx.theme))
}

/// The styles a deck's table styles part defines, in file order, as
/// `(style id, name)`.
pub fn deck_table_styles(styles_part: Option<&PartRef>) -> Vec<(String, String)> {
    let Some(p) = styles_part else {
        return Vec::new();
    };
    let doc = &p.doc;
    doc.children(doc.root())
        .filter(|&c| doc.local(c) == "tblStyle")
        .filter_map(|c| {
            let id = doc.attr(c, "styleId")?.trim().to_owned();
            let name = doc.attr(c, "styleName").unwrap_or_default().to_owned();
            (!id.is_empty()).then_some((id, name))
        })
        .collect()
}

/// The display name of table style `id`: PowerPoint's name for a built-in
/// style, else the name the deck's table styles part gives it.
pub fn table_style_name(styles_part: Option<&PartRef>, id: &str) -> Option<String> {
    if let Some(b) = super::table_style::builtin_style(id) {
        return Some(b.name);
    }
    deck_table_styles(styles_part)
        .into_iter()
        .find(|(s, _)| s.eq_ignore_ascii_case(id))
        .map(|(_, name)| name)
}

/// Parses and resolves a table.
pub fn resolve_table(
    ctx: &SlideContext,
    part: &PartRef,
    tbl: NodeId,
    style: Option<&TableStyle>,
) -> Table {
    let doc: &Arc<XmlDoc> = &part.doc;
    let colors = ctx.colors();
    let rels = part.rels.clone();
    let resolver = move |id: &str| rels.target_part(id);
    let tbl_pr = doc.child(tbl, Ns::A, "tblPr");
    let flag = |a: &str| tbl_pr.and_then(|p| doc.attr_bool(p, a)).unwrap_or(false);
    let flags = TableFlags {
        first_row: flag("firstRow"),
        last_row: flag("lastRow"),
        first_col: flag("firstCol"),
        last_col: flag("lastCol"),
        band_row: flag("bandRow"),
        band_col: flag("bandCol"),
    };
    let background = tbl_pr
        .and_then(|p| find_fill(doc, p, &colors, &resolver))
        .or_else(|| style.and_then(|s| s.background.clone()))
        .unwrap_or(Fill::None);
    let cols: Vec<f32> = doc
        .child(tbl, Ns::A, "tblGrid")
        .map(|g| {
            doc.children_named(g, Ns::A, "gridCol")
                .map(|c| doc.attr_f64(c, "w").map_or(0.0, emu_to_pt))
                .collect()
        })
        .unwrap_or_default();
    let tr_nodes: Vec<NodeId> = doc.children_named(tbl, Ns::A, "tr").collect();
    let (nrows, ncols) = (tr_nodes.len(), cols.len());
    let mut rows = Vec::with_capacity(nrows);
    for (r, tr) in tr_nodes.iter().enumerate() {
        let height = doc.attr_f64(*tr, "h").map_or(0.0, emu_to_pt);
        let mut cells = Vec::with_capacity(ncols);
        for (c, tc) in doc
            .children_named(*tr, Ns::A, "tc")
            .enumerate()
            .take(ncols.max(1))
        {
            let tc_pr = doc.child(tc, Ns::A, "tcPr");
            let parts = applicable_parts(flags, r, c, nrows, ncols);
            // Fill: direct, else the highest-precedence style part with a fill.
            let fill = tc_pr
                .and_then(|p| find_fill(doc, p, &colors, &resolver))
                .or_else(|| {
                    style.and_then(|s| {
                        parts
                            .iter()
                            .rev()
                            .find_map(|(n, _)| s.part(n).and_then(|p| p.fill.clone()))
                    })
                })
                .unwrap_or(Fill::None);
            let grid_span = doc.attr_i64(tc, "gridSpan").unwrap_or(1).max(1) as usize;
            let row_span = doc.attr_i64(tc, "rowSpan").unwrap_or(1).max(1) as usize;
            let end = (
                (r + row_span - 1).min(nrows.saturating_sub(1)),
                (c + grid_span - 1).min(ncols.saturating_sub(1)),
            );
            let mut borders: [Option<LineProps>; 6] = Default::default();
            for (i, e) in EDGES.iter().enumerate() {
                let direct_name = match e {
                    Edge::Left => "lnL",
                    Edge::Top => "lnT",
                    Edge::Right => "lnR",
                    Edge::Bottom => "lnB",
                    Edge::TlBr => "lnTlToBr",
                    Edge::BlTr => "lnBlToTr",
                };
                let mut line =
                    style.and_then(|s| border_for(s, flags, (r, c), end, (nrows, ncols), *e));
                if let Some(ln) = tc_pr.and_then(|p| doc.child(p, Ns::A, direct_name)) {
                    let mut direct = parse_line(doc, ln, &colors, &resolver);
                    if let Some(base) = &line {
                        direct.inherit(base);
                    }
                    line = Some(direct);
                }
                borders[i] = line;
            }
            let m = |a: &str, d: f64| {
                tc_pr
                    .and_then(|p| doc.attr_f64(p, a))
                    .map_or(emu_to_pt(d), emu_to_pt)
            };
            let margins = [
                m("marL", 91440.0),
                m("marT", 45720.0),
                m("marR", 91440.0),
                m("marB", 45720.0),
            ];
            let anchor = match tc_pr.and_then(|p| doc.attr(p, "anchor")) {
                Some("ctr") => Anchor::Middle,
                Some("b") => Anchor::Bottom,
                _ => Anchor::Top,
            };
            let vert = match tc_pr.and_then(|p| doc.attr(p, "vert")) {
                Some("vert") => Vert::Vert,
                Some("vert270") => Vert::Vert270,
                Some("eaVert") => Vert::EaVert,
                _ => Vert::Horz,
            };
            let mut text_style = CellTextStyle::default();
            if let Some(s) = style {
                for (n, _) in parts.iter().rev() {
                    if let Some(p) = s.part(n) {
                        text_style.inherit(&p.text);
                    }
                }
            }
            let text = resolve_cell_text(ctx, part, tc, &text_style, margins, anchor, vert);
            cells.push(Cell {
                node: tc,
                row: r,
                col: c,
                grid_span,
                row_span,
                h_merge: doc.attr_bool(tc, "hMerge").unwrap_or(false),
                v_merge: doc.attr_bool(tc, "vMerge").unwrap_or(false),
                fill,
                borders,
                margins,
                anchor,
                vert,
                text,
            });
        }
        rows.push(Row { height, cells });
    }
    Table {
        cols,
        rows,
        flags,
        background,
    }
}

/// A cell region: (first row, first col, last row, last col).
type Region = (usize, usize, usize, usize);

/// Style parts that apply to a cell, lowest precedence first, with each part's region.
fn applicable_parts(
    f: TableFlags,
    r: usize,
    c: usize,
    nrows: usize,
    ncols: usize,
) -> Vec<(&'static str, Region)> {
    let (lr, lc) = (nrows.saturating_sub(1), ncols.saturating_sub(1));
    let mut parts = vec![("wholeTbl", (0, 0, lr, lc))];
    let in_body_row = !(f.first_row && r == 0 || f.last_row && r == lr);
    if f.band_row && in_body_row {
        let k = if f.first_row { r - 1 } else { r };
        parts.push((if k % 2 == 0 { "band1H" } else { "band2H" }, (r, 0, r, lc)));
    }
    let in_body_col = !(f.first_col && c == 0 || f.last_col && c == lc);
    if f.band_col && in_body_col {
        let k = if f.first_col { c - 1 } else { c };
        parts.push((if k % 2 == 0 { "band1V" } else { "band2V" }, (0, c, lr, c)));
    }
    if f.last_col && c == lc {
        parts.push(("lastCol", (0, lc, lr, lc)));
    }
    if f.first_col && c == 0 {
        parts.push(("firstCol", (0, 0, lr, 0)));
    }
    if f.last_row && r == lr {
        parts.push(("lastRow", (lr, 0, lr, lc)));
    }
    if f.first_row && r == 0 {
        parts.push(("firstRow", (0, 0, 0, lc)));
    }
    let corner = |name: &'static str, rr: usize, cc: usize, parts: &mut Vec<_>| {
        if r == rr && c == cc {
            parts.push((name, (rr, cc, rr, cc)));
        }
    };
    if f.last_row && f.last_col {
        corner("seCell", lr, lc, &mut parts);
    }
    if f.last_row && f.first_col {
        corner("swCell", lr, 0, &mut parts);
    }
    if f.first_row && f.last_col {
        corner("neCell", 0, lc, &mut parts);
    }
    if f.first_row && f.first_col {
        corner("nwCell", 0, 0, &mut parts);
    }
    parts
}

/// The style border of one edge of the cell spanning `start`..=`end` (row, col):
/// the highest-precedence part defining it, using the part's outer edge when the
/// cell touches its region's boundary and its inside line otherwise.
fn border_for(
    s: &TableStyle,
    flags: TableFlags,
    start: (usize, usize),
    end: (usize, usize),
    size: (usize, usize),
    e: Edge,
) -> Option<LineProps> {
    let parts = applicable_parts(flags, start.0, start.1, size.0, size.1);
    for (name, (r0, c0, r1, c1)) in parts.iter().rev() {
        let Some(p) = s.part(name) else { continue };
        let key = match e {
            Edge::Left => {
                if start.1 <= *c0 {
                    "left"
                } else {
                    "insideV"
                }
            }
            Edge::Right => {
                if end.1 >= *c1 {
                    "right"
                } else {
                    "insideV"
                }
            }
            Edge::Top => {
                if start.0 <= *r0 {
                    "top"
                } else {
                    "insideH"
                }
            }
            Edge::Bottom => {
                if end.0 >= *r1 {
                    "bottom"
                } else {
                    "insideH"
                }
            }
            Edge::TlBr => "tl2br",
            Edge::BlTr => "tr2bl",
        };
        if let Some((_, l)) = p.borders.iter().find(|(n, _)| n == key) {
            return l.clone();
        }
    }
    None
}

/// Representative text color of a style part (for tests and inspection).
pub fn part_text_color(s: &TableStyle, part: &str) -> Option<Rgba> {
    s.part(part).and_then(|p| p.text.color)
}

#[cfg(test)]
mod test;
