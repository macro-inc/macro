//! Table, row and cell properties.

use super::border::{Border, read_border};
use super::color::{ThemeInfo, read_shading};
use crate::units::twips;
use crate::xml::{NodeId, Ns, XmlTree, parse_int, parse_on_off};
use pptx_engine::model::color::Rgba;

/// A table or cell width.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Width {
    /// Automatic.
    Auto,
    /// Absolute (points).
    Abs(f32),
    /// A fraction of the available width (0.5 = 50%).
    Pct(f32),
}

/// Reads a `w:tblW`/`w:tcW`-style width element.
pub fn read_width(t: &XmlTree, n: NodeId) -> Option<Width> {
    let ty = t.w_attr(n, "type").unwrap_or("dxa");
    let raw = t.w_attr(n, "w")?;
    match ty {
        "nil" => Some(Width::Abs(0.0)),
        "auto" => Some(Width::Auto),
        "pct" => {
            // Fiftieths of a percent, or a literal percentage.
            let v = if let Some(p) = raw.strip_suffix('%') {
                p.trim().parse::<f32>().ok()? / 100.0
            } else {
                parse_int(raw)? as f32 / 5000.0
            };
            Some(Width::Pct(v))
        }
        _ => parse_int(raw).map(|v| Width::Abs(twips(v))),
    }
}

/// Margins (cell margins).
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct MarginsPr {
    /// Top (points).
    pub top: Option<f32>,
    /// Left (points).
    pub left: Option<f32>,
    /// Bottom (points).
    pub bottom: Option<f32>,
    /// Right (points).
    pub right: Option<f32>,
}

impl MarginsPr {
    fn read(t: &XmlTree, n: NodeId) -> Self {
        let mut m = MarginsPr::default();
        for c in t.children(n) {
            let v = match read_width(t, c) {
                Some(Width::Abs(v)) => Some(v),
                _ => None,
            };
            match t.local(c) {
                "top" => m.top = v,
                "left" | "start" => m.left = v,
                "bottom" => m.bottom = v,
                "right" | "end" => m.right = v,
                _ => {}
            }
        }
        m
    }

    fn apply(&mut self, o: &MarginsPr) {
        if o.top.is_some() {
            self.top = o.top;
        }
        if o.left.is_some() {
            self.left = o.left;
        }
        if o.bottom.is_some() {
            self.bottom = o.bottom;
        }
        if o.right.is_some() {
            self.right = o.right;
        }
    }
}

/// Table or cell borders, as a level states them.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct BordersPr {
    /// Top.
    pub top: Option<Option<Border>>,
    /// Left.
    pub left: Option<Option<Border>>,
    /// Bottom.
    pub bottom: Option<Option<Border>>,
    /// Right.
    pub right: Option<Option<Border>>,
    /// Between rows.
    pub inside_h: Option<Option<Border>>,
    /// Between columns.
    pub inside_v: Option<Option<Border>>,
    /// Diagonal, top-left to bottom-right (cells).
    pub tl2br: Option<Option<Border>>,
    /// Diagonal, top-right to bottom-left (cells).
    pub tr2bl: Option<Option<Border>>,
}

impl BordersPr {
    fn read(t: &XmlTree, n: NodeId, theme: &ThemeInfo) -> Self {
        let mut b = BordersPr::default();
        for c in t.children(n) {
            let v = Some(read_border(t, c, theme));
            match t.local(c) {
                "top" => b.top = v,
                "left" | "start" => b.left = v,
                "bottom" => b.bottom = v,
                "right" | "end" => b.right = v,
                "insideH" => b.inside_h = v,
                "insideV" => b.inside_v = v,
                "tl2br" => b.tl2br = v,
                "tr2bl" => b.tr2bl = v,
                _ => {}
            }
        }
        b
    }

    /// Overlays a later level.
    pub fn apply(&mut self, o: &BordersPr) {
        macro_rules! set {
            ($($f:ident),*) => {$(
                if o.$f.is_some() {
                    self.$f = o.$f;
                }
            )*};
        }
        set!(top, left, bottom, right, inside_h, inside_v, tl2br, tr2bl);
    }
}

/// Floating table position (`w:tblpPr`).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct TablePosition {
    /// Distance from text, left (points).
    pub left_from_text: f32,
    /// Distance from text, right.
    pub right_from_text: f32,
    /// Distance from text, top.
    pub top_from_text: f32,
    /// Distance from text, bottom.
    pub bottom_from_text: f32,
    /// Horizontal anchor (`margin`, `page`, `text`).
    pub h_anchor: String,
    /// Vertical anchor.
    pub v_anchor: String,
    /// Horizontal alignment keyword.
    pub x_align: Option<String>,
    /// Vertical alignment keyword.
    pub y_align: Option<String>,
    /// Horizontal offset (points).
    pub x: f32,
    /// Vertical offset (points).
    pub y: f32,
}

/// Which conditional formats of the table style apply (`w:tblLook`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TableLook {
    /// Header row formatting.
    pub first_row: bool,
    /// Total row formatting.
    pub last_row: bool,
    /// First column formatting.
    pub first_col: bool,
    /// Last column formatting.
    pub last_col: bool,
    /// Row banding.
    pub h_band: bool,
    /// Column banding.
    pub v_band: bool,
}

impl Default for TableLook {
    fn default() -> Self {
        Self {
            first_row: true,
            last_row: false,
            first_col: true,
            last_col: false,
            h_band: true,
            v_band: false,
        }
    }
}

/// Table properties as one level states them.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct TblPr {
    /// Table style.
    pub style: Option<String>,
    /// Preferred width.
    pub width: Option<Width>,
    /// Alignment (`left`, `center`, `right`).
    pub jc: Option<String>,
    /// Indent from the margin (points).
    pub ind: Option<f32>,
    /// Borders.
    pub borders: BordersPr,
    /// Shading.
    pub shading: Option<Option<Rgba>>,
    /// Fixed layout.
    pub fixed: Option<bool>,
    /// Default cell margins.
    pub cell_margins: MarginsPr,
    /// Spacing between cells (points).
    pub cell_spacing: Option<f32>,
    /// Conditional format switches.
    pub look: Option<TableLook>,
    /// Floating position.
    pub position: Option<TablePosition>,
    /// Rows per band.
    pub row_band: Option<u32>,
    /// Columns per band.
    pub col_band: Option<u32>,
    /// Right-to-left table.
    pub bidi: Option<bool>,
}

impl TblPr {
    /// Reads a `w:tblPr` (or `w:tblPrEx`) element.
    pub fn read(t: &XmlTree, n: NodeId, theme: &ThemeInfo) -> Self {
        let mut p = TblPr::default();
        for c in t.children(n) {
            if t.ns(c) != Ns::W {
                continue;
            }
            match t.local(c) {
                "tblStyle" => p.style = t.val(c).map(str::to_owned),
                "tblW" => p.width = read_width(t, c),
                "jc" => p.jc = t.val(c).map(str::to_owned),
                "tblInd" => {
                    p.ind = match read_width(t, c) {
                        Some(Width::Abs(v)) => Some(v),
                        _ => Some(0.0),
                    }
                }
                "tblBorders" => p.borders = BordersPr::read(t, c, theme),
                "shd" => p.shading = Some(read_shading(t, c, theme)),
                "tblLayout" => p.fixed = Some(t.w_attr(c, "type") == Some("fixed")),
                "tblCellMar" => p.cell_margins = MarginsPr::read(t, c),
                "tblCellSpacing" => {
                    p.cell_spacing = match read_width(t, c) {
                        Some(Width::Abs(v)) => Some(v),
                        _ => None,
                    }
                }
                "tblLook" => {
                    let mut look = TableLook::default();
                    if let Some(v) = t.val(c).and_then(|v| u32::from_str_radix(v, 16).ok()) {
                        look.first_row = v & 0x20 != 0;
                        look.last_row = v & 0x40 != 0;
                        look.first_col = v & 0x80 != 0;
                        look.last_col = v & 0x100 != 0;
                        look.h_band = v & 0x200 == 0;
                        look.v_band = v & 0x400 == 0;
                    }
                    let flag = |name: &str, current: bool| {
                        t.w_attr(c, name).map_or(current, |v| parse_on_off(Some(v)))
                    };
                    look.first_row = flag("firstRow", look.first_row);
                    look.last_row = flag("lastRow", look.last_row);
                    look.first_col = flag("firstColumn", look.first_col);
                    look.last_col = flag("lastColumn", look.last_col);
                    look.h_band = !flag("noHBand", !look.h_band);
                    look.v_band = !flag("noVBand", !look.v_band);
                    p.look = Some(look);
                }
                "tblpPr" => {
                    let tw = |name: &str| t.w_attr(c, name).and_then(parse_int).map_or(0.0, twips);
                    p.position = Some(TablePosition {
                        left_from_text: tw("leftFromText"),
                        right_from_text: tw("rightFromText"),
                        top_from_text: tw("topFromText"),
                        bottom_from_text: tw("bottomFromText"),
                        h_anchor: t.w_attr(c, "horzAnchor").unwrap_or("text").to_owned(),
                        v_anchor: t.w_attr(c, "vertAnchor").unwrap_or("margin").to_owned(),
                        x_align: t.w_attr(c, "tblpXSpec").map(str::to_owned),
                        y_align: t.w_attr(c, "tblpYSpec").map(str::to_owned),
                        x: tw("tblpX"),
                        y: tw("tblpY"),
                    });
                }
                "tblStyleRowBandSize" => {
                    p.row_band = t.val(c).and_then(parse_int).map(|v| v.max(1) as u32);
                }
                "tblStyleColBandSize" => {
                    p.col_band = t.val(c).and_then(parse_int).map(|v| v.max(1) as u32);
                }
                "bidiVisual" => p.bidi = Some(parse_on_off(t.val(c))),
                _ => {}
            }
        }
        p
    }

    /// Overlays a later level.
    pub fn apply(&mut self, o: &TblPr) {
        macro_rules! set {
            ($($f:ident),*) => {$(
                if o.$f.is_some() {
                    self.$f = o.$f.clone();
                }
            )*};
        }
        set!(
            style,
            width,
            jc,
            ind,
            shading,
            fixed,
            cell_spacing,
            look,
            position,
            row_band,
            col_band,
            bidi
        );
        self.borders.apply(&o.borders);
        self.cell_margins.apply(&o.cell_margins);
    }

    /// Resolved default cell margins (Word's defaults: 0.08" left and right).
    pub fn margins(&self) -> (f32, f32, f32, f32) {
        (
            self.cell_margins.top.unwrap_or(0.0),
            self.cell_margins.left.unwrap_or(5.4),
            self.cell_margins.bottom.unwrap_or(0.0),
            self.cell_margins.right.unwrap_or(5.4),
        )
    }
}

/// Row height rule.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum HeightRule {
    /// At least the given height.
    AtLeast,
    /// Exactly the given height.
    Exact,
    /// Content height (the value is ignored).
    Auto,
}

/// Row properties.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct TrPr {
    /// Don't split the row across pages.
    pub cant_split: Option<bool>,
    /// Height and rule.
    pub height: Option<(f32, HeightRule)>,
    /// Repeat as a header row on each page.
    pub header: Option<bool>,
    /// Row alignment.
    pub jc: Option<String>,
    /// Hidden row.
    pub hidden: Option<bool>,
    /// Grid columns skipped before the first cell.
    pub grid_before: Option<u32>,
    /// Grid columns skipped after the last cell.
    pub grid_after: Option<u32>,
    /// Cell spacing override (points).
    pub cell_spacing: Option<f32>,
    /// Inserted row (tracked change).
    pub inserted: bool,
    /// Deleted row (tracked change).
    pub deleted: bool,
}

impl TrPr {
    /// Reads a `w:trPr` element.
    pub fn read(t: &XmlTree, n: NodeId) -> Self {
        let mut p = TrPr::default();
        for c in t.children(n) {
            if t.ns(c) != Ns::W {
                continue;
            }
            match t.local(c) {
                "cantSplit" => p.cant_split = Some(parse_on_off(t.val(c))),
                "trHeight" => {
                    let v = t.val(c).and_then(parse_int).map_or(0.0, twips);
                    let rule = match t.w_attr(c, "hRule") {
                        Some("exact") => HeightRule::Exact,
                        Some("auto") => HeightRule::Auto,
                        _ => HeightRule::AtLeast,
                    };
                    p.height = Some((v, rule));
                }
                "tblHeader" => p.header = Some(parse_on_off(t.val(c))),
                "jc" => p.jc = t.val(c).map(str::to_owned),
                "hidden" => p.hidden = Some(parse_on_off(t.val(c))),
                "gridBefore" => {
                    p.grid_before = t.val(c).and_then(parse_int).map(|v| v.max(0) as u32)
                }
                "gridAfter" => p.grid_after = t.val(c).and_then(parse_int).map(|v| v.max(0) as u32),
                "tblCellSpacing" => {
                    p.cell_spacing = match read_width(t, c) {
                        Some(Width::Abs(v)) => Some(v),
                        _ => None,
                    }
                }
                "ins" => p.inserted = true,
                "del" => p.deleted = true,
                _ => {}
            }
        }
        p
    }

    /// Overlays a later level.
    pub fn apply(&mut self, o: &TrPr) {
        macro_rules! set {
            ($($f:ident),*) => {$(
                if o.$f.is_some() {
                    self.$f = o.$f.clone();
                }
            )*};
        }
        set!(
            cant_split,
            height,
            header,
            jc,
            hidden,
            grid_before,
            grid_after,
            cell_spacing
        );
        self.inserted |= o.inserted;
        self.deleted |= o.deleted;
    }
}

/// Vertical merge state of a cell.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum VMerge {
    /// Starts a merged region.
    Restart,
    /// Continues the region above.
    Continue,
}

/// Cell properties.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct TcPr {
    /// Preferred width.
    pub width: Option<Width>,
    /// Grid columns spanned.
    pub grid_span: Option<u32>,
    /// Legacy horizontal merge.
    pub h_merge: Option<VMerge>,
    /// Vertical merge.
    pub v_merge: Option<VMerge>,
    /// Borders.
    pub borders: BordersPr,
    /// Shading.
    pub shading: Option<Option<Rgba>>,
    /// No wrapping.
    pub no_wrap: Option<bool>,
    /// Margins.
    pub margins: MarginsPr,
    /// Text direction (`btLr`, `tbRl`...).
    pub text_direction: Option<String>,
    /// Vertical alignment (`top`, `center`, `bottom`).
    pub v_align: Option<String>,
    /// Ignore the end-of-cell mark's height.
    pub hide_mark: Option<bool>,
}

impl TcPr {
    /// Reads a `w:tcPr` element.
    pub fn read(t: &XmlTree, n: NodeId, theme: &ThemeInfo) -> Self {
        let mut p = TcPr::default();
        for c in t.children(n) {
            if t.ns(c) != Ns::W {
                continue;
            }
            match t.local(c) {
                "tcW" => p.width = read_width(t, c),
                "gridSpan" => p.grid_span = t.val(c).and_then(parse_int).map(|v| v.max(1) as u32),
                "hMerge" => {
                    p.h_merge = Some(match t.val(c) {
                        Some("restart") => VMerge::Restart,
                        _ => VMerge::Continue,
                    })
                }
                "vMerge" => {
                    p.v_merge = Some(match t.val(c) {
                        Some("restart") => VMerge::Restart,
                        _ => VMerge::Continue,
                    })
                }
                "tcBorders" => p.borders = BordersPr::read(t, c, theme),
                "shd" => p.shading = Some(read_shading(t, c, theme)),
                "noWrap" => p.no_wrap = Some(parse_on_off(t.val(c))),
                "tcMar" => p.margins = MarginsPr::read(t, c),
                "textDirection" => p.text_direction = t.val(c).map(str::to_owned),
                "vAlign" => p.v_align = t.val(c).map(str::to_owned),
                "hideMark" => p.hide_mark = Some(parse_on_off(t.val(c))),
                _ => {}
            }
        }
        p
    }

    /// Overlays a later level.
    pub fn apply(&mut self, o: &TcPr) {
        macro_rules! set {
            ($($f:ident),*) => {$(
                if o.$f.is_some() {
                    self.$f = o.$f.clone();
                }
            )*};
        }
        set!(
            width,
            grid_span,
            h_merge,
            v_merge,
            shading,
            no_wrap,
            text_direction,
            v_align,
            hide_mark
        );
        self.borders.apply(&o.borders);
        self.margins.apply(&o.margins);
    }
}
