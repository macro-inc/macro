//! Paragraph properties.

use super::border::{Border, read_border};
use super::color::{ThemeInfo, read_shading};
use super::run::RPr;
use crate::units::twips;
use crate::xml::{NodeId, Ns, XmlTree, parse_int, parse_on_off};
use pptx_engine::model::color::Rgba;

/// Horizontal alignment of a paragraph.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Align {
    /// Left (start).
    #[default]
    Left,
    /// Centered.
    Center,
    /// Right (end).
    Right,
    /// Justified: lines but the last stretch to both margins.
    Justify,
    /// Distributed: every line, including the last, stretches by spacing characters.
    Distribute,
}

/// Line spacing rule.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum LineSpacing {
    /// A multiple of the natural line height (1.0 = single).
    Auto(f32),
    /// Exactly this height (points).
    Exact(f32),
    /// At least this height (points).
    AtLeast(f32),
}

impl Default for LineSpacing {
    fn default() -> Self {
        LineSpacing::Auto(1.0)
    }
}

/// Alignment of a tab stop.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TabAlign {
    /// Text starts at the stop.
    Left,
    /// Text centers on the stop.
    Center,
    /// Text ends at the stop.
    Right,
    /// The decimal separator aligns on the stop.
    Decimal,
    /// A vertical line at the stop; text is not moved.
    Bar,
}

/// What fills the space before a tab stop.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum TabLeader {
    /// Nothing.
    #[default]
    None,
    /// Dots.
    Dot,
    /// Hyphens.
    Hyphen,
    /// An underline.
    Underscore,
    /// A heavy line.
    Heavy,
    /// Middle dots.
    MiddleDot,
}

/// A custom tab stop.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct TabStop {
    /// Position from the start of the text area (points; may be negative).
    pub pos: f32,
    /// Alignment.
    pub align: TabAlign,
    /// Leader.
    pub leader: TabLeader,
}

/// A paragraph's numbering reference (`w:numPr`), as a level states it.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct NumPr {
    /// Numbering instance (`0` removes numbering).
    pub num_id: Option<i64>,
    /// List level.
    pub ilvl: Option<u8>,
}

/// Paragraph borders, as a level states them.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct ParaBordersPr {
    /// Top.
    pub top: Option<Option<Border>>,
    /// Left.
    pub left: Option<Option<Border>>,
    /// Bottom.
    pub bottom: Option<Option<Border>>,
    /// Right.
    pub right: Option<Option<Border>>,
    /// Between paragraphs with the same borders.
    pub between: Option<Option<Border>>,
    /// Bar beside the paragraph.
    pub bar: Option<Option<Border>>,
}

/// Paragraph borders, resolved.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct ParaBorders {
    /// Top.
    pub top: Option<Border>,
    /// Left.
    pub left: Option<Border>,
    /// Bottom.
    pub bottom: Option<Border>,
    /// Right.
    pub right: Option<Border>,
    /// Between paragraphs with the same borders.
    pub between: Option<Border>,
}

impl ParaBorders {
    /// Whether any border is set.
    pub fn any(&self) -> bool {
        self.top.is_some()
            || self.left.is_some()
            || self.bottom.is_some()
            || self.right.is_some()
            || self.between.is_some()
    }
}

/// A text frame or drop cap (`w:framePr`).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct FramePr {
    /// Drop cap style (`drop`, `margin`), when this is a drop cap.
    pub drop_cap: Option<String>,
    /// Lines the drop cap spans.
    pub lines: u32,
    /// Width (points).
    pub w: Option<f32>,
    /// Height (points).
    pub h: Option<f32>,
    /// Horizontal position (points).
    pub x: Option<f32>,
    /// Vertical position (points).
    pub y: Option<f32>,
    /// Horizontal anchor (`margin`, `page`, `text`).
    pub h_anchor: Option<String>,
    /// Vertical anchor.
    pub v_anchor: Option<String>,
    /// Horizontal alignment keyword.
    pub x_align: Option<String>,
    /// Vertical alignment keyword.
    pub y_align: Option<String>,
    /// Wrap mode.
    pub wrap: Option<String>,
    /// Horizontal distance from text (points).
    pub h_space: f32,
    /// Vertical distance from text (points).
    pub v_space: f32,
}

/// Paragraph properties as one level of the hierarchy states them.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct PPr {
    /// Paragraph style.
    pub style: Option<String>,
    /// Keep with the next paragraph.
    pub keep_next: Option<bool>,
    /// Keep lines together.
    pub keep_lines: Option<bool>,
    /// Start on a new page.
    pub page_break_before: Option<bool>,
    /// Widow and orphan control.
    pub widow_control: Option<bool>,
    /// Exclude from line numbering.
    pub suppress_line_numbers: Option<bool>,
    /// Ignore spacing between paragraphs of the same style.
    pub contextual_spacing: Option<bool>,
    /// Swap indents on even pages.
    pub mirror_indents: Option<bool>,
    /// Right-to-left paragraph.
    pub bidi: Option<bool>,
    /// Snap to the document grid.
    pub snap_to_grid: Option<bool>,
    /// Numbering.
    pub num: NumPr,
    /// Borders.
    pub borders: ParaBordersPr,
    /// Shading.
    pub shading: Option<Option<Rgba>>,
    /// Tab stops added (and cleared: `None` alignment) by this level.
    pub tabs: Vec<(f32, Option<TabStop>)>,
    /// Space before (points).
    pub before: Option<f32>,
    /// Space before in lines (hundredths of a line), overriding `before`.
    pub before_lines: Option<f32>,
    /// HTML-style automatic space before.
    pub before_auto: Option<bool>,
    /// Space after (points).
    pub after: Option<f32>,
    /// Space after in lines.
    pub after_lines: Option<f32>,
    /// Automatic space after.
    pub after_auto: Option<bool>,
    /// Line spacing.
    pub line: Option<LineSpacing>,
    /// Left (start) indent (points).
    pub ind_left: Option<f32>,
    /// Right (end) indent (points).
    pub ind_right: Option<f32>,
    /// First-line offset (points; negative = hanging).
    pub ind_first: Option<f32>,
    /// Alignment.
    pub jc: Option<Align>,
    /// Outline level (0-8; 9 = body text).
    pub outline_lvl: Option<u8>,
    /// Frame or drop cap.
    pub frame: Option<Option<FramePr>>,
    /// Properties of the paragraph mark.
    pub mark: RPr,
    /// Whether this paragraph ends a section (`w:sectPr` inside `w:pPr`).
    pub ends_section: bool,
}

fn twips_attr(t: &XmlTree, n: NodeId, name: &str) -> Option<f32> {
    t.w_attr(n, name).and_then(parse_int).map(twips)
}

impl PPr {
    /// Reads a `w:pPr` element.
    pub fn read(t: &XmlTree, ppr: NodeId, theme: &ThemeInfo) -> Self {
        let mut p = PPr::default();
        for c in t.children(ppr) {
            p.read_child(t, c, theme);
        }
        p
    }

    /// Reads one property element.
    pub fn read_child(&mut self, t: &XmlTree, c: NodeId, theme: &ThemeInfo) {
        if t.ns(c) != Ns::W {
            return;
        }
        let flag = || parse_on_off(t.val(c));
        match t.local(c) {
            "pStyle" => self.style = t.val(c).map(str::to_owned),
            "keepNext" => self.keep_next = Some(flag()),
            "keepLines" => self.keep_lines = Some(flag()),
            "pageBreakBefore" => self.page_break_before = Some(flag()),
            "widowControl" => self.widow_control = Some(flag()),
            "suppressLineNumbers" => self.suppress_line_numbers = Some(flag()),
            "contextualSpacing" => self.contextual_spacing = Some(flag()),
            "mirrorIndents" => self.mirror_indents = Some(flag()),
            "bidi" => self.bidi = Some(flag()),
            "snapToGrid" => self.snap_to_grid = Some(flag()),
            "numPr" => {
                if let Some(id) = t.child_val(c, "numId").and_then(parse_int) {
                    self.num.num_id = Some(id);
                }
                if let Some(l) = t.child_val(c, "ilvl").and_then(parse_int) {
                    self.num.ilvl = Some(l.clamp(0, 8) as u8);
                }
            }
            "pBdr" => {
                for b in t.children(c) {
                    let border = Some(read_border(t, b, theme));
                    match t.local(b) {
                        "top" => self.borders.top = border,
                        "left" | "start" => self.borders.left = border,
                        "bottom" => self.borders.bottom = border,
                        "right" | "end" => self.borders.right = border,
                        "between" => self.borders.between = border,
                        "bar" => self.borders.bar = border,
                        _ => {}
                    }
                }
            }
            "shd" => self.shading = Some(read_shading(t, c, theme)),
            "tabs" => {
                for tab in t.children_named(c, Ns::W, "tab") {
                    let Some(pos) = twips_attr(t, tab, "pos") else {
                        continue;
                    };
                    let align = match t.val(tab).unwrap_or("left") {
                        "clear" => None,
                        "center" => Some(TabAlign::Center),
                        "right" | "end" => Some(TabAlign::Right),
                        "decimal" => Some(TabAlign::Decimal),
                        "bar" => Some(TabAlign::Bar),
                        // `num` stops are list stops; they act as left stops.
                        _ => Some(TabAlign::Left),
                    };
                    let leader = match t.w_attr(tab, "leader").unwrap_or("none") {
                        "dot" => TabLeader::Dot,
                        "hyphen" => TabLeader::Hyphen,
                        "underscore" => TabLeader::Underscore,
                        "heavy" => TabLeader::Heavy,
                        "middleDot" => TabLeader::MiddleDot,
                        _ => TabLeader::None,
                    };
                    self.tabs
                        .push((pos, align.map(|align| TabStop { pos, align, leader })));
                }
            }
            "spacing" => {
                if let Some(v) = twips_attr(t, c, "before") {
                    self.before = Some(v);
                }
                if let Some(v) = t.w_attr(c, "beforeLines").and_then(parse_int) {
                    self.before_lines = Some(v as f32 / 100.0);
                }
                if let Some(v) = t.w_attr(c, "beforeAutospacing") {
                    self.before_auto = Some(parse_on_off(Some(v)));
                }
                if let Some(v) = twips_attr(t, c, "after") {
                    self.after = Some(v);
                }
                if let Some(v) = t.w_attr(c, "afterLines").and_then(parse_int) {
                    self.after_lines = Some(v as f32 / 100.0);
                }
                if let Some(v) = t.w_attr(c, "afterAutospacing") {
                    self.after_auto = Some(parse_on_off(Some(v)));
                }
                if let Some(line) = t.w_attr(c, "line").and_then(parse_int) {
                    self.line = Some(match t.w_attr(c, "lineRule").unwrap_or("auto") {
                        "exact" => LineSpacing::Exact(twips(line.abs())),
                        "atLeast" => LineSpacing::AtLeast(twips(line)),
                        _ => LineSpacing::Auto(line as f32 / 240.0),
                    });
                }
            }
            "ind" => {
                if let Some(v) = twips_attr(t, c, "left").or_else(|| twips_attr(t, c, "start")) {
                    self.ind_left = Some(v);
                }
                if let Some(v) = twips_attr(t, c, "right").or_else(|| twips_attr(t, c, "end")) {
                    self.ind_right = Some(v);
                }
                if let Some(v) = twips_attr(t, c, "hanging") {
                    self.ind_first = Some(-v);
                } else if let Some(v) = twips_attr(t, c, "firstLine") {
                    self.ind_first = Some(v);
                }
            }
            "jc" => {
                self.jc = Some(match t.val(c).unwrap_or("left") {
                    "center" => Align::Center,
                    "right" | "end" => Align::Right,
                    "both" | "lowKashida" | "mediumKashida" | "highKashida" | "thaiDistribute" => {
                        Align::Justify
                    }
                    "distribute" => Align::Distribute,
                    _ => Align::Left,
                });
            }
            "outlineLvl" => {
                self.outline_lvl = t.val(c).and_then(parse_int).map(|v| v.clamp(0, 9) as u8);
            }
            "framePr" => {
                let drop_cap = t
                    .w_attr(c, "dropCap")
                    .filter(|v| *v != "none")
                    .map(str::to_owned);
                self.frame = Some(Some(FramePr {
                    drop_cap,
                    lines: t
                        .w_attr(c, "lines")
                        .and_then(parse_int)
                        .map_or(1, |v| v.clamp(1, 10) as u32),
                    w: twips_attr(t, c, "w"),
                    h: twips_attr(t, c, "h"),
                    x: twips_attr(t, c, "x"),
                    y: twips_attr(t, c, "y"),
                    h_anchor: t.w_attr(c, "hAnchor").map(str::to_owned),
                    v_anchor: t.w_attr(c, "vAnchor").map(str::to_owned),
                    x_align: t.w_attr(c, "xAlign").map(str::to_owned),
                    y_align: t.w_attr(c, "yAlign").map(str::to_owned),
                    wrap: t.w_attr(c, "wrap").map(str::to_owned),
                    h_space: twips_attr(t, c, "hSpace").unwrap_or(0.0),
                    v_space: twips_attr(t, c, "vSpace").unwrap_or(0.0),
                }));
            }
            "rPr" => self.mark = RPr::read(t, c, theme),
            "sectPr" => self.ends_section = true,
            _ => {}
        }
    }

    /// Overlays a later level onto these properties.
    pub fn apply(&mut self, o: &PPr) {
        macro_rules! set {
            ($($f:ident),*) => {$(
                if o.$f.is_some() {
                    self.$f = o.$f.clone();
                }
            )*};
        }
        set!(
            style,
            keep_next,
            keep_lines,
            page_break_before,
            widow_control,
            suppress_line_numbers,
            contextual_spacing,
            mirror_indents,
            bidi,
            snap_to_grid,
            shading,
            before,
            before_lines,
            before_auto,
            after,
            after_lines,
            after_auto,
            line,
            ind_left,
            ind_right,
            ind_first,
            jc,
            outline_lvl,
            frame
        );
        if o.num.num_id.is_some() {
            self.num.num_id = o.num.num_id;
        }
        if o.num.ilvl.is_some() {
            self.num.ilvl = o.num.ilvl;
        }
        macro_rules! border {
            ($($f:ident),*) => {$(
                if o.borders.$f.is_some() {
                    self.borders.$f = o.borders.$f;
                }
            )*};
        }
        border!(top, left, bottom, right, between, bar);
        self.tabs.extend(o.tabs.iter().copied());
        self.mark.apply(&o.mark, false);
        self.ends_section |= o.ends_section;
    }
}

/// Paragraph properties fully resolved.
#[derive(Clone, Debug, PartialEq)]
pub struct ParaProps {
    /// Paragraph style id.
    pub style: Option<String>,
    /// Keep with next.
    pub keep_next: bool,
    /// Keep lines together.
    pub keep_lines: bool,
    /// Page break before.
    pub page_break_before: bool,
    /// Widow/orphan control.
    pub widow_control: bool,
    /// Not line-numbered.
    pub suppress_line_numbers: bool,
    /// Contextual spacing.
    pub contextual_spacing: bool,
    /// Mirror indents.
    pub mirror_indents: bool,
    /// Right to left.
    pub bidi: bool,
    /// Snap to grid.
    pub snap_to_grid: bool,
    /// Numbering instance and level (`None` when not numbered).
    pub num: Option<(i64, u8)>,
    /// Borders.
    pub borders: ParaBorders,
    /// Bar border.
    pub bar: Option<Border>,
    /// Shading.
    pub shading: Option<Rgba>,
    /// Tab stops, sorted by position.
    pub tabs: Vec<TabStop>,
    /// Space before (points).
    pub before: f32,
    /// Space before in lines, when set.
    pub before_lines: Option<f32>,
    /// Automatic space before.
    pub before_auto: bool,
    /// Space after (points).
    pub after: f32,
    /// Space after in lines, when set.
    pub after_lines: Option<f32>,
    /// Automatic space after.
    pub after_auto: bool,
    /// Line spacing.
    pub line: LineSpacing,
    /// Left indent (points).
    pub ind_left: f32,
    /// Right indent (points).
    pub ind_right: f32,
    /// First-line offset (points; negative = hanging).
    pub ind_first: f32,
    /// Alignment.
    pub jc: Align,
    /// Outline level.
    pub outline_lvl: Option<u8>,
    /// Frame or drop cap.
    pub frame: Option<FramePr>,
    /// Paragraph mark run properties (merged).
    pub mark: RPr,
}

impl PPr {
    /// Resolves fully merged properties.
    pub fn resolve(&self) -> ParaProps {
        let mut tabs: Vec<TabStop> = Vec::new();
        for (pos, stop) in &self.tabs {
            tabs.retain(|s| (s.pos - pos).abs() > 0.05);
            if let Some(s) = stop {
                tabs.push(*s);
            }
        }
        tabs.sort_by(|a, b| a.pos.total_cmp(&b.pos));
        let num = match (self.num.num_id, self.num.ilvl) {
            (Some(id), lvl) if id > 0 => Some((id, lvl.unwrap_or(0))),
            _ => None,
        };
        ParaProps {
            style: self.style.clone(),
            keep_next: self.keep_next.unwrap_or(false),
            keep_lines: self.keep_lines.unwrap_or(false),
            page_break_before: self.page_break_before.unwrap_or(false),
            // Word applies widow control unless a level turns it off.
            widow_control: self.widow_control.unwrap_or(true),
            suppress_line_numbers: self.suppress_line_numbers.unwrap_or(false),
            contextual_spacing: self.contextual_spacing.unwrap_or(false),
            mirror_indents: self.mirror_indents.unwrap_or(false),
            bidi: self.bidi.unwrap_or(false),
            snap_to_grid: self.snap_to_grid.unwrap_or(true),
            num,
            borders: ParaBorders {
                top: self.borders.top.flatten(),
                left: self.borders.left.flatten(),
                bottom: self.borders.bottom.flatten(),
                right: self.borders.right.flatten(),
                between: self.borders.between.flatten(),
            },
            bar: self.borders.bar.flatten(),
            shading: self.shading.flatten(),
            tabs,
            before: self.before.unwrap_or(0.0),
            before_lines: self.before_lines,
            before_auto: self.before_auto.unwrap_or(false),
            after: self.after.unwrap_or(0.0),
            after_lines: self.after_lines,
            after_auto: self.after_auto.unwrap_or(false),
            line: self.line.unwrap_or_default(),
            ind_left: self.ind_left.unwrap_or(0.0),
            ind_right: self.ind_right.unwrap_or(0.0),
            ind_first: self.ind_first.unwrap_or(0.0),
            jc: self.jc.unwrap_or_default(),
            outline_lvl: self.outline_lvl,
            frame: self.frame.clone().flatten(),
            mark: self.mark.clone(),
        }
    }
}
