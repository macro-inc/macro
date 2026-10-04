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

/// Reads an explicit `null` as `Some(None)`; an omitted field stays `None`
/// (with `#[serde(default)]`), so "clear" and "keep" differ.
fn double_option<'de, D, T>(de: D) -> Result<Option<Option<T>>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(de).map(Some)
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

/// A series color for [`EditOp::FormatChart`].
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChartSeriesColor {
    /// Series index in plot order (0-based).
    pub series: u32,
    /// `RRGGBB`, or a theme color name (`accent1`, `tx1`...).
    pub color: String,
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
    /// Values are in slide space, also for group members (as the outline
    /// reports them); their group grows or shrinks to fit.
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
    /// Merges the rectangle of table cells between two corners into one cell.
    /// The top-left cell keeps its formatting; the text of the other cells is
    /// appended to it as paragraphs. Merged cells already inside the rectangle
    /// are absorbed; a rectangle that cuts through a merged cell is rejected.
    MergeCells {
        /// Slide id.
        slide: u32,
        /// Graphic frame id.
        shape: u32,
        /// One corner of the rectangle.
        from: CellRef,
        /// The opposite corner.
        to: CellRef,
    },
    /// Splits a merged cell back into the grid cells it covers. The revealed
    /// cells are empty and take the merged cell's fill and outer borders.
    SplitCell {
        /// Slide id.
        slide: u32,
        /// Graphic frame id.
        shape: u32,
        /// Any grid cell the merged cell covers.
        cell: CellRef,
    },
    /// Formats the table cells in the rectangle between two corners (widened
    /// to whole merged cells). Omitted fields stay unchanged.
    FormatCells {
        /// Slide id.
        slide: u32,
        /// Graphic frame id.
        shape: u32,
        /// One corner of the rectangle.
        from: CellRef,
        /// The opposite corner.
        to: CellRef,
        /// Cell fill (`{"kind":"none"}` = no fill, so the table background shows).
        #[serde(default)]
        fill: Option<FillSpec>,
        /// Borders to change.
        #[serde(default)]
        borders: Option<CellBorders>,
        /// Vertical text alignment: `top`, `middle`, or `bottom`.
        #[serde(default)]
        anchor: Option<String>,
        /// Cell margins `[left, top, right, bottom]` in points.
        #[serde(default)]
        margins: Option<[f32; 4]>,
    },
    /// Sets a table's style and which of its parts the style emphasizes
    /// (omitted fields stay unchanged). Applying a different style clears
    /// fills and borders set directly on cells, as PowerPoint does, so the
    /// table shows the new style.
    SetTableStyle {
        /// Slide id.
        slide: u32,
        /// Graphic frame id.
        shape: u32,
        /// Style id (a GUID from the deck outline's `tableStyles`, e.g.
        /// `{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}` = Medium Style 2 - Accent 1),
        /// or `""` for no style.
        #[serde(default)]
        style: Option<String>,
        /// Emphasize the first (header) row.
        #[serde(default)]
        first_row: Option<bool>,
        /// Emphasize the last (total) row.
        #[serde(default)]
        last_row: Option<bool>,
        /// Emphasize the first column.
        #[serde(default)]
        first_col: Option<bool>,
        /// Emphasize the last column.
        #[serde(default)]
        last_col: Option<bool>,
        /// Alternate the shading of rows.
        #[serde(default)]
        band_row: Option<bool>,
        /// Alternate the shading of columns.
        #[serde(default)]
        band_col: Option<bool>,
    },
    /// Sets table column widths and minimum row heights in points (rows still
    /// grow to fit their text). The frame is resized to match.
    SetTableGrid {
        /// Slide id.
        slide: u32,
        /// Graphic frame id.
        shape: u32,
        /// One width per column.
        #[serde(default)]
        column_widths: Option<Vec<f32>>,
        /// One minimum height per row.
        #[serde(default)]
        row_heights: Option<Vec<f32>>,
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
    // ---- charts ----
    /// Replaces a chart's categories and series (the chart must be `editable`
    /// in the outline). Existing series keep their formatting; new series
    /// copy the last one's with the next theme accent color. The embedded
    /// workbook is rewritten to match.
    SetChartData {
        /// Slide id.
        slide: u32,
        /// Graphic frame id.
        shape: u32,
        /// Category labels.
        categories: Vec<String>,
        /// Series in plot order (one value per category).
        series: Vec<ChartSeriesData>,
    },
    /// Changes a chart's type (the chart must be `editable` in the outline).
    SetChartType {
        /// Slide id.
        slide: u32,
        /// Graphic frame id.
        shape: u32,
        /// `bar` (horizontal), `column`, `line`, `pie`, `doughnut`, or `area`.
        kind: String,
        /// `clustered`, `stacked`, `percentStacked`, or `standard` (kept or the type's default when omitted).
        #[serde(default)]
        grouping: Option<String>,
    },
    /// Changes a chart's title, legend, data labels, or series colors (omitted fields stay).
    FormatChart {
        /// Slide id.
        slide: u32,
        /// Graphic frame id.
        shape: u32,
        /// Title text (`""` removes the title).
        #[serde(default)]
        title: Option<String>,
        /// Legend position: `right`, `left`, `top`, `bottom`, `topRight`, or `none`.
        #[serde(default)]
        legend: Option<String>,
        /// Show or hide value data labels on every series.
        #[serde(default)]
        data_labels: Option<bool>,
        /// Series colors.
        #[serde(default)]
        series_colors: Option<Vec<ChartSeriesColor>>,
    },
    // ---- shapes and slides ----
    /// Groups two or more shapes that share a parent (usually top-level
    /// shapes) into a new group placed at the z-position of the topmost of
    /// them. They keep their order and exactly where they are. The group's id
    /// is reported in the result. Placeholders cannot be grouped.
    GroupShapes {
        /// Slide id.
        slide: u32,
        /// Ids of the shapes to group (at least two).
        shapes: Vec<u32>,
    },
    /// Ungroups a group: its members take its place in the z-order and keep
    /// exactly where and how they appear (the group's offset, scale,
    /// rotation, and flips are applied to each). The members' ids are
    /// reported in the result, back to front.
    UngroupShape {
        /// Slide id.
        slide: u32,
        /// Group id.
        shape: u32,
    },
    /// Changes a slide's layout. Placeholders are matched to the new layout's
    /// placeholders by type and index and take their position; placeholders
    /// without a match stay where they are. Content is kept, and the new
    /// layout's other placeholders are added empty.
    SetSlideLayout {
        /// Slide id.
        slide: u32,
        /// Layout name (e.g. "Title Only"), as listed in the deck's layouts.
        layout: String,
    },
    /// Sets the transition into a slide. Omitted fields keep the slide's
    /// current value, or take the effect's default for a new transition.
    SetTransition {
        /// Slide id.
        slide: u32,
        /// Effect: `none` (removes the transition), `cut`, `fade`, `push`,
        /// `wipe`, `split`, `reveal`, `randomBar`, `shape`, `uncover`,
        /// `cover`, `zoom`, `dissolve`, `flash`, or `morph`.
        kind: String,
        /// Duration in milliseconds (at most 60000).
        #[serde(default)]
        duration_ms: Option<u32>,
        /// Effect option: `fade`: `smooth` or `black`; `push`, `wipe`: `l`,
        /// `r`, `u`, `d`; `cover`, `uncover`: those or `lu`, `ru`, `ld`, `rd`;
        /// `split`: `horzOut`, `horzIn`, `vertOut`, `vertIn`; `reveal`: `l`,
        /// `r`; `randomBar`: `horz`, `vert`; `shape`: `circle`, `diamond`,
        /// `plus`; `zoom`: `in`, `out`; `morph`: `byObject`, `byWord`,
        /// `byChar`. Directions are the OOXML `dir` values.
        #[serde(default)]
        direction: Option<String>,
        /// Whether a click advances to the next slide.
        #[serde(default)]
        advance_on_click: Option<bool>,
        /// Advance automatically after this many milliseconds; `null` turns
        /// automatic advance off and an omitted field keeps the current setting.
        #[serde(
            default,
            deserialize_with = "double_option",
            skip_serializing_if = "Option::is_none"
        )]
        advance_after_ms: Option<Option<u32>>,
        /// Give every slide of the deck the resulting transition.
        #[serde(default, deserialize_with = "nullable")]
        apply_to_all: bool,
    },
    /// Replaces text in shapes, group members, and table cells, on one slide
    /// or on every slide. A match may span differently formatted runs but not
    /// paragraphs; the replacement takes the formatting of the first matched
    /// character. The number of replacements is reported in the result.
    ReplaceText {
        /// Text to find (within one paragraph).
        find: String,
        /// Replacement text (may be empty; no paragraph or line breaks).
        replace: String,
        /// Match upper and lower case exactly (default: ignore case).
        #[serde(default, deserialize_with = "nullable")]
        match_case: bool,
        /// Only match whole words (no letter, digit, or `_` on either side).
        #[serde(default, deserialize_with = "nullable")]
        whole_word: bool,
        /// Slide id; omit to replace on every slide.
        #[serde(default)]
        slide: Option<u32>,
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
    /// Text replacements made by `replaceText` operations.
    #[serde(default)]
    pub replaced: usize,
}

/// Which borders of a cell range [`EditOp::FormatCells`] changes. A border
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

/// Borders to change in [`EditOp::FormatCells`].
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CellBorders {
    /// Which borders.
    pub edges: BorderEdges,
    /// The change applied to each of them.
    pub line: BorderLine,
}
