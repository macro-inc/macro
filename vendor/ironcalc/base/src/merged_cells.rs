use serde::{Deserialize, Serialize};

use crate::constants::{LAST_COLUMN, LAST_ROW};
use crate::expressions::types::Area;
use crate::model::{CellStructure, Model};
use crate::types::{Alignment, Cell, HorizontalAlignment, MergedCell};

// Splits `range` into the one-row-tall sub-ranges that "merge across" merges
// separately.
pub(crate) fn merge_across_ranges(range: &Area) -> Result<Vec<Area>, String> {
    let Area {
        sheet,
        row,
        column,
        width,
        height,
    } = *range;
    if row < 1 || column < 1 || width < 1 || height < 1 {
        return Err("Invalid range".to_string());
    }
    Ok((row..row + height)
        .map(|r| Area {
            sheet,
            row: r,
            column,
            width,
            height: 1,
        })
        .collect())
}

// Splits `range` into the one-column-wide sub-ranges that "merge down" merges
// separately.
pub(crate) fn merge_down_ranges(range: &Area) -> Result<Vec<Area>, String> {
    let Area {
        sheet,
        row,
        column,
        width,
        height,
    } = *range;
    if row < 1 || column < 1 || width < 1 || height < 1 {
        return Err("Invalid range".to_string());
    }
    Ok((column..column + width)
        .map(|c| Area {
            sheet,
            row,
            column: c,
            width: 1,
            height,
        })
        .collect())
}

/// Position of a cell relative to the merged cells of a worksheet
#[derive(Serialize, Deserialize, Debug, PartialEq, Eq, Clone)]
pub enum MergeStructure {
    /// The cell is not part of any merged range
    None,
    /// The cell is the anchor (top-left cell) of a merged range
    Anchor {
        /// Number of columns of the merged range
        width: i32,
        /// Number of rows of the merged range
        height: i32,
    },
    /// The cell is inside a merged range but is not its anchor
    Covered {
        /// Row of the anchor of the merged range
        anchor_row: i32,
        /// Column of the anchor of the merged range
        anchor_column: i32,
    },
}

impl<'a> Model<'a> {
    /// Merges the cells in `range` into a single merged cell anchored at its
    /// top-left corner:
    /// * at most one cell of the range may have content; if more than one does
    ///   the merge fails and nothing changes
    /// * the content, link and style of that single cell move to the anchor
    ///   and its style is copied to every cell of the range, so the old styles
    ///   of the other cells are forgotten (after unmerging the whole range
    ///   shows that cell's formatting). With no content anywhere the anchor
    ///   plays that role
    /// * borders included: the content cell's borders outline the merged cell
    ///   as a whole, so each cell of the range keeps only the border sides
    ///   that lie on the perimeter (interior edges have no border)
    ///
    /// Fails if:
    /// * the range is invalid, out of bounds or a single cell
    /// * the range intersects an existing merged cell
    /// * the range intersects an array formula
    /// * more than one cell of the range has content
    pub fn merge_cells(&mut self, range: &Area) -> Result<(), String> {
        let Area {
            sheet,
            row,
            column,
            width,
            height,
        } = *range;
        self.check_merge_range(range)?;
        let content_cell = self.merge_range_content_cell(range)?;
        // The merged cell takes the content and style of the single cell with
        // content; of the anchor if the whole range is empty.
        let (source_row, source_column) = content_cell.unwrap_or((row, column));
        let merged_style = self.get_style_for_cell(sheet, source_row, source_column)?;
        if (source_row, source_column) != (row, column) {
            // Move the content and link to the anchor before the covered
            // cells (the source among them) are cleared. The anchor is known
            // to be empty: otherwise there would be two cells with content.
            let source_cell = self
                .workbook
                .worksheet(sheet)?
                .cell(source_row, source_column)
                .cloned();
            match source_cell {
                Some(Cell::CellFormula { .. }) | Some(Cell::ArrayFormula { .. }) => {
                    // Formulas are stored relative to their cell: re-enter the
                    // text at the anchor so the formula stays as written.
                    let content =
                        self.get_localized_cell_content(sheet, source_row, source_column)?;
                    self.set_user_input(sheet, row, column, content)?;
                }
                Some(cell) => {
                    self.workbook
                        .worksheet_mut(sheet)?
                        .update_cell(row, column, cell)?;
                }
                None => {}
            }
            let worksheet = self.workbook.worksheet_mut(sheet)?;
            if let Some(link) = worksheet.links.remove(&(source_row, source_column)) {
                worksheet.links.insert((row, column), link);
            }
        }
        self.merge_cells_keep_styles(range)?;
        for r in row..row + height {
            for c in column..column + width {
                let mut style = merged_style.clone();
                if r != row {
                    style.border.top = None;
                }
                if r != row + height - 1 {
                    style.border.bottom = None;
                }
                if c != column {
                    style.border.left = None;
                }
                if c != column + width - 1 {
                    style.border.right = None;
                }
                if self.get_style_for_cell(sheet, r, c)? != style {
                    self.set_cell_style(sheet, r, c, &style)?;
                }
            }
        }
        Ok(())
    }

    /// Same as [Model::merge_cells] but the merged cell is also centered
    /// horizontally ("merge & center").
    pub fn merge_cells_center(&mut self, range: &Area) -> Result<(), String> {
        self.merge_cells(range)?;
        self.center_merged_range(range)
    }

    /// Merges each row of `range` separately into a one-row-tall merged cell
    /// ("merge across"), following the rules of [Model::merge_cells] row by
    /// row. Every row is validated up front, so the operation is
    /// all-or-nothing: if any row cannot be merged nothing changes.
    pub fn merge_cells_across(&mut self, range: &Area) -> Result<(), String> {
        let ranges = merge_across_ranges(range)?;
        for range in &ranges {
            self.check_merge(range)?;
        }
        for range in &ranges {
            self.merge_cells(range)?;
        }
        Ok(())
    }

    /// Merges each column of `range` separately into a one-column-wide merged
    /// cell ("merge down"), following the rules of [Model::merge_cells]
    /// column by column. Every column is validated up front, so the operation
    /// is all-or-nothing: if any column cannot be merged nothing changes.
    pub fn merge_cells_down(&mut self, range: &Area) -> Result<(), String> {
        let ranges = merge_down_ranges(range)?;
        for range in &ranges {
            self.check_merge(range)?;
        }
        for range in &ranges {
            self.merge_cells(range)?;
        }
        Ok(())
    }

    // Full validation of merging `range` without touching the model: the
    // shape checks of `check_merge_range` plus the single-content-cell rule.
    // Lets a multi-range merge ("across", "down") be all-or-nothing.
    pub(crate) fn check_merge(&self, range: &Area) -> Result<(), String> {
        self.check_merge_range(range)?;
        self.merge_range_content_cell(range)?;
        Ok(())
    }

    // Finds the single cell of `range` with content, if any; merging is not
    // allowed when more than one cell has content. Spill cells don't count:
    // they hold values computed by an anchor outside the range, not content
    // of their own (the spill is blocked and re-evaluated).
    fn merge_range_content_cell(&self, range: &Area) -> Result<Option<(i32, i32)>, String> {
        let Area {
            sheet,
            row,
            column,
            width,
            height,
        } = *range;
        let worksheet = self.workbook.worksheet(sheet)?;
        let mut content_cell = None;
        for r in row..row + height {
            for c in column..column + width {
                if matches!(
                    worksheet.cell(r, c),
                    None | Some(Cell::EmptyCell { .. }) | Some(Cell::SpillCell { .. })
                ) {
                    continue;
                }
                if content_cell.is_some() {
                    return Err("Cannot merge cells: more than one cell has content".to_string());
                }
                content_cell = Some((r, c));
            }
        }
        Ok(content_cell)
    }

    // Sets horizontal center alignment on every cell of `range` (the style of
    // a merged cell lives on all its cells alike). Used by "merge & center"
    // right after the merge itself.
    pub(crate) fn center_merged_range(&mut self, range: &Area) -> Result<(), String> {
        let Area {
            sheet,
            row,
            column,
            width,
            height,
        } = *range;
        for r in row..row + height {
            for c in column..column + width {
                let mut style = self.get_style_for_cell(sheet, r, c)?;
                let alignment = style.alignment.get_or_insert_with(Alignment::default);
                if alignment.horizontal != HorizontalAlignment::Center {
                    alignment.horizontal = HorizontalAlignment::Center;
                    self.set_cell_style(sheet, r, c, &style)?;
                }
            }
        }
        Ok(())
    }

    // Checks that `range` is a valid merge target: in bounds, more than one
    // cell and intersecting no existing merged cell or array formula.
    fn check_merge_range(&self, range: &Area) -> Result<(), String> {
        let Area {
            sheet,
            row,
            column,
            width,
            height,
        } = *range;
        if row < 1 || column < 1 || width < 1 || height < 1 {
            return Err("Invalid range".to_string());
        }
        if row + height - 1 > LAST_ROW || column + width - 1 > LAST_COLUMN {
            return Err("Range is out of bounds".to_string());
        }
        if width == 1 && height == 1 {
            return Err("Cannot merge a single cell".to_string());
        }
        let worksheet = self.workbook.worksheet(sheet)?;
        if let Some(m) = worksheet
            .merged_cells
            .iter()
            .find(|m| m.intersects(row, column, width, height))
        {
            return Err(format!(
                "Range intersects the merged cell at row {}, column {}",
                m.row, m.column
            ));
        }
        for r in row..row + height {
            for c in column..column + width {
                match worksheet.get_cell_structure(r, c)? {
                    CellStructure::ArrayFormula {
                        range: (array_width, array_height),
                    } => {
                        if array_width > 1 || array_height > 1 {
                            return Err(
                                "Cannot merge cells that intersect an array formula".to_string()
                            );
                        }
                    }
                    CellStructure::SpillArray { .. } => {
                        return Err(
                            "Cannot merge cells that intersect an array formula".to_string()
                        );
                    }
                    _ => {}
                }
            }
        }
        Ok(())
    }

    // Registers the merged cell and clears the content and links of the
    // covered cells, but leaves every cell's style untouched. Used by the
    // clipboard when recreating a pasted merge: the pasted cells already carry
    // the merged style pattern of the source, and stamping the anchor's style
    // would drop the perimeter borders that live on non-anchor cells.
    pub(crate) fn merge_cells_keep_styles(&mut self, range: &Area) -> Result<(), String> {
        let Area {
            sheet,
            row,
            column,
            width,
            height,
        } = *range;
        self.check_merge_range(range)?;
        // Clear the content and links of the covered cells. Going through
        // prepare_cell_for_user_input keeps dynamic array formulas consistent:
        // a covered spill anchor loses its spill and an outside anchor spilling
        // into the range is reset, so it re-evaluates (to #SPILL!) afterwards.
        for r in row..row + height {
            for c in column..column + width {
                if r == row && c == column {
                    continue;
                }
                self.prepare_cell_for_user_input(sheet, r, c)?;
                let worksheet = self.workbook.worksheet_mut(sheet)?;
                if worksheet.cell(r, c).is_some() {
                    worksheet.cell_clear_contents(r, c)?;
                }
                worksheet.links.remove(&(r, c));
            }
        }
        self.workbook
            .worksheet_mut(sheet)?
            .merged_cells
            .push(MergedCell {
                row,
                column,
                width,
                height,
            });
        Ok(())
    }

    /// Removes every merged cell that intersects `range`. The content of the
    /// anchors is kept. Removing no merged cells at all is not an error.
    pub fn unmerge_cells(&mut self, range: &Area) -> Result<(), String> {
        let Area {
            sheet,
            row,
            column,
            width,
            height,
        } = *range;
        if row < 1 || column < 1 || width < 1 || height < 1 {
            return Err("Invalid range".to_string());
        }
        let worksheet = self.workbook.worksheet_mut(sheet)?;
        worksheet
            .merged_cells
            .retain(|m| !m.intersects(row, column, width, height));
        Ok(())
    }

    /// Returns the list of merged cells of the worksheet
    pub fn get_merged_cells(&self, sheet: u32) -> Result<&[MergedCell], String> {
        Ok(&self.workbook.worksheet(sheet)?.merged_cells)
    }

    /// Returns the position of (row, column) relative to the merged cells of
    /// the worksheet: not merged, the anchor of a merged range or covered by one.
    pub fn get_merge_structure(
        &self,
        sheet: u32,
        row: i32,
        column: i32,
    ) -> Result<MergeStructure, String> {
        let worksheet = self.workbook.worksheet(sheet)?;
        Ok(match worksheet.merged_cell_containing(row, column) {
            Some(m) if m.row == row && m.column == column => MergeStructure::Anchor {
                width: m.width,
                height: m.height,
            },
            Some(m) => MergeStructure::Covered {
                anchor_row: m.row,
                anchor_column: m.column,
            },
            None => MergeStructure::None,
        })
    }
}
