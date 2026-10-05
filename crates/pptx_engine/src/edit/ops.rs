//! The edit-operation vocabulary shared by the editor UI and AI tools.
//!
//! Slides are addressed by their stable id (`p:sldId/@id`), shapes by their
//! `p:cNvPr/@id` (unique within a slide). Positions and sizes are in points.
//! Text positions count Unicode scalar values within a paragraph, where a line
//! break (`a:br`) counts as one character.

use serde::{Deserialize, Deserializer, Serialize};

/// Reads `null` as the default value: AI tool calls in strict mode send
/// `null` for every optional field they leave out.
fn nullable<'de, D, T>(de: D) -> Result<T, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de> + Default,
{
    Ok(Option::<T>::deserialize(de)?.unwrap_or_default())
}

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
    /// Hyperlink URL, or `""` to remove.
    pub link: Option<String>,
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

/// What to add with [`EditOp::AddShape`].
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase", tag = "kind", deny_unknown_fields)]
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
    /// A table.
    Table {
        /// Cell text, row by row.
        cells: Vec<Vec<String>>,
    },
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

/// One edit operation.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[serde(
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    tag = "op",
    deny_unknown_fields
)]
pub enum EditOp {
    /// Replaces all text of a shape (`\n` separates paragraphs, `\u{b}` is a line
    /// break), keeping the formatting of the first run of each paragraph.
    SetText {
        /// Slide id.
        slide: u32,
        /// Shape id.
        shape: u32,
        /// Table cell whose text to edit (the shape must be a table).
        #[serde(default)]
        cell: Option<CellRef>,
        /// New text.
        text: String,
    },
    /// Inserts text at a position (`\n` splits paragraphs).
    InsertText {
        /// Slide id.
        slide: u32,
        /// Shape id.
        shape: u32,
        /// Table cell whose text to edit (the shape must be a table).
        #[serde(default)]
        cell: Option<CellRef>,
        /// Where to insert.
        at: TextPos,
        /// Text to insert.
        text: String,
    },
    /// Deletes text between two positions (may span paragraphs).
    DeleteText {
        /// Slide id.
        slide: u32,
        /// Shape id.
        shape: u32,
        /// Table cell whose text to edit (the shape must be a table).
        #[serde(default)]
        cell: Option<CellRef>,
        /// Start (inclusive).
        start: TextPos,
        /// End (exclusive).
        end: TextPos,
    },
    /// Applies character formatting to a range (whole shape when omitted).
    FormatText {
        /// Slide id.
        slide: u32,
        /// Shape id.
        shape: u32,
        /// Table cell whose text to edit (the shape must be a table).
        #[serde(default)]
        cell: Option<CellRef>,
        /// Start of the range.
        #[serde(default)]
        start: Option<TextPos>,
        /// End of the range.
        #[serde(default)]
        end: Option<TextPos>,
        /// Changes.
        props: RunPatch,
    },
    /// Applies paragraph formatting to paragraphs `from..=to` (all when omitted).
    FormatParagraphs {
        /// Slide id.
        slide: u32,
        /// Shape id.
        shape: u32,
        /// Table cell whose text to edit (the shape must be a table).
        #[serde(default)]
        cell: Option<CellRef>,
        /// First paragraph.
        #[serde(default)]
        from: Option<usize>,
        /// Last paragraph.
        #[serde(default)]
        to: Option<usize>,
        /// Changes.
        props: ParaPatch,
    },
    /// Changes text box properties.
    FormatBody {
        /// Slide id.
        slide: u32,
        /// Shape id.
        shape: u32,
        /// Table cell whose text to edit (the shape must be a table).
        #[serde(default)]
        cell: Option<CellRef>,
        /// Changes.
        props: BodyPatch,
    },
    /// Moves, resizes, rotates, or flips a shape (omitted fields stay).
    SetTransform {
        /// Slide id.
        slide: u32,
        /// Shape id.
        shape: u32,
        /// Left (points).
        #[serde(default)]
        x: Option<f32>,
        /// Top (points).
        #[serde(default)]
        y: Option<f32>,
        /// Width (points).
        #[serde(default)]
        w: Option<f32>,
        /// Height (points).
        #[serde(default)]
        h: Option<f32>,
        /// Rotation in degrees.
        #[serde(default)]
        rotation: Option<f32>,
        /// Horizontal flip.
        #[serde(default)]
        flip_h: Option<bool>,
        /// Vertical flip.
        #[serde(default)]
        flip_v: Option<bool>,
    },
    /// Sets a shape's fill.
    SetFill {
        /// Slide id.
        slide: u32,
        /// Shape id.
        shape: u32,
        /// The fill.
        fill: FillSpec,
    },
    /// Changes a shape's outline.
    SetLine {
        /// Slide id.
        slide: u32,
        /// Shape id.
        shape: u32,
        /// Changes.
        line: LinePatch,
    },
    /// Changes a shape's preset geometry.
    SetGeometry {
        /// Slide id.
        slide: u32,
        /// Shape id.
        shape: u32,
        /// Preset name.
        preset: String,
    },
    /// Adds a shape (its id is reported in the result).
    AddShape {
        /// Slide id.
        slide: u32,
        /// What to add.
        shape: NewShape,
        /// Left (points).
        x: f32,
        /// Top (points).
        y: f32,
        /// Width (points).
        w: f32,
        /// Height (points).
        h: f32,
    },
    /// Deletes a shape.
    DeleteShape {
        /// Slide id.
        slide: u32,
        /// Shape id.
        shape: u32,
    },
    /// Duplicates a shape, offset by (dx, dy) points.
    DuplicateShape {
        /// Slide id.
        slide: u32,
        /// Shape id.
        shape: u32,
        /// Horizontal offset.
        #[serde(default, deserialize_with = "nullable")]
        dx: f32,
        /// Vertical offset.
        #[serde(default, deserialize_with = "nullable")]
        dy: f32,
    },
    /// Changes a shape's z-order.
    ReorderShape {
        /// Slide id.
        slide: u32,
        /// Shape id.
        shape: u32,
        /// Where to move it.
        to: ZOrder,
    },
    /// Replaces a picture's image.
    ReplaceImage {
        /// Slide id.
        slide: u32,
        /// Shape id.
        shape: u32,
        /// Base64-encoded PNG, JPEG, or GIF bytes.
        data: String,
    },
    /// Sets the text of a table cell.
    SetCellText {
        /// Slide id.
        slide: u32,
        /// Graphic frame id.
        shape: u32,
        /// Row.
        row: usize,
        /// Column.
        col: usize,
        /// Text.
        text: String,
    },
    /// Inserts a table row (copying the formatting of an adjacent row).
    InsertTableRow {
        /// Slide id.
        slide: u32,
        /// Graphic frame id.
        shape: u32,
        /// Index of the new row.
        at: usize,
    },
    /// Deletes a table row.
    DeleteTableRow {
        /// Slide id.
        slide: u32,
        /// Graphic frame id.
        shape: u32,
        /// Row index.
        row: usize,
    },
    /// Inserts a table column (copying the formatting of an adjacent column).
    InsertTableColumn {
        /// Slide id.
        slide: u32,
        /// Graphic frame id.
        shape: u32,
        /// Index of the new column.
        at: usize,
    },
    /// Deletes a table column.
    DeleteTableColumn {
        /// Slide id.
        slide: u32,
        /// Graphic frame id.
        shape: u32,
        /// Column index.
        col: usize,
    },
    /// Adds a slide based on a layout (its id is reported in the result).
    AddSlide {
        /// Layout name (e.g. "Title and Content"); defaults to the layout of the reference slide.
        #[serde(default)]
        layout: Option<String>,
        /// Insert after this slide (end of deck when omitted).
        #[serde(default)]
        after: Option<u32>,
        /// Title placeholder text.
        #[serde(default)]
        title: Option<String>,
        /// Body placeholder text (`\n` separates paragraphs).
        #[serde(default)]
        body: Option<String>,
    },
    /// Duplicates a slide right after itself.
    DuplicateSlide {
        /// Slide id.
        slide: u32,
    },
    /// Deletes a slide.
    DeleteSlide {
        /// Slide id.
        slide: u32,
    },
    /// Moves a slide to a 0-based position.
    MoveSlide {
        /// Slide id.
        slide: u32,
        /// New index.
        to: usize,
    },
    /// Hides or shows a slide in slideshows.
    SetSlideHidden {
        /// Slide id.
        slide: u32,
        /// Hidden.
        hidden: bool,
    },
    /// Replaces the speaker notes of a slide.
    SetNotes {
        /// Slide id.
        slide: u32,
        /// Notes text (`\n` separates paragraphs).
        text: String,
    },
    /// Sets a slide's background.
    SetBackground {
        /// Slide id.
        slide: u32,
        /// The fill (`None` removes the override, inheriting the layout background).
        fill: Option<FillSpec>,
    },
}

/// Something an edit created.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase")]
pub struct Created {
    /// Slide id.
    pub slide: u32,
    /// Shape id, for created shapes.
    pub shape: Option<u32>,
}

/// The outcome of applying a batch of operations.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase")]
pub struct EditResult {
    /// Ids created by the batch, in order.
    pub created: Vec<Created>,
    /// Slides whose rendering changed.
    pub changed_slides: Vec<u32>,
    /// Whether slides were added, removed, or reordered.
    pub structure_changed: bool,
}
