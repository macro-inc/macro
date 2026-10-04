//! The resolved text model: body, paragraph, and run properties.

use crate::model::color::Rgba;
use crate::model::fill::{Effects, Fill, LineProps};
use crate::xml::NodeId;

/// Vertical anchoring of text in its box.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Anchor {
    /// Top.
    Top,
    /// Middle.
    Middle,
    /// Bottom.
    Bottom,
}

/// Text direction of a body.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Vert {
    /// Horizontal.
    Horz,
    /// Rotated 90° clockwise.
    Vert,
    /// Rotated 270° clockwise.
    Vert270,
    /// East Asian vertical (approximated as rotated 90°).
    EaVert,
    /// Stacked letters.
    Stacked,
}

/// Autofit behavior.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Autofit {
    /// Text may overflow.
    None,
    /// Shrink text: font scale and line-spacing reduction (fractions).
    Normal {
        /// Font scale (1.0 = 100%).
        font_scale: f32,
        /// Line spacing reduction (0.2 = 20 percentage points).
        line_reduction: f32,
    },
    /// The shape grows to fit the text.
    Shape,
}

/// Resolved body properties.
#[derive(Clone, Debug, PartialEq)]
pub struct BodyProps {
    /// Left, top, right, bottom insets in points.
    pub insets: [f32; 4],
    /// Vertical anchor.
    pub anchor: Anchor,
    /// Center the text block horizontally.
    pub anchor_ctr: bool,
    /// Wrap lines at the box width.
    pub wrap: bool,
    /// Text direction.
    pub vert: Vert,
    /// Extra text rotation in degrees.
    pub rot: f32,
    /// Number of columns.
    pub num_col: u32,
    /// Space between columns in points.
    pub spc_col: f32,
    /// Autofit.
    pub autofit: Autofit,
    /// Clip text that overflows the box vertically (`vertOverflow="clip"`/`"ellipsis"`).
    pub clip_overflow: bool,
}

impl Default for BodyProps {
    fn default() -> Self {
        Self {
            insets: [7.2, 3.6, 7.2, 3.6],
            anchor: Anchor::Top,
            anchor_ctr: false,
            wrap: true,
            vert: Vert::Horz,
            rot: 0.0,
            num_col: 1,
            spc_col: 0.0,
            autofit: Autofit::None,
            clip_overflow: false,
        }
    }
}

/// Horizontal paragraph alignment.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Align {
    /// Left.
    Left,
    /// Centered.
    Center,
    /// Right.
    Right,
    /// Justified (last line left).
    Justify,
    /// Distributed (every line, including the last).
    Distributed,
}

/// Line or paragraph spacing.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Spacing {
    /// Fraction of single spacing (1.0 = 100%).
    Percent(f32),
    /// Exact points.
    Points(f32),
}

/// A tab stop.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct TabStop {
    /// Position in points from the left inset.
    pub pos: f32,
    /// `l`, `ctr`, `r`, or `dec` alignment.
    pub align: TabAlign,
}

/// Tab stop alignment.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TabAlign {
    /// Left-aligned.
    Left,
    /// Centered.
    Center,
    /// Right-aligned.
    Right,
    /// Aligned on the decimal point.
    Decimal,
}

/// Bullet glyph or numbering.
#[derive(Clone, Debug, PartialEq)]
pub enum BulletKind {
    /// No bullet.
    None,
    /// A character bullet.
    Char(String),
    /// Automatic numbering (`arabicPeriod`...) starting at `start`.
    AutoNum {
        /// Numbering scheme.
        scheme: String,
        /// First number.
        start: u32,
    },
    /// A picture bullet (image part).
    Picture(Option<String>),
}

/// Bullet size.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum BulletSize {
    /// Same as the first run.
    FollowText,
    /// Fraction of the first run's size.
    Percent(f32),
    /// Absolute points.
    Points(f32),
}

/// A resolved bullet.
#[derive(Clone, Debug, PartialEq)]
pub struct Bullet {
    /// Kind.
    pub kind: BulletKind,
    /// Font typeface, `None` = follow the text.
    pub font: Option<String>,
    /// Size.
    pub size: BulletSize,
    /// Color, `None` = follow the text.
    pub color: Option<Rgba>,
}

/// Resolved paragraph properties.
#[derive(Clone, Debug, PartialEq)]
pub struct ParaProps {
    /// Alignment.
    pub align: Align,
    /// Left margin (points).
    pub mar_l: f32,
    /// Right margin (points).
    pub mar_r: f32,
    /// First-line indent relative to `mar_l` (points, negative = hanging).
    pub indent: f32,
    /// Line spacing.
    pub line_spacing: Spacing,
    /// Space before.
    pub space_before: Spacing,
    /// Space after.
    pub space_after: Spacing,
    /// Bullet.
    pub bullet: Bullet,
    /// Custom tab stops.
    pub tabs: Vec<TabStop>,
    /// Default tab size (points).
    pub default_tab: f32,
    /// Right-to-left paragraph.
    pub rtl: bool,
    /// Outline level (0-based).
    pub level: u8,
    /// Whether Latin words may break mid-word.
    pub latin_line_break: bool,
}

/// Underline style.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Underline {
    /// None.
    None,
    /// Single.
    Single,
    /// Double.
    Double,
    /// Thick.
    Heavy,
    /// Dotted.
    Dotted,
    /// Dashed.
    Dash,
    /// Wavy.
    Wavy,
}

/// Strikethrough style.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Strike {
    /// None.
    None,
    /// Single.
    Single,
    /// Double.
    Double,
}

/// Capitalization.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Caps {
    /// As typed.
    None,
    /// Small capitals.
    Small,
    /// All capitals.
    All,
}

/// Resolved run properties.
#[derive(Clone, Debug, PartialEq)]
pub struct RunProps {
    /// Size in points (before autofit scaling).
    pub size: f32,
    /// Bold.
    pub bold: bool,
    /// Italic.
    pub italic: bool,
    /// Underline.
    pub underline: Underline,
    /// Strikethrough.
    pub strike: Strike,
    /// Capitalization.
    pub caps: Caps,
    /// Baseline shift as a fraction of the size (0.3 = superscript).
    pub baseline: f32,
    /// Extra character spacing (points).
    pub spacing: f32,
    /// Minimum size (points) at which kerning applies; 0 disables kerning.
    pub kern: f32,
    /// Latin typeface (theme references resolved).
    pub latin: String,
    /// East Asian typeface.
    pub ea: String,
    /// Complex-script typeface.
    pub cs: String,
    /// Symbol typeface.
    pub sym: String,
    /// Text fill.
    pub fill: Fill,
    /// Text outline.
    pub outline: Option<LineProps>,
    /// Highlight color.
    pub highlight: Option<Rgba>,
    /// Text effects.
    pub effects: Effects,
    /// Language tag.
    pub lang: String,
}

/// What a run contains.
#[derive(Clone, Debug, PartialEq)]
pub enum RunKind {
    /// Text.
    Text,
    /// A line break (`a:br`).
    Break,
    /// A field (`a:fld`) of the given type; `text` holds its display value.
    Field(String),
    /// An equation (`a14:m`, usually inside `mc:AlternateContent`); `text`
    /// is one U+FFFC, as it counts one character.
    Math(Box<crate::math::Equation>),
}

/// Where a hyperlink (`a:hlinkClick`) goes.
#[derive(Clone, Debug, PartialEq)]
pub enum LinkTarget {
    /// An external address: a web page, `mailto:`, or a file.
    Url(String),
    /// Another slide of the deck, by part name.
    Slide(String),
    /// A slide show jump: `firstslide`, `lastslide`, `nextslide`,
    /// `previousslide`, `lastslideviewed`, or `endshow`.
    Jump(String),
}

/// A hyperlink on text or on a shape.
#[derive(Clone, Debug, PartialEq)]
pub struct Link {
    /// Where it goes.
    pub target: LinkTarget,
    /// The ScreenTip shown on hover.
    pub tooltip: Option<String>,
}

/// A resolved run.
#[derive(Clone, Debug, PartialEq)]
pub struct Run {
    /// Display text.
    pub text: String,
    /// Properties.
    pub props: RunProps,
    /// Kind.
    pub kind: RunKind,
    /// Hyperlink, if any.
    pub link: Option<Link>,
    /// The run element (`a:r`, `a:br`, `a:fld`).
    pub node: NodeId,
}

/// A resolved paragraph.
#[derive(Clone, Debug, PartialEq)]
pub struct Paragraph {
    /// Properties.
    pub props: ParaProps,
    /// Runs.
    pub runs: Vec<Run>,
    /// Properties of the paragraph end mark (sizes empty paragraphs).
    pub end_props: RunProps,
    /// The `a:p` element.
    pub node: NodeId,
}

impl Paragraph {
    /// Plain text of the paragraph (line breaks as `\n`).
    pub fn text(&self) -> String {
        self.runs
            .iter()
            .map(|r| {
                if r.kind == RunKind::Break {
                    "\n"
                } else {
                    r.text.as_str()
                }
            })
            .collect()
    }
}

/// A resolved text body.
#[derive(Clone, Debug, PartialEq)]
pub struct TextBody {
    /// Body properties.
    pub body: BodyProps,
    /// Paragraphs.
    pub paragraphs: Vec<Paragraph>,
    /// The `txBody` element.
    pub node: NodeId,
}

impl TextBody {
    /// Plain text (paragraphs separated by `\n`).
    pub fn text(&self) -> String {
        self.paragraphs
            .iter()
            .map(Paragraph::text)
            .collect::<Vec<_>>()
            .join("\n")
    }

    /// Whether the body has no visible text.
    pub fn is_empty(&self) -> bool {
        self.paragraphs
            .iter()
            .all(|p| p.runs.iter().all(|r| r.text.trim().is_empty()))
    }
}
