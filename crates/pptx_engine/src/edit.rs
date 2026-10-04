//! Editing: atomic batches of [`EditOp`]s, undo/redo, and lossless save.
//!
//! Edits mutate the parsed XML of the parts they touch (copy-on-write), so
//! untouched parts keep their original bytes and untouched markup inside an
//! edited part is re-serialized unchanged. A batch is atomic: if any operation
//! fails, the presentation is restored to its state before the batch.
//!
//! [`Editor`] adds an undo history on top. Snapshots are whole
//! [`Presentation`] clones, which are cheap because parsed parts and package
//! bytes are reference-counted and only copied when an edit touches them.

pub(crate) mod animation;
mod autofit;
pub(crate) mod chart;
mod chart_data;
mod chart_format;
mod chart_new;
mod chart_type;
mod chart_workbook;
mod notes;
mod ops;
mod parts;
mod shapes;
pub(crate) mod slides;
mod table;
mod table_style;
mod text;
mod xmlutil;

mod clipboard;
mod diff;
pub(crate) mod effects;
mod find;
mod format_painter;
pub(crate) mod group;
pub(crate) mod header_footer;
mod links;
pub(crate) mod picture;
mod relayout;
pub(crate) mod sections;
mod slide_size;
mod theme;
pub(crate) mod transition;

pub use links::{JUMPS, link_string};
pub use notes::notes_text;
pub use ops::{AnimationClass, AnimationRepeat, AnimationSpec, AnimationStart, RepeatUntil};
pub use ops::{
    BodyPatch, BulletSpec, CellRef, ChartSeriesColor, ChartSeriesData, Created, EditOp, EditResult,
    FillSpec, LinePatch, NewShape, ParaPatch, RunPatch, TextPos, ZOrder,
};
pub use ops::{BorderEdges, BorderLine, CellBorders, SlideScale, ThemeColor};
pub use ops::{
    CropMode, EffectSpec, GlowOptions, ReflectionOptions, ShadowOptions, SoftEdgeOptions,
};
pub use slides::{LayoutInfo, layouts};

pub use clipboard::{
    CLIPBOARD_FORMAT, ClipFrame, ClipLayout, ClipNotes, ClipPart, ClipRel, ClipSlide,
    ClipboardPayload,
};
use diff::carry_caches;
pub(crate) use diff::diff;
pub use find::{FindOptions, TextMatch};

use crate::error::{Error, Result};
use crate::font::FontDb;
use crate::model::presentation::Presentation;
use crate::xml::{NodeId, XmlDoc};

/// Maximum number of undo steps an [`Editor`] keeps.
const HISTORY_LIMIT: usize = 200;

impl EditOp {
    /// The slide this operation addresses, if any.
    pub fn slide(&self) -> Option<u32> {
        use EditOp as O;
        match self {
            O::SetText { slide, .. }
            | O::InsertText { slide, .. }
            | O::DeleteText { slide, .. }
            | O::FormatText { slide, .. }
            | O::FormatParagraphs { slide, .. }
            | O::FormatBody { slide, .. }
            | O::SetTransform { slide, .. }
            | O::SetFill { slide, .. }
            | O::SetLine { slide, .. }
            | O::SetGeometry { slide, .. }
            | O::AddShape { slide, .. }
            | O::DeleteShape { slide, .. }
            | O::DuplicateShape { slide, .. }
            | O::ReorderShape { slide, .. }
            | O::ReplaceImage { slide, .. }
            | O::SetCellText { slide, .. }
            | O::InsertTableRow { slide, .. }
            | O::DeleteTableRow { slide, .. }
            | O::InsertTableColumn { slide, .. }
            | O::DeleteTableColumn { slide, .. }
            | O::MergeCells { slide, .. }
            | O::SplitCell { slide, .. }
            | O::FormatCells { slide, .. }
            | O::SetTableStyle { slide, .. }
            | O::SetTableGrid { slide, .. }
            | O::DuplicateSlide { slide }
            | O::DeleteSlide { slide }
            | O::MoveSlide { slide, .. }
            | O::SetSlideHidden { slide, .. }
            | O::SetNotes { slide, .. }
            | O::SetBackground { slide, .. }
            | O::SetChartData { slide, .. }
            | O::SetChartType { slide, .. }
            | O::FormatChart { slide, .. } => Some(*slide),
            O::AddSlide { .. } => None,
            O::GroupShapes { slide, .. }
            | O::UngroupShape { slide, .. }
            | O::PasteShapes { slide, .. }
            | O::SetSlideLayout { slide, .. }
            | O::SetTransition { slide, .. }
            | O::SetAltText { slide, .. }
            | O::SetShapeName { slide, .. }
            | O::SetShapeHidden { slide, .. }
            | O::SetShapeLink { slide, .. }
            | O::PasteFormat { slide, .. }
            | O::SetAnimations { slide, .. }
            | O::AddAnimation { slide, .. }
            | O::RemoveAnimations { slide, .. }
            | O::CropPicture { slide, .. }
            | O::FormatPicture { slide, .. }
            | O::SetShapeEffects { slide, .. } => Some(*slide),
            O::PasteSlides { .. }
            | O::SetThemeColors { .. }
            | O::SetThemeFonts { .. }
            | O::SetHeaderFooter { .. }
            | O::SetSlideSize { .. }
            | O::AddSection { .. }
            | O::RenameSection { .. }
            | O::RemoveSection { .. }
            | O::MoveSection { .. } => None,
            O::ReplaceText { slide, .. } => *slide,
        }
    }

    /// Whether the operation can leave parts without any relationship pointing at them.
    fn may_orphan(&self) -> bool {
        matches!(
            self,
            EditOp::DeleteShape { .. }
                | EditOp::DeleteSlide { .. }
                | EditOp::ReplaceImage { .. }
                | EditOp::SetText { .. }
                | EditOp::DeleteText { .. }
                | EditOp::FormatText { .. }
                | EditOp::DeleteTableRow { .. }
                | EditOp::DeleteTableColumn { .. }
                | EditOp::SetCellText { .. }
                | EditOp::SetBackground { .. }
                | EditOp::SetFill { .. }
                | EditOp::RemoveSection { .. }
                | EditOp::FormatPicture { .. }
        )
    }
}

impl Presentation {
    /// Applies a batch of operations atomically.
    ///
    /// `fonts` is used to re-fit text after text edits (shrink-on-overflow and
    /// resize-shape-to-fit), as PowerPoint does while editing.
    pub fn apply(&mut self, ops: &[EditOp], fonts: &FontDb) -> Result<EditResult> {
        self.apply_batch(ops, fonts).map(|(result, _)| result)
    }

    /// Applies a batch, returning the result and the state before the batch.
    fn apply_batch(
        &mut self,
        ops: &[EditOp],
        fonts: &FontDb,
    ) -> Result<(EditResult, Presentation)> {
        let before = self.clone();
        match self.run_batch(ops, fonts) {
            Ok(out) => {
                self.flush();
                let mut result = diff(&before, self);
                result.created = out.created;
                result.replaced = out.replaced;
                Ok((result, before))
            }
            Err(e) => {
                *self = before;
                Err(e)
            }
        }
    }

    fn run_batch(&mut self, ops: &[EditOp], fonts: &FontDb) -> Result<BatchOutput> {
        let gc = if ops.iter().any(EditOp::may_orphan) {
            Some(parts::baseline(self)?)
        } else {
            None
        };
        let mut out = BatchOutput::default();
        let mut refit = Vec::new();
        for op in ops {
            self.apply_op(op, &mut refit, &mut out)?;
        }
        // Animations name shapes and paragraphs by id and index: drop the
        // ones the batch left without a target, which PowerPoint repairs.
        let touched: Vec<String> = self
            .slides
            .iter()
            .filter(|s| self.dirty_xml.contains(&s.part))
            .map(|s| s.part.clone())
            .collect();
        for part in touched {
            animation::scrub(self, &part)?;
        }
        autofit::refit(self, &refit, fonts)?;
        parts::prune_rels(self)?;
        if let Some(gc) = gc {
            parts::collect_garbage(self, &gc)?;
        }
        Ok(out)
    }

    /// The part name of the slide with stable id `id`.
    pub(crate) fn slide_part(&self, id: u32) -> Result<String> {
        self.slides
            .iter()
            .find(|s| s.id == id)
            .map(|s| s.part.clone())
            .ok_or_else(|| Error::NotFound(format!("slide {id}")))
    }

    /// Runs `f` on the text body of a shape (or of one of its table cells).
    fn edit_text<T>(
        &mut self,
        part: &str,
        shape: u32,
        cell: Option<CellRef>,
        f: impl FnOnce(&mut XmlDoc, NodeId) -> Result<T>,
    ) -> Result<T> {
        let doc = self.xml_mut(part)?;
        let node = shapes::find(doc, shape)?;
        let body = match cell {
            Some(c) => table::cell_body(doc, node, c)?,
            None => shapes::ensure_tx_body(doc, node)?,
        };
        f(doc, body)
    }

    /// Runs `f` on a table's graphic frame, then re-fits the frame to the table.
    fn edit_table(
        &mut self,
        slide: u32,
        shape: u32,
        refit: &mut Vec<(String, u32)>,
        f: impl FnOnce(&mut XmlDoc, NodeId) -> Result<()>,
    ) -> Result<()> {
        let part = self.slide_part(slide)?;
        let doc = self.xml_mut(&part)?;
        let node = shapes::find(doc, shape)?;
        f(doc, node)?;
        refit.push((part, shape));
        Ok(())
    }

    fn apply_op(
        &mut self,
        op: &EditOp,
        refit: &mut Vec<(String, u32)>,
        out: &mut BatchOutput,
    ) -> Result<()> {
        use EditOp as O;
        let mut created = None;
        match op {
            O::SetText {
                slide,
                shape,
                cell,
                text,
            } => {
                let part = self.slide_part(*slide)?;
                self.edit_text(&part, *shape, *cell, |doc, body| {
                    text::set_text(doc, body, text)
                })?;
                refit.push((part, *shape));
            }
            O::InsertText {
                slide,
                shape,
                cell,
                at,
                text,
            } => {
                let part = self.slide_part(*slide)?;
                self.edit_text(&part, *shape, *cell, |doc, body| {
                    text::insert_text(doc, body, *at, text)
                })?;
                refit.push((part, *shape));
            }
            O::DeleteText {
                slide,
                shape,
                cell,
                start,
                end,
            } => {
                let part = self.slide_part(*slide)?;
                self.edit_text(&part, *shape, *cell, |doc, body| {
                    text::delete_text(doc, body, *start, *end)
                })?;
                refit.push((part, *shape));
            }
            O::FormatText {
                slide,
                shape,
                cell,
                start,
                end,
                props,
            } => {
                let part = self.slide_part(*slide)?;
                let link = match props.link.as_deref() {
                    Some(link) => links::link_ref(self, &part, link, props.link_tip.as_deref())?,
                    None => None,
                };
                self.edit_text(&part, *shape, *cell, |doc, body| {
                    text::format_text(doc, body, *start, *end, props, link.as_ref())
                })?;
                refit.push((part, *shape));
            }
            O::FormatParagraphs {
                slide,
                shape,
                cell,
                from,
                to,
                props,
            } => {
                let part = self.slide_part(*slide)?;
                self.edit_text(&part, *shape, *cell, |doc, body| {
                    text::format_paragraphs(doc, body, *from, *to, props)
                })?;
                refit.push((part, *shape));
            }
            O::FormatBody {
                slide,
                shape,
                cell,
                props,
            } => {
                let part = self.slide_part(*slide)?;
                match cell {
                    // A cell's alignment and margins live on the cell, not its text body.
                    Some(c) => {
                        let doc = self.xml_mut(&part)?;
                        let node = shapes::find(doc, *shape)?;
                        table::format_cell_body(doc, node, *c, props)?;
                    }
                    None => self.edit_text(&part, *shape, None, |doc, body| {
                        text::format_body(doc, body, props)
                    })?,
                }
                refit.push((part, *shape));
            }
            O::SetTransform {
                slide,
                shape,
                x,
                y,
                w,
                h,
                rotation,
                flip_h,
                flip_v,
            } => {
                let part = self.slide_part(*slide)?;
                let patch = shapes::TransformPatch {
                    x: *x,
                    y: *y,
                    w: *w,
                    h: *h,
                    rotation: *rotation,
                    flip_h: *flip_h,
                    flip_v: *flip_v,
                };
                shapes::set_transform(self, &part, *shape, &patch)?;
                if w.is_some() || h.is_some() {
                    table::fit_frame(self.xml_mut(&part)?, *shape, *w, *h)?;
                    refit.push((part, *shape));
                }
            }
            O::SetFill { slide, shape, fill } => {
                let part = self.slide_part(*slide)?;
                let doc = self.xml_mut(&part)?;
                let node = shapes::find(doc, *shape)?;
                shapes::set_fill(doc, node, fill)?;
            }
            O::SetLine { slide, shape, line } => {
                let part = self.slide_part(*slide)?;
                let doc = self.xml_mut(&part)?;
                let node = shapes::find(doc, *shape)?;
                shapes::set_line(doc, node, line)?;
            }
            O::SetGeometry {
                slide,
                shape,
                preset,
            } => {
                let part = self.slide_part(*slide)?;
                let doc = self.xml_mut(&part)?;
                let node = shapes::find(doc, *shape)?;
                shapes::set_geometry(doc, node, preset)?;
            }
            O::AddShape {
                slide,
                shape,
                x,
                y,
                w,
                h,
            } => {
                let part = self.slide_part(*slide)?;
                let id = shapes::add_shape(self, &part, shape, [*x, *y, *w, *h])?;
                if matches!(shape, NewShape::Table { .. }) {
                    table_style::define(self, crate::model::table_style::DEFAULT_TABLE_STYLE)?;
                }
                created = Some(Created {
                    slide: *slide,
                    shape: Some(id),
                    section: None,
                });
                refit.push((part, id));
            }
            O::DeleteShape { slide, shape } => {
                let part = self.slide_part(*slide)?;
                let doc = self.xml_mut(&part)?;
                let node = shapes::find(doc, *shape)?;
                shapes::delete_shape(doc, node);
            }
            O::DuplicateShape {
                slide,
                shape,
                dx,
                dy,
            } => {
                let part = self.slide_part(*slide)?;
                let id = shapes::duplicate_shape(self, &part, *shape, *dx, *dy)?;
                created = Some(Created {
                    slide: *slide,
                    shape: Some(id),
                    section: None,
                });
            }
            O::ReorderShape { slide, shape, to } => {
                let part = self.slide_part(*slide)?;
                let doc = self.xml_mut(&part)?;
                let node = shapes::find(doc, *shape)?;
                shapes::reorder(doc, node, *to);
            }
            O::ReplaceImage { slide, shape, data } => {
                let part = self.slide_part(*slide)?;
                shapes::replace_image(self, &part, *shape, data)?;
            }
            O::SetCellText {
                slide,
                shape,
                row,
                col,
                text,
            } => {
                let part = self.slide_part(*slide)?;
                let cell = CellRef {
                    row: *row,
                    col: *col,
                };
                self.edit_text(&part, *shape, Some(cell), |doc, body| {
                    text::set_text(doc, body, text)
                })?;
                refit.push((part, *shape));
            }
            O::InsertTableRow { slide, shape, at } => {
                self.edit_table(*slide, *shape, refit, |doc, node| {
                    table::insert_row(doc, node, *at)
                })?;
            }
            O::DeleteTableRow { slide, shape, row } => {
                self.edit_table(*slide, *shape, refit, |doc, node| {
                    table::delete_row(doc, node, *row)
                })?;
            }
            O::InsertTableColumn { slide, shape, at } => {
                self.edit_table(*slide, *shape, refit, |doc, node| {
                    table::insert_column(doc, node, *at)
                })?;
            }
            O::DeleteTableColumn { slide, shape, col } => {
                self.edit_table(*slide, *shape, refit, |doc, node| {
                    table::delete_column(doc, node, *col)
                })?;
            }
            O::MergeCells {
                slide,
                shape,
                from,
                to,
            } => {
                self.edit_table(*slide, *shape, refit, |doc, node| {
                    table::merge_cells(doc, node, *from, *to)
                })?;
            }
            O::SplitCell { slide, shape, cell } => {
                self.edit_table(*slide, *shape, refit, |doc, node| {
                    table::split_cell(doc, node, *cell)
                })?;
            }
            O::FormatCells {
                slide,
                shape,
                from,
                to,
                fill,
                borders,
                anchor,
                margins,
            } => {
                let format = table::CellFormat {
                    fill: fill.as_ref(),
                    borders: borders.as_ref(),
                    anchor: anchor.as_deref(),
                    margins: *margins,
                };
                self.edit_table(*slide, *shape, refit, |doc, node| {
                    table::format_cells(doc, node, *from, *to, &format)
                })?;
            }
            O::SetTableStyle {
                slide,
                shape,
                style,
                first_row,
                last_row,
                first_col,
                last_col,
                band_row,
                band_col,
            } => {
                let style = match style.as_deref().map(str::trim) {
                    Some(id) if !id.is_empty() => Some(table_style::define(self, id)?),
                    other => other.map(str::to_owned),
                };
                let flags = table::StyleFlags {
                    first_row: *first_row,
                    last_row: *last_row,
                    first_col: *first_col,
                    last_col: *last_col,
                    band_row: *band_row,
                    band_col: *band_col,
                };
                self.edit_table(*slide, *shape, refit, |doc, node| {
                    table::set_style(doc, node, style.as_deref(), flags)
                })?;
            }
            O::SetTableGrid {
                slide,
                shape,
                column_widths,
                row_heights,
            } => {
                self.edit_table(*slide, *shape, refit, |doc, node| {
                    table::set_grid(doc, node, column_widths.as_deref(), row_heights.as_deref())
                })?;
            }
            O::AddSlide {
                layout,
                after,
                title,
                body,
            } => {
                let id = slides::add_slide(
                    self,
                    layout.as_deref(),
                    *after,
                    title.as_deref(),
                    body.as_deref(),
                )?;
                created = Some(Created {
                    slide: id,
                    shape: None,
                    section: None,
                });
            }
            O::DuplicateSlide { slide } => {
                let id = slides::duplicate_slide(self, *slide)?;
                created = Some(Created {
                    slide: id,
                    shape: None,
                    section: None,
                });
            }
            O::DeleteSlide { slide } => slides::delete_slide(self, *slide)?,
            O::MoveSlide { slide, to } => slides::move_slide(self, *slide, *to)?,
            O::SetSlideHidden { slide, hidden } => slides::set_hidden(self, *slide, *hidden)?,
            O::SetNotes { slide, text } => notes::set_notes(self, *slide, text)?,
            O::SetBackground { slide, fill } => {
                slides::set_background(self, *slide, fill.as_ref())?
            }
            O::SetChartData {
                slide,
                shape,
                categories,
                series,
            } => {
                let part = self.slide_part(*slide)?;
                chart::set_data(self, &part, *shape, categories, series)?;
            }
            O::SetChartType {
                slide,
                shape,
                kind,
                grouping,
            } => {
                let part = self.slide_part(*slide)?;
                chart::set_type(self, &part, *shape, kind, grouping.as_deref())?;
            }
            O::FormatChart {
                slide,
                shape,
                title,
                legend,
                data_labels,
                series_colors,
            } => {
                let part = self.slide_part(*slide)?;
                let format = chart_format::ChartFormat {
                    title: title.as_deref(),
                    legend: legend.as_deref(),
                    data_labels: *data_labels,
                    series_colors: series_colors.as_deref().unwrap_or_default(),
                };
                chart::format(self, &part, *shape, &format)?;
            }
            O::GroupShapes { slide, shapes } => {
                let part = self.slide_part(*slide)?;
                let id = group::group_shapes(self, &part, shapes)?;
                created = Some(Created {
                    slide: *slide,
                    shape: Some(id),
                    section: None,
                });
            }
            O::UngroupShape { slide, shape } => {
                let part = self.slide_part(*slide)?;
                for id in group::ungroup(self, &part, *shape)? {
                    out.created.push(Created {
                        slide: *slide,
                        shape: Some(id),
                        section: None,
                    });
                }
            }
            O::PasteShapes {
                slide,
                payload,
                dx,
                dy,
            } => {
                let part = self.slide_part(*slide)?;
                for id in clipboard::paste_shapes(self, &part, payload, *dx, *dy)? {
                    out.created.push(Created {
                        slide: *slide,
                        shape: Some(id),
                        section: None,
                    });
                    refit.push((part.clone(), id));
                }
            }
            O::PasteSlides { after, payload } => {
                for id in clipboard::paste_slides(self, *after, payload)? {
                    out.created.push(Created {
                        slide: id,
                        shape: None,
                        section: None,
                    });
                }
            }
            O::SetSlideLayout { slide, layout } => {
                relayout::set_slide_layout(self, *slide, layout)?;
            }
            O::SetThemeColors { colors, name } => {
                theme::set_theme_colors(self, colors, name.as_deref())?
            }
            O::SetThemeFonts { major, minor, name } => {
                theme::set_theme_fonts(self, major.as_deref(), minor.as_deref(), name.as_deref())?
            }
            O::SetTransition {
                slide,
                kind,
                duration_ms,
                direction,
                advance_on_click,
                advance_after_ms,
                apply_to_all,
            } => {
                let patch = transition::TransitionPatch {
                    kind,
                    duration_ms: *duration_ms,
                    direction: direction.as_deref(),
                    advance_on_click: *advance_on_click,
                    // 0 turns automatic advance off.
                    advance_after_ms: advance_after_ms.map(|ms| (ms > 0).then_some(ms)),
                };
                transition::set_transition(self, *slide, &patch, *apply_to_all)?;
            }
            O::SetAnimations { slide, animations } => {
                animation::set_animations(self, *slide, animations)?;
            }
            O::AddAnimation {
                slide,
                animation: spec,
                index,
            } => animation::add_animation(self, *slide, spec, *index)?,
            O::RemoveAnimations {
                slide,
                shape_ids,
                indexes,
            } => animation::remove_animations(
                self,
                *slide,
                shape_ids.as_deref(),
                indexes.as_deref(),
            )?,
            O::ReplaceText {
                find: query,
                replace,
                match_case,
                whole_word,
                slide,
            } => {
                let options = FindOptions {
                    match_case: *match_case,
                    whole_word: *whole_word,
                };
                out.replaced += find::replace_text(self, query, replace, options, *slide, refit)?;
            }
            O::SetAltText { slide, shape, text } => {
                let part = self.slide_part(*slide)?;
                shapes::set_c_nv_pr(self.xml_mut(&part)?, *shape, "descr", Some(text))?;
            }
            O::SetShapeName { slide, shape, name } => {
                let part = self.slide_part(*slide)?;
                shapes::set_c_nv_pr(self.xml_mut(&part)?, *shape, "name", Some(name))?;
            }
            O::SetShapeLink {
                slide,
                shapes,
                link,
                tip,
            } => {
                let part = self.slide_part(*slide)?;
                for &shape in shapes {
                    let link = links::link_ref(self, &part, link, tip.as_deref())?;
                    links::set_shape_link(self.xml_mut(&part)?, shape, link.as_ref())?;
                }
            }
            O::SetShapeHidden {
                slide,
                shape,
                hidden,
            } => {
                let part = self.slide_part(*slide)?;
                let value = hidden.then_some("1");
                shapes::set_c_nv_pr(self.xml_mut(&part)?, *shape, "hidden", value)?;
            }
            O::PasteFormat {
                slide,
                shapes,
                from_slide,
                from_shape,
            } => {
                let part = self.slide_part(*slide)?;
                let from_part = self.slide_part(*from_slide)?;
                format_painter::paste_format(self, &from_part, *from_shape, &part, shapes)?;
            }
            O::SetHeaderFooter {
                slides,
                slide_number,
                date,
                date_text,
                date_format,
                footer,
                footer_text,
                not_on_title,
            } => {
                use header_footer::DateContent;
                let date_content = match (date_text.as_deref(), date_format.as_deref()) {
                    (Some(text), _) if !text.is_empty() => DateContent::Fixed(text),
                    (Some(_), format) | (None, format @ Some(_)) => DateContent::Auto(format),
                    (None, None) => DateContent::Keep,
                };
                let patch = header_footer::HeaderFooterPatch {
                    slides: slides.as_deref(),
                    slide_number: *slide_number,
                    date: *date,
                    date_content,
                    footer: *footer,
                    footer_text: footer_text.as_deref(),
                    not_on_title: *not_on_title,
                };
                header_footer::set_header_footer(self, &patch)?;
            }
            O::SetSlideSize {
                width,
                height,
                scale,
            } => slide_size::set_slide_size(self, *width, *height, scale.unwrap_or_default())?,
            O::AddSection { name, before_slide } => {
                let id = sections::add_section(self, name, *before_slide)?;
                created = Some(Created {
                    slide: *before_slide,
                    shape: None,
                    section: Some(id),
                });
            }
            O::RenameSection { id, name } => sections::rename_section(self, id, name)?,
            O::RemoveSection { id, delete_slides } => {
                sections::remove_section(self, id, *delete_slides)?
            }
            O::MoveSection { id, to_index } => sections::move_section(self, id, *to_index)?,
            O::CropPicture {
                slide,
                shape,
                left,
                top,
                right,
                bottom,
                mode,
            } => {
                let patch = picture::CropPatch {
                    edges: [*left, *top, *right, *bottom],
                    mode: *mode,
                };
                picture::crop_picture(self, *slide, *shape, &patch)?;
            }
            O::FormatPicture {
                slide,
                shapes,
                brightness,
                contrast,
                recolor,
                transparency,
                reset,
            } => {
                let patch = picture::PicturePatch {
                    brightness: *brightness,
                    contrast: *contrast,
                    recolor: recolor.as_deref(),
                    transparency: *transparency,
                    reset: *reset,
                };
                picture::format_picture(self, *slide, shapes, &patch)?;
            }
            O::SetShapeEffects {
                slide,
                shapes,
                shadow,
                glow,
                soft_edge,
                reflection,
            } => {
                let patch = effects::EffectsPatch {
                    shadow: shadow.as_ref(),
                    glow: glow.as_ref(),
                    soft_edge: soft_edge.as_ref(),
                    reflection: reflection.as_ref(),
                };
                effects::set_shape_effects(self, *slide, shapes, &patch)?;
            }
        }
        out.created.extend(created);
        Ok(())
    }
}

/// What a batch reports besides the slides it changed.
#[derive(Default)]
struct BatchOutput {
    /// Ids created, in order.
    created: Vec<Created>,
    /// Text replacements made.
    replaced: usize,
}

/// A presentation with an undo history, for interactive editing.
pub struct Editor {
    pres: Presentation,
    undo: Vec<Presentation>,
    redo: Vec<Presentation>,
    /// Coalescing key of the last batch (typing bursts share one undo step).
    group: Option<String>,
}

impl Editor {
    /// Wraps an opened presentation.
    pub fn new(pres: Presentation) -> Self {
        Self {
            pres,
            undo: Vec::new(),
            redo: Vec::new(),
            group: None,
        }
    }

    /// The current state.
    pub fn presentation(&self) -> &Presentation {
        &self.pres
    }

    /// The current state, mutably (rendering fills caches).
    pub fn presentation_mut(&mut self) -> &mut Presentation {
        &mut self.pres
    }

    /// Applies a batch as one undo step.
    ///
    /// Consecutive batches with the same `group` key merge into a single undo
    /// step (used for typing); `None` always starts a new step.
    pub fn apply(
        &mut self,
        ops: &[EditOp],
        group: Option<&str>,
        fonts: &FontDb,
    ) -> Result<EditResult> {
        let (result, before) = self.pres.apply_batch(ops, fonts)?;
        let nothing_changed = result.changed_slides.is_empty() && !result.structure_changed;
        if nothing_changed && result.created.is_empty() {
            return Ok(result);
        }
        let coalesce = group.is_some() && group == self.group.as_deref() && !self.undo.is_empty();
        if !coalesce {
            self.undo.push(before);
            if self.undo.len() > HISTORY_LIMIT {
                self.undo.remove(0);
            }
        }
        self.redo.clear();
        self.group = group.map(str::to_owned);
        Ok(result)
    }

    /// Ends the current coalescing group, so the next batch starts a new undo step.
    pub fn break_group(&mut self) {
        self.group = None;
    }

    /// Whether there is something to undo.
    pub fn can_undo(&self) -> bool {
        !self.undo.is_empty()
    }

    /// Whether there is something to redo.
    pub fn can_redo(&self) -> bool {
        !self.redo.is_empty()
    }

    /// Reverts the last undo step.
    pub fn undo(&mut self) -> Option<EditResult> {
        let previous = self.undo.pop()?;
        Some(self.restore(previous, true))
    }

    /// Re-applies the last undone step.
    pub fn redo(&mut self) -> Option<EditResult> {
        let next = self.redo.pop()?;
        Some(self.restore(next, false))
    }

    fn restore(&mut self, state: Presentation, undoing: bool) -> EditResult {
        let current = std::mem::replace(&mut self.pres, state);
        carry_caches(&current, &mut self.pres);
        let result = diff(&current, &self.pres);
        if undoing {
            self.redo.push(current);
        } else {
            self.undo.push(current);
        }
        self.group = None;
        result
    }

    /// Serializes the current state.
    pub fn save(&mut self) -> Result<Vec<u8>> {
        self.pres.save()
    }
}

#[cfg(test)]
mod chart_test;
#[cfg(test)]
mod test;
