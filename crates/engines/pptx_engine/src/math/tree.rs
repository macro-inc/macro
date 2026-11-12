//! The equation tree: the Office Math (OMML) structures as data.
//!
//! Both the OMML reader and the LaTeX-style linear format produce this
//! tree, and the typesetter, the OMML writer, and the LaTeX writer consume
//! it. Run formatting read from a slide (`props`) only matters to the
//! typesetter; trees parsed from linear text leave it empty.

use crate::model::text::RunProps;

/// A sequence of math items (an OMML argument such as `m:e` or `m:num`).
pub type List = Vec<Node>;

/// One equation: an inline `m:oMath` or a display `m:oMathPara`.
#[derive(Clone, Debug, PartialEq)]
pub struct Equation {
    /// A display equation (`m:oMathPara`): on its own line, centered by
    /// default, with large operators at display size.
    pub display: bool,
    /// Horizontal placement of a display equation's lines.
    pub justify: Justify,
    /// The lines (`m:oMath` children of a display equation; one line inline).
    pub lines: Vec<List>,
}

impl Equation {
    /// An equation of one line.
    pub fn new(display: bool, line: List) -> Self {
        Self {
            display,
            justify: Justify::CenterGroup,
            lines: vec![line],
        }
    }

    /// Whether the equation has no content at all.
    pub fn is_empty(&self) -> bool {
        self.lines.iter().all(Vec::is_empty)
    }
}

/// `m:jc` of a display equation.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Justify {
    /// Lines left-aligned with each other, the group centered (the default).
    CenterGroup,
    /// Each line centered.
    Center,
    /// Left.
    Left,
    /// Right.
    Right,
}

/// Explicit math style of a run (`m:sty`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Style {
    /// Upright (`p`).
    Plain,
    /// Bold upright (`b`).
    Bold,
    /// Italic (`i`).
    Italic,
    /// Bold italic (`bi`).
    BoldItalic,
}

/// Math alphabet of a run (`m:scr`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Alphabet {
    /// The default serif alphabet.
    Roman,
    /// Script (calligraphic).
    Script,
    /// Fraktur.
    Fraktur,
    /// Double-struck (blackboard bold).
    DoubleStruck,
    /// Sans-serif.
    SansSerif,
    /// Monospace.
    Monospace,
}

/// A run of math text (`m:r`).
#[derive(Clone, Debug, PartialEq)]
pub struct Run {
    /// The text, with OMML's math alphanumerics (`𝑥`) mapped back to plain
    /// letters plus `style`/`alphabet`.
    pub text: String,
    /// Explicit style; `None` follows the defaults (italic letters, upright
    /// digits and operators).
    pub style: Option<Style>,
    /// Alphabet; `None` is roman.
    pub alphabet: Option<Alphabet>,
    /// Ordinary text inside math (`m:nor`, LaTeX `\text{}`): set in the
    /// run's text font, without math spacing.
    pub normal: bool,
    /// Formatting from the run's `a:rPr` (typesetting only).
    pub props: Option<Box<RunProps>>,
}

impl Run {
    /// A run of `text` in the default style.
    pub fn new(text: impl Into<String>) -> Self {
        Self {
            text: text.into(),
            style: None,
            alphabet: None,
            normal: false,
            props: None,
        }
    }

    /// The same text settings without slide formatting.
    pub fn same_style(&self, other: &Run) -> bool {
        self.style == other.style && self.alphabet == other.alphabet && self.normal == other.normal
    }
}

/// `m:type` of a fraction.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FracKind {
    /// Stacked with a bar (the default).
    Bar,
    /// Skewed: numerator up and left of a slash, denominator down and right.
    Skewed,
    /// Linear: `a/b` on one line.
    Linear,
    /// Stacked without a bar (binomial coefficients).
    NoBar,
}

/// Where an n-ary operator's limits go (`m:limLoc`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LimLoc {
    /// The operator's default: under and over for sums and products, as
    /// scripts for integrals.
    Auto,
    /// Centered under and over the operator (in display equations).
    UnderOver,
    /// To the side, as subscript and superscript.
    SubSup,
}

/// Which sides a border box draws and which strikes cross it.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub struct Borders {
    /// No top edge.
    pub hide_top: bool,
    /// No bottom edge.
    pub hide_bottom: bool,
    /// No left edge.
    pub hide_left: bool,
    /// No right edge.
    pub hide_right: bool,
    /// A horizontal strike.
    pub strike_h: bool,
    /// A vertical strike.
    pub strike_v: bool,
    /// A strike from bottom left to top right.
    pub strike_bltr: bool,
    /// A strike from top left to bottom right.
    pub strike_tlbr: bool,
}

/// A math item.
#[derive(Clone, Debug, PartialEq)]
pub enum Node {
    /// Text.
    Run(Run),
    /// A fraction (`m:f`).
    Frac {
        /// Bar, skewed, linear, or no bar.
        kind: FracKind,
        /// Numerator.
        num: List,
        /// Denominator.
        den: List,
        /// Formatting of the bar (`m:ctrlPr`).
        props: Option<Box<RunProps>>,
    },
    /// Subscript and/or superscript after a base (`m:sSub`, `m:sSup`, `m:sSubSup`).
    Scripts {
        /// The base.
        base: List,
        /// Subscript.
        sub: Option<List>,
        /// Superscript.
        sup: Option<List>,
    },
    /// Scripts before a base (`m:sPre`).
    PreScripts {
        /// The base.
        base: List,
        /// Pre-subscript.
        sub: List,
        /// Pre-superscript.
        sup: List,
    },
    /// A radical (`m:rad`).
    Radical {
        /// The index (`None` when hidden: a square root).
        degree: Option<List>,
        /// The radicand.
        body: List,
        /// Formatting of the radical sign.
        props: Option<Box<RunProps>>,
    },
    /// An n-ary operator with limits and an operand (`m:nary`).
    Nary {
        /// The operator character (`∑`, `∫`...).
        op: char,
        /// Limit placement.
        limits: LimLoc,
        /// The operator grows with its operand (`m:grow`).
        grow: bool,
        /// Lower limit (`None` when hidden).
        sub: Option<List>,
        /// Upper limit (`None` when hidden).
        sup: Option<List>,
        /// The operand.
        body: List,
        /// Formatting of the operator.
        props: Option<Box<RunProps>>,
    },
    /// Delimiters around one or more items (`m:d`).
    Delim {
        /// Opening character (`None`: none).
        open: Option<char>,
        /// Closing character (`None`: none).
        close: Option<char>,
        /// Separator between items.
        sep: char,
        /// The delimiters grow to the content (`m:grow`, the default).
        grow: bool,
        /// The items (`m:e`).
        items: Vec<List>,
        /// Formatting of the delimiters.
        props: Option<Box<RunProps>>,
    },
    /// A function application such as `sin x` (`m:func`).
    Func {
        /// The function name (usually an upright run, or limits around one).
        name: List,
        /// The argument.
        body: List,
    },
    /// A limit under or over a base (`m:limLow`, `m:limUpp`).
    Limit {
        /// Over (`m:limUpp`) instead of under.
        upper: bool,
        /// The base.
        base: List,
        /// The limit.
        limit: List,
    },
    /// An accent over a base (`m:acc`).
    Accent {
        /// The accent character (combining marks such as U+0302).
        chr: char,
        /// The base.
        base: List,
        /// Formatting of the accent.
        props: Option<Box<RunProps>>,
    },
    /// A bar over or under a base (`m:bar`).
    Bar {
        /// Over (instead of under).
        top: bool,
        /// The base.
        base: List,
        /// Formatting of the bar.
        props: Option<Box<RunProps>>,
    },
    /// A stretched character over or under a base, such as a brace (`m:groupChr`).
    GroupChr {
        /// The character.
        chr: char,
        /// Over (instead of under).
        top: bool,
        /// The base.
        base: List,
        /// Formatting of the character.
        props: Option<Box<RunProps>>,
    },
    /// A frame or strikes around a base (`m:borderBox`).
    BorderBox {
        /// Sides and strikes.
        borders: Borders,
        /// The base.
        base: List,
        /// Formatting of the lines.
        props: Option<Box<RunProps>>,
    },
    /// An invisible grouping box (`m:box`).
    Group(List),
    /// Rows aligned at `&` marks (`m:eqArr`).
    EqArray(Vec<List>),
    /// A matrix (`m:m`), rows of cells.
    Matrix(Vec<Vec<List>>),
    /// Content that takes (some of) its space without showing, or shows
    /// without taking space (`m:phant`).
    Phantom {
        /// Show the content.
        show: bool,
        /// Take no width.
        zero_width: bool,
        /// Take no height above the baseline.
        zero_ascent: bool,
        /// Take no depth below the baseline.
        zero_descent: bool,
        /// The content.
        base: List,
    },
}

/// Removes slide formatting from every run and structure (for comparing
/// trees by content).
pub fn strip_props(list: &mut List) {
    for node in list {
        match node {
            Node::Run(r) => r.props = None,
            Node::Frac {
                num, den, props, ..
            } => {
                *props = None;
                strip_props(num);
                strip_props(den);
            }
            Node::Scripts { base, sub, sup } => {
                strip_props(base);
                sub.iter_mut().chain(sup.iter_mut()).for_each(strip_props);
            }
            Node::PreScripts { base, sub, sup } => {
                strip_props(base);
                strip_props(sub);
                strip_props(sup);
            }
            Node::Radical {
                degree,
                body,
                props,
            } => {
                *props = None;
                degree.iter_mut().for_each(strip_props);
                strip_props(body);
            }
            Node::Nary {
                sub,
                sup,
                body,
                props,
                ..
            } => {
                *props = None;
                sub.iter_mut().chain(sup.iter_mut()).for_each(strip_props);
                strip_props(body);
            }
            Node::Delim { items, props, .. } => {
                *props = None;
                items.iter_mut().for_each(strip_props);
            }
            Node::Func { name, body } => {
                strip_props(name);
                strip_props(body);
            }
            Node::Limit { base, limit, .. } => {
                strip_props(base);
                strip_props(limit);
            }
            Node::Accent { base, props, .. }
            | Node::Bar { base, props, .. }
            | Node::GroupChr { base, props, .. }
            | Node::BorderBox { base, props, .. } => {
                *props = None;
                strip_props(base);
            }
            Node::Group(base) | Node::Phantom { base, .. } => strip_props(base),
            Node::EqArray(rows) => rows.iter_mut().for_each(strip_props),
            Node::Matrix(rows) => rows.iter_mut().flatten().for_each(strip_props),
        }
    }
}
