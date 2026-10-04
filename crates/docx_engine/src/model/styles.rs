//! The style sheet (`word/styles.xml`) and property resolution.
//!
//! Formatting is resolved the way Word layers it: document defaults, then
//! the table style (with the conditional formats that apply to the cell),
//! then the paragraph style, numbering, the character style, and finally
//! direct formatting. Within one style's `basedOn` chain later levels
//! simply win; between style levels the toggle properties (bold, italic,
//! caps...) flip, so a bold character style in a bold heading reads normal.

use super::props::{PPr, RPr, TblPr, TcPr, TrPr};
use crate::model::props::ThemeInfo;
use crate::xml::{NodeId, Ns, XmlTree, parse_on_off};
use std::collections::HashMap;

/// What a style applies to.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StyleKind {
    /// Paragraph style.
    Paragraph,
    /// Character style.
    Character,
    /// Table style.
    Table,
    /// Numbering style.
    Numbering,
}

/// Formatting of one table-style condition (`w:tblStylePr`).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct CondFormat {
    /// Paragraph properties.
    pub ppr: PPr,
    /// Run properties.
    pub rpr: RPr,
    /// Table properties.
    pub tbl: TblPr,
    /// Row properties.
    pub tr: TrPr,
    /// Cell properties.
    pub tc: TcPr,
}

impl CondFormat {
    fn apply(&mut self, o: &CondFormat) {
        self.ppr.apply(&o.ppr);
        self.rpr.inherit(&o.rpr);
        self.tbl.apply(&o.tbl);
        self.tr.apply(&o.tr);
        self.tc.apply(&o.tc);
    }
}

/// One style definition, with its `basedOn` chain already merged in.
#[derive(Clone, Debug)]
pub struct Style {
    /// Style id.
    pub id: String,
    /// Display name.
    pub name: String,
    /// Kind.
    pub kind: StyleKind,
    /// Parent style.
    pub based_on: Option<String>,
    /// Style for the next paragraph.
    pub next: Option<String>,
    /// The default style of its kind.
    pub is_default: bool,
    /// Hidden from the user interface.
    pub hidden: bool,
    /// Shown in the quick style gallery.
    pub q_format: bool,
    /// Sort priority in the user interface.
    pub ui_priority: Option<i64>,
    /// Paragraph properties (merged chain).
    pub ppr: PPr,
    /// Run properties (merged chain).
    pub rpr: RPr,
    /// Table properties (merged chain).
    pub tbl: TblPr,
    /// Row properties (merged chain).
    pub tr: TrPr,
    /// Cell properties (merged chain).
    pub tc: TcPr,
    /// Conditional formats by type (merged chain).
    pub cond: Vec<(String, CondFormat)>,
}

/// The parsed style sheet.
#[derive(Clone, Debug, Default)]
pub struct Styles {
    /// Document default run properties.
    pub doc_rpr: RPr,
    /// Document default paragraph properties.
    pub doc_ppr: PPr,
    styles: HashMap<String, Style>,
    /// Lower-cased name → id.
    by_name: HashMap<String, String>,
    default_paragraph: Option<String>,
    default_character: Option<String>,
    default_table: Option<String>,
}

struct RawStyle {
    id: String,
    name: String,
    kind: StyleKind,
    based_on: Option<String>,
    next: Option<String>,
    is_default: bool,
    hidden: bool,
    q_format: bool,
    ui_priority: Option<i64>,
    ppr: PPr,
    rpr: RPr,
    tbl: TblPr,
    tr: TrPr,
    tc: TcPr,
    cond: Vec<(String, CondFormat)>,
}

fn read_cond(t: &XmlTree, n: NodeId, theme: &ThemeInfo) -> CondFormat {
    let mut c = CondFormat::default();
    for k in t.children(n) {
        match t.local(k) {
            "pPr" => c.ppr = PPr::read(t, k, theme),
            "rPr" => c.rpr = RPr::read(t, k, theme),
            "tblPr" => c.tbl = TblPr::read(t, k, theme),
            "trPr" => c.tr = TrPr::read(t, k),
            "tcPr" => c.tc = TcPr::read(t, k, theme),
            _ => {}
        }
    }
    c
}

impl Styles {
    /// Parses `styles.xml`.
    pub fn parse(t: &XmlTree, theme: &ThemeInfo) -> Self {
        let root = t.root();
        let mut s = Styles::default();
        if let Some(dd) = t.w_child(root, "docDefaults") {
            if let Some(rpr) = t
                .w_child(dd, "rPrDefault")
                .and_then(|r| t.w_child(r, "rPr"))
            {
                s.doc_rpr = RPr::read(t, rpr, theme);
            }
            if let Some(ppr) = t
                .w_child(dd, "pPrDefault")
                .and_then(|r| t.w_child(r, "pPr"))
            {
                s.doc_ppr = PPr::read(t, ppr, theme);
            }
        }
        let mut raw: HashMap<String, RawStyle> = HashMap::new();
        for n in t.children_named(root, Ns::W, "style") {
            let Some(id) = t.w_attr(n, "styleId") else {
                continue;
            };
            let kind = match t.w_attr(n, "type").unwrap_or("paragraph") {
                "character" => StyleKind::Character,
                "table" => StyleKind::Table,
                "numbering" => StyleKind::Numbering,
                _ => StyleKind::Paragraph,
            };
            let mut r = RawStyle {
                id: id.to_owned(),
                name: t.child_val(n, "name").unwrap_or(id).to_owned(),
                kind,
                based_on: t.child_val(n, "basedOn").map(str::to_owned),
                next: t.child_val(n, "next").map(str::to_owned),
                is_default: t
                    .w_attr(n, "default")
                    .is_some_and(|v| parse_on_off(Some(v))),
                hidden: t.w_child(n, "hidden").is_some()
                    || t.w_child(n, "semiHidden")
                        .is_some_and(|h| parse_on_off(t.val(h))),
                q_format: t.w_child(n, "qFormat").is_some(),
                ui_priority: t.child_val(n, "uiPriority").and_then(crate::xml::parse_int),
                ppr: PPr::default(),
                rpr: RPr::default(),
                tbl: TblPr::default(),
                tr: TrPr::default(),
                tc: TcPr::default(),
                cond: Vec::new(),
            };
            for c in t.children(n) {
                match t.local(c) {
                    "pPr" => r.ppr = PPr::read(t, c, theme),
                    "rPr" => r.rpr = RPr::read(t, c, theme),
                    "tblPr" => r.tbl = TblPr::read(t, c, theme),
                    "trPr" => r.tr = TrPr::read(t, c),
                    "tcPr" => r.tc = TcPr::read(t, c, theme),
                    "tblStylePr" => {
                        if let Some(ty) = t.w_attr(c, "type") {
                            r.cond.push((ty.to_owned(), read_cond(t, c, theme)));
                        }
                    }
                    _ => {}
                }
            }
            if r.is_default {
                match kind {
                    StyleKind::Paragraph => s.default_paragraph = Some(id.to_owned()),
                    StyleKind::Character => s.default_character = Some(id.to_owned()),
                    StyleKind::Table => s.default_table = Some(id.to_owned()),
                    StyleKind::Numbering => {}
                }
            }
            raw.insert(id.to_owned(), r);
        }
        // Merge each style's basedOn chain (root first), guarding cycles.
        let ids: Vec<String> = raw.keys().cloned().collect();
        for id in ids {
            let mut chain: Vec<&RawStyle> = Vec::new();
            let mut at = raw.get(&id);
            while let Some(r) = at {
                if chain.iter().any(|c| c.id == r.id) || chain.len() > 32 {
                    break;
                }
                chain.push(r);
                at = r.based_on.as_ref().and_then(|b| raw.get(b));
            }
            chain.reverse();
            let Some(own) = chain.last() else {
                continue;
            };
            let mut style = Style {
                id: own.id.clone(),
                name: own.name.clone(),
                kind: own.kind,
                based_on: own.based_on.clone(),
                next: own.next.clone(),
                is_default: own.is_default,
                hidden: own.hidden,
                q_format: own.q_format,
                ui_priority: own.ui_priority,
                ppr: PPr::default(),
                rpr: RPr::default(),
                tbl: TblPr::default(),
                tr: TrPr::default(),
                tc: TcPr::default(),
                cond: Vec::new(),
            };
            for level in &chain {
                // Styles of another kind in the chain are ignored, as Word does.
                if level.kind != own.kind {
                    continue;
                }
                style.ppr.apply(&level.ppr);
                style.rpr.inherit(&level.rpr);
                style.tbl.apply(&level.tbl);
                style.tr.apply(&level.tr);
                style.tc.apply(&level.tc);
                for (ty, c) in &level.cond {
                    match style.cond.iter_mut().find(|(t, _)| t == ty) {
                        Some((_, existing)) => existing.apply(c),
                        None => style.cond.push((ty.clone(), c.clone())),
                    }
                }
            }
            // A style's own pStyle reference is meaningless for resolution.
            style.ppr.style = None;
            style.rpr.style = None;
            s.by_name
                .insert(style.name.to_lowercase(), style.id.clone());
            s.styles.insert(style.id.clone(), style);
        }
        s
    }

    /// A style by id.
    pub fn get(&self, id: &str) -> Option<&Style> {
        self.styles.get(id)
    }

    /// A style id by display name (case-insensitive).
    pub fn id_by_name(&self, name: &str) -> Option<&str> {
        self.by_name.get(&name.to_lowercase()).map(String::as_str)
    }

    /// Every style.
    pub fn all(&self) -> impl Iterator<Item = &Style> {
        self.styles.values()
    }

    /// The paragraph style a paragraph uses (its own, or the default).
    pub fn paragraph_style(&self, id: Option<&str>) -> Option<&Style> {
        id.and_then(|i| self.styles.get(i))
            .filter(|s| s.kind == StyleKind::Paragraph)
            .or_else(|| {
                self.default_paragraph
                    .as_ref()
                    .and_then(|d| self.styles.get(d))
            })
    }

    /// The table style a table uses (its own, or the default).
    pub fn table_style(&self, id: Option<&str>) -> Option<&Style> {
        id.and_then(|i| self.styles.get(i))
            .filter(|s| s.kind == StyleKind::Table)
            .or_else(|| self.default_table.as_ref().and_then(|d| self.styles.get(d)))
    }

    /// A character style.
    pub fn character_style(&self, id: Option<&str>) -> Option<&Style> {
        id.and_then(|i| self.styles.get(i))
            .filter(|s| s.kind == StyleKind::Character)
            .or_else(|| {
                self.default_character
                    .as_ref()
                    .and_then(|d| self.styles.get(d))
            })
    }

    /// The default paragraph style id.
    pub fn default_paragraph_id(&self) -> Option<&str> {
        self.default_paragraph.as_deref()
    }
}

/// Which table-style conditions apply to a cell, in Word's precedence order
/// (later entries override earlier ones).
pub fn cell_conditions(
    look: &super::props::TableLook,
    row: usize,
    rows: usize,
    col: usize,
    cols: usize,
    header_rows: usize,
    row_band: usize,
    col_band: usize,
) -> Vec<&'static str> {
    let mut out = vec!["wholeTable"];
    let first_row = look.first_row && row < header_rows.max(1);
    let last_row = look.last_row && row + 1 == rows;
    let first_col = look.first_col && col == 0;
    let last_col = look.last_col && col + 1 == cols;
    if look.v_band && !first_col && !last_col {
        let c = col - usize::from(look.first_col);
        out.push(if (c / col_band.max(1)) % 2 == 0 {
            "band1Vert"
        } else {
            "band2Vert"
        });
    }
    if look.h_band && !first_row && !last_row {
        let skipped = if look.first_row {
            header_rows.max(1)
        } else {
            0
        };
        let r = row.saturating_sub(skipped);
        out.push(if (r / row_band.max(1)) % 2 == 0 {
            "band1Horz"
        } else {
            "band2Horz"
        });
    }
    if first_col {
        out.push("firstCol");
    }
    if last_col {
        out.push("lastCol");
    }
    if first_row {
        out.push("firstRow");
    }
    if last_row {
        out.push("lastRow");
    }
    if first_row && first_col {
        out.push("nwCell");
    }
    if first_row && last_col {
        out.push("neCell");
    }
    if last_row && first_col {
        out.push("swCell");
    }
    if last_row && last_col {
        out.push("seCell");
    }
    out
}

#[cfg(test)]
mod test;
