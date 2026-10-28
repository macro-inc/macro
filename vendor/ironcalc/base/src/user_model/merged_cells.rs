use crate::expressions::types::Area;
use crate::merged_cells::{merge_across_ranges, merge_down_ranges};
use crate::types::{Cell, MergedCell};

use super::{common::UserModel, history::Diff};

impl UserModel<'_> {
    /// Merges the cells of `range` into a single merged cell anchored at its
    /// top-left corner. At most one cell of the range may have content: its
    /// content, link and style move to the anchor and the style is copied to
    /// the whole range (with its borders outlining the merged cell as a
    /// whole); undoing restores everything.
    ///
    /// Fails if the range is invalid, a single cell, intersects an existing
    /// merged cell or an array formula, or contains more than one cell with
    /// content.
    ///
    /// See also:
    /// * [Model::merge_cells](crate::Model::merge_cells)
    pub fn merge_cells(&mut self, range: &Area) -> Result<(), String> {
        self.merge_ranges(std::slice::from_ref(range), false)
    }

    /// Same as [UserModel::merge_cells] but the merged cell is also centered
    /// horizontally ("merge & center"). Merging and centering form a single
    /// undo step.
    ///
    /// See also:
    /// * [Model::merge_cells_center](crate::Model::merge_cells_center)
    pub fn merge_cells_center(&mut self, range: &Area) -> Result<(), String> {
        self.merge_ranges(std::slice::from_ref(range), true)
    }

    /// Merges each row of `range` separately into a one-row-tall merged cell
    /// ("merge across"), following the rules of [UserModel::merge_cells] row
    /// by row. Every row is validated up front, so the operation is
    /// all-or-nothing, and all the merges form a single undo step.
    ///
    /// See also:
    /// * [Model::merge_cells_across](crate::Model::merge_cells_across)
    pub fn merge_cells_across(&mut self, range: &Area) -> Result<(), String> {
        self.merge_ranges(&merge_across_ranges(range)?, false)
    }

    /// Merges each column of `range` separately into a one-column-wide merged
    /// cell ("merge down"), following the rules of [UserModel::merge_cells]
    /// column by column. Every column is validated up front, so the operation
    /// is all-or-nothing, and all the merges form a single undo step.
    ///
    /// See also:
    /// * [Model::merge_cells_down](crate::Model::merge_cells_down)
    pub fn merge_cells_down(&mut self, range: &Area) -> Result<(), String> {
        self.merge_ranges(&merge_down_ranges(range)?, false)
    }

    // Merges every range of `ranges` (all on the same sheet), centering each
    // horizontally when `center` is set, as a single undo step.
    fn merge_ranges(&mut self, ranges: &[Area], center: bool) -> Result<(), String> {
        let Some(first) = ranges.first() else {
            return Ok(());
        };
        let sheet = first.sheet;
        // Validate every range up front so a multi-range merge is
        // all-or-nothing: if any range cannot be merged nothing changes.
        for range in ranges {
            self.model.check_merge(range)?;
        }
        let old_merged_cells = self.model.get_merged_cells(sheet)?.to_vec();

        let mut diff_list = Vec::new();
        for range in ranges {
            self.merge_range_collect_diffs(range, center, &mut diff_list)?;
        }
        self.snap_selection_to_merged_area(ranges);

        let new_merged_cells = self.model.get_merged_cells(sheet)?.to_vec();
        diff_list.push(Diff::SetMergedCells {
            sheet,
            old_value: old_merged_cells,
            new_value: new_merged_cells,
        });
        self.push_diff_list(diff_list);
        self.evaluate_if_not_paused();
        Ok(())
    }

    // Merges `range` (plus, with `center`, the horizontal centering) and
    // appends the undo diffs for everything that changed: contents, links and
    // styles, but not the merged-cell list itself.
    fn merge_range_collect_diffs(
        &mut self,
        range: &Area,
        center: bool,
        diff_list: &mut Vec<Diff>,
    ) -> Result<(), String> {
        let sheet = range.sheet;
        diff_list.extend(self.covered_cells_clear_diffs(range)?);

        // Merging moves the content and link of the single covered cell with
        // content to the anchor: capture the anchor's state before so the
        // gained content can be recorded as diffs of its own (redo and
        // external models replay the diffs, not merge_cells).
        let worksheet = self.model.workbook.worksheet(sheet)?;
        let anchor_old_value = worksheet.cell(range.row, range.column).cloned();
        let anchor_old_link = worksheet.links.get(&(range.row, range.column)).cloned();

        // Merging stamps the anchor's style on the whole range: capture the
        // explicit style of every cell before and after so undo restores them
        let mut old_styles = Vec::new();
        for row in range.row..range.row + range.height {
            for column in range.column..range.column + range.width {
                old_styles.push((
                    row,
                    column,
                    self.model.get_cell_style_or_none(sheet, row, column)?,
                ));
            }
        }

        self.model.merge_cells(range)?;
        if center {
            self.model.center_merged_range(range)?;
        }

        let worksheet = self.model.workbook.worksheet(sheet)?;
        let anchor_new_value = worksheet.cell(range.row, range.column).cloned();
        let anchor_had_content = !matches!(&anchor_old_value, None | Some(Cell::EmptyCell { .. }));
        let anchor_has_content = !matches!(&anchor_new_value, None | Some(Cell::EmptyCell { .. }));
        if !anchor_had_content && anchor_has_content {
            let new_value =
                self.model
                    .get_localized_cell_content(sheet, range.row, range.column)?;
            diff_list.push(Diff::SetCellValue {
                sheet,
                row: range.row,
                column: range.column,
                new_value,
                old_value: Box::new(anchor_old_value),
            });
        }
        let anchor_new_link = worksheet.links.get(&(range.row, range.column)).cloned();
        if anchor_new_link != anchor_old_link {
            diff_list.push(Diff::SetCellLink {
                sheet,
                row: range.row,
                column: range.column,
                old_value: Box::new(anchor_old_link),
                new_value: Box::new(anchor_new_link),
            });
        }

        for (row, column, old_style) in old_styles {
            let new_style = self.model.get_cell_style_or_none(sheet, row, column)?;
            if new_style != old_style {
                if let Some(new_style) = new_style {
                    diff_list.push(Diff::SetCellStyle {
                        sheet,
                        row,
                        column,
                        old_value: Box::new(old_style),
                        new_value: Box::new(new_style),
                    });
                }
            }
        }
        Ok(())
    }

    // A covered cell can never stay selected: if the selected cell is now
    // inside the merged area, select the whole area — all the merged cells of
    // a multi-range merge ("across", "down") — with the top-left anchor as
    // the selected cell and the bottom-right cell as the focus (the canonical
    // anchor/focus pair for that range). The scroll position and the
    // selection are left alone on undo.
    fn snap_selection_to_merged_area(&mut self, ranges: &[Area]) {
        let Some(first) = ranges.first() else {
            return;
        };
        let row = ranges.iter().map(|r| r.row).min().unwrap_or(first.row);
        let column = ranges
            .iter()
            .map(|r| r.column)
            .min()
            .unwrap_or(first.column);
        let last_row = ranges
            .iter()
            .map(|r| r.row + r.height - 1)
            .max()
            .unwrap_or(first.row);
        let last_column = ranges
            .iter()
            .map(|r| r.column + r.width - 1)
            .max()
            .unwrap_or(first.column);
        if let Ok(worksheet) = self.model.workbook.worksheet_mut(first.sheet) {
            if let Some(view) = worksheet.views.get_mut(&self.model.view_id) {
                if view.row >= row
                    && view.row <= last_row
                    && view.column >= column
                    && view.column <= last_column
                {
                    view.row = row;
                    view.column = column;
                    view.range = [row, column, last_row, last_column];
                    view.focus_row = last_row;
                    view.focus_column = last_column;
                }
            }
        }
    }

    /// Removes every merged cell that intersects `range`. The content of the
    /// anchors is kept. Removing no merged cells at all is a no-op.
    ///
    /// See also:
    /// * [Model::unmerge_cells](crate::Model::unmerge_cells)
    pub fn unmerge_cells(&mut self, range: &Area) -> Result<(), String> {
        let sheet = range.sheet;
        let old_value = self.model.get_merged_cells(sheet)?.to_vec();
        self.model.unmerge_cells(range)?;
        let new_value = self.model.get_merged_cells(sheet)?.to_vec();
        if old_value == new_value {
            // no-op, don't pollute the undo history
            return Ok(());
        }
        self.push_diff_list(vec![Diff::SetMergedCells {
            sheet,
            old_value,
            new_value,
        }]);
        self.evaluate_if_not_paused();
        Ok(())
    }

    /// Returns the list of merged cells of the worksheet.
    pub fn get_merged_cells(&self, sheet: u32) -> Result<Vec<MergedCell>, String> {
        Ok(self.model.get_merged_cells(sheet)?.to_vec())
    }

    // Captures the undo diffs for the content and links that merging `range`
    // will clear: everything but the anchor.
    pub(super) fn covered_cells_clear_diffs(&self, range: &Area) -> Result<Vec<Diff>, String> {
        let sheet = range.sheet;
        let mut diff_list: Vec<Diff> = Vec::new();
        let worksheet = self.model.workbook.worksheet(sheet)?;
        for row in range.row..range.row + range.height {
            for column in range.column..range.column + range.width {
                if row == range.row && column == range.column {
                    continue;
                }
                if let Some(link) = worksheet.links.get(&(row, column)) {
                    diff_list.push(Diff::SetCellLink {
                        sheet,
                        row,
                        column,
                        old_value: Box::new(Some(link.clone())),
                        new_value: Box::new(None),
                    });
                }
                let old_value = worksheet.cell(row, column).cloned();
                if matches!(&old_value, None | Some(Cell::EmptyCell { .. })) {
                    continue;
                }
                diff_list.push(Diff::SetCellValue {
                    sheet,
                    row,
                    column,
                    new_value: "".to_string(),
                    old_value: Box::new(old_value),
                });
            }
        }
        Ok(diff_list)
    }
}
