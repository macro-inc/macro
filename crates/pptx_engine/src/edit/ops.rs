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

mod values;

pub use values::*;

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
    /// Pastes shapes copied with `copyShapes` (from this or another
    /// presentation) on top of a slide, with fresh ids, offset by (dx, dy)
    /// points. Pictures, media, charts, and links come along. Theme colors,
    /// theme fonts, and style references take this presentation's theme
    /// (PowerPoint's "Use Destination Theme"). The new top-level shape ids are
    /// reported in the result, back to front.
    PasteShapes {
        /// Slide id.
        slide: u32,
        /// The clipboard payload JSON returned by `copyShapes`.
        payload: String,
        /// Horizontal offset in points.
        #[serde(default, deserialize_with = "nullable")]
        dx: f32,
        /// Vertical offset in points.
        #[serde(default, deserialize_with = "nullable")]
        dy: f32,
    },
    /// Pastes slides copied with `copySlides` (from this or another
    /// presentation), with their speaker notes. Each slide takes this deck's
    /// layout of the same name, else the first with the same placeholder
    /// types, else "Title and Content", else the first layout; theme colors
    /// and fonts follow this deck's theme. New slide ids are reported in the
    /// result, in order.
    PasteSlides {
        /// Insert after this slide (end of deck when omitted).
        #[serde(default)]
        after: Option<u32>,
        /// The clipboard payload JSON returned by `copySlides`.
        payload: String,
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
        /// Advance automatically after this many milliseconds; `0` turns
        /// automatic advance off, and an omitted (or null) field keeps the
        /// current setting.
        #[serde(default)]
        advance_after_ms: Option<u32>,
        /// Give every slide of the deck the resulting transition.
        #[serde(default, deserialize_with = "nullable")]
        apply_to_all: bool,
    },
    /// Replaces a slide's animations (its main sequence, which plays as the
    /// presenter clicks through the slide) with these, in playback order;
    /// `[]` removes them all. An entry matching an animation the slide has
    /// (same shape, class, effect, and paragraph, and direction when given)
    /// keeps it, with its other settings unless the entry gives them, so
    /// listing the current animations in a new order reorders them.
    /// Animations started by clicking a shape (triggers) are kept.
    SetAnimations {
        /// Slide id.
        slide: u32,
        /// Animations in playback order.
        animations: Vec<AnimationSpec>,
    },
    /// Adds a new animation to a slide's sequence.
    AddAnimation {
        /// Slide id.
        slide: u32,
        /// The animation.
        animation: AnimationSpec,
        /// 0-based position in playback order (the end when omitted).
        #[serde(default)]
        index: Option<usize>,
    },
    /// Removes animations from a slide's sequence: every animation of the
    /// listed shapes and the animations at the listed playback positions.
    /// Give at least one of the lists (`setAnimations` with `[]` removes all).
    RemoveAnimations {
        /// Slide id.
        slide: u32,
        /// Shapes whose animations to remove.
        #[serde(default)]
        shape_ids: Option<Vec<u32>>,
        /// 0-based playback positions to remove.
        #[serde(default)]
        indexes: Option<Vec<usize>>,
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
    /// Sets a shape's alt text (its description for screen readers); `""` removes it.
    SetAltText {
        /// Slide id.
        slide: u32,
        /// Shape id.
        shape: u32,
        /// Alt text.
        text: String,
    },
    /// Renames a shape (the name shown in the selection pane).
    SetShapeName {
        /// Slide id.
        slide: u32,
        /// Shape id.
        shape: u32,
        /// New name.
        name: String,
    },
    /// Hides or shows a shape (hidden shapes are not drawn).
    SetShapeHidden {
        /// Slide id.
        slide: u32,
        /// Shape id.
        shape: u32,
        /// Hidden.
        hidden: bool,
    },
    /// Format painter: gives shapes the look of another shape — its fill,
    /// outline, effects, theme style, and text margins and anchoring.
    /// Character and paragraph formatting are not copied (use formatText and
    /// formatParagraphs). Group targets paint every member.
    PasteFormat {
        /// Slide id of the shapes to restyle.
        slide: u32,
        /// Shape ids to restyle.
        shapes: Vec<u32>,
        /// Slide id of the shape to copy from.
        from_slide: u32,
        /// Shape id to copy from (a shape, line, or picture).
        from_shape: u32,
    },
    // ---- theme ----
    /// Recolors the deck: sets theme color slots in every slide master's
    /// theme, so everything that uses theme colors (most text, shapes,
    /// charts, and tables) follows. Omitted slots keep their color.
    SetThemeColors {
        /// Slots to set.
        colors: Vec<ThemeColor>,
        /// New name of the color scheme.
        #[serde(default)]
        name: Option<String>,
    },
    /// Sets the theme's heading (`major`) and body (`minor`) Latin fonts in
    /// every slide master's theme; text that uses theme fonts follows.
    SetThemeFonts {
        /// Heading font (kept when omitted).
        #[serde(default)]
        major: Option<String>,
        /// Body font (kept when omitted).
        #[serde(default)]
        minor: Option<String>,
        /// New name of the font scheme.
        #[serde(default)]
        name: Option<String>,
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
