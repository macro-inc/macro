//! Values the edit operations take: text positions, formatting patches,
//! fills, outlines, new shapes, chart data, and table borders.

use super::{EffectSpec, GlowOptions, ShadowOptions, nullable};
use serde::{Deserialize, Deserializer, Serialize};

/// Reads `null` (as AI tool calls send for an omitted start) as 1.
fn nullable_start<'de, D: Deserializer<'de>>(de: D) -> Result<u32, D::Error> {
    Ok(Option::<u32>::deserialize(de)?.unwrap_or_else(one))
}

/// A position inside a shape's text.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
pub struct TextPos {
    /// Paragraph index.
    pub paragraph: usize,
    /// Character offset within the paragraph.
    pub offset: usize,
}

/// A table cell inside a graphic frame (0-based).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
pub struct CellRef {
    /// Row index.
    pub row: usize,
    /// Column index.
    pub col: usize,
}

/// Character formatting changes (`None` = leave unchanged).
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase", default, deny_unknown_fields)]
pub struct RunPatch {
    /// Bold.
    pub bold: Option<bool>,
    /// Italic.
    pub italic: Option<bool>,
    /// Underline.
    pub underline: Option<bool>,
    /// Strikethrough.
    pub strike: Option<bool>,
    /// Size in points.
    pub size: Option<f32>,
    /// Text color as `RRGGBB`.
    pub color: Option<String>,
    /// Latin typeface.
    pub font: Option<String>,
    /// Highlight color as `RRGGBB`, or `""` to remove.
    pub highlight: Option<String>,
    /// Baseline shift in percent (30 = superscript, -25 = subscript, 0 = normal).
    pub baseline: Option<f32>,
    /// Character spacing in points added between letters (negative
    /// condenses; 0 = normal).
    pub spacing: Option<f32>,
    /// Hyperlink, or `""` to remove: an address (`https://…`, `mailto:…`),
    /// `#slide=<id>` for another slide by stable id, or a slide show jump
    /// (`#nextslide`, `#previousslide`, `#firstslide`, `#lastslide`,
    /// `#lastslideviewed`, `#endshow`).
    pub link: Option<String>,
    /// The link's ScreenTip (written with `link`).
    pub link_tip: Option<String>,
    /// Text shadow (WordArt-style): a preset name, `none`, or options, as
    /// for `setShapeEffects`.
    pub shadow: Option<EffectSpec<ShadowOptions>>,
    /// Text glow: `none` or options, as for `setShapeEffects`.
    pub glow: Option<EffectSpec<GlowOptions>>,
}

/// Bullet style for paragraphs.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase", tag = "kind", deny_unknown_fields)]
pub enum BulletSpec {
    /// No bullet.
    None,
    /// Inherit from the layout/master (removes explicit bullet settings).
    Inherit,
    /// A character bullet.
    Char {
        /// The bullet character.
        char: String,
    },
    /// Automatic numbering (`arabicPeriod`, `romanUcPeriod`, `alphaLcParenR`...).
    Number {
        /// Numbering scheme.
        scheme: String,
        /// First number.
        #[serde(default = "one", deserialize_with = "nullable_start")]
        start: u32,
    },
}

fn one() -> u32 {
    1
}

/// Paragraph formatting changes.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase", default, deny_unknown_fields)]
pub struct ParaPatch {
    /// `left`, `center`, `right`, `justify`, `distributed`.
    pub align: Option<String>,
    /// Outline level 0-8.
    pub level: Option<u8>,
    /// Bullet.
    pub bullet: Option<BulletSpec>,
    /// Line spacing as a multiple of single spacing (1.0, 1.5...).
    pub line_spacing: Option<f32>,
    /// Space before in points.
    pub space_before: Option<f32>,
    /// Space after in points.
    pub space_after: Option<f32>,
    /// Left margin in points.
    pub margin_left: Option<f32>,
    /// First-line indent in points (negative = hanging).
    pub indent: Option<f32>,
}

/// Text box (body) changes.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase", default, deny_unknown_fields)]
pub struct BodyPatch {
    /// `top`, `middle`, `bottom`.
    pub anchor: Option<String>,
    /// Wrap text at the box width.
    pub wrap: Option<bool>,
    /// `none`, `shrink` (shrink text on overflow), `resize` (resize shape to fit).
    pub autofit: Option<String>,
    /// Insets `[left, top, right, bottom]` in points.
    pub insets: Option<[f32; 4]>,
    /// Number of columns.
    pub columns: Option<u32>,
    /// Text direction (PowerPoint's Text Direction): `horz` (horizontal),
    /// `vert` (rotate all text 90°: lines run top to bottom, stacking right
    /// to left), `vert270` (rotate all text 270°: lines run bottom to top,
    /// stacking left to right), `wordArtVert` (stacked: upright letters one
    /// under another), `eaVert` (East Asian vertical: CJK upright, other
    /// text rotated 90°), `mongolianVert` (like `eaVert`, lines stacking
    /// left to right), or `wordArtVertRtl` (stacked, lines stacking right to
    /// left). Insets stay on the shape's sides; `anchor` `top` is where the
    /// first line goes (the right edge for `vert`). Switching a text box that
    /// resizes to fit its text between horizontal and vertical swaps its
    /// width and height first. Applies to table cells too. Omitted or null
    /// keeps the direction.
    pub direction: Option<TextDirection>,
}

/// Which way a drawing guide runs.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase")]
pub enum GuideOrient {
    /// A line across the slide, at a distance from its top edge.
    Horizontal,
    /// A line down the slide, at a distance from its left edge.
    Vertical,
}

/// One drawing guide of [`EditOp::SetGuides`](super::EditOp::SetGuides).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GuideSpec {
    /// `horizontal` (a line across the slide) or `vertical` (a line down it).
    pub orient: GuideOrient,
    /// Distance in points from the slide's top edge (horizontal guides) or
    /// left edge (vertical guides), from 0 to the slide's height or width.
    /// The slide's center is half its height or width.
    pub position: f32,
    /// Color as `RRGGBB` or a theme color name (`accent1`, `tx1`...).
    /// Omitted or null keeps the color of the guide `id` names, and gives a
    /// new guide PowerPoint's gray.
    #[serde(default)]
    pub color: Option<String>,
    /// The id (from the deck outline's `guides`) of the guide this entry
    /// keeps, with anything else the file stores on it. Omitted or null for
    /// a new guide.
    #[serde(default)]
    pub id: Option<u32>,
}

/// A text direction (`ST_TextVerticalType`).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
pub enum TextDirection {
    /// Horizontal.
    #[serde(rename = "horz")]
    Horz,
    /// Rotate all text 90°.
    #[serde(rename = "vert")]
    Vert,
    /// Rotate all text 270°.
    #[serde(rename = "vert270")]
    Vert270,
    /// Stacked.
    #[serde(rename = "wordArtVert")]
    WordArtVert,
    /// East Asian vertical.
    #[serde(rename = "eaVert")]
    EaVert,
    /// Mongolian vertical.
    #[serde(rename = "mongolianVert")]
    MongolianVert,
    /// Stacked, lines right to left.
    #[serde(rename = "wordArtVertRtl")]
    WordArtVertRtl,
}

/// A fill specification.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase", tag = "kind", deny_unknown_fields)]
pub enum FillSpec {
    /// No fill.
    None,
    /// Solid color.
    Solid {
        /// `RRGGBB`, or a theme color name (`accent1`, `tx1`, `bg1`...).
        color: String,
        /// Opacity 0-1.
        #[serde(default)]
        alpha: Option<f32>,
    },
    /// Linear gradient.
    Gradient {
        /// Stop colors (`RRGGBB` or theme names), evenly spaced.
        colors: Vec<String>,
        /// Angle in degrees.
        #[serde(default, deserialize_with = "nullable")]
        angle: f32,
    },
}

/// Outline changes.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase", default, deny_unknown_fields)]
pub struct LinePatch {
    /// Remove the outline.
    #[serde(deserialize_with = "nullable")]
    pub none: bool,
    /// Color (`RRGGBB` or theme name).
    pub color: Option<String>,
    /// Width in points.
    pub width: Option<f32>,
    /// Preset dash (`solid`, `dash`, `dot`, `dashDot`, `lgDash`, `sysDash`, `sysDot`).
    pub dash: Option<String>,
    /// Arrowhead at the end (`none`, `triangle`, `stealth`, `diamond`, `oval`, `arrow`).
    pub tail: Option<String>,
    /// Arrowhead at the start.
    pub head: Option<String>,
}

/// What to add with [`EditOp::AddShape`](super::EditOp::AddShape).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[serde(
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    tag = "kind",
    deny_unknown_fields
)]
pub enum NewShape {
    /// A text box.
    TextBox {
        /// Initial text (`\n` separates paragraphs).
        #[serde(default, deserialize_with = "nullable")]
        text: String,
    },
    /// A preset shape (`rect`, `roundRect`, `ellipse`, `rightArrow`...).
    Shape {
        /// Preset geometry name.
        preset: String,
        /// Initial text.
        #[serde(default, deserialize_with = "nullable")]
        text: String,
    },
    /// A straight line from the top-left to the bottom-right of the box.
    Line {
        /// Arrowhead at the end.
        #[serde(default, deserialize_with = "nullable")]
        arrow: bool,
    },
    /// A picture.
    Image {
        /// Base64-encoded PNG, JPEG, or GIF bytes.
        data: String,
        /// Alt text.
        #[serde(default, deserialize_with = "nullable")]
        description: String,
    },
    /// A video, played when clicked in a slide show. A zero width or height
    /// takes the poster's aspect ratio.
    Video {
        /// Base64-encoded MP4, M4V, MOV, WebM, WMV, or AVI bytes.
        data: String,
        /// The file's MIME type (`video/mp4`...).
        content_type: String,
        /// Base64-encoded PNG or JPEG shown until it plays (its first frame).
        poster: String,
        /// Alt text.
        #[serde(default, deserialize_with = "nullable")]
        description: String,
    },
    /// An audio clip, shown as its poster (a speaker icon) and played when
    /// clicked in a slide show.
    Audio {
        /// Base64-encoded MP3, M4A, WAV, or OGG bytes.
        data: String,
        /// The file's MIME type (`audio/mpeg`...).
        content_type: String,
        /// Base64-encoded PNG or JPEG icon.
        poster: String,
        /// Alt text.
        #[serde(default, deserialize_with = "nullable")]
        description: String,
    },
    /// A table.
    Table {
        /// Cell text, row by row.
        cells: Vec<Vec<String>>,
    },
    /// A chart with an embedded workbook holding its data.
    Chart {
        /// `bar` (horizontal), `column`, `line`, `pie`, `doughnut`, or `area`.
        chart_type: String,
        /// `clustered`, `stacked`, `percentStacked`, or `standard` (the type's default when omitted).
        #[serde(default)]
        grouping: Option<String>,
        /// Category labels.
        categories: Vec<String>,
        /// Series in plot order.
        series: Vec<ChartSeriesData>,
        /// Chart title (no title when omitted or empty).
        #[serde(default)]
        title: Option<String>,
    },
}

/// One series of chart data.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChartSeriesData {
    /// Series name (legend text).
    pub name: String,
    /// One value per category (`null` for a blank).
    pub values: Vec<Option<f64>>,
}

/// A series color for [`EditOp::FormatChart`](super::EditOp::FormatChart).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChartSeriesColor {
    /// Series index in plot order (0-based).
    pub series: u32,
    /// `RRGGBB`, or a theme color name (`accent1`, `tx1`...).
    pub color: String,
}

/// One theme color for [`EditOp::SetThemeColors`](super::EditOp::SetThemeColors).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ThemeColor {
    /// `dk1`, `lt1`, `dk2`, `lt2`, `accent1`-`accent6`, `hlink`, or `folHlink`.
    pub slot: String,
    /// `RRGGBB`.
    pub color: String,
}

/// An animation's effect group (PowerPoint's Entrance, Emphasis, Exit, and
/// Motion Paths galleries).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase")]
pub enum AnimationClass {
    /// Makes the shape appear (it is hidden until the effect plays).
    Entrance,
    /// Draws attention to a shape that is already visible.
    Emphasis,
    /// Makes the shape disappear.
    Exit,
    /// Moves the shape along a motion path.
    Path,
    /// Plays, pauses, or stops a video or sound (only kept, never created).
    Media,
    /// Anything else, such as an embedded object's verb (only kept, never created).
    Other,
}

/// When an animation starts.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase")]
pub enum AnimationStart {
    /// When the presenter clicks (or presses the next key).
    OnClick,
    /// At the same time as the previous animation.
    WithPrevious,
    /// When the previous animation has finished.
    AfterPrevious,
}

/// How often an animation plays.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[serde(untagged)]
pub enum AnimationRepeat {
    /// Plays this many times in all (`1` = once, no repeat; fractions such as 2.5 are allowed).
    Times(f32),
    /// Repeats until an event.
    Until(RepeatUntil),
}

/// The event that ends a repeating animation.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase")]
pub enum RepeatUntil {
    /// Until the presenter clicks again.
    UntilNextClick,
    /// Until the slide ends.
    UntilEndOfSlide,
}

/// One animation of a slide, for [`EditOp::SetAnimations`] and
/// [`EditOp::AddAnimation`]. Omitted (or null) fields take the effect's
/// defaults, or keep the values of the existing animation it matches.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AnimationSpec {
    /// Id of the shape to animate. A group member's id animates only that member.
    pub shape_id: u32,
    /// Effect group: `entrance`, `emphasis`, `exit`, or `path` (`media` and
    /// `other` can only keep animations the slide already has).
    pub class: AnimationClass,
    /// Effect name. Entrance: `appear`, `fade`, `flyIn`, `floatIn`, `split`,
    /// `wipe`, `shape`, `wheel`, `randomBars`, `growTurn`, `zoom`, `swivel`,
    /// `bounce`. Emphasis: `pulse`, `colorPulse`, `teeter`, `spin`,
    /// `growShrink`, `desaturate`, `darken`, `lighten`, `transparency`,
    /// `boldFlash`, `wave`. Exit: `disappear`, `fadeOut`, `flyOut`,
    /// `floatOut`, `split`, `wipe`, `shape`, `wheel`, `randomBars`,
    /// `shrinkTurn`, `zoom`, `swivel`, `bounce`. Path: `path`. Other names
    /// the slide's outline reports (and `custom`) only keep an existing
    /// animation of that name on the same shape.
    pub effect: String,
    /// `onClick` (the default for a new animation), `withPrevious`, or `afterPrevious`.
    #[serde(default)]
    pub start: Option<AnimationStart>,
    /// Duration of one play in milliseconds, 10-60000 (default: the
    /// effect's, e.g. 500 for fade, flyIn, wipe, and zoom, 1000 for floatIn
    /// and teeter, 2000 for spin, growShrink, shape, wheel, and paths).
    /// `appear` and `disappear` are instant and ignore it.
    #[serde(default)]
    pub duration_ms: Option<u32>,
    /// Wait in milliseconds after the animation's start (click, previous
    /// animation's start, or its end) before it plays, 0-60000 (default 0).
    #[serde(default)]
    pub delay_ms: Option<u32>,
    /// Effect option (default: the first listed). `flyIn`, `flyOut` (edge it
    /// flies in from or out to): `bottom`, `left`, `right`, `top`,
    /// `bottomLeft`, `bottomRight`, `topLeft`, `topRight`; `wipe` (edge it
    /// starts from): `bottom`, `left`, `right`, `top`; `split` (entrance):
    /// `verticalOut`, `horizontalOut`, `verticalIn`, `horizontalIn` (exit:
    /// the `In` ones first); `shape` (entrance): `circleOut`, `circleIn`,
    /// `boxOut`, `boxIn`, `diamondOut`, `diamondIn`, `plusOut`, `plusIn`
    /// (exit: `circleIn` first); `wheel`: `spokes1`, `spokes2`, `spokes3`,
    /// `spokes4`, `spokes8`; `randomBars`: `horizontal`, `vertical`; `zoom`:
    /// `objectCenter`, `slideCenter`; `floatIn`: `up`, `down`; `floatOut`:
    /// `down`, `up`; `spin`: `clockwise`, `counterclockwise`; `path`: `down`,
    /// `left`, `right`, `up` (a straight line a quarter of the slide long).
    #[serde(default)]
    pub direction: Option<String>,
    /// Animate only this paragraph of the shape's text (0-based); omit to
    /// animate the whole shape. One animation per paragraph builds a list
    /// paragraph by paragraph.
    #[serde(default)]
    pub paragraph: Option<u32>,
    /// How often it plays: a count (`2`, `3`...; `1` = no repeat),
    /// `untilNextClick`, or `untilEndOfSlide`.
    #[serde(default)]
    pub repeat: Option<AnimationRepeat>,
    /// `path` class only: a motion path of its own instead of a direction,
    /// in PowerPoint's syntax with coordinates as fractions of the slide's
    /// width and height relative to the shape's position (`M 0 0 L 0.25 0.1 E`;
    /// commands `M`, `L`, `C`, `Z`, and `E` for the end).
    #[serde(default)]
    pub path: Option<String>,
}

/// Z-order moves.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase")]
pub enum ZOrder {
    /// To the top.
    Front,
    /// To the bottom.
    Back,
    /// One step up.
    Forward,
    /// One step down.
    Backward,
}

/// How slide content follows a new slide size
/// ([`EditOp::SetSlideSize`](super::EditOp::SetSlideSize)).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase")]
pub enum SlideScale {
    /// Content keeps its size and position (it may overflow or leave space).
    #[default]
    None,
    /// PowerPoint's "Ensure Fit": content, text, and lines scale by the
    /// smaller of the width and height ratios and are centered, so all of
    /// it stays on the slide.
    Fit,
    /// PowerPoint's "Maximize": content, text, and lines scale by the larger
    /// of the two ratios and are centered, filling the slide (content may
    /// run off its edges).
    Maximize,
}

/// Which borders of a cell range [`EditOp::FormatCells`](super::EditOp::FormatCells) changes. A border
/// between two cells is shared, so both cells get the change.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase")]
pub enum BorderEdges {
    /// Every border, outside and inside.
    All,
    /// The range's outline.
    Outside,
    /// The lines between the range's cells.
    Inside,
    /// The range's top edge.
    Top,
    /// The range's bottom edge.
    Bottom,
    /// The range's left edge.
    Left,
    /// The range's right edge.
    Right,
    /// The lines between the range's rows.
    InsideHorizontal,
    /// The lines between the range's columns.
    InsideVertical,
}

/// A table border change (`None` = leave unchanged). A border that did not
/// exist yet becomes a solid 1 pt `tx1` line unless the change says otherwise.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase", default, deny_unknown_fields)]
pub struct BorderLine {
    /// Remove the border (no line).
    #[serde(deserialize_with = "nullable")]
    pub none: bool,
    /// Color (`RRGGBB` or theme name).
    pub color: Option<String>,
    /// Width in points.
    pub width: Option<f32>,
    /// Preset dash (`solid`, `dash`, `dot`, `dashDot`, `lgDash`, `sysDash`, `sysDot`).
    pub dash: Option<String>,
}

/// Borders to change in [`EditOp::FormatCells`](super::EditOp::FormatCells).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CellBorders {
    /// Which borders.
    pub edges: BorderEdges,
    /// The change applied to each of them.
    pub line: BorderLine,
}
