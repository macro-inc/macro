//! Typesetting equations into positioned glyphs and rules.
//!
//! The layout follows TeX's rules with OpenType `MATH` parameters, which is
//! also how Office lays out Cambria Math: atoms are spaced by class, scripts
//! and limits shift by the font's constants, and delimiters, radicals, and
//! large operators take the font's size variants or are assembled from
//! parts. Letters, digits, and the common operators come from Caladea
//! (Cambria's metrics, so equations measure like PowerPoint's), other
//! symbols and the stretchy glyphs from the bundled STIX Two Math, and
//! everything sits on Cambria Math's axis.
//!
//! Coordinates are points with y pointing down and the origin on the
//! baseline at the box's left edge.

mod stretch;
mod structs;

use super::font::{Constants, MathFont};
use super::symbols::{Class, class_of, default_style, is_greek, math_char};
use super::tree::{Alphabet, Equation, Justify, Node, Run, Style};
use crate::font::{FaceId, FontChoice, FontDb};
use crate::model::fill::Fill;
use crate::model::text::RunProps;
use crate::path::{Point, Rect};

/// Cambria Math's math axis (ems), where fraction bars and operators center.
const AXIS: f32 = 0.2856;
/// Space between the lines of a display equation or array rows (ems).
const ROW_GAP: f32 = 0.25;
/// Smallest baseline-to-baseline distance of stacked rows (ems).
const ROW_MIN: f32 = 1.2;

/// A glyph of a typeset equation.
#[derive(Clone, Debug, PartialEq)]
pub struct MathGlyph {
    /// Face.
    pub face: FaceId,
    /// Glyph id.
    pub glyph: u16,
    /// Size in points.
    pub size: f32,
    /// Pen position (baseline origin).
    pub x: f32,
    /// Baseline.
    pub y: f32,
    /// Paint.
    pub fill: Fill,
    /// Embolden synthetically.
    pub synthetic_bold: bool,
    /// Slant synthetically.
    pub synthetic_italic: bool,
}

/// Something a typeset equation draws.
#[derive(Clone, Debug, PartialEq)]
pub enum MathItem {
    /// A glyph.
    Glyph(MathGlyph),
    /// A filled rectangle: fraction bars, radical and over/under bars, box edges.
    Rule {
        /// The rectangle.
        rect: Rect,
        /// Paint.
        fill: Fill,
    },
    /// A straight stroke (strikes through a border box).
    Line {
        /// Start.
        from: Point,
        /// End.
        to: Point,
        /// Thickness.
        width: f32,
        /// Paint.
        fill: Fill,
    },
}

/// A typeset equation (or part of one).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct MathBox {
    /// Advance width.
    pub width: f32,
    /// Height above the baseline.
    pub ascent: f32,
    /// Depth below the baseline.
    pub descent: f32,
    /// Italic correction after the last glyph (scripts move right by it).
    pub italic: f32,
    /// What to draw.
    pub items: Vec<MathItem>,
}

impl MathBox {
    /// An empty box of a size.
    fn space(width: f32, ascent: f32, descent: f32) -> Self {
        Self {
            width,
            ascent,
            descent,
            ..Self::default()
        }
    }

    /// Draws `other` with its origin at (`dx`, `dy`) and grows to cover it.
    fn place(&mut self, other: MathBox, dx: f32, dy: f32) {
        self.ascent = self.ascent.max(other.ascent - dy);
        self.descent = self.descent.max(other.descent + dy);
        self.width = self.width.max(dx + other.width);
        for item in other.items {
            self.items.push(shift(item, dx, dy));
        }
    }

    fn rule(&mut self, rect: Rect, fill: &Fill) {
        self.items.push(MathItem::Rule {
            rect,
            fill: fill.clone(),
        });
    }

    /// Moves everything down by `dy` (up when negative).
    fn lower(mut self, dy: f32) -> Self {
        self.ascent -= dy;
        self.descent += dy;
        self.items = self.items.into_iter().map(|i| shift(i, 0.0, dy)).collect();
        self
    }

    /// The bounds of what the box draws, relative to its origin.
    pub fn ink(&self) -> Rect {
        Rect::from_ltrb(0.0, -self.ascent, self.width, self.descent)
    }
}

/// The outline of a straight stroke from `from` to `to`, moved by (`dx`, `dy`).
pub fn stroke_outline(from: Point, to: Point, width: f32, dx: f32, dy: f32) -> crate::path::Path {
    let (vx, vy) = (to.x - from.x, to.y - from.y);
    let len = (vx * vx + vy * vy).sqrt().max(1e-3);
    let (nx, ny) = (-vy / len * width / 2.0, vx / len * width / 2.0);
    let p = |px: f32, py: f32| Point::new(dx + px, dy + py);
    let mut path = crate::path::Path::new();
    path.move_to(p(from.x + nx, from.y + ny));
    path.line_to(p(to.x + nx, to.y + ny));
    path.line_to(p(to.x - nx, to.y - ny));
    path.line_to(p(from.x - nx, from.y - ny));
    path.close();
    path
}

fn shift(item: MathItem, dx: f32, dy: f32) -> MathItem {
    match item {
        MathItem::Glyph(mut g) => {
            g.x += dx;
            g.y += dy;
            MathItem::Glyph(g)
        }
        MathItem::Rule { rect, fill } => MathItem::Rule {
            rect: Rect::from_xywh(rect.x + dx, rect.y + dy, rect.w, rect.h),
            fill,
        },
        MathItem::Line {
            from,
            to,
            width,
            fill,
        } => MathItem::Line {
            from: Point::new(from.x + dx, from.y + dy),
            to: Point::new(to.x + dx, to.y + dy),
            width,
            fill,
        },
    }
}

/// TeX's four styles.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
enum Level {
    Display,
    Text,
    Script,
    ScriptScript,
}

/// The style a part of an equation is set in.
#[derive(Clone, Debug)]
struct St {
    level: Level,
    /// Superscripts sit lower (under radicals, in denominators, subscripts).
    cramped: bool,
    /// The run's size before script scaling (points).
    size: f32,
    fill: Fill,
}

impl St {
    /// Points per em at this level.
    fn em(&self, c: &Constants) -> f32 {
        self.size
            * match self.level {
                Level::Display | Level::Text => 1.0,
                Level::Script => c.script_scale,
                Level::ScriptScript => c.script_script_scale,
            }
    }

    fn display(&self) -> bool {
        self.level == Level::Display
    }

    /// Superscript style.
    fn sup(&self) -> St {
        St {
            level: match self.level {
                Level::Display | Level::Text => Level::Script,
                _ => Level::ScriptScript,
            },
            ..self.clone()
        }
    }

    /// Subscript style.
    fn sub(&self) -> St {
        St {
            cramped: true,
            ..self.sup()
        }
    }

    /// Numerator style.
    fn num(&self) -> St {
        St {
            level: match self.level {
                Level::Display => Level::Text,
                Level::Text => Level::Script,
                _ => Level::ScriptScript,
            },
            ..self.clone()
        }
    }

    /// Denominator style.
    fn den(&self) -> St {
        St {
            cramped: true,
            ..self.num()
        }
    }

    fn cramp(&self) -> St {
        St {
            cramped: true,
            ..self.clone()
        }
    }

    /// The style with a run's or structure's own formatting.
    fn with(&self, props: Option<&RunProps>, font_scale: f32) -> St {
        match props {
            Some(p) => St {
                size: p.size * font_scale,
                fill: p.fill.clone(),
                ..self.clone()
            },
            None => self.clone(),
        }
    }
}

/// Faces and constants for one equation.
struct Env<'a> {
    fonts: &'a FontDb,
    math: MathFont<'a>,
    c: Constants,
    font_scale: f32,
    placeholders: bool,
}

/// Ink extents of a glyph (ems; `top` up from the baseline, `bottom` down).
#[derive(Clone, Copy, Debug, Default)]
struct Ink {
    advance: f32,
    left: f32,
    right: f32,
    top: f32,
    bottom: f32,
}

/// An atom of a horizontal list: its box and spacing classes.
struct Atom {
    bx: MathBox,
    left: Class,
    right: Class,
    /// A space or kern, which TeX's spacing looks past.
    kern: bool,
}

/// Typesets an equation at the size and color of `props` (scaled by
/// `font_scale` for shrink-to-fit text). `placeholders` draws dotted
/// boxes in empty required slots, as an equation editor shows them.
pub fn typeset(
    eq: &Equation,
    props: &RunProps,
    font_scale: f32,
    fonts: &FontDb,
    placeholders: bool,
) -> MathBox {
    let math = MathFont::new(fonts);
    let mut c = math.constants;
    c.axis_height = AXIS;
    let env = Env {
        fonts,
        math,
        c,
        font_scale,
        placeholders,
    };
    let st = St {
        level: if eq.display {
            Level::Display
        } else {
            Level::Text
        },
        cramped: false,
        size: props.size * font_scale,
        fill: props.fill.clone(),
    };
    let lines: Vec<MathBox> = eq.lines.iter().map(|l| env.hlist(l, &st)).collect();
    if lines.len() == 1 {
        return lines.into_iter().next().unwrap_or_default();
    }
    let width = lines.iter().map(|l| l.width).fold(0.0f32, f32::max);
    let em = st.em(&env.c);
    let mut out = MathBox::default();
    let mut y = 0.0f32;
    let group_left = lines
        .iter()
        .map(|l| (width - l.width) / 2.0)
        .fold(width, f32::min);
    for (i, line) in lines.into_iter().enumerate() {
        if i > 0 {
            let prev_descent = out.descent - y;
            y += (prev_descent + ROW_GAP * em + line.ascent).max(ROW_MIN * em);
        }
        let x = match eq.justify {
            Justify::Left => 0.0,
            Justify::Right => width - line.width,
            Justify::Center => (width - line.width) / 2.0,
            Justify::CenterGroup => group_left,
        };
        out.place(line, x, y);
    }
    out.width = width;
    out
}

impl Env<'_> {
    fn em(&self, st: &St) -> f32 {
        st.em(&self.c)
    }

    /// Lays out items left to right with math spacing.
    fn hlist(&self, list: &[Node], st: &St) -> MathBox {
        let mut atoms: Vec<Atom> = Vec::new();
        for node in list {
            self.node(node, st, &mut atoms);
        }
        self.join(atoms, st)
    }

    /// Joins atoms, applying TeX's binary-operator rules and spacing.
    fn join(&self, mut atoms: Vec<Atom>, st: &St) -> MathBox {
        // A binary operator with nothing to operate on is ordinary.
        let mut prev: Option<Class> = None;
        let indexes: Vec<usize> = (0..atoms.len()).filter(|&i| !atoms[i].kern).collect();
        for (k, &i) in indexes.iter().enumerate() {
            if atoms[i].left == Class::Bin {
                let after = indexes.get(k + 1).map(|&j| atoms[j].left);
                let unary = matches!(
                    prev,
                    None | Some(Class::Bin | Class::Op | Class::Rel | Class::Open | Class::Punct)
                ) || matches!(
                    after,
                    None | Some(Class::Rel | Class::Close | Class::Punct)
                );
                if unary {
                    atoms[i].left = Class::Ord;
                    atoms[i].right = Class::Ord;
                }
            }
            prev = Some(atoms[i].right);
        }
        let tight = st.level >= Level::Script;
        let mu = self.em(st) / 18.0;
        let mut out = MathBox::default();
        let mut x = 0.0;
        let mut prev: Option<Class> = None;
        let mut italic = 0.0;
        for atom in atoms {
            if !atom.kern {
                if let Some(p) = prev {
                    x += f32::from(super::symbols::spacing(p, atom.left, tight)) * mu;
                }
                prev = Some(atom.right);
                italic = atom.bx.italic;
            } else {
                italic = 0.0;
            }
            let w = atom.bx.width;
            out.place(atom.bx, x, 0.0);
            x += w;
        }
        out.width = x;
        out.italic = italic;
        out
    }

    fn node(&self, node: &Node, st: &St, atoms: &mut Vec<Atom>) {
        match node {
            Node::Run(r) => self.run(r, st, atoms),
            Node::Group(list) => {
                let bx = self.hlist(list, st);
                atoms.push(Atom {
                    bx,
                    left: Class::Ord,
                    right: Class::Ord,
                    kern: false,
                });
            }
            Node::Func { name, body } => {
                let name_box = self.hlist(name, st);
                atoms.push(Atom {
                    bx: name_box,
                    left: Class::Op,
                    right: Class::Op,
                    kern: false,
                });
                for n in body {
                    self.node(n, st, atoms);
                }
                if body.is_empty() && self.placeholders {
                    atoms.push(self.ord(self.placeholder(st)));
                }
            }
            Node::Nary { body, .. } => {
                let op = self.structure(node, st);
                atoms.push(Atom {
                    bx: op,
                    left: Class::Op,
                    right: Class::Op,
                    kern: false,
                });
                let body_box = self.arg(body, st);
                atoms.push(self.ord(body_box));
            }
            Node::Delim { .. } => {
                // Spaced as the brackets it starts and ends with.
                let bx = self.structure(node, st);
                atoms.push(Atom {
                    bx,
                    left: Class::Open,
                    right: Class::Close,
                    kern: false,
                });
            }
            Node::Frac { .. } => {
                let bx = self.structure(node, st);
                atoms.push(Atom {
                    bx,
                    left: Class::Inner,
                    right: Class::Inner,
                    kern: false,
                });
            }
            Node::Scripts { base, .. } => {
                let bx = self.structure(node, st);
                // Scripts keep the class of their base (`x^2` is ordinary,
                // `=^?` a relation).
                let class = match base.as_slice() {
                    [Node::Run(r)] if !r.normal && r.text.chars().count() == 1 => {
                        r.text.chars().next().map_or(Class::Ord, class_of)
                    }
                    _ => Class::Ord,
                };
                let class = if class == Class::Op {
                    Class::Ord
                } else {
                    class
                };
                atoms.push(Atom {
                    bx,
                    left: class,
                    right: class,
                    kern: false,
                });
            }
            _ => {
                let bx = self.structure(node, st);
                atoms.push(self.ord(bx));
            }
        }
    }

    fn ord(&self, bx: MathBox) -> Atom {
        Atom {
            bx,
            left: Class::Ord,
            right: Class::Ord,
            kern: false,
        }
    }

    /// A required argument: its items, or a placeholder when empty.
    fn arg(&self, list: &[Node], st: &St) -> MathBox {
        if list.is_empty() && self.placeholders {
            return self.placeholder(st);
        }
        self.hlist(list, st)
    }

    /// A dotted square standing for an empty slot.
    fn placeholder(&self, st: &St) -> MathBox {
        let em = self.em(st);
        let (w, h) = (0.55 * em, 0.7 * em);
        let mut bx = MathBox::space(w + 0.1 * em, h, 0.0);
        let t = (0.04 * em).max(0.3);
        let dash = 0.08 * em;
        let fill = st.fill.clone();
        let (l, top) = (0.05 * em, -h);
        let mut x = 0.0;
        while x < w {
            let len = dash.min(w - x);
            bx.rule(Rect::from_xywh(l + x, top, len, t), &fill);
            bx.rule(Rect::from_xywh(l + x, -t, len, t), &fill);
            x += dash * 2.0;
        }
        let mut y = 0.0;
        while y < h {
            let len = dash.min(h - y);
            bx.rule(Rect::from_xywh(l, top + y, t, len), &fill);
            bx.rule(Rect::from_xywh(l + w - t, top + y, t, len), &fill);
            y += dash * 2.0;
        }
        bx
    }

    /// The ink of a glyph (ems).
    fn ink(&self, face: FaceId, glyph: u16) -> Ink {
        let advance = self.fonts.advance(face, glyph);
        match self.fonts.outline(face, glyph).and_then(|p| p.bounds()) {
            Some(b) => Ink {
                advance,
                left: b.x,
                right: b.x + b.w,
                top: -b.y,
                bottom: b.y + b.h,
            },
            None => Ink {
                advance,
                ..Ink::default()
            },
        }
    }

    /// A glyph as a box at `em` points per em, with its ink as height and depth.
    fn glyph_box(&self, choice: FontChoice, glyph: u16, em: f32, fill: &Fill) -> MathBox {
        let ink = self.ink(choice.face, glyph);
        MathBox {
            width: ink.advance * em,
            ascent: ink.top.max(0.0) * em,
            descent: ink.bottom.max(0.0) * em,
            italic: 0.0,
            items: vec![MathItem::Glyph(MathGlyph {
                face: choice.face,
                glyph,
                size: em,
                x: 0.0,
                y: 0.0,
                fill: fill.clone(),
                synthetic_bold: choice.synthetic_bold,
                synthetic_italic: choice.synthetic_italic,
            })],
        }
    }

    fn math_choice(&self) -> Option<FontChoice> {
        self.math.face.map(|face| FontChoice {
            face,
            synthetic_bold: false,
            synthetic_italic: false,
        })
    }

    /// A character from the math font (falling back to any face).
    fn math_glyph(&self, c: char) -> Option<(FontChoice, u16)> {
        if let (Some(choice), Some(g)) = (self.math_choice(), self.math.glyph(self.fonts, c)) {
            return Some((choice, g));
        }
        self.fallback(c, false, false)
    }

    fn fallback(&self, c: char, bold: bool, italic: bool) -> Option<(FontChoice, u16)> {
        let base = self.fonts.select("Cambria", bold, italic)?;
        if let Some(g) = self.fonts.glyph(base.face, c) {
            return Some((base, g));
        }
        let fb = self.fonts.fallback_for(c, base.face, bold, italic)?;
        self.fonts.glyph(fb.face, c).map(|g| (fb, g))
    }

    /// The face and glyph for a character of a math run.
    fn char_glyph(
        &self,
        c: char,
        style: Style,
        alphabet: Option<Alphabet>,
    ) -> Option<(FontChoice, u16, bool)> {
        let bold = matches!(style, Style::Bold | Style::BoldItalic);
        let italic = matches!(style, Style::Italic | Style::BoldItalic);
        match alphabet {
            Some(a @ (Alphabet::Script | Alphabet::Fraktur | Alphabet::DoubleStruck)) => {
                if let Some(m) =
                    math_char(c, Style::Plain, a).or_else(|| math_char(c, Style::Italic, a))
                    && let Some(found) = self.math_glyph(m)
                {
                    return Some((found.0, found.1, false));
                }
            }
            Some(Alphabet::SansSerif) => {
                let choice = self.fonts.select("Arial", bold, italic)?;
                if let Some(g) = self.fonts.glyph(choice.face, c) {
                    return Some((choice, g, false));
                }
            }
            Some(Alphabet::Monospace) => {
                let choice = self.fonts.select("Courier New", bold, italic)?;
                if let Some(g) = self.fonts.glyph(choice.face, c) {
                    return Some((choice, g, false));
                }
            }
            _ => {}
        }
        if is_greek(c) || matches!(c, '∂' | '∇') {
            if let Some(m) = math_char(c, style, Alphabet::Roman)
                && let Some(found) = self.math_glyph(m)
            {
                return Some((found.0, found.1, false));
            }
            return self.math_glyph(c).map(|(ch, g)| (ch, g, false));
        }
        // Letters, digits, and the operators Cambria has come from Caladea.
        let text_char = c.is_alphanumeric() && (c as u32) < 0x250
            || matches!(
                c,
                '+' | '−'
                    | '='
                    | '<'
                    | '>'
                    | '×'
                    | '±'
                    | '÷'
                    | '('
                    | ')'
                    | '['
                    | ']'
                    | '{'
                    | '}'
                    | '|'
                    | '/'
                    | ','
                    | '.'
                    | ';'
                    | ':'
                    | '!'
                    | '?'
                    | '\''
                    | '′'
                    | '″'
                    | '‴'
                    | '%'
                    | '&'
                    | '#'
                    | '@'
                    | '"'
                    | '≤'
                    | '≥'
                    | '≠'
                    | '≈'
                    | '∞'
                    | '·'
                    | '…'
                    | '°'
            );
        if text_char {
            let choice = self.fonts.select("Cambria", bold, italic)?;
            if let Some(g) = self.fonts.glyph(choice.face, c) {
                return Some((choice, g, false));
            }
        }
        // Other symbols: the math font, raised from its axis to Cambria's
        // when the symbol is an operator.
        if let Some((choice, g)) = self.math_glyph(c) {
            let raise = matches!(class_of(c), Class::Bin | Class::Rel)
                && Some(choice.face) == self.math.face;
            return Some((choice, g, raise));
        }
        self.fallback(c, bold, italic).map(|(ch, g)| (ch, g, false))
    }

    /// A math run: one atom per character, spaced by class.
    fn run(&self, r: &Run, st: &St, atoms: &mut Vec<Atom>) {
        let st = st.with(r.props.as_deref(), self.font_scale);
        let em = self.em(&st);
        if r.normal {
            atoms.push(self.ord(self.text_run(r, &st)));
            return;
        }
        for c in r.text.chars() {
            if let Some(width) = space_width(c) {
                atoms.push(Atom {
                    bx: MathBox::space(width * em, 0.0, 0.0),
                    left: Class::Ord,
                    right: Class::Ord,
                    kern: true,
                });
                continue;
            }
            let style = r.style.unwrap_or_else(|| default_style(c));
            let class = class_of(c);
            let Some((choice, glyph, raise)) = self.char_glyph(c, style, r.alphabet) else {
                atoms.push(Atom {
                    bx: MathBox::space(0.5 * em, 0.7 * em, 0.0),
                    left: class,
                    right: class,
                    kern: false,
                });
                continue;
            };
            let mut bx = self.glyph_box(choice, glyph, em, &st.fill);
            // Italic letters overhang their advance: as in TeX, the overhang
            // (italic correction) is part of their width, and a subscript
            // tucks back under it.
            let ink = self.ink(choice.face, glyph);
            bx.italic = if Some(choice.face) == self.math.face {
                self.math.italic_correction(glyph).unwrap_or(0.0) * em
            } else if matches!(style, Style::Italic | Style::BoldItalic) {
                (ink.right - ink.advance).max(0.0) * em
            } else {
                0.0
            };
            bx.width += bx.italic;
            if raise {
                bx = bx.lower(-(AXIS - super::font::Constants::default().axis_height) * em);
            }
            atoms.push(Atom {
                bx,
                left: class,
                right: class,
                kern: false,
            });
        }
    }

    /// Ordinary text inside an equation (`\text{}`), in the run's own font.
    fn text_run(&self, r: &Run, st: &St) -> MathBox {
        let em = self.em(st);
        let (family, bold, italic) = match r.props.as_deref() {
            Some(p) => (p.latin.as_str(), p.bold, p.italic),
            None => ("Cambria", false, false),
        };
        let bold = bold || matches!(r.style, Some(Style::Bold | Style::BoldItalic));
        let italic = italic || matches!(r.style, Some(Style::Italic | Style::BoldItalic));
        let family = if family.eq_ignore_ascii_case("Cambria Math") {
            "Cambria"
        } else {
            family
        };
        let mut out = MathBox::default();
        let mut x = 0.0;
        for c in r.text.chars() {
            let found = self
                .fonts
                .select(family, bold, italic)
                .and_then(|ch| self.fonts.glyph(ch.face, c).map(|g| (ch, g)))
                .or_else(|| self.fallback(c, bold, italic));
            let Some((choice, glyph)) = found else {
                x += 0.5 * em;
                continue;
            };
            let bx = self.glyph_box(choice, glyph, em, &st.fill);
            let w = bx.width;
            out.place(bx, x, 0.0);
            x += w;
        }
        out.width = x;
        out
    }

    /// Typesets a structure (everything but runs and plain groups).
    fn structure(&self, node: &Node, st: &St) -> MathBox {
        structs::layout(self, node, st)
    }
}

/// The width of a space character (ems), for characters that are spaces.
fn space_width(c: char) -> Option<f32> {
    Some(match c {
        ' ' | '\u{a0}' => 0.25,
        '\u{2009}' => 3.0 / 18.0,
        '\u{205F}' => 4.0 / 18.0,
        '\u{2004}' => 5.0 / 18.0,
        '\u{2002}' => 0.5,
        '\u{2003}' => 1.0,
        '\u{200A}' => 1.0 / 18.0,
        '\u{200B}' | '\u{2061}' | '\u{2062}' | '\u{2063}' | '\u{2064}' => 0.0,
        _ => return None,
    })
}
