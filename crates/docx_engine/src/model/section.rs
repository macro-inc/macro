//! Section properties (`w:sectPr`): page geometry, columns, headers and
//! footers, page and line numbering.

use super::numbering::NumFmt;
use super::props::{Border, ThemeInfo, read_border};
use crate::units::twips;
use crate::xml::{NodeId, Ns, XmlTree, parse_int, parse_on_off};

/// How a section starts.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum SectionStart {
    /// On a new page.
    #[default]
    NextPage,
    /// On the same page.
    Continuous,
    /// On the next even page.
    EvenPage,
    /// On the next odd page.
    OddPage,
    /// In the next column.
    NextColumn,
}

/// Header or footer part references by page kind (relationship ids).
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct HeaderRefs {
    /// Default (odd) pages.
    pub default: Option<String>,
    /// The first page (with a title page).
    pub first: Option<String>,
    /// Even pages (with different odd and even pages).
    pub even: Option<String>,
}

/// One column of a section.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Column {
    /// Width (points).
    pub width: f32,
    /// Space after it (points).
    pub space: f32,
}

/// Line numbering settings.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct LineNumbering {
    /// Number every n-th line.
    pub count_by: u32,
    /// First number.
    pub start: u32,
    /// Distance from the text (points; `None` = automatic).
    pub distance: Option<f32>,
    /// When numbering restarts.
    pub restart: LineNumberRestart,
}

/// When line numbering restarts.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LineNumberRestart {
    /// On each page.
    NewPage,
    /// At each section.
    NewSection,
    /// Never.
    Continuous,
}

/// Vertical alignment of text on the page.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum PageVAlign {
    /// Top.
    #[default]
    Top,
    /// Centered.
    Center,
    /// Justified.
    Both,
    /// Bottom.
    Bottom,
}

/// The document grid.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct DocGrid {
    /// Lines snap to the grid pitch.
    pub snap_lines: bool,
    /// Grid line pitch (points).
    pub line_pitch: f32,
}

/// Page borders.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct PageBorders {
    /// Top.
    pub top: Option<Border>,
    /// Left.
    pub left: Option<Border>,
    /// Bottom.
    pub bottom: Option<Border>,
    /// Right.
    pub right: Option<Border>,
    /// Offsets are measured from the page edge (else from the text).
    pub from_page_edge: bool,
}

/// One section's properties.
#[derive(Clone, Debug, PartialEq)]
pub struct Section {
    /// Page width (points).
    pub page_w: f32,
    /// Page height (points).
    pub page_h: f32,
    /// Top margin (points).
    pub top: f32,
    /// Right margin.
    pub right: f32,
    /// Bottom margin.
    pub bottom: f32,
    /// Left margin.
    pub left: f32,
    /// Header distance from the page top.
    pub header: f32,
    /// Footer distance from the page bottom.
    pub footer: f32,
    /// Gutter.
    pub gutter: f32,
    /// Whether the top margin is a minimum (positive) or exact (negative in the file).
    pub top_exact: bool,
    /// Whether the bottom margin is exact.
    pub bottom_exact: bool,
    /// Columns (one entry per column).
    pub columns: Vec<Column>,
    /// Draw a line between columns.
    pub column_separator: bool,
    /// Header references.
    pub headers: HeaderRefs,
    /// Footer references.
    pub footers: HeaderRefs,
    /// Different first page.
    pub title_page: bool,
    /// How the section starts.
    pub start: SectionStart,
    /// Page number format.
    pub page_fmt: NumFmt,
    /// Page number restart value.
    pub page_start: Option<i64>,
    /// Line numbering.
    pub line_numbers: Option<LineNumbering>,
    /// Vertical alignment.
    pub v_align: PageVAlign,
    /// Document grid.
    pub grid: DocGrid,
    /// Page borders.
    pub borders: Option<PageBorders>,
    /// Right-to-left section.
    pub bidi: bool,
}

impl Default for Section {
    /// US Letter with one-inch margins, as a new Word document has.
    fn default() -> Self {
        Self {
            page_w: 612.0,
            page_h: 792.0,
            top: 72.0,
            right: 72.0,
            bottom: 72.0,
            left: 72.0,
            header: 36.0,
            footer: 36.0,
            gutter: 0.0,
            top_exact: false,
            bottom_exact: false,
            columns: vec![Column {
                width: 468.0,
                space: 0.0,
            }],
            column_separator: false,
            headers: HeaderRefs::default(),
            footers: HeaderRefs::default(),
            title_page: false,
            start: SectionStart::NextPage,
            page_fmt: NumFmt::Decimal,
            page_start: None,
            line_numbers: None,
            v_align: PageVAlign::Top,
            grid: DocGrid::default(),
            borders: None,
            bidi: false,
        }
    }
}

impl Section {
    /// Width of the text area (points).
    pub fn text_width(&self) -> f32 {
        (self.page_w - self.left - self.right - self.gutter).max(36.0)
    }

    /// Reads a `w:sectPr` element.
    pub fn read(t: &XmlTree, n: NodeId, theme: &ThemeInfo) -> Self {
        let mut s = Section::default();
        let tw = |c: NodeId, name: &str| t.w_attr(c, name).and_then(parse_int);
        let mut cols: Option<NodeId> = None;
        for c in t.children(n) {
            if t.ns(c) != Ns::W {
                continue;
            }
            match t.local(c) {
                "pgSz" => {
                    if let Some(w) = tw(c, "w") {
                        s.page_w = twips(w).max(72.0);
                    }
                    if let Some(h) = tw(c, "h") {
                        s.page_h = twips(h).max(72.0);
                    }
                }
                "pgMar" => {
                    if let Some(v) = tw(c, "top") {
                        s.top_exact = v < 0;
                        s.top = twips(v.abs());
                    }
                    if let Some(v) = tw(c, "bottom") {
                        s.bottom_exact = v < 0;
                        s.bottom = twips(v.abs());
                    }
                    if let Some(v) = tw(c, "left").or_else(|| tw(c, "start")) {
                        s.left = twips(v);
                    }
                    if let Some(v) = tw(c, "right").or_else(|| tw(c, "end")) {
                        s.right = twips(v);
                    }
                    if let Some(v) = tw(c, "header") {
                        s.header = twips(v);
                    }
                    if let Some(v) = tw(c, "footer") {
                        s.footer = twips(v);
                    }
                    if let Some(v) = tw(c, "gutter") {
                        s.gutter = twips(v);
                    }
                }
                "cols" => cols = Some(c),
                "headerReference" | "footerReference" => {
                    let rid = t.attr(c, Ns::R, "id").map(str::to_owned);
                    let refs = if t.local(c) == "headerReference" {
                        &mut s.headers
                    } else {
                        &mut s.footers
                    };
                    match t.w_attr(c, "type").unwrap_or("default") {
                        "first" => refs.first = rid,
                        "even" => refs.even = rid,
                        _ => refs.default = rid,
                    }
                }
                "titlePg" => s.title_page = parse_on_off(t.val(c)),
                "type" => {
                    s.start = match t.val(c) {
                        Some("continuous") => SectionStart::Continuous,
                        Some("evenPage") => SectionStart::EvenPage,
                        Some("oddPage") => SectionStart::OddPage,
                        Some("nextColumn") => SectionStart::NextColumn,
                        _ => SectionStart::NextPage,
                    }
                }
                "pgNumType" => {
                    if let Some(f) = t.w_attr(c, "fmt") {
                        s.page_fmt = NumFmt::parse(f, None);
                    }
                    s.page_start = tw(c, "start");
                }
                "lnNumType" => {
                    let count_by = tw(c, "countBy").unwrap_or(0);
                    if count_by > 0 {
                        s.line_numbers = Some(LineNumbering {
                            count_by: count_by as u32,
                            start: tw(c, "start").map_or(1, |v| (v + 1).max(1) as u32),
                            distance: tw(c, "distance").map(twips),
                            restart: match t.w_attr(c, "restart") {
                                Some("continuous") => LineNumberRestart::Continuous,
                                Some("newSection") => LineNumberRestart::NewSection,
                                _ => LineNumberRestart::NewPage,
                            },
                        });
                    }
                }
                "vAlign" => {
                    s.v_align = match t.val(c) {
                        Some("center") => PageVAlign::Center,
                        Some("both") => PageVAlign::Both,
                        Some("bottom") => PageVAlign::Bottom,
                        _ => PageVAlign::Top,
                    }
                }
                "docGrid" => {
                    let ty = t.w_attr(c, "type").unwrap_or("default");
                    s.grid = DocGrid {
                        snap_lines: matches!(ty, "lines" | "linesAndChars" | "snapToChars"),
                        line_pitch: tw(c, "linePitch").map_or(0.0, twips),
                    };
                }
                "pgBorders" => {
                    let mut b = PageBorders {
                        from_page_edge: t.w_attr(c, "offsetFrom") == Some("page"),
                        ..PageBorders::default()
                    };
                    for e in t.children(c) {
                        let border = read_border(t, e, theme);
                        match t.local(e) {
                            "top" => b.top = border,
                            "left" => b.left = border,
                            "bottom" => b.bottom = border,
                            "right" => b.right = border,
                            _ => {}
                        }
                    }
                    s.borders = Some(b);
                }
                "bidi" => s.bidi = parse_on_off(t.val(c)),
                _ => {}
            }
        }
        let text_w = s.text_width();
        s.columns = match cols {
            Some(c) => {
                let num = tw(c, "num").unwrap_or(1).clamp(1, 45) as usize;
                let space = tw(c, "space").map_or(36.0, twips);
                s.column_separator = t.w_attr(c, "sep").is_some_and(|v| parse_on_off(Some(v)));
                let equal = t
                    .w_attr(c, "equalWidth")
                    .is_none_or(|v| parse_on_off(Some(v)));
                let explicit: Vec<Column> = t
                    .children_named(c, Ns::W, "col")
                    .map(|col| Column {
                        width: tw(col, "w").map_or(0.0, twips),
                        space: tw(col, "space").map_or(0.0, twips),
                    })
                    .collect();
                if !equal && explicit.len() > 1 {
                    explicit
                } else if num > 1 {
                    let w = ((text_w - space * (num - 1) as f32) / num as f32).max(18.0);
                    (0..num)
                        .map(|i| Column {
                            width: w,
                            space: if i + 1 < num { space } else { 0.0 },
                        })
                        .collect()
                } else {
                    vec![Column {
                        width: text_w,
                        space: 0.0,
                    }]
                }
            }
            None => vec![Column {
                width: text_w,
                space: 0.0,
            }],
        };
        s
    }
}
