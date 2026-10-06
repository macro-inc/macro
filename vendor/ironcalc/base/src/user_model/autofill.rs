#![deny(missing_docs)]

use std::collections::{HashMap, HashSet};

use crate::{
    expressions::{
        types::Area,
        utils::{is_valid_column_number, is_valid_row},
    },
    model::CellStructure,
    types::MergedCell,
    user_model::sequence_detector::detect_progression,
    UserModel,
};

use crate::user_model::history::Diff;

const PARTIAL_MERGE_ERROR: &str =
    "Cannot auto-fill: a merged cell partially overlaps the fill area";
const CUT_MERGE_ERROR: &str = "Cannot auto-fill: the fill size must fit whole merged cells";

// How the merged cells of the sheet interact with a fill:
// the merges of the source are tiled into the fill target, and the merges
// already in the target are replaced by that pattern.
struct MergedFillPlan {
    // source cells covered by a merge (every cell of a source merge except
    // its anchor): they hold no content, and neither do their tiled copies
    covered_source: HashSet<(i32, i32)>,
    // the tiled copies of the source merges, to create in the fill target
    new_merges: Vec<MergedCell>,
    // the merged cells of the sheet before the fill
    old_merged_cells: Vec<MergedCell>,
    // the merged cells after removing the ones replaced by the fill, before
    // adding `new_merges`
    merged_cells_after_removal: Vec<MergedCell>,
}

fn merge_is_contained(m: &MergedCell, row1: i32, column1: i32, row2: i32, column2: i32) -> bool {
    m.row >= row1
        && m.column >= column1
        && m.row + m.height - 1 <= row2
        && m.column + m.width - 1 <= column2
}

impl<'a> UserModel<'a> {
    // Validates the fill of `target` from `source` (both closed rectangles
    // `(first_row, first_column, last_row, last_column)` on `sheet`) against
    // the merged cells of the sheet and returns the resulting plan:
    //
    // * A merge intersecting the source or the target but not fully contained
    //   in it fails with [PARTIAL_MERGE_ERROR].
    // * The source merges are tiled into the target with period the source
    //   height (`by_rows`) or width. A tiled merge that would stick out of
    //   the target fails with [CUT_MERGE_ERROR]: the fill can stop mid-tile,
    //   but only where it cuts no merge.
    // * Merges fully contained in the target are replaced by the tiled
    //   pattern (they are dropped from `merged_cells_after_removal`).
    fn plan_fill_merges(
        &self,
        sheet: u32,
        source: (i32, i32, i32, i32),
        target: (i32, i32, i32, i32),
        by_rows: bool,
    ) -> Result<MergedFillPlan, String> {
        let (s_row1, s_column1, s_row2, s_column2) = source;
        let (t_row1, t_column1, t_row2, t_column2) = target;
        let merged_cells = &self.model.workbook.worksheet(sheet)?.merged_cells;

        let mut source_merges = Vec::new();
        let mut merged_cells_after_removal = Vec::new();
        for m in merged_cells {
            if m.intersects(
                s_row1,
                s_column1,
                s_column2 - s_column1 + 1,
                s_row2 - s_row1 + 1,
            ) {
                if !merge_is_contained(m, s_row1, s_column1, s_row2, s_column2) {
                    return Err(PARTIAL_MERGE_ERROR.to_string());
                }
                source_merges.push(*m);
                merged_cells_after_removal.push(*m);
            } else if m.intersects(
                t_row1,
                t_column1,
                t_column2 - t_column1 + 1,
                t_row2 - t_row1 + 1,
            ) {
                if !merge_is_contained(m, t_row1, t_column1, t_row2, t_column2) {
                    return Err(PARTIAL_MERGE_ERROR.to_string());
                }
                // fully contained in the fill target: replaced by the fill
            } else {
                merged_cells_after_removal.push(*m);
            }
        }

        let mut covered_source = HashSet::new();
        for m in &source_merges {
            for row in m.row..m.row + m.height {
                for column in m.column..m.column + m.width {
                    if (row, column) != (m.row, m.column) {
                        covered_source.insert((row, column));
                    }
                }
            }
        }

        // Tile the source merges into the target. Tiles start at the target
        // edge next to the source and repeat away from it.
        let mut new_merges = Vec::new();
        if !source_merges.is_empty() {
            let mut tile_starts = Vec::new();
            if by_rows {
                let period = s_row2 - s_row1 + 1;
                if t_row1 > s_row2 {
                    let mut start = t_row1;
                    while start <= t_row2 {
                        tile_starts.push(start);
                        start += period;
                    }
                } else {
                    let mut start = s_row1 - period;
                    while start + period > t_row1 {
                        tile_starts.push(start);
                        start -= period;
                    }
                }
                for tile_start in tile_starts {
                    for m in &source_merges {
                        let first_row = tile_start + (m.row - s_row1);
                        let last_row = first_row + m.height - 1;
                        if last_row < t_row1 || first_row > t_row2 {
                            continue;
                        }
                        if first_row < t_row1 || last_row > t_row2 {
                            return Err(CUT_MERGE_ERROR.to_string());
                        }
                        new_merges.push(MergedCell {
                            row: first_row,
                            column: m.column,
                            width: m.width,
                            height: m.height,
                        });
                    }
                }
            } else {
                let period = s_column2 - s_column1 + 1;
                if t_column1 > s_column2 {
                    let mut start = t_column1;
                    while start <= t_column2 {
                        tile_starts.push(start);
                        start += period;
                    }
                } else {
                    let mut start = s_column1 - period;
                    while start + period > t_column1 {
                        tile_starts.push(start);
                        start -= period;
                    }
                }
                for tile_start in tile_starts {
                    for m in &source_merges {
                        let first_column = tile_start + (m.column - s_column1);
                        let last_column = first_column + m.width - 1;
                        if last_column < t_column1 || first_column > t_column2 {
                            continue;
                        }
                        if first_column < t_column1 || last_column > t_column2 {
                            return Err(CUT_MERGE_ERROR.to_string());
                        }
                        new_merges.push(MergedCell {
                            row: m.row,
                            column: first_column,
                            width: m.width,
                            height: m.height,
                        });
                    }
                }
            }
        }

        Ok(MergedFillPlan {
            covered_source,
            new_merges,
            old_merged_cells: merged_cells.clone(),
            merged_cells_after_removal,
        })
    }

    // Removes the merges the fill target replaces, with its diff. Pushed
    // before the cell diffs so a forward replay writes on unmerged cells.
    fn apply_fill_merge_removal(
        &mut self,
        sheet: u32,
        plan: &MergedFillPlan,
        diff_list: &mut Vec<Diff>,
    ) -> Result<(), String> {
        if plan.merged_cells_after_removal != plan.old_merged_cells {
            self.model.workbook.worksheet_mut(sheet)?.merged_cells =
                plan.merged_cells_after_removal.clone();
            diff_list.push(Diff::SetMergedCells {
                sheet,
                old_value: plan.old_merged_cells.clone(),
                new_value: plan.merged_cells_after_removal.clone(),
            });
        }
        Ok(())
    }

    // Creates the tiled merges in the fill target, with its diff. Pushed
    // after the cell diffs so an undo unmerges first and can then restore the
    // old content of the covered cells.
    fn apply_fill_merge_creation(
        &mut self,
        sheet: u32,
        plan: &MergedFillPlan,
        diff_list: &mut Vec<Diff>,
    ) -> Result<(), String> {
        if !plan.new_merges.is_empty() {
            let worksheet = self.model.workbook.worksheet_mut(sheet)?;
            worksheet
                .merged_cells
                .extend(plan.new_merges.iter().copied());
            diff_list.push(Diff::SetMergedCells {
                sheet,
                old_value: plan.merged_cells_after_removal.clone(),
                new_value: worksheet.merged_cells.clone(),
            });
        }
        Ok(())
    }

    // The fill target cell is covered by a tiled merge: it gets no value,
    // only the style and (lack of) link of its source cell, and its old
    // content is cleared. `source` and `target` are `(row, column)` pairs.
    fn fill_covered_cell(
        &mut self,
        sheet: u32,
        source: (i32, i32),
        target: (i32, i32),
        old_value: Option<crate::types::Cell>,
        diff_list: &mut Vec<Diff>,
    ) -> Result<(), String> {
        let (source_row, source_column) = source;
        let (row, column) = target;
        let old_style = self.model.get_cell_style_or_none(sheet, row, column)?;
        // Going through prepare_cell_for_user_input keeps dynamic array
        // formulas consistent (an anchor spilling into the cell is reset)
        self.model.prepare_cell_for_user_input(sheet, row, column)?;
        let worksheet = self.model.workbook.worksheet_mut(sheet)?;
        if worksheet.cell(row, column).is_some() {
            worksheet.cell_clear_contents(row, column)?;
        }
        if old_value.is_some() {
            diff_list.push(Diff::SetCellValue {
                sheet,
                row,
                column,
                new_value: "".to_string(),
                old_value: Box::new(old_value),
            });
        }

        let new_style = self
            .model
            .get_style_for_cell(sheet, source_row, source_column)?;
        self.model.set_cell_style(sheet, row, column, &new_style)?;
        diff_list.push(Diff::SetCellStyle {
            sheet,
            row,
            column,
            old_value: Box::new(old_style),
            new_value: Box::new(new_style),
        });

        self.fill_cell_link(sheet, source_row, source_column, row, column, diff_list)
    }
    /// Scans the fill target rectangle (`row_start..=row_end`, `col_start..=col_end`) for
    /// CSE array formulas and prepares them for overwriting:
    ///
    /// * A CSE formula **completely** inside the rectangle is cleared; its original cell
    ///   values are returned keyed by `(row, col)` so the caller can emit correct undo diffs.
    /// * A CSE formula only **partially** overlapping the rectangle causes an immediate error.
    fn collect_and_clear_cse_in_fill_target(
        &mut self,
        sheet: u32,
        row_start: i32,
        row_end: i32,
        col_start: i32,
        col_end: i32,
    ) -> Result<HashMap<(i32, i32), Option<crate::types::Cell>>, String> {
        // First pass: validate all affected CSE anchors without mutating the worksheet.
        // An error here leaves the sheet untouched.
        let mut anchors: Vec<(i32, i32, i32, i32)> = Vec::new();
        let mut handled: Vec<(i32, i32)> = Vec::new();
        for row in row_start..=row_end {
            for col in col_start..=col_end {
                let (ar, ac, w, h) = match self.model.get_cell_structure(sheet, row, col)? {
                    CellStructure::ArrayFormula { range: (w, h) } if w > 1 || h > 1 => {
                        (row, col, w, h)
                    }
                    CellStructure::SpillArray {
                        anchor: (ar, ac),
                        range: (w, h),
                    } => (ar, ac, w, h),
                    _ => continue,
                };
                if handled.contains(&(ar, ac)) {
                    continue;
                }
                handled.push((ar, ac));
                let completely_covered = ar >= row_start
                    && ar + h - 1 <= row_end
                    && ac >= col_start
                    && ac + w - 1 <= col_end;
                if !completely_covered {
                    return Err(
                        "Cannot autofill: selection partially overlaps an array formula"
                            .to_string(),
                    );
                }
                anchors.push((ar, ac, w, h));
            }
        }

        // Second pass: all anchors are completely covered — safe to save and clear.
        let mut saved: HashMap<(i32, i32), Option<crate::types::Cell>> = HashMap::new();
        for (ar, ac, w, h) in anchors {
            for r in ar..ar + h {
                for c in ac..ac + w {
                    let cell = self.model.workbook.worksheet(sheet)?.cell(r, c).cloned();
                    saved.insert((r, c), cell);
                }
            }
            let ws = self.model.workbook.worksheet_mut(sheet)?;
            for r in ar..ar + h {
                for c in ac..ac + w {
                    let _ = ws.cell_clear_contents(r, c);
                }
            }
        }
        Ok(saved)
    }

    /// Fills the cells from `source_area` until `to_row`.
    /// This simulates the user clicking on the cell outline handle and dragging it downwards (or upwards)
    pub fn auto_fill_rows(&mut self, source_area: &Area, to_row: i32) -> Result<(), String> {
        let mut diff_list = Vec::new();
        let sheet = source_area.sheet;
        let row1 = source_area.row;
        let column1 = source_area.column;
        let width = source_area.width;
        let height = source_area.height;

        // Check first all parameters are valid
        if self.model.workbook.worksheet(sheet).is_err() {
            return Err(format!("Invalid worksheet index: '{sheet}'"));
        }

        if !is_valid_column_number(column1) {
            return Err(format!("Invalid column: '{column1}'"));
        }
        if !is_valid_row(row1) {
            return Err(format!("Invalid row: '{row1}'"));
        }
        if width <= 0 || height <= 0 {
            return Err(format!("Invalid width='{}' or height='{}'", width, height));
        }

        let last_column = column1 + width - 1;
        let last_row = row1 + height - 1;

        if !is_valid_column_number(last_column) {
            return Err(format!("Invalid column: '{last_column}'"));
        }
        if !is_valid_row(last_row) {
            return Err(format!("Invalid row: '{last_row}'"));
        }

        if !is_valid_row(to_row) {
            return Err(format!("Invalid row: '{to_row}'"));
        }

        // anchor_row is the first row that repeats in each case.
        let anchor_row;
        let sign;
        // this is the range of rows we are going to fill
        let row_range: Vec<i32>;

        if to_row > last_row {
            // we go downwards, we start from `row1 + height1` to `to_row`,
            anchor_row = row1;
            sign = 1;
            row_range = (last_row + 1..=to_row).collect();
        } else if to_row < row1 {
            // we go upwards, starting from `row1 - 1` all the way to `to_row`
            anchor_row = last_row;
            sign = -1;
            row_range = (to_row..row1).rev().collect();
        } else {
            return Err("Invalid parameters for autofill".to_string());
        }

        // Fill target: rows in row_range, all source columns.
        let fill_row_start = if sign < 0 { to_row } else { last_row + 1 };
        let fill_row_end = if sign < 0 { row1 - 1 } else { to_row };

        // The merged cells of the source are tiled into the fill target and
        // replace the merges already there; a merge partially overlapping the
        // source or the target, or cut by the fill boundary, is an error.
        let plan = self.plan_fill_merges(
            sheet,
            (row1, column1, last_row, last_column),
            (fill_row_start, column1, fill_row_end, last_column),
            true,
        )?;
        self.apply_fill_merge_removal(sheet, &plan, &mut diff_list)?;

        let saved_cse = self.collect_and_clear_cse_in_fill_target(
            sheet,
            fill_row_start,
            fill_row_end,
            column1,
            last_column,
        )?;

        for column in column1..=last_column {
            let mut index = 0;
            let locale = &self.model.locale;
            // covered cells hold no content: the progression is detected over
            // the rest and lands on the non-covered cells of the target
            let values = if sign < 0 {
                (row1..=last_row)
                    .rev()
                    .filter(|row| !plan.covered_source.contains(&(*row, column)))
                    .map(|row| self.get_cell_content(sheet, row, column))
                    .collect::<Result<Vec<_>, _>>()?
            } else {
                (row1..=last_row)
                    .filter(|row| !plan.covered_source.contains(&(*row, column)))
                    .map(|row| self.get_cell_content(sheet, row, column))
                    .collect::<Result<Vec<_>, _>>()?
            };
            let case_seed = self.get_cell_content(sheet, row1, column)?;
            let possible_progression = if values.is_empty() {
                None
            } else {
                detect_progression(&values, locale, &case_seed)
            };
            let mut progression_idx = 0;
            for row_ref in row_range.iter() {
                let row = *row_ref;

                let old_value = saved_cse.get(&(row, column)).cloned().unwrap_or_else(|| {
                    self.model
                        .workbook
                        .worksheet(sheet)
                        .ok()
                        .and_then(|ws| ws.cell(row, column).cloned())
                });

                let source_row = anchor_row + index;

                if plan.covered_source.contains(&(source_row, column)) {
                    // the target cell is covered by a tiled merge
                    self.fill_covered_cell(
                        sheet,
                        (source_row, column),
                        (row, column),
                        old_value,
                        &mut diff_list,
                    )?;
                    index = (index + sign) % source_area.height;
                    continue;
                }

                let old_style = self.model.get_cell_style_or_none(sheet, row, column)?;
                let target_value;

                // compute the new value and set it
                if let Some(ref detected_progression) = possible_progression {
                    target_value = detected_progression.next(progression_idx);
                    progression_idx += 1;
                } else {
                    target_value = self
                        .model
                        .extend_to(sheet, source_row, column, row, column)?;
                }

                self.model
                    .set_user_input(sheet, row, column, target_value.to_string())?;

                // Compute the new style and set it
                let new_style = self.model.get_style_for_cell(sheet, source_row, column)?;
                self.model.set_cell_style(sheet, row, column, &new_style)?;

                // Add the diffs
                diff_list.push(Diff::SetCellStyle {
                    sheet,
                    row,
                    column,
                    old_value: Box::new(old_style),
                    new_value: Box::new(new_style),
                });
                diff_list.push(Diff::SetCellValue {
                    sheet,
                    row,
                    column,
                    new_value: target_value.to_string(),
                    old_value: Box::new(old_value),
                });

                self.fill_cell_link(sheet, source_row, column, row, column, &mut diff_list)?;

                index = (index + sign) % source_area.height;
            }
        }
        self.apply_fill_merge_creation(sheet, &plan, &mut diff_list)?;
        self.push_diff_list(diff_list);
        self.evaluate();
        Ok(())
    }

    /// Fills the cells from `source_area` until `to_column`.
    /// This simulates the user clicking on the cell outline handle and dragging it to the right (or to the left)
    pub fn auto_fill_columns(&mut self, source_area: &Area, to_column: i32) -> Result<(), String> {
        let mut diff_list = Vec::new();
        let sheet = source_area.sheet;
        let row1 = source_area.row;
        let column1 = source_area.column;
        let width = source_area.width;
        let height = source_area.height;

        // Check first all parameters are valid
        if self.model.workbook.worksheet(sheet).is_err() {
            return Err(format!("Invalid worksheet index: '{sheet}'"));
        }

        if !is_valid_column_number(column1) {
            return Err(format!("Invalid column: '{column1}'"));
        }
        if !is_valid_row(row1) {
            return Err(format!("Invalid row: '{row1}'"));
        }
        if width <= 0 || height <= 0 {
            return Err(format!("Invalid width='{}' or height='{}'", width, height));
        }

        let last_column = column1 + width - 1;
        let last_row = row1 + height - 1;

        if !is_valid_column_number(last_column) {
            return Err(format!("Invalid column: '{last_column}'"));
        }
        if !is_valid_row(last_row) {
            return Err(format!("Invalid row: '{last_row}'"));
        }

        if !is_valid_column_number(to_column) {
            return Err(format!("Invalid column: '{to_column}'"));
        }

        // anchor_column is the first column that repeats in each case.
        let anchor_column;
        let sign;
        // this is the range of columns we are going to fill
        let column_range: Vec<i32>;

        if to_column > last_column {
            // we go right, we start from `last_column + 1` to `to_column`,
            anchor_column = column1;
            sign = 1;
            column_range = (last_column + 1..to_column + 1).collect();
        } else if to_column < column1 {
            // we go left, starting from `column1 - 1` all the way to `to_column`
            anchor_column = last_column;
            sign = -1;
            column_range = (to_column..column1).rev().collect();
        } else {
            return Err("Invalid parameters for autofill".to_string());
        }

        // Fill target: all source rows, columns in column_range.
        let fill_col_start = if sign < 0 { to_column } else { last_column + 1 };
        let fill_col_end = if sign < 0 { column1 - 1 } else { to_column };

        // The merged cells of the source are tiled into the fill target and
        // replace the merges already there; a merge partially overlapping the
        // source or the target, or cut by the fill boundary, is an error.
        let plan = self.plan_fill_merges(
            sheet,
            (row1, column1, last_row, last_column),
            (row1, fill_col_start, last_row, fill_col_end),
            false,
        )?;
        self.apply_fill_merge_removal(sheet, &plan, &mut diff_list)?;

        let saved_cse = self.collect_and_clear_cse_in_fill_target(
            sheet,
            row1,
            last_row,
            fill_col_start,
            fill_col_end,
        )?;

        for row in row1..=last_row {
            let mut index = 0;
            let locale = &self.model.locale;
            // covered cells hold no content: the progression is detected over
            // the rest and lands on the non-covered cells of the target
            let values = if sign < 0 {
                (column1..=last_column)
                    .rev()
                    .filter(|column| !plan.covered_source.contains(&(row, *column)))
                    .map(|column| self.get_cell_content(sheet, row, column))
                    .collect::<Result<Vec<_>, _>>()?
            } else {
                (column1..=last_column)
                    .filter(|column| !plan.covered_source.contains(&(row, *column)))
                    .map(|column| self.get_cell_content(sheet, row, column))
                    .collect::<Result<Vec<_>, _>>()?
            };
            let case_seed = self.get_cell_content(sheet, row, column1)?;
            let possible_progression = if values.is_empty() {
                None
            } else {
                detect_progression(&values, locale, &case_seed)
            };
            let mut progression_idx = 0;
            for column_ref in column_range.iter() {
                let column = *column_ref;

                // Save value and style first
                let old_value = saved_cse.get(&(row, column)).cloned().unwrap_or_else(|| {
                    self.model
                        .workbook
                        .worksheet(sheet)
                        .ok()
                        .and_then(|ws| ws.cell(row, column).cloned())
                });

                let source_column = anchor_column + index;

                if plan.covered_source.contains(&(row, source_column)) {
                    // the target cell is covered by a tiled merge
                    self.fill_covered_cell(
                        sheet,
                        (row, source_column),
                        (row, column),
                        old_value,
                        &mut diff_list,
                    )?;
                    index = (index + sign) % source_area.width;
                    continue;
                }

                let old_style = self.model.get_cell_style_or_none(sheet, row, column)?;
                let target_value;

                // compute the new value and set it
                if let Some(ref detected_progression) = possible_progression {
                    target_value = detected_progression.next(progression_idx);
                    progression_idx += 1;
                } else {
                    target_value = self
                        .model
                        .extend_to(sheet, row, source_column, row, column)?;
                }

                self.model
                    .set_user_input(sheet, row, column, target_value.to_string())?;

                let new_style = self.model.get_style_for_cell(sheet, row, source_column)?;
                // Compute the new style and set it

                self.model.set_cell_style(sheet, row, column, &new_style)?;

                // Add the diffs
                diff_list.push(Diff::SetCellStyle {
                    sheet,
                    row,
                    column,
                    old_value: Box::new(old_style),
                    new_value: Box::new(new_style),
                });

                diff_list.push(Diff::SetCellValue {
                    sheet,
                    row,
                    column,
                    new_value: target_value.to_string(),
                    old_value: Box::new(old_value),
                });

                self.fill_cell_link(sheet, row, source_column, row, column, &mut diff_list)?;

                index = (index + sign) % source_area.width;
            }
        }
        self.apply_fill_merge_creation(sheet, &plan, &mut diff_list)?;
        self.push_diff_list(diff_list);
        self.evaluate();
        Ok(())
    }

    /// Makes the link of the fill target cell match the one of its source cell,
    /// adding the corresponding diff. This runs after the value is set so that
    /// it also overrides any link auto-created by an URL value.
    fn fill_cell_link(
        &mut self,
        sheet: u32,
        source_row: i32,
        source_column: i32,
        row: i32,
        column: i32,
        diff_list: &mut Vec<Diff>,
    ) -> Result<(), String> {
        let new_link = self.model.get_cell_link(sheet, source_row, source_column)?;
        let old_link = self.model.get_cell_link(sheet, row, column)?;
        if old_link == new_link {
            return Ok(());
        }
        match &new_link {
            Some(link) => self.model.set_cell_link(sheet, row, column, link.clone())?,
            None => self.model.delete_cell_link(sheet, row, column)?,
        }
        diff_list.push(Diff::SetCellLink {
            sheet,
            row,
            column,
            old_value: Box::new(old_link),
            new_value: Box::new(new_link),
        });
        Ok(())
    }
}
