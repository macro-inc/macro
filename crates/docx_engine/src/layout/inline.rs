//! A paragraph's content as measured clusters, ready for line breaking.
//!
//! Every character becomes a cluster with its advance, font and break
//! opportunity; list labels, field results that depend on the page, and
//! note numbers are synthetic clusters that occupy no content offsets.

use super::bidi::{self, Class};
use super::drawing::{Drawing, parse_drawing};
use super::fonts::{Font, Fonts};
use super::format::{Formats, ParaFormat};
use crate::model::block::Block;
use crate::model::content::Attrs;
use crate::model::numbering::{Label, NumFmt, Suffix, format_number};
use crate::model::props::{RunProps, VertAlign};
use crate::xml::parse_int;
use pptx_engine::font::arabic::{self, JoinForm, Joining};
use pptx_engine::model::color::Rgba;
use std::collections::HashMap;
use std::sync::Arc;

mod script;

use script::{breaks_after, is_cjk, is_complex};

/// Superscript and subscript size relative to the run (LibreOffice's
/// Word-compatible defaults).
const SCRIPT_SIZE: f32 = 0.58;
/// Superscript raise as a fraction of the run size.
const SUPER_RAISE: f32 = 0.33;
/// Subscript drop as a fraction of the run size.
const SUB_DROP: f32 = 0.08;
/// Small capitals size relative to the run.
const SMALL_CAPS_SIZE: f32 = 0.8;
/// Resolution of the device Word measures some runs on.
const DEVICE_DPI: f32 = 600.0;

/// Whether Word measures a run with a device font: runs with character
/// scaling or kerning come out as wide as a font of a whole number of
/// pixels at 600 dpi (10pt text measures as 9.96pt).
fn device_metrics(props: &RunProps, size: f32) -> bool {
    (props.scale - 1.0).abs() > 0.001 || (props.kern > 0.0 && size >= props.kern)
}

/// `size` rounded to whole device pixels.
fn device_size(size: f32) -> f32 {
    (size * DEVICE_DPI / 72.0).round().max(1.0) * 72.0 / DEVICE_DPI
}

/// What a cluster is.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    /// A visible character.
    Text,
    /// A breakable space.
    Space,
    /// A tab.
    Tab,
    /// A line break.
    LineBreak,
    /// A page break.
    PageBreak,
    /// A column break.
    ColumnBreak,
    /// An inline drawing (index into `objects`).
    Object(u16),
    /// A floating drawing's anchor (index into `objects`).
    Anchor(u16),
    /// Takes no space: hidden text, field codes, bookmarks.
    Zero,
    /// A soft hyphen: invisible unless the line breaks after it.
    SoftHyphen,
    /// The note separator line (`true` = continuation separator).
    Separator(bool),
    /// The paragraph mark.
    End,
}

/// A line-break opportunity after a cluster.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Brk {
    /// No break.
    No,
    /// A break is allowed after this cluster.
    After,
}

/// One measured unit of a paragraph.
#[derive(Clone, Copy, Debug)]
pub struct Cluster {
    /// Kind.
    pub kind: Kind,
    /// Content offset (UTF-16) where the cluster starts.
    pub offset: u32,
    /// Content length it covers (0 for synthetic clusters).
    pub len: u16,
    /// Index of its run style.
    pub run: u16,
    /// Natural advance (points).
    pub advance: f32,
    /// Glyph id (text clusters).
    pub glyph: u16,
    /// Font of the glyph.
    pub font: Option<Font>,
    /// The character displayed.
    pub ch: char,
    /// Break opportunity.
    pub brk: Brk,
    /// Explicit tab stop for absolute position tabs (`w:ptab`).
    pub ptab: Option<(f32, crate::model::props::TabAlign)>,
    /// Drawn size of a text cluster (points); differs from the run's for
    /// small capitals.
    pub size: f32,
}

/// How a run shows tracked changes.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
pub enum Revision {
    /// Not a tracked change.
    #[default]
    None,
    /// Inserted text.
    Inserted,
    /// Deleted text.
    Deleted,
    /// Text whose formatting changed: drawn as it is now, with a change bar.
    Formatted,
}

impl Revision {
    /// Whether the text shows as inserted or deleted.
    pub fn marked(self) -> bool {
        matches!(self, Self::Inserted | Self::Deleted)
    }
}

/// Drawing style of a run.
#[derive(Clone, Debug)]
pub struct RunStyle {
    /// Resolved properties.
    pub props: Arc<RunProps>,
    /// Size drawn (after super/subscript and small caps).
    pub size: f32,
    /// Baseline shift (points, up).
    pub shift: f32,
    /// Text color.
    pub color: Rgba,
    /// Tracked change.
    pub revision: Revision,
    /// Inside a hyperlink.
    pub link: bool,
    /// Ascent for line height (points).
    pub ascent: f32,
    /// Descent for line height (points).
    pub descent: f32,
    /// External leading (points).
    pub leading: f32,
    /// The primary font of the run.
    pub font: Option<Font>,
}

/// Dynamic field values.
#[derive(Clone, Debug, PartialEq)]
pub struct FieldValues {
    /// Page number.
    pub page: i64,
    /// Number of pages.
    pub pages: i64,
    /// Pages in the section.
    pub section_pages: i64,
    /// Section page number format.
    pub page_fmt: NumFmt,
}

impl Default for FieldValues {
    fn default() -> Self {
        Self {
            page: 1,
            pages: 1,
            section_pages: 1,
            page_fmt: NumFmt::Decimal,
        }
    }
}

/// What inline building needs besides the paragraph.
pub struct InlineCtx<'a> {
    /// Formatting resolver.
    pub formats: &'a Formats<'a>,
    /// Fonts.
    pub fonts: &'a Fonts<'a>,
    /// Page-dependent field values.
    pub fields: &'a FieldValues,
    /// Displayed note numbers by (endnote, id).
    pub note_numbers: &'a HashMap<(bool, i64), String>,
    /// The number of the note being laid out (for `w:footnoteRef`).
    pub note_number: Option<&'a str>,
    /// Show tracked changes (else show the final text).
    pub markup: bool,
}

/// A paragraph as clusters.
#[derive(Clone, Debug, Default)]
pub struct Inline {
    /// Clusters in order; the last one is the paragraph mark.
    pub clusters: Vec<Cluster>,
    /// Run styles.
    pub runs: Vec<RunStyle>,
    /// Drawings (inline and floating).
    pub objects: Vec<Drawing>,
    /// Note references: (cluster index, endnote, note id).
    pub notes: Vec<(usize, bool, i64)>,
    /// Whether the paragraph shows page-dependent fields.
    pub dynamic: bool,
    /// Clusters belonging to the list label.
    pub label_len: usize,
    /// Hyperlink targets by cluster range (start, end, relationship id or anchor).
    pub links: Vec<(usize, usize, String)>,
    /// Embedding level of each cluster (Unicode bidirectional algorithm);
    /// empty when the paragraph is all left to right.
    pub levels: Vec<u8>,
    /// The paragraph's mark is a tracked insertion or deletion shown with
    /// markup.
    pub mark_changed: bool,
    /// The paragraph's properties are a tracked change shown with markup.
    pub props_changed: bool,
}

/// A field being read.
struct FieldState {
    instr: String,
    in_result: bool,
    dynamic: Option<Dynamic>,
    emitted: bool,
    /// A legacy check box form field: whether it is checked.
    checkbox: Option<bool>,
}

/// Whether a field's `w:fldChar` start holds a check box form field, and
/// its state.
fn checkbox_state(xml: &str) -> Option<bool> {
    let start = xml.find(":checkBox")?;
    let rest = &xml[start..];
    let on = |name: &str| {
        rest.find(name).is_some_and(|i| {
            let tag = &rest[i..rest[i..].find('>').map_or(rest.len(), |e| i + e)];
            !(tag.contains("\"0\"") || tag.contains("\"false\"") || tag.contains("\"off\""))
        })
    };
    Some(if rest.contains(":checked") {
        on(":checked")
    } else {
        on(":default")
    })
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Dynamic {
    Page,
    Pages,
    SectionPages,
}

fn field_kind(instr: &str) -> Option<Dynamic> {
    let word = instr.split_whitespace().next()?.to_ascii_uppercase();
    match word.as_str() {
        "PAGE" => Some(Dynamic::Page),
        "NUMPAGES" => Some(Dynamic::Pages),
        "SECTIONPAGES" => Some(Dynamic::SectionPages),
        _ => None,
    }
}

/// The `\*` format switch of a field instruction.
fn field_format(instr: &str, default: &NumFmt) -> NumFmt {
    let mut words = instr.split_whitespace();
    while let Some(w) = words.next() {
        if w == "\\*" {
            return match words.next().unwrap_or("") {
                "ROMAN" | "Roman" => NumFmt::UpperRoman,
                "roman" => NumFmt::LowerRoman,
                "ALPHABETIC" | "Alphabetic" => NumFmt::UpperLetter,
                "alphabetic" => NumFmt::LowerLetter,
                "CardText" => NumFmt::CardinalText,
                "OrdText" => NumFmt::OrdinalText,
                "Ordinal" => NumFmt::Ordinal,
                "Arabic" | "arabic" => NumFmt::Decimal,
                _ => continue,
            };
        }
    }
    default.clone()
}

struct Builder<'a, 'b> {
    ctx: &'b InlineCtx<'a>,
    para: &'b Arc<ParaFormat>,
    out: Inline,
    /// Style index by (properties, revision, link, complex script).
    run_index: HashMap<(usize, Revision, bool, bool), u16>,
    /// Each style's properties as given (before condensing).
    run_props: Vec<Arc<RunProps>>,
}

impl Builder<'_, '_> {
    fn run_style(&mut self, props: &Arc<RunProps>, revision: Revision, link: bool) -> u16 {
        self.style_for(props, revision, link, false)
    }

    /// The style of the complex-script text (Arabic, Hebrew, or any text of
    /// a right-to-left run) of style `run`: its own font and size also give
    /// its lines their height.
    fn complex_style(&mut self, run: u16) -> u16 {
        let style = &self.out.runs[run as usize];
        let p = &style.props;
        if p.cs == p.ascii && p.size_cs == p.size && p.bold_cs == p.bold && p.italic_cs == p.italic
        {
            return run;
        }
        let (revision, link) = (style.revision, style.link);
        let props = Arc::clone(&self.run_props[run as usize]);
        self.style_for(&props, revision, link, true)
    }

    fn style_for(
        &mut self,
        props: &Arc<RunProps>,
        revision: Revision,
        link: bool,
        complex: bool,
    ) -> u16 {
        let key = (Arc::as_ptr(props) as usize, revision, link, complex);
        if let Some(&i) = self.run_index.get(&key) {
            return i;
        }
        let given = Arc::clone(props);
        let fonts = self.ctx.fonts;
        let (family, base) = if complex {
            (&props.cs, props.size_cs)
        } else {
            (&props.ascii, props.size)
        };
        let font = if complex {
            fonts.select(family, props.bold_cs, props.italic_cs)
        } else {
            fonts.select(family, props.bold, props.italic)
        };
        // A condensed family drawn with a regular-width face is squeezed.
        let factor = font.map_or(1.0, |f| fonts.width_factor(family, f.face));
        let (ascent, descent, leading) = match font {
            Some(f) => {
                let m = fonts.vmetrics_for(family, f.face);
                (m.ascent * base, m.descent * base, m.leading * base)
            }
            None => (base * 0.9, base * 0.25, 0.0),
        };
        let props = &if (factor - 1.0).abs() > f32::EPSILON {
            Arc::new(RunProps {
                scale: props.scale * factor,
                ..(**props).clone()
            })
        } else {
            Arc::clone(props)
        };
        let (size, shift) = match props.vert_align {
            VertAlign::Super => (base * SCRIPT_SIZE, base * SUPER_RAISE),
            VertAlign::Sub => (base * SCRIPT_SIZE, -base * SUB_DROP),
            VertAlign::Baseline => (base, 0.0),
        };
        // Links take their color from their formatting (usually the
        // Hyperlink character style), like any other text.
        let mut color = props.color.unwrap_or_else(|| auto_color(props));
        if revision.marked() && self.ctx.markup {
            // Word's default "by author" revision color for one author.
            color = Rgba::from_u8(0xC0, 0x00, 0x00);
        }
        let style = RunStyle {
            props: Arc::clone(props),
            size,
            shift: shift + props.position,
            color,
            revision,
            link,
            ascent,
            descent,
            leading,
            font,
        };
        let i = self.out.runs.len() as u16;
        self.out.runs.push(style);
        self.run_props.push(given);
        self.run_index.insert(key, i);
        i
    }

    fn push(&mut self, c: Cluster) {
        self.out.clusters.push(c);
    }

    fn zero(&mut self, offset: usize, len: usize, run: u16) {
        self.push(Cluster {
            kind: Kind::Zero,
            offset: offset as u32,
            len: len as u16,
            run,
            advance: 0.0,
            glyph: 0,
            font: None,
            ch: '\u{FFFC}',
            brk: Brk::No,
            ptab: None,
            size: 0.0,
        });
    }

    /// Measures and pushes one visible character.
    fn text_char(&mut self, ch: char, next: Option<char>, offset: usize, len: usize, run: u16) {
        let given = &self.out.runs[run as usize].props;
        // A run marked right to left (or complex script) is complex-script
        // text throughout (its size and weight), though Word sets its Latin
        // letters and digits in the run's Latin font.
        let marked = given.cs_flag || given.rtl;
        let complex = marked || is_complex(ch);
        let latin = marked && !is_complex(ch) && ch.is_ascii_alphanumeric();
        let run = if complex {
            self.complex_style(run)
        } else {
            run
        };
        let props = Arc::clone(&self.out.runs[run as usize].props);
        let fonts = self.ctx.fonts;
        let (family, bold, italic, mut size) = if complex {
            let family = if latin { &props.ascii } else { &props.cs };
            (family, props.bold_cs, props.italic_cs, props.size_cs)
        } else if is_cjk(ch) || (props.hint.as_deref() == Some("eastAsia") && !ch.is_ascii()) {
            (&props.east_asia, props.bold, props.italic, props.size)
        } else if ch.is_ascii() {
            (&props.ascii, props.bold, props.italic, props.size)
        } else {
            (&props.h_ansi, props.bold, props.italic, props.size)
        };
        let mut shown = ch;
        if props.caps || props.small_caps {
            let upper = ch.to_uppercase().next().unwrap_or(ch);
            if props.small_caps && !props.caps && upper != ch {
                size *= SMALL_CAPS_SIZE;
            }
            shown = upper;
        }
        size = match props.vert_align {
            VertAlign::Baseline => size,
            _ => size * SCRIPT_SIZE,
        };
        if device_metrics(&props, size) {
            size = device_size(size);
        }
        let Some(font) = fonts.select(family, bold, italic) else {
            self.zero(offset, len, run);
            return;
        };
        let g = fonts.glyph(font, shown);
        let mut advance = g.advance * size * props.scale + props.spacing;
        if ch == '\u{00A0}' {
            advance = fonts.glyph(font, ' ').advance * size * props.scale + props.spacing;
        }
        // An Arabic family drawn by a substitute keeps its own widths.
        if complex && let Some((letters, space)) = fonts.arabic_widths(family) {
            if matches!(ch, ' ' | '\u{00A0}') {
                advance = space * size * props.scale + props.spacing;
            } else if g.font.face != font.face || arabic::joining(ch) != Joining::None {
                advance = g.advance * letters * size * props.scale + props.spacing;
            }
        }
        // Pair kerning only when the run asks for it.
        if props.kern > 0.0
            && size >= props.kern
            && let Some(prev) = self.out.clusters.last_mut()
            && prev.kind == Kind::Text
            && prev.font.map(|f| f.face) == Some(g.font.face)
        {
            prev.advance += fonts.kerning(g.font.face, prev.glyph, g.id) * size;
        }
        let kind = if ch == ' ' || ch == '\u{2002}' || ch == '\u{2003}' || ch == '\u{3000}' {
            Kind::Space
        } else {
            Kind::Text
        };
        let brk = if kind == Kind::Space || breaks_after(ch, next) {
            Brk::After
        } else {
            Brk::No
        };
        self.push(Cluster {
            kind,
            offset: offset as u32,
            len: len as u16,
            run,
            advance,
            glyph: g.id,
            font: Some(g.font),
            ch: shown,
            brk,
            ptab: None,
            size,
        });
    }

    /// Pushes synthetic text (labels, field results, note numbers).
    fn synthetic(&mut self, text: &str, offset: usize, first_len: usize, run: u16) {
        let chars: Vec<char> = text.chars().collect();
        for (i, &c) in chars.iter().enumerate() {
            let len = if i == 0 { first_len } else { 0 };
            if c == '\t' {
                self.tab(offset, len, run);
                continue;
            }
            self.text_char(c, chars.get(i + 1).copied(), offset, len, run);
        }
        if chars.is_empty() && first_len > 0 {
            self.zero(offset, first_len, run);
        }
    }

    /// A legacy check box form field: a box as wide as the font is high.
    fn checkbox(&mut self, checked: bool, offset: usize, len: usize, run: u16) {
        let ch = if checked { '\u{2612}' } else { '\u{2610}' };
        self.text_char(ch, None, offset, len, run);
        if let Some(c) = self.out.clusters.last_mut()
            && c.kind == Kind::Text
        {
            c.advance = c.size.max(1.0);
        }
    }

    /// Joins Arabic letters: each takes its initial, medial, final or
    /// isolated presentation form, and lam with a following alef becomes
    /// one ligature (the alef's cluster then draws nothing).
    fn shape_arabic(&mut self) {
        let clusters = &mut self.out.clusters;
        if !clusters
            .iter()
            .any(|c| c.kind == Kind::Text && arabic::joining(c.ch) != Joining::None)
        {
            return;
        }
        let types: Vec<Joining> = clusters
            .iter()
            .map(|c| match c.kind {
                Kind::Text => arabic::joining(c.ch),
                // Bookmarks and other hidden markers do not break a word.
                Kind::Zero => Joining::Transparent,
                _ => Joining::None,
            })
            .collect();
        let forms = arabic::forms_of(&types);
        let fonts = self.ctx.fonts;
        let db = fonts.db();
        let runs = &self.out.runs;
        let measure = |c: &Cluster, glyph: u16, face| {
            let props = &runs[c.run as usize].props;
            let letters = fonts.arabic_widths(&props.cs).map_or(1.0, |w| w.0);
            db.advance(face, glyph) * letters * c.size * props.scale + props.spacing
        };
        let mut i = 0;
        while i < clusters.len() {
            let (Some(form), Some(font)) = (forms[i], clusters[i].font) else {
                i += 1;
                continue;
            };
            let face = font.face;
            let joined = matches!(form, JoinForm::Medial | JoinForm::Final);
            let lam_alef = (clusters[i].ch == '\u{0644}')
                .then(|| clusters.get(i + 1))
                .flatten()
                .filter(|next| next.kind == Kind::Text && next.font.map(|f| f.face) == Some(face))
                .and_then(|next| arabic::lam_alef(next.ch, joined))
                .and_then(|lig| db.glyph(face, lig));
            if let Some(glyph) = lam_alef {
                let advance = measure(&clusters[i], glyph, face);
                let c = &mut clusters[i];
                c.glyph = glyph;
                c.advance = advance;
                let tail = &mut clusters[i + 1];
                tail.kind = Kind::Zero;
                tail.glyph = 0;
                tail.advance = 0.0;
                i += 2;
                continue;
            }
            if let Some(glyph) =
                arabic::presentation_form(clusters[i].ch, form).and_then(|p| db.glyph(face, p))
            {
                let advance = measure(&clusters[i], glyph, face);
                let c = &mut clusters[i];
                c.glyph = glyph;
                c.advance = advance;
            }
            i += 1;
        }
    }

    /// Resolves the clusters' embedding levels when the paragraph is right
    /// to left or holds right-to-left text, and mirrors brackets that read
    /// right to left.
    fn resolve_bidi(&mut self) {
        let base = u8::from(self.para.props.bidi);
        let clusters = &self.out.clusters;
        let classes: Vec<Class> = clusters
            .iter()
            .map(|c| match c.kind {
                Kind::Text => bidi::class(c.ch),
                Kind::Space => Class::Ws,
                Kind::Tab => Class::S,
                Kind::LineBreak => Class::Ws,
                Kind::Zero | Kind::Anchor(_) | Kind::SoftHyphen => Class::Bn,
                Kind::End => Class::B,
                _ => Class::On,
            })
            .collect();
        if !bidi::needed(&classes, base == 1) {
            return;
        }
        let rtl: Vec<bool> = clusters
            .iter()
            .map(|c| self.out.runs[c.run as usize].props.rtl)
            .collect();
        let levels = bidi::levels(&classes, &rtl, base);
        let db = self.ctx.fonts.db();
        for (c, &level) in self.out.clusters.iter_mut().zip(&levels) {
            if level % 2 == 0 || c.kind != Kind::Text {
                continue;
            }
            if let (Some(m), Some(font)) = (bidi::mirror(c.ch), c.font)
                && let Some(glyph) = db.glyph(font.face, m)
            {
                c.glyph = glyph;
            }
        }
        self.out.levels = levels;
    }

    fn tab(&mut self, offset: usize, len: usize, run: u16) {
        self.push(Cluster {
            kind: Kind::Tab,
            offset: offset as u32,
            len: len as u16,
            run,
            advance: 0.0,
            glyph: 0,
            font: self.out.runs[run as usize].font,
            ch: '\t',
            brk: Brk::After,
            ptab: None,
            size: 0.0,
        });
    }

    fn simple(&mut self, kind: Kind, offset: usize, len: usize, run: u16) {
        self.push(Cluster {
            kind,
            offset: offset as u32,
            len: len as u16,
            run,
            advance: 0.0,
            glyph: 0,
            font: None,
            ch: '\u{FFFC}',
            brk: Brk::After,
            ptab: None,
            size: 0.0,
        });
    }
}

/// Text color for `auto`: black, or white on dark shading.
fn auto_color(props: &RunProps) -> Rgba {
    match props.shading.or(props.highlight) {
        Some(bg) if bg.r * 0.299 + bg.g * 0.587 + bg.b * 0.114 < 0.4 => Rgba::WHITE,
        _ => Rgba::BLACK,
    }
}

fn wrapper_instr(open: &str) -> Option<String> {
    // `<w:fldSimple w:instr="PAGE \* MERGEFORMAT">`
    let i = open.find("instr=\"")?;
    let rest = &open[i + 7..];
    let end = rest.find('"')?;
    Some(rest[..end].replace("&quot;", "\"").replace("&amp;", "&"))
}

/// Builds the clusters of a paragraph.
pub fn build(
    block: &Block,
    para: &Arc<ParaFormat>,
    label: Option<(&Label, &RunProps)>,
    ctx: &InlineCtx<'_>,
) -> Inline {
    let mut b = Builder {
        ctx,
        para,
        out: Inline::default(),
        run_index: HashMap::new(),
        run_props: Vec::new(),
    };
    let mark_run = {
        let mark = Arc::clone(&para.mark);
        let run = b.run_style(&mark, Revision::None, false);
        // A right-to-left mark is sized like complex-script text.
        if mark.rtl || mark.cs_flag {
            b.complex_style(run)
        } else {
            run
        }
    };
    // The mark's revision also shows on the list label, as in Word.
    let mark_revision = if !ctx.markup {
        Revision::None
    } else if para.mark.mark_deleted {
        Revision::Deleted
    } else if para.mark.mark_inserted {
        Revision::Inserted
    } else {
        Revision::None
    };
    b.out.mark_changed = mark_revision != Revision::None;
    b.out.props_changed = ctx.markup && block.props.contains("pPrChange");
    // List label.
    if let Some((label, props)) = label {
        let props = Arc::new(props.clone());
        let run = b.run_style(&props, mark_revision, false);
        b.synthetic(&label.text, 0, 0, run);
        match label.suffix {
            Suffix::Tab => b.tab(0, 0, run),
            Suffix::Space => b.synthetic(" ", 0, 0, run),
            Suffix::Nothing => {}
        }
        b.out.label_len = b.out.clusters.len();
    }
    let mut fields: Vec<FieldState> = Vec::new();
    let mut simple_dynamic_open: Option<String> = None;
    let mut link_start: Option<(usize, String)> = None;
    let spans: Vec<(usize, &crate::model::content::Span)> = block.content.spans_at().collect();
    for (si, (start, span)) in spans.iter().enumerate() {
        let attrs: &Attrs = &span.attrs;
        let wrappers = attrs.wrappers();
        let revision = if wrappers
            .iter()
            .any(|w| matches!(w.local(), "del" | "moveFrom"))
        {
            Revision::Deleted
        } else if wrappers
            .iter()
            .any(|w| matches!(w.local(), "ins" | "moveTo"))
        {
            Revision::Inserted
        } else if attrs.run_props().any(|(q, _)| q.ends_with("rPrChange")) {
            Revision::Formatted
        } else {
            Revision::None
        };
        let link_wrapper = wrappers.iter().find(|w| w.local() == "hyperlink");
        let link = link_wrapper.is_some();
        // Track hyperlink extents for the editor (cluster ranges).
        match (link_wrapper, &link_start) {
            (Some(w), None) => link_start = Some((b.out.clusters.len(), w.open.clone())),
            (Some(w), Some((_, open))) if *open != w.open => {
                let (s, o) = link_start.take().unwrap_or_default();
                b.out.links.push((s, b.out.clusters.len(), o));
                link_start = Some((b.out.clusters.len(), w.open.clone()));
            }
            (None, Some(_)) => {
                let (s, o) = link_start.take().unwrap_or_default();
                b.out.links.push((s, b.out.clusters.len(), o));
            }
            _ => {}
        }
        // Simple fields that show page numbers.
        let simple = wrappers
            .iter()
            .rev()
            .find(|w| w.local() == "fldSimple")
            .and_then(|w| wrapper_instr(&w.open).map(|i| (w.open.clone(), i)));
        let simple_dynamic = simple
            .as_ref()
            .and_then(|(open, instr)| field_kind(instr).map(|k| (open.clone(), instr.clone(), k)));
        let props = ctx.formats.run(attrs, para);
        let hidden_revision = revision == Revision::Deleted && !ctx.markup;
        // Without markup the document shows as if every change were
        // accepted: insertions look like any other text.
        let shown = if ctx.markup { revision } else { Revision::None };
        let run = b.run_style(&props, shown, link);
        let text: Vec<char> = span.text.chars().collect();
        let mut offset = *start;
        for (ci, &ch) in text.iter().enumerate() {
            let len = ch.len_utf16();
            let next = text
                .get(ci + 1)
                .copied()
                .or_else(|| spans.get(si + 1).and_then(|(_, s)| s.text.chars().next()));
            // Markers: bookmarks, comment ranges, math...
            if attrs.marker().is_some() {
                b.zero(offset, len, run);
                offset += len;
                continue;
            }
            if let Some(obj) = attrs.object() {
                object(
                    &mut b,
                    obj,
                    &mut fields,
                    offset,
                    len,
                    run,
                    hidden_revision || props.vanish,
                );
                offset += len;
                continue;
            }
            if attrs.is_instr()
                && let Some(f) = fields.last_mut()
                && !f.in_result
            {
                f.instr.push(ch);
            }
            let field_hidden = attrs.is_instr() || fields_hidden(&fields);
            if let Some((open, instr, kind)) = &simple_dynamic {
                if simple_dynamic_open.as_ref() != Some(open) {
                    simple_dynamic_open = Some(open.clone());
                    let value = dynamic_value(*kind, instr, ctx.fields);
                    b.out.dynamic = true;
                    b.synthetic(&value, offset, len, run);
                } else {
                    b.zero(offset, len, run);
                }
                offset += len;
                continue;
            }
            simple_dynamic_open = None;
            if field_hidden || props.vanish || hidden_revision {
                b.zero(offset, len, run);
                offset += len;
                continue;
            }
            match ch {
                '\t' => b.tab(offset, len, run),
                '\n' => b.simple(Kind::LineBreak, offset, len, run),
                '\u{00AD}' => b.simple(Kind::SoftHyphen, offset, len, run),
                '\u{200B}' => {
                    b.zero(offset, len, run);
                    if let Some(c) = b.out.clusters.last_mut() {
                        c.brk = Brk::After;
                    }
                }
                _ => b.text_char(ch, next, offset, len, run),
            }
            offset += len;
        }
    }
    if let Some((s, o)) = link_start {
        b.out.links.push((s, b.out.clusters.len(), o));
    }
    // The paragraph mark.
    let end = block.content.len();
    let hidden_mark = para.mark.vanish || (para.mark.mark_deleted && !ctx.markup);
    b.push(Cluster {
        kind: Kind::End,
        offset: end as u32,
        len: 0,
        run: mark_run,
        advance: 0.0,
        glyph: 0,
        font: None,
        ch: if hidden_mark { '\u{0}' } else { '\u{00B6}' },
        brk: Brk::After,
        ptab: None,
        size: 0.0,
    });
    b.shape_arabic();
    b.resolve_bidi();
    b.out
}

fn dynamic_value(kind: Dynamic, instr: &str, f: &FieldValues) -> String {
    let fmt = field_format(instr, &f.page_fmt);
    match kind {
        Dynamic::Page => format_number(f.page, &fmt),
        Dynamic::Pages => format_number(f.pages, &field_format(instr, &NumFmt::Decimal)),
        Dynamic::SectionPages => {
            format_number(f.section_pages, &field_format(instr, &NumFmt::Decimal))
        }
    }
}

/// Handles one object character.
fn object(
    b: &mut Builder<'_, '_>,
    xml: &str,
    fields: &mut Vec<FieldState>,
    offset: usize,
    len: usize,
    run: u16,
    hidden: bool,
) {
    // Cheap dispatch on the element name before parsing.
    let name = xml
        .trim_start_matches('<')
        .split(|c: char| c.is_whitespace() || c == '>' || c == '/')
        .next()
        .unwrap_or("");
    let local = name.rsplit(':').next().unwrap_or(name);
    match local {
        "fldChar" => {
            let kind = attr_value(xml, "fldCharType").unwrap_or_default();
            match kind.as_str() {
                "begin" => fields.push(FieldState {
                    instr: String::new(),
                    in_result: false,
                    dynamic: None,
                    emitted: false,
                    checkbox: checkbox_state(xml),
                }),
                "separate" => {
                    if let Some(f) = fields.last_mut() {
                        f.in_result = true;
                        f.dynamic = field_kind(&f.instr);
                    }
                    let outer_hidden = fields_hidden(&fields[..fields.len().saturating_sub(1)]);
                    if let Some(f) = fields.last_mut()
                        && let Some(kind) = f.dynamic
                        && !f.emitted
                        && !outer_hidden
                    {
                        let instr = fields.last().map(|f| f.instr.clone()).unwrap_or_default();
                        let value = dynamic_value(kind, &instr, b.ctx.fields);
                        if let Some(f) = fields.last_mut() {
                            f.emitted = true;
                        }
                        b.out.dynamic = true;
                        b.synthetic(&value, offset, len, run);
                        return;
                    }
                }
                "end" => {
                    let f = fields.pop();
                    if let Some(f) = &f
                        && let Some(checked) = f.checkbox
                        && f.instr.split_whitespace().next() == Some("FORMCHECKBOX")
                        && !hidden
                        && !fields_hidden(fields)
                    {
                        b.checkbox(checked, offset, len, run);
                        return;
                    }
                    if let Some(f) = f
                        && !f.emitted
                        && let Some(kind) = field_kind(&f.instr)
                        && !f.in_result
                        && !fields_hidden(fields)
                    {
                        // A field without a stored result still shows its value.
                        let value = dynamic_value(kind, &f.instr, b.ctx.fields);
                        b.out.dynamic = true;
                        b.synthetic(&value, offset, len, run);
                        return;
                    }
                }
                _ => {}
            }
            b.zero(offset, len, run);
        }
        _ if hidden || fields_hidden(fields) => b.zero(offset, len, run),
        "footnoteReference" | "endnoteReference" => {
            let endnote = local == "endnoteReference";
            let custom =
                attr_value(xml, "customMarkFollows").is_some_and(|v| v == "1" || v == "true");
            let id = attr_value(xml, "id")
                .and_then(|v| parse_int(&v))
                .unwrap_or(0);
            let number = b
                .ctx
                .note_numbers
                .get(&(endnote, id))
                .cloned()
                .unwrap_or_default();
            let at = b.out.clusters.len();
            if custom || number.is_empty() {
                b.zero(offset, len, run);
            } else {
                b.synthetic(&number, offset, len, run);
            }
            b.out.notes.push((at, endnote, id));
        }
        "footnoteRef" | "endnoteRef" => {
            let number = b.ctx.note_number.unwrap_or("").to_owned();
            b.synthetic(&number, offset, len, run);
        }
        "separator" | "continuationSeparator" => {
            b.simple(
                Kind::Separator(local == "continuationSeparator"),
                offset,
                len,
                run,
            );
        }
        "br" => {
            let kind = match attr_value(xml, "type").as_deref() {
                Some("page") => Kind::PageBreak,
                Some("column") => Kind::ColumnBreak,
                _ => Kind::LineBreak,
            };
            b.simple(kind, offset, len, run);
        }
        "cr" => b.simple(Kind::LineBreak, offset, len, run),
        "tab" => b.tab(offset, len, run),
        "ptab" => {
            b.tab(offset, len, run);
            let align = match attr_value(xml, "alignment").as_deref() {
                Some("center") => crate::model::props::TabAlign::Center,
                Some("right") => crate::model::props::TabAlign::Right,
                _ => crate::model::props::TabAlign::Left,
            };
            let relative_to_indent = attr_value(xml, "relativeTo").as_deref() == Some("indent");
            if let Some(c) = b.out.clusters.last_mut() {
                // Position resolved at line layout: NaN = "the edge for this alignment".
                c.ptab = Some((if relative_to_indent { -1.0 } else { f32::NAN }, align));
            }
        }
        "sym" => {
            let font = attr_value(xml, "font").unwrap_or_default();
            let code = attr_value(xml, "char")
                .and_then(|c| u32::from_str_radix(&c, 16).ok())
                .and_then(char::from_u32)
                .unwrap_or('\u{2022}');
            let style = &b.out.runs[run as usize];
            let props = Arc::clone(&style.props);
            let size = style.size;
            let Some(f) = b.ctx.fonts.select(&font, props.bold, props.italic) else {
                b.zero(offset, len, run);
                return;
            };
            let g = b.ctx.fonts.glyph(f, code);
            b.push(Cluster {
                kind: Kind::Text,
                offset: offset as u32,
                len: len as u16,
                run,
                advance: g.advance * size * props.scale + props.spacing,
                glyph: g.id,
                font: Some(g.font),
                ch: code,
                brk: Brk::No,
                ptab: None,
                size,
            });
        }
        "noBreakHyphen" => b.text_char('\u{2011}', None, offset, len, run),
        "softHyphen" => b.simple(Kind::SoftHyphen, offset, len, run),
        "drawing" | "pict" | "object" | "AlternateContent" => {
            match parse_drawing(xml, b.ctx.formats.snippets()) {
                Some(d) => {
                    let index = b.out.objects.len() as u16;
                    let floating = d.anchor.is_some();
                    let width = d.width + d.effect[0] + d.effect[2];
                    b.out.objects.push(d);
                    if floating {
                        b.push(Cluster {
                            kind: Kind::Anchor(index),
                            offset: offset as u32,
                            len: len as u16,
                            run,
                            advance: 0.0,
                            glyph: 0,
                            font: None,
                            ch: '\u{FFFC}',
                            brk: Brk::No,
                            ptab: None,
                            size: 0.0,
                        });
                    } else {
                        b.push(Cluster {
                            kind: Kind::Object(index),
                            offset: offset as u32,
                            len: len as u16,
                            run,
                            advance: width,
                            glyph: 0,
                            font: None,
                            ch: '\u{FFFC}',
                            brk: Brk::After,
                            ptab: None,
                            size: 0.0,
                        });
                    }
                }
                None => b.zero(offset, len, run),
            }
        }
        "dayShort" | "dayLong" | "monthShort" | "monthLong" | "yearShort" | "yearLong"
        | "pgNum" => {
            let value = if local == "pgNum" {
                format_number(b.ctx.fields.page, &b.ctx.fields.page_fmt)
            } else {
                String::new()
            };
            b.synthetic(&value, offset, len, run);
        }
        _ => b.zero(offset, len, run),
    }
}

/// Whether an enclosing field hides its content (instruction part, or a
/// dynamic result already replaced).
fn fields_hidden(fields: &[FieldState]) -> bool {
    fields
        .iter()
        .any(|f| !f.in_result || (f.dynamic.is_some() && f.in_result))
}

/// A quick attribute read on an element's start tag.
fn attr_value(xml: &str, name: &str) -> Option<String> {
    let tag_end = xml.find('>').unwrap_or(xml.len());
    let tag = &xml[..tag_end];
    let mut search = 0;
    while let Some(i) = tag[search..].find(name) {
        let at = search + i;
        let before = tag
            .as_bytes()
            .get(at.wrapping_sub(1))
            .copied()
            .unwrap_or(b' ');
        let after = &tag[at + name.len()..];
        if (before == b':' || before == b' ') && after.trim_start().starts_with('=') {
            let after = after.trim_start()[1..].trim_start();
            let quote = after.chars().next()?;
            let rest = &after[1..];
            let end = rest.find(quote)?;
            return Some(rest[..end].replace("&quot;", "\"").replace("&amp;", "&"));
        }
        search = at + name.len();
    }
    None
}

#[cfg(test)]
mod test;
