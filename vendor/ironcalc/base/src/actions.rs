use crate::cf_types::{CfRule, Cfvo};
use crate::constants::{LAST_COLUMN, LAST_ROW};
use crate::cut_paste::cf_sqref_anchor;
use crate::expressions::parser::stringify::{
    to_localized_string, to_string_displaced, DisplaceData,
};
use crate::expressions::parser::Parser as ExprParser;
use crate::expressions::types::CellReferenceRC;
use crate::expressions::utils;
use crate::language::get_default_language;
use crate::locale::get_default_locale;
use crate::model::{CellStructure, Model};
use crate::types::{ArrayKind, Cell, Link, MergedCell, Worksheet};

/// Applies `map` to the (row, column) key of every link in the worksheet, so
/// that links follow their cells when rows or columns are inserted, deleted or
/// moved: `Some((row, column))` moves the link there, `None` removes it.
fn displace_links<F>(worksheet: &mut Worksheet, map: F)
where
    F: Fn(i32, i32) -> Option<(i32, i32)>,
{
    let links = std::mem::take(&mut worksheet.links);
    worksheet.links = links
        .into_iter()
        .filter_map(|((row, column), link)| map(row, column).map(|key| (key, link)))
        .collect();
}

/// Applies `map` to the corners (first row, first column, last row, last column)
/// of every merged cell of the worksheet, so that merged ranges follow their
/// cells when rows or columns are inserted, deleted or moved. `None` removes
/// the merged cell; ranges reduced to a single cell are removed as well.
fn displace_merged_cells<F>(worksheet: &mut Worksheet, map: F)
where
    F: Fn(i32, i32, i32, i32) -> Option<(i32, i32, i32, i32)>,
{
    let merged_cells = std::mem::take(&mut worksheet.merged_cells);
    worksheet.merged_cells = merged_cells
        .into_iter()
        .filter_map(|m| {
            map(m.row, m.column, m.last_row(), m.last_column()).map(
                |(first_row, first_column, last_row, last_column)| MergedCell {
                    row: first_row,
                    column: first_column,
                    width: last_column - first_column + 1,
                    height: last_row - first_row + 1,
                },
            )
        })
        .filter(|m| m.width >= 1 && m.height >= 1 && !(m.width == 1 && m.height == 1))
        .collect();
}

// Interval arithmetic for a move action: the moved group [group_start, group_end]
// jumps by `delta` while the displaced zone shifts in the opposite direction.
// Returns whether the interval [start, end] survives the move without being
// split: it must be fully inside the moved group, fully inside the displaced
// zone or fully outside both.
fn interval_survives_move(
    start: i32,
    end: i32,
    group_start: i32,
    group_end: i32,
    delta: i32,
) -> bool {
    let (displace_start, displace_end) = if delta > 0 {
        (group_end + 1, group_end + delta)
    } else {
        (group_start + delta, group_start - 1)
    };
    let inside = |a: i32, b: i32| start >= a && end <= b;
    let outside = |a: i32, b: i32| end < a || start > b;
    (inside(group_start, group_end) || outside(group_start, group_end))
        && (inside(displace_start, displace_end) || outside(displace_start, displace_end))
}

// Returns the new position of the interval [start, end] after moving the group
// [group_start, group_end] by `delta` (`count` is the size of the group).
// Assumes `interval_survives_move` holds.
fn displace_interval_for_move(
    start: i32,
    end: i32,
    group_start: i32,
    group_end: i32,
    delta: i32,
    count: i32,
) -> (i32, i32) {
    if start >= group_start && end <= group_end {
        (start + delta, end + delta)
    } else if delta > 0 && start > group_end && end <= group_end + delta {
        (start - count, end - count)
    } else if delta < 0 && start >= group_start + delta && end < group_start {
        (start + count, end + count)
    } else {
        (start, end)
    }
}

/// Returns the new row after displacement, or `None` if the row was deleted.
fn displace_cf_row(row: i32, data: &DisplaceData, sheet: u32) -> Option<i32> {
    match data {
        DisplaceData::Row {
            sheet: s,
            row: dr,
            delta,
        } if *s == sheet => {
            if row >= *dr {
                if *delta < 0 && row < *dr - *delta {
                    None
                } else {
                    Some(row + *delta)
                }
            } else {
                Some(row)
            }
        }
        DisplaceData::RowMove {
            sheet: s,
            row: mr,
            delta,
        } if *s == sheet => {
            if row == *mr {
                Some(row + *delta)
            } else if *delta > 0 && row > *mr && row <= *mr + *delta {
                Some(row - 1)
            } else if *delta < 0 && row < *mr && row >= *mr + *delta {
                Some(row + 1)
            } else {
                Some(row)
            }
        }
        _ => Some(row),
    }
}

/// Returns the new column after displacement, or `None` if the column was deleted.
fn displace_cf_col(col: i32, data: &DisplaceData, sheet: u32) -> Option<i32> {
    match data {
        DisplaceData::Column {
            sheet: s,
            column: dc,
            delta,
        } if *s == sheet => {
            if col >= *dc {
                if *delta < 0 && col < *dc - *delta {
                    None
                } else {
                    Some(col + *delta)
                }
            } else {
                Some(col)
            }
        }
        DisplaceData::ColumnMove {
            sheet: s,
            column: mc,
            delta,
        } if *s == sheet => {
            if col == *mc {
                Some(col + *delta)
            } else if *delta > 0 && col > *mc && col <= *mc + *delta {
                Some(col - 1)
            } else if *delta < 0 && col < *mc && col >= *mc + *delta {
                Some(col + 1)
            } else {
                Some(col)
            }
        }
        _ => Some(col),
    }
}

/// Displaces a single A1-style sqref part (e.g. "A1" or "A1:B5").
/// Returns the original string unchanged if any corner would become #REF!.
fn displace_cf_sqref_part(part: &str, data: &DisplaceData, sheet: u32) -> String {
    let upper = part.to_uppercase();
    let segs: Vec<&str> = upper.splitn(2, ':').collect();
    match segs.len() {
        1 => {
            if let Some(r) = utils::parse_reference_a1(segs[0]) {
                if let (Some(nr), Some(nc)) = (
                    displace_cf_row(r.row, data, sheet),
                    displace_cf_col(r.column, data, sheet),
                ) {
                    if let Some(c) = utils::number_to_column(nc) {
                        return format!("{c}{nr}");
                    }
                }
            }
            part.to_string()
        }
        2 => {
            if let (Some(r1), Some(r2)) = (
                utils::parse_reference_a1(segs[0]),
                utils::parse_reference_a1(segs[1]),
            ) {
                if let (Some(nr1), Some(nc1), Some(nr2), Some(nc2)) = (
                    displace_cf_row(r1.row, data, sheet),
                    displace_cf_col(r1.column, data, sheet),
                    displace_cf_row(r2.row, data, sheet),
                    displace_cf_col(r2.column, data, sheet),
                ) {
                    if let (Some(c1), Some(c2)) =
                        (utils::number_to_column(nc1), utils::number_to_column(nc2))
                    {
                        return format!("{c1}{nr1}:{c2}{nr2}");
                    }
                }
            }
            part.to_string()
        }
        _ => part.to_string(),
    }
}

/// Displaces every part of a space-separated sqref string.
fn displace_cf_sqref(sqref: &str, data: &DisplaceData, sheet: u32) -> String {
    sqref
        .split_whitespace()
        .map(|p| displace_cf_sqref_part(p, data, sheet))
        .collect::<Vec<_>>()
        .join(" ")
}

// NOTE: There is a difference with Excel behaviour when deleting cells/rows/columns
// In Excel if the whole range is deleted then it will substitute for #REF!
// In IronCalc, if one of the edges of the range is deleted will replace the edge with #REF!
// I feel this is unimportant for now.

/// Displaces a single formula string (with or without leading `=`) using `to_string_displaced`.
/// CF formulas are stored in English (see [Model::user_formula_to_internal]),
/// so the caller must have the parser in the default (English) locale/language.
fn displace_cf_formula_str(
    parser: &mut ExprParser<'_>,
    formula: &str,
    context: &CellReferenceRC,
    data: &DisplaceData,
) -> String {
    let trimmed = formula.trim();
    let has_eq = trimmed.starts_with('=');
    let body = if has_eq { &trimmed[1..] } else { trimmed };
    let node = parser.parse(body, context);
    let displaced = to_string_displaced(
        &node,
        context,
        data,
        get_default_locale(),
        get_default_language(),
    );
    if has_eq {
        format!("={displaced}")
    } else {
        displaced
    }
}

fn displace_cfvo(
    parser: &mut ExprParser<'_>,
    cfvo: Cfvo,
    context: &CellReferenceRC,
    data: &DisplaceData,
) -> Cfvo {
    if let Cfvo::Formula(f) = cfvo {
        Cfvo::Formula(displace_cf_formula_str(parser, &f, context, data))
    } else {
        cfvo
    }
}

/// Displaces all formula fields inside a `CfRule`.
fn displace_cf_rule_formulas(
    parser: &mut ExprParser<'_>,
    rule: CfRule,
    context: &CellReferenceRC,
    data: &DisplaceData,
) -> CfRule {
    match rule {
        CfRule::Formula {
            formula,
            dxf_id,
            stop_if_true,
        } => CfRule::Formula {
            formula: displace_cf_formula_str(parser, &formula, context, data),
            dxf_id,
            stop_if_true,
        },
        CfRule::CellIs {
            operator,
            formula,
            formula2,
            dxf_id,
            stop_if_true,
        } => CfRule::CellIs {
            operator,
            formula: displace_cf_formula_str(parser, &formula, context, data),
            formula2: formula2.map(|f| displace_cf_formula_str(parser, &f, context, data)),
            dxf_id,
            stop_if_true,
        },
        CfRule::ColorScale { thresholds } => CfRule::ColorScale {
            thresholds: thresholds
                .into_iter()
                .map(|mut t| {
                    t.cfvo = displace_cfvo(parser, t.cfvo, context, data);
                    t
                })
                .collect(),
        },
        CfRule::DataBar {
            min,
            max,
            positive_color,
            negative_color,
            is_gradient,
            show_value,
        } => CfRule::DataBar {
            min: min.map(|c| displace_cfvo(parser, c, context, data)),
            max: max.map(|c| displace_cfvo(parser, c, context, data)),
            positive_color,
            negative_color,
            is_gradient,
            show_value,
        },
        CfRule::IconSet {
            thresholds,
            show_value,
        } => CfRule::IconSet {
            thresholds: thresholds
                .into_iter()
                .map(|mut t| {
                    t.cfvo = displace_cfvo(parser, t.cfvo, context, data);
                    t
                })
                .collect(),
            show_value,
        },
        CfRule::IconRating {
            icon,
            color,
            thresholds,
            show_value,
        } => CfRule::IconRating {
            icon,
            color,
            thresholds: thresholds
                .into_iter()
                .map(|(cfvo, strict)| (displace_cfvo(parser, cfvo, context, data), strict))
                .collect(),
            show_value,
        },
        // No formula fields in remaining variants
        other => other,
    }
}

impl<'a> Model<'a> {
    fn shift_cell_formula(
        &mut self,
        sheet: u32,
        row: i32,
        column: i32,
        displace_data: &DisplaceData,
    ) -> Result<(), String> {
        if let Some(f) = self
            .workbook
            .worksheet(sheet)?
            .cell(row, column)
            .and_then(|c| c.get_formula())
        {
            let node = &self.parsed_formulas[sheet as usize][f as usize].0.clone();
            let cell_reference = CellReferenceRC {
                sheet: self.workbook.worksheets[sheet as usize].get_name(),
                row,
                column,
            };
            // FIXME: This is not a very performant way if the formula has changed :S.
            // Both strings must be in the active locale/language: the displaced
            // one is written back through the (localized) parser, and comparing
            // against an English rendering would flag every formula as changed.
            let formula = to_localized_string(node, &cell_reference, self.locale, self.language);
            let formula_displaced = to_string_displaced(
                node,
                &cell_reference,
                displace_data,
                self.locale,
                self.language,
            );
            if formula != formula_displaced {
                self.update_cell_with_formula(sheet, row, column, format!("={formula_displaced}"))?;
            };
        }
        Ok(())
    }
    /// This function iterates over all cells in the model and shifts their formulas according to the displacement data.
    ///
    /// # Arguments
    ///
    /// * `displace_data` - A reference to `DisplaceData` describing the displacement's direction and magnitude.
    fn displace_cells(&mut self, displace_data: &DisplaceData) -> Result<(), String> {
        let cells = self.get_all_cells();
        for cell in cells {
            self.shift_cell_formula(cell.index, cell.row, cell.column, displace_data)?;
        }
        Ok(())
    }

    /// Updates the `range` field and formula fields of every CF rule on `sheet` according to `displace_data`.
    fn displace_cf_ranges(&mut self, sheet: u32, displace_data: &DisplaceData) {
        let count = match self.workbook.worksheets.get(sheet as usize) {
            Some(ws) => ws.conditional_formatting.len(),
            None => return,
        };

        // Phase 1: collect (index, new_range, old_rule, anchor) without holding a borrow on self.
        let sheet_name = self.workbook.worksheets[sheet as usize].get_name();
        let mut phase1: Vec<(usize, String, CfRule, i32, i32)> = Vec::with_capacity(count);
        for idx in 0..count {
            let cf = &self.workbook.worksheets[sheet as usize].conditional_formatting[idx];
            let old_range = cf.range.clone();
            let new_range = displace_cf_sqref(&old_range, displace_data, sheet);
            let rule = cf.cf_rule.clone();
            if let Some((anchor_row, anchor_col)) = cf_sqref_anchor(&old_range) {
                phase1.push((idx, new_range, rule, anchor_row, anchor_col));
            }
        }

        // Phase 2: displace formula fields (requires &mut self.parser) then write back.
        // CF formulas are stored in English, so parse them with the default
        // locale/language regardless of the active ones.
        let locale = self.locale;
        let language = self.language;
        self.parser.set_locale(get_default_locale());
        self.parser.set_language(get_default_language());
        for (idx, new_range, rule, anchor_row, anchor_col) in phase1 {
            let context = CellReferenceRC {
                sheet: sheet_name.clone(),
                row: anchor_row,
                column: anchor_col,
            };
            let new_rule =
                displace_cf_rule_formulas(&mut self.parser, rule, &context, displace_data);
            self.workbook.worksheets[sheet as usize].conditional_formatting[idx].range = new_range;
            self.workbook.worksheets[sheet as usize].conditional_formatting[idx].cf_rule = new_rule;
        }
        self.parser.set_locale(locale);
        self.parser.set_language(language);
    }

    /// Retrieves the column indices for a specific row in a given sheet, sorted in ascending or descending order.
    ///
    /// # Arguments
    ///
    /// * `sheet` - The sheet number to retrieve columns from.
    /// * `row` - The row number to retrieve columns for.
    /// * `descending` - If true, the columns are returned in descending order; otherwise, in ascending order.
    ///
    /// # Returns
    ///
    /// This function returns a `Result` containing either:
    /// - `Ok(Vec<i32>)`: A vector of column indices for the specified row, sorted according to the `descending` flag.
    /// - `Err(String)`: An error message if the sheet cannot be found.
    fn get_columns_for_row(
        &self,
        sheet: u32,
        row: i32,
        descending: bool,
    ) -> Result<Vec<i32>, String> {
        let worksheet = self.workbook.worksheet(sheet)?;
        let mut columns = worksheet.sheet_data.columns_in_row(row);
        if descending {
            columns.reverse();
        }
        Ok(columns)
    }

    /// Moves the contents of cell (source_row, source_column) to (target_row, target_column).
    ///
    /// It assumes that the caller has already checked that the move is valid
    /// (e.g. it does not split an array formula). And that dynamic array spills have been reset.
    ///
    /// # Arguments
    ///
    /// * `sheet` - The sheet number to retrieve columns from.
    /// * `source_row` - The row index of the cell's current location.
    /// * `source_column` - The column index of the cell's current location.
    /// * `target_row` - The row index of the cell's new location.
    /// * `target_column` - The column index of the cell's new location.
    fn move_cell(
        &mut self,
        sheet: u32,
        source_row: i32,
        source_column: i32,
        target_row: i32,
        target_column: i32,
    ) -> Result<(), String> {
        let source_cell = match self
            .workbook
            .worksheet(sheet)?
            .cell(source_row, source_column)
        {
            Some(c) => c.clone(),
            None => return Ok(()),
        };
        let style = source_cell.get_style();

        let mut array = None;

        match &source_cell {
            Cell::EmptyCell { .. }
            | Cell::BooleanCell { .. }
            | Cell::NumberCell { .. }
            | Cell::ErrorCell { .. }
            | Cell::SharedString { .. }
            | Cell::CellFormula { .. } => {
                // This is a regular cell, we can just move it.
            }
            Cell::SpillCell { a, .. } => {
                // A cell of a CSE array is moved together with its anchor, whether
                // the anchor has already been relocated (this is then a cell of the
                // array at its new place) or is still to come: leave it alone.
                // Anything else is the stale spill of a dynamic array (those have
                // been reset by the caller): drop it.
                let worksheet = self.workbook.worksheet_mut(sheet)?;
                let live_cse = matches!(
                    worksheet.cell(a.0, a.1),
                    Some(Cell::ArrayFormula { r: (width, height), kind: ArrayKind::Cse, .. })
                        if source_row >= a.0
                            && source_row < a.0 + height
                            && source_column >= a.1
                            && source_column < a.1 + width
                );
                if !live_cse {
                    worksheet.remove_cell(source_row, source_column)?;
                }
                return Ok(());
            }
            Cell::ArrayFormula {
                r,
                kind: ArrayKind::Dynamic,
                ..
            } => {
                // We are moving the anchor of a dynamic formula.
                // We assume the spill has been taken care of by the caller
                debug_assert_eq!(*r, (1, 1));
            }
            Cell::ArrayFormula {
                r,
                kind: ArrayKind::Cse,
                ..
            } => {
                // This is an array formula, we need to move the whole range
                // We rely on the calling function to check that the move is valid and does not split the array formula
                array = Some(*r);
            }
        }
        let formula_or_value = self
            .get_cell_formula(sheet, source_row, source_column)?
            .unwrap_or_else(|| {
                source_cell.get_localized_text(
                    &self.workbook.shared_strings,
                    self.locale,
                    self.language,
                )
            });

        if let Some((width, height)) = array {
            // We are moving an array formula, we need to move the whole range.
            // Its cells are removed first: the new area may overlap the old one,
            // and `set_user_array_formula` refuses to cover an array formula.
            let worksheet = self.workbook.worksheet_mut(sheet)?;
            for r in source_row..source_row + height {
                for c in source_column..source_column + width {
                    if worksheet.cell(r, c).is_some() {
                        worksheet.remove_cell(r, c)?;
                    }
                }
            }
            self.set_user_array_formula(
                sheet,
                target_row,
                target_column,
                width,
                height,
                &formula_or_value,
            )?;
        } else {
            self.set_user_input(sheet, target_row, target_column, formula_or_value)?;
        }

        let worksheet = self.workbook.worksheet_mut(sheet)?;
        // copy style
        worksheet.set_cell_style(target_row, target_column, style)?;

        // delete source cell content and style (an array's cells are gone
        // already, and the source position may now hold a cell of the array
        // at its new place)
        if array.is_none() {
            worksheet.remove_cell(source_row, source_column)?;
        }
        Ok(())
    }

    /// Inserts one or more new columns into the model at the specified index.
    ///
    /// This method shifts existing columns to the right to make space for the new columns.
    ///
    /// # Arguments
    ///
    /// * `sheet` - The sheet number to retrieve columns from.
    /// * `column` - The index at which the new columns should be inserted.
    /// * `column_count` - The number of columns to insert.
    pub fn insert_columns(
        &mut self,
        sheet: u32,
        column: i32,
        column_count: i32,
    ) -> Result<(), String> {
        if column_count <= 0 {
            return Err("Cannot add a negative number of cells :)".to_string());
        }
        if !self.can_insert_columns(sheet, column, column_count)? {
            return Err(
                "Cannot insert columns because that would break an array formula".to_string(),
            );
        }
        // check if it is possible:
        let dimensions = self.workbook.worksheet(sheet)?.dimension();
        let last_column = dimensions.max_column + column_count;
        if last_column > LAST_COLUMN {
            return Err(
                "Cannot shift cells because that would delete cells at the end of a row"
                    .to_string(),
            );
        }
        self.reset_dynamic_array_spills(sheet)?;
        // Merged ranges are remapped at the end; take them out so the cell moves
        // (which go through `set_user_input`) do not trip the covered-cell guard.
        let merged_cells = std::mem::take(&mut self.workbook.worksheet_mut(sheet)?.merged_cells);
        let worksheet = self.workbook.worksheet(sheet)?;
        let all_rows = worksheet.sheet_data.rows();
        for row in all_rows {
            let sorted_columns = self.get_columns_for_row(sheet, row, true)?;
            for col in sorted_columns {
                if col >= column {
                    self.move_cell(sheet, row, col, row, col + column_count)?;
                } else {
                    // Break because columns are in descending order.
                    break;
                }
            }
        }

        // Links move with their cells
        displace_links(self.workbook.worksheet_mut(sheet)?, |r, c| {
            if c >= column {
                Some((r, c + column_count))
            } else {
                Some((r, c))
            }
        });

        // Merged ranges shift right or grow when columns are inserted inside them
        self.workbook.worksheet_mut(sheet)?.merged_cells = merged_cells;
        displace_merged_cells(
            self.workbook.worksheet_mut(sheet)?,
            |first_row, first_column, last_row, last_column| {
                let first = if first_column >= column {
                    first_column + column_count
                } else {
                    first_column
                };
                let last = if last_column >= column {
                    last_column + column_count
                } else {
                    last_column
                };
                if first > LAST_COLUMN {
                    return None;
                }
                Some((first_row, first, last_row, last.min(LAST_COLUMN)))
            },
        );

        // Update all formulas in the workbook
        let disp = DisplaceData::Column {
            sheet,
            column,
            delta: column_count,
        };
        self.displace_cells(&disp)?;
        self.displace_cf_ranges(sheet, &disp);

        // In the list of columns:
        // * Keep all the columns to the left
        // * Displace all the columns to the right

        let worksheet = &mut self.workbook.worksheet_mut(sheet)?;

        let mut new_columns = Vec::new();
        for col in worksheet.cols.iter_mut() {
            // range under study
            let min = col.min;
            let max = col.max;
            if column > max {
                // If the range under study is to our left, this is a noop
            } else if column <= min {
                // If the range under study is to our right, we displace it
                col.min = min + column_count;
                col.max = max + column_count;
            } else {
                // If the range under study is in the middle we augment it
                col.max = max + column_count;
            }
            new_columns.push(col.clone());
        }
        // TODO: If in a row the cell to the right and left have the same style we should copy it

        worksheet.cols = new_columns;

        Ok(())
    }

    /// Deletes one or more columns from the model starting at the specified index.
    ///
    /// # Arguments
    ///
    /// * `sheet` - The sheet number to retrieve columns from.
    /// * `column` - The index of the first column to delete.
    /// * `count` - The number of columns to delete.
    pub fn delete_columns(
        &mut self,
        sheet: u32,
        column: i32,
        column_count: i32,
    ) -> Result<(), String> {
        if column_count <= 0 {
            return Err("Please use insert columns instead".to_string());
        }
        if !(1..=LAST_COLUMN).contains(&column) {
            return Err(format!("Column number '{column}' is not valid."));
        }
        if column + column_count - 1 > LAST_COLUMN {
            return Err("Cannot delete columns beyond the last column of the sheet".to_string());
        }
        if !self.can_delete_columns(sheet, column, column_count)? {
            return Err(
                "Cannot delete columns because that would break an array formula".to_string(),
            );
        }

        self.reset_dynamic_array_spills(sheet)?;
        // Merged ranges are remapped at the end; take them out so the cell moves
        // (which go through `set_user_input`) do not trip the covered-cell guard.
        let merged_cells = std::mem::take(&mut self.workbook.worksheet_mut(sheet)?.merged_cells);
        // first column being deleted
        let column_start = column;
        // last column being deleted
        let column_end = column + column_count - 1;

        // Move cells
        let worksheet = &self.workbook.worksheet(sheet)?;
        let all_rows = worksheet.sheet_data.rows();

        for r in all_rows {
            let columns: Vec<i32> = self.get_columns_for_row(sheet, r, false)?;
            for col in columns {
                if col >= column_start {
                    if col > column_end {
                        self.move_cell(sheet, r, col, r, col - column_count)?;
                    } else {
                        self.workbook.worksheet_mut(sheet)?.remove_cell(r, col)?;
                    }
                }
            }
        }
        // Links move with their cells; the links of the deleted columns are removed
        displace_links(self.workbook.worksheet_mut(sheet)?, |r, c| {
            if c < column_start {
                Some((r, c))
            } else if c <= column_end {
                None
            } else {
                Some((r, c - column_count))
            }
        });

        // Merged ranges shrink or shift left; fully deleted ones are removed
        self.workbook.worksheet_mut(sheet)?.merged_cells = merged_cells;
        displace_merged_cells(
            self.workbook.worksheet_mut(sheet)?,
            |first_row, first_column, last_row, last_column| {
                let first = if first_column < column_start {
                    first_column
                } else if first_column <= column_end {
                    column_start
                } else {
                    first_column - column_count
                };
                let last = if last_column < column_start {
                    last_column
                } else if last_column <= column_end {
                    column_start - 1
                } else {
                    last_column - column_count
                };
                if last < first {
                    return None;
                }
                Some((first_row, first, last_row, last))
            },
        );

        // Update all formulas in the workbook
        let disp = DisplaceData::Column {
            sheet,
            column,
            delta: -column_count,
        };
        self.displace_cells(&disp)?;
        self.displace_cf_ranges(sheet, &disp);
        let worksheet = &mut self.workbook.worksheet_mut(sheet)?;

        // deletes all the column styles
        let mut new_columns = Vec::new();
        for col in worksheet.cols.iter_mut() {
            // range under study
            let min = col.min;
            let max = col.max;
            // In the diagram:
            // |xxxxx| range we are studying [min, max]
            // |*****| range we are deleting [column_start, column_end]
            // we are going to split it in three big cases:
            // ----------------|xxxxxxxx|-----------------
            // -----|*****|------------------------------- Case A
            // -------|**********|------------------------ Case B
            // -------------|**************|-------------- Case C
            // ------------------|****|------------------- Case D
            // ---------------------|**********|---------- Case E
            // -----------------------------|*****|------- Case F
            if column_start < min {
                if column_end < min {
                    // Case A
                    // We displace all columns
                    let mut new_column = col.clone();
                    new_column.min = min - column_count;
                    new_column.max = max - column_count;
                    new_columns.push(new_column);
                } else if column_end < max {
                    // Case B
                    // We displace the end
                    let mut new_column = col.clone();
                    new_column.min = column_start;
                    new_column.max = max - column_count;
                    new_columns.push(new_column);
                } else {
                    // Case C
                    // skip this, we are deleting the whole range
                }
            } else if column_start <= max {
                if column_end <= max {
                    // Case D
                    // We displace the end
                    let mut new_column = col.clone();
                    new_column.max = max - column_count;
                    new_columns.push(new_column);
                } else {
                    // Case E
                    let mut new_column = col.clone();
                    new_column.max = column_start - 1;
                    new_columns.push(new_column);
                }
            } else {
                // Case F
                // No action required
                new_columns.push(col.clone());
            }
        }
        worksheet.cols = new_columns;

        Ok(())
    }

    // Returns true if inserting rows at `row` would not split any array formula.
    // Inserting at `row` shifts every row >= `row` down. A formula whose anchor
    // row is strictly above `row` but whose spill extends to `row` or below would
    // be split, so we must reject that.
    fn can_insert_rows(&self, sheet: u32, row: i32, _row_count: i32) -> Result<bool, String> {
        let cell_coords: Vec<(i32, i32)> = {
            let worksheet = self.workbook.worksheet(sheet)?;
            worksheet
                .sheet_data
                .cells()
                .map(|(r, c, _)| (r, c))
                .collect()
        };
        for (r, c) in cell_coords {
            if let CellStructure::ArrayFormula { range: (_, height) } =
                self.get_cell_structure(sheet, r, c)?
            {
                // The formula spans rows [r, r + height - 1].
                // Inserting at `row` splits it when the anchor is above `row`
                // but the spill reaches `row` or beyond.
                if r < row && row < r + height {
                    return Ok(false);
                }
            }
        }
        Ok(true)
    }

    // Returns true if inserting columns at `column` would not split any array formula.
    fn can_insert_columns(
        &self,
        sheet: u32,
        column: i32,
        _column_count: i32,
    ) -> Result<bool, String> {
        let cell_coords: Vec<(i32, i32)> = {
            let worksheet = self.workbook.worksheet(sheet)?;
            worksheet
                .sheet_data
                .cells()
                .map(|(r, c, _)| (r, c))
                .collect()
        };
        for (r, c) in cell_coords {
            if let CellStructure::ArrayFormula { range: (width, _) } =
                self.get_cell_structure(sheet, r, c)?
            {
                if c < column && column < c + width {
                    return Ok(false);
                }
            }
        }
        Ok(true)
    }

    // Returns true if deleting rows [row, row + row_count - 1] would not break any
    // array formula. An array formula must be either fully inside the deleted range
    // or fully outside it; any partial overlap is rejected.
    fn can_delete_rows(&self, sheet: u32, row: i32, row_count: i32) -> Result<bool, String> {
        let row_end = row + row_count; // exclusive upper bound
        let cell_coords: Vec<(i32, i32)> = {
            let worksheet = self.workbook.worksheet(sheet)?;
            worksheet
                .sheet_data
                .cells()
                .map(|(r, c, _)| (r, c))
                .collect()
        };
        for (r, c) in cell_coords {
            if let CellStructure::ArrayFormula { range: (_, height) } =
                self.get_cell_structure(sheet, r, c)?
            {
                // Formula row span: [r, r + height - 1]
                let overlaps = r < row_end && r + height > row;
                let contained = r >= row && r + height <= row_end;
                if overlaps && !contained {
                    return Ok(false);
                }
            }
        }
        Ok(true)
    }

    // Returns true if deleting columns [column, column + column_count - 1] would not
    // break any array formula.
    fn can_delete_columns(
        &self,
        sheet: u32,
        column: i32,
        column_count: i32,
    ) -> Result<bool, String> {
        let col_end = column + column_count; // exclusive upper bound
        let cell_coords: Vec<(i32, i32)> = {
            let worksheet = self.workbook.worksheet(sheet)?;
            worksheet
                .sheet_data
                .cells()
                .map(|(r, c, _)| (r, c))
                .collect()
        };
        for (r, c) in cell_coords {
            if let CellStructure::ArrayFormula { range: (width, _) } =
                self.get_cell_structure(sheet, r, c)?
            {
                // Formula column span: [c, c + width - 1]
                let overlaps = c < col_end && c + width > column;
                let contained = c >= column && c + width <= col_end;
                if overlaps && !contained {
                    return Ok(false);
                }
            }
        }
        Ok(true)
    }

    /// Inserts one or more new rows into the model at the specified index.
    ///
    /// # Arguments
    ///
    /// * `sheet` - The sheet number to retrieve columns from.
    /// * `row` - The index at which the new rows should be inserted.
    /// * `row_count` - The number of rows to insert.
    pub fn insert_rows(&mut self, sheet: u32, row: i32, row_count: i32) -> Result<(), String> {
        if row_count <= 0 {
            return Err("Cannot add a negative number of cells :)".to_string());
        }
        if !self.can_insert_rows(sheet, row, row_count)? {
            return Err("Cannot insert rows because that would break an array formula".to_string());
        }
        // Check if it is possible:
        let dimensions = self.workbook.worksheet(sheet)?.dimension();
        let last_row = dimensions.max_row + row_count;
        if last_row > LAST_ROW {
            return Err(
                "Cannot shift cells because that would delete cells at the end of a column"
                    .to_string(),
            );
        }

        self.reset_dynamic_array_spills(sheet)?;
        // Merged ranges are remapped at the end; take them out so the cell moves
        // (which go through `set_user_input`) do not trip the covered-cell guard.
        let merged_cells = std::mem::take(&mut self.workbook.worksheet_mut(sheet)?.merged_cells);
        // Move cells
        let worksheet = &self.workbook.worksheet(sheet)?;
        let mut all_rows = worksheet.sheet_data.rows();
        all_rows.reverse();
        for r in all_rows {
            if r >= row {
                // We do not really need the columns in any order
                let columns: Vec<i32> = self.get_columns_for_row(sheet, r, false)?;
                for column in columns {
                    self.move_cell(sheet, r, column, r + row_count, column)?;
                }
            } else {
                // Rows are in descending order
                break;
            }
        }
        // In the list of rows styles:
        // * Add all rows above the rows we are inserting unchanged
        // * Shift the ones below
        let rows = &self.workbook.worksheets[sheet as usize].rows;
        let mut new_rows = vec![];
        for r in rows {
            if r.r < row {
                new_rows.push(r.clone());
            } else if r.r >= row {
                let mut new_row = r.clone();
                new_row.r = r.r + row_count;
                new_rows.push(new_row);
            }
        }
        self.workbook.worksheets[sheet as usize].rows = new_rows;

        // Links move with their cells
        displace_links(self.workbook.worksheet_mut(sheet)?, |r, c| {
            if r >= row {
                Some((r + row_count, c))
            } else {
                Some((r, c))
            }
        });

        // Merged ranges shift down or grow when rows are inserted inside them
        self.workbook.worksheet_mut(sheet)?.merged_cells = merged_cells;
        displace_merged_cells(
            self.workbook.worksheet_mut(sheet)?,
            |first_row, first_column, last_row, last_column| {
                let first = if first_row >= row {
                    first_row + row_count
                } else {
                    first_row
                };
                let last = if last_row >= row {
                    last_row + row_count
                } else {
                    last_row
                };
                if first > LAST_ROW {
                    return None;
                }
                Some((first, first_column, last.min(LAST_ROW), last_column))
            },
        );

        // Update all formulas in the workbook
        let disp = DisplaceData::Row {
            sheet,
            row,
            delta: row_count,
        };
        self.displace_cells(&disp)?;
        self.displace_cf_ranges(sheet, &disp);

        Ok(())
    }

    /// Deletes one or more rows from the model starting at the specified index.
    ///
    /// # Arguments
    ///
    /// * `sheet` - The sheet number to retrieve columns from.
    /// * `row` - The index of the first row to delete.
    /// * `row_count` - The number of rows to delete.
    pub fn delete_rows(&mut self, sheet: u32, row: i32, row_count: i32) -> Result<(), String> {
        if row_count <= 0 {
            return Err("Please use insert rows instead".to_string());
        }
        if !(1..=LAST_ROW).contains(&row) {
            return Err(format!("Row number '{row}' is not valid."));
        }
        if row + row_count - 1 > LAST_ROW {
            return Err("Cannot delete rows beyond the last row of the sheet".to_string());
        }
        if !self.can_delete_rows(sheet, row, row_count)? {
            return Err("Cannot delete rows because that would break an array formula".to_string());
        }

        self.reset_dynamic_array_spills(sheet)?;
        // Merged ranges are remapped at the end; take them out so the cell moves
        // (which go through `set_user_input`) do not trip the covered-cell guard.
        let merged_cells = std::mem::take(&mut self.workbook.worksheet_mut(sheet)?.merged_cells);
        // Move cells
        let worksheet = &self.workbook.worksheet(sheet)?;
        let all_rows = worksheet.sheet_data.rows();

        for r in all_rows {
            if r >= row {
                // We do not need ordered, but it is safer to eliminate sources of randomness in the algorithm
                let columns: Vec<i32> = self.get_columns_for_row(sheet, r, false)?;
                if r >= row + row_count {
                    // displace all cells in column
                    for column in columns {
                        self.move_cell(sheet, r, column, r - row_count, column)?;
                    }
                } else {
                    // remove all cells in row
                    self.workbook.worksheet_mut(sheet)?.sheet_data.remove_row(r);
                }
            }
        }
        // In the list of rows styles:
        // * Add all rows above the rows we are deleting unchanged
        // * Skip all those we are deleting
        // * Shift the ones below
        let rows = &self.workbook.worksheets[sheet as usize].rows;
        let mut new_rows = vec![];
        for r in rows {
            if r.r < row {
                new_rows.push(r.clone());
            } else if r.r >= row + row_count {
                let mut new_row = r.clone();
                new_row.r = r.r - row_count;
                new_rows.push(new_row);
            }
        }
        self.workbook.worksheets[sheet as usize].rows = new_rows;

        // Links move with their cells; the links of the deleted rows are removed
        displace_links(self.workbook.worksheet_mut(sheet)?, |r, c| {
            if r < row {
                Some((r, c))
            } else if r < row + row_count {
                None
            } else {
                Some((r - row_count, c))
            }
        });

        // Merged ranges shrink or shift up; fully deleted ones are removed
        self.workbook.worksheet_mut(sheet)?.merged_cells = merged_cells;
        displace_merged_cells(
            self.workbook.worksheet_mut(sheet)?,
            |first_row, first_column, last_row, last_column| {
                let first = if first_row < row {
                    first_row
                } else if first_row < row + row_count {
                    row
                } else {
                    first_row - row_count
                };
                let last = if last_row < row {
                    last_row
                } else if last_row < row + row_count {
                    row - 1
                } else {
                    last_row - row_count
                };
                if last < first {
                    return None;
                }
                Some((first, first_column, last, last_column))
            },
        );

        let disp = DisplaceData::Row {
            sheet,
            row,
            delta: -row_count,
        };
        self.displace_cells(&disp)?;
        self.displace_cf_ranges(sheet, &disp);
        Ok(())
    }

    // Inner column move: no boundary/can check, no spill reset.
    // Caller must have validated and reset spills before calling this.
    fn move_column_unchecked(&mut self, sheet: u32, column: i32, delta: i32) -> Result<(), String> {
        let target_column = column + delta;

        // Links move with their cells: take the moved column's links out and
        // shift the links of the columns in between. The moved links are
        // re-attached at the end, after the cells have been rebuilt (rebuilding
        // goes through `set_user_input`, which could auto-link URL-like values).
        let worksheet = self.workbook.worksheet_mut(sheet)?;
        let moved_links: Vec<(i32, Link)> = worksheet
            .links
            .iter()
            .filter(|(&(_, c), _)| c == column)
            .map(|(&(r, _), link)| (r, link.clone()))
            .collect();
        displace_links(worksheet, |r, c| {
            if c == column {
                None
            } else if delta > 0 && c > column && c <= target_column {
                Some((r, c - 1))
            } else if delta < 0 && c >= target_column && c < column {
                Some((r, c + 1))
            } else {
                Some((r, c))
            }
        });

        let original_refs = self
            .workbook
            .worksheet(sheet)?
            .column_cell_references(column)?;
        let mut original_cells = Vec::new();
        for r in &original_refs {
            let cell = self
                .workbook
                .worksheet(sheet)?
                .cell(r.row, column)
                .ok_or("Expected Cell to exist")?;
            let style_idx = cell.get_style();
            let formula_or_value =
                self.get_cell_formula(sheet, r.row, column)?
                    .unwrap_or_else(|| {
                        cell.get_localized_text(
                            &self.workbook.shared_strings,
                            self.locale,
                            self.language,
                        )
                    });

            let mut array = None;

            match cell {
                Cell::EmptyCell { .. }
                | Cell::BooleanCell { .. }
                | Cell::NumberCell { .. }
                | Cell::ErrorCell { .. }
                | Cell::SharedString { .. }
                | Cell::CellFormula { .. } => {
                    // This is a regular cell, we can just move it.
                }
                Cell::SpillCell { .. } => {
                    // This the spill of an array formula. Because dynamic arrays spills have been deleted
                    // We delete the spill
                    let worksheet = self.workbook.worksheet_mut(sheet)?;
                    worksheet.remove_cell(r.row, column)?;
                    continue;
                }
                Cell::ArrayFormula {
                    r,
                    kind: ArrayKind::Dynamic,
                    ..
                } => {
                    // We are moving the anchor of a dynamic formula.
                    // We assume the spill has been taken care of by the caller
                    debug_assert_eq!(*r, (1, 1));
                }
                Cell::ArrayFormula {
                    r,
                    kind: ArrayKind::Cse,
                    ..
                } => {
                    // This is an array formula, we need to move the whole range
                    // We rely on the calling function to check that the move is valid and does not split the array formula
                    array = Some(*r);
                }
            }

            original_cells.push((r.row, formula_or_value, style_idx, array));
            let ws = self.workbook.worksheet_mut(sheet)?;
            ws.remove_cell(r.row, column)?;
        }
        let width = self
            .workbook
            .worksheet(sheet)?
            .get_actual_column_width(column)?;
        let style = self.workbook.worksheet(sheet)?.get_column_style(column)?;
        let hidden = self.workbook.worksheet(sheet)?.is_column_hidden(column)?;
        if delta > 0 {
            for c in column + 1..=target_column {
                let refs = self.workbook.worksheet(sheet)?.column_cell_references(c)?;
                for r in refs {
                    self.move_cell(sheet, r.row, c, r.row, c - 1)?;
                }
                let w = self.workbook.worksheet(sheet)?.get_actual_column_width(c)?;
                let s = self.workbook.worksheet(sheet)?.get_column_style(c)?;
                let h = self.workbook.worksheet(sheet)?.is_column_hidden(c)?;
                self.workbook
                    .worksheet_mut(sheet)?
                    .set_column_width_and_style(c - 1, w, h, s)?;
            }
        } else {
            for c in (target_column..=column - 1).rev() {
                let refs = self.workbook.worksheet(sheet)?.column_cell_references(c)?;
                for r in refs {
                    self.move_cell(sheet, r.row, c, r.row, c + 1)?;
                }
                let w = self.workbook.worksheet(sheet)?.get_actual_column_width(c)?;
                let s = self.workbook.worksheet(sheet)?.get_column_style(c)?;
                let h = self.workbook.worksheet(sheet)?.is_column_hidden(c)?;
                self.workbook
                    .worksheet_mut(sheet)?
                    .set_column_width_and_style(c + 1, w, h, s)?;
            }
        }
        for (r, value, style_idx, array) in original_cells {
            if let Some(a) = array {
                self.set_user_array_formula(sheet, r, target_column, a.0, a.1, &value)?;
            } else {
                self.set_user_input(sheet, r, target_column, value)?;
            }
            self.workbook
                .worksheet_mut(sheet)?
                .set_cell_style(r, target_column, style_idx)?;
        }
        self.workbook
            .worksheet_mut(sheet)?
            .set_column_width_and_style(target_column, width, hidden, style)?;

        // Re-attach the moved links, discarding any link the rebuild auto-created
        let worksheet = self.workbook.worksheet_mut(sheet)?;
        worksheet.links.retain(|&(_, c), _| c != target_column);
        for (r, link) in moved_links {
            worksheet.links.insert((r, target_column), link);
        }

        let disp = DisplaceData::ColumnMove {
            sheet,
            column,
            delta,
        };
        self.displace_cells(&disp)?;
        self.displace_cf_ranges(sheet, &disp);
        Ok(())
    }

    // Inner row move: no boundary/can check, no spill reset.
    fn move_row_unchecked(&mut self, sheet: u32, row: i32, delta: i32) -> Result<(), String> {
        let target_row = row + delta;

        // Links move with their cells: take the moved row's links out and shift
        // the links of the rows in between. The moved links are re-attached at
        // the end, after the cells have been rebuilt (rebuilding goes through
        // `set_user_input`, which could auto-link URL-like values).
        let worksheet = self.workbook.worksheet_mut(sheet)?;
        let moved_links: Vec<(i32, Link)> = worksheet
            .links
            .iter()
            .filter(|(&(r, _), _)| r == row)
            .map(|(&(_, c), link)| (c, link.clone()))
            .collect();
        displace_links(worksheet, |r, c| {
            if r == row {
                None
            } else if delta > 0 && r > row && r <= target_row {
                Some((r - 1, c))
            } else if delta < 0 && r >= target_row && r < row {
                Some((r + 1, c))
            } else {
                Some((r, c))
            }
        });

        let original_cols = self.get_columns_for_row(sheet, row, false)?;
        let mut original_cells = Vec::new();
        for c in &original_cols {
            let cell = self
                .workbook
                .worksheet(sheet)?
                .cell(row, *c)
                .ok_or("Expected Cell to exist")?;
            let style_idx = cell.get_style();
            let formula_or_value = self.get_cell_formula(sheet, row, *c)?.unwrap_or_else(|| {
                cell.get_localized_text(&self.workbook.shared_strings, self.locale, self.language)
            });
            let mut array = None;

            match cell {
                Cell::EmptyCell { .. }
                | Cell::BooleanCell { .. }
                | Cell::NumberCell { .. }
                | Cell::ErrorCell { .. }
                | Cell::SharedString { .. }
                | Cell::CellFormula { .. } => {
                    // This is a regular cell, we can just move it.
                }
                Cell::SpillCell { .. } => {
                    // This the spill of an array formula. Because dynamic arrays spills have been deleted
                    // We delete the spill
                    let worksheet = self.workbook.worksheet_mut(sheet)?;
                    worksheet.remove_cell(row, *c)?;
                    continue;
                }
                Cell::ArrayFormula {
                    r,
                    kind: ArrayKind::Dynamic,
                    ..
                } => {
                    // We are moving the anchor of a dynamic formula.
                    // We assume the spill has been taken care of by the caller
                    debug_assert_eq!(*r, (1, 1));
                }
                Cell::ArrayFormula {
                    r,
                    kind: ArrayKind::Cse,
                    ..
                } => {
                    // This is an array formula, we need to move the whole range
                    // We rely on the calling function to check that the move is valid and does not split the array formula
                    array = Some(*r);
                }
            }
            original_cells.push((*c, formula_or_value, style_idx, array));
            let ws = self.workbook.worksheet_mut(sheet)?;
            ws.remove_cell(row, *c)?;
        }
        if delta > 0 {
            for r in row + 1..=target_row {
                let cols = self.get_columns_for_row(sheet, r, false)?;
                for c in cols {
                    self.move_cell(sheet, r, c, r - 1, c)?;
                }
            }
        } else {
            for r in (target_row..=row - 1).rev() {
                let cols = self.get_columns_for_row(sheet, r, false)?;
                for c in cols {
                    self.move_cell(sheet, r, c, r + 1, c)?;
                }
            }
        }
        for (c, value, style_idx, array) in original_cells {
            if let Some(array_range) = array {
                self.set_user_array_formula(
                    sheet,
                    target_row,
                    c,
                    array_range.0,
                    array_range.1,
                    &value,
                )?;
            } else {
                self.set_user_input(sheet, target_row, c, value)?;
            }
            self.workbook
                .worksheet_mut(sheet)?
                .set_cell_style(target_row, c, style_idx)?;
        }
        let worksheet = &mut self.workbook.worksheet_mut(sheet)?;
        let mut new_rows = Vec::new();
        for r in worksheet.rows.iter() {
            if r.r == row {
                let mut nr = r.clone();
                nr.r = target_row;
                new_rows.push(nr);
            } else if delta > 0 && r.r > row && r.r <= target_row {
                let mut nr = r.clone();
                nr.r -= 1;
                new_rows.push(nr);
            } else if delta < 0 && r.r < row && r.r >= target_row {
                let mut nr = r.clone();
                nr.r += 1;
                new_rows.push(nr);
            } else {
                new_rows.push(r.clone());
            }
        }
        worksheet.rows = new_rows;

        // Re-attach the moved links, discarding any link the rebuild auto-created
        let worksheet = self.workbook.worksheet_mut(sheet)?;
        worksheet.links.retain(|&(r, _), _| r != target_row);
        for (c, link) in moved_links {
            worksheet.links.insert((target_row, c), link);
        }

        let disp = DisplaceData::RowMove { sheet, row, delta };
        self.displace_cells(&disp)?;
        self.displace_cf_ranges(sheet, &disp);
        Ok(())
    }

    // Returns true if moving columns [column, column+column_count-1] by delta would not
    // split any CSE array formula. A formula is OK if its column span is fully within
    // the moved group, fully within the displaced zone, or fully outside both.
    fn can_move_columns_action(
        &self,
        sheet: u32,
        column: i32,
        column_count: i32,
        delta: i32,
    ) -> Result<bool, String> {
        if delta == 0 {
            return Ok(true);
        }

        let group_start = column;
        let group_end = column + column_count - 1;

        let (displace_start, displace_end) = if delta > 0 {
            (group_end + 1, group_end + delta)
        } else {
            (group_start + delta, group_start - 1)
        };

        let overlaps = |a_start: i32, a_end: i32, b_start: i32, b_end: i32| {
            a_start <= b_end && b_start <= a_end
        };

        let contains = |a_start: i32, a_end: i32, b_start: i32, b_end: i32| {
            a_start <= b_start && b_end <= a_end
        };

        let interval_is_safe = |array_start: i32, array_end: i32| {
            let safe_for = |start: i32, end: i32| {
                !overlaps(start, end, array_start, array_end)
                    || contains(start, end, array_start, array_end)
            };
            safe_for(group_start, group_end) && safe_for(displace_start, displace_end)
        };

        let cell_coords: Vec<(i32, i32)> = {
            let worksheet = self.workbook.worksheet(sheet)?;
            worksheet
                .sheet_data
                .cells()
                .map(|(r, c, _)| (r, c))
                .collect()
        };

        for (r, c) in cell_coords {
            match self.get_cell_structure(sheet, r, c)? {
                CellStructure::ArrayFormula { range } => {
                    let (width, _) = range;
                    let array_start_col = c;
                    let array_end_col = c + width - 1;

                    if !interval_is_safe(array_start_col, array_end_col) {
                        return Ok(false);
                    }
                }
                CellStructure::SpillArray { anchor, range } => {
                    let (width, _) = range;
                    let (_, array_start_col) = anchor;
                    let array_end_col = array_start_col + width - 1;

                    if !interval_is_safe(array_start_col, array_end_col) {
                        return Ok(false);
                    }
                }
                _ => {}
            }
        }

        Ok(true)
    }

    // Returns true if moving rows [row, row+row_count-1] by delta would not
    // split any CSE array formula.
    // That could happen because:
    // * rows are moved in the middle of an array formula
    // * we move part of an array
    fn can_move_rows_action(
        &self,
        sheet: u32,
        row: i32,
        row_count: i32,
        delta: i32,
    ) -> Result<bool, String> {
        if delta == 0 {
            return Ok(true);
        }

        let group_start = row;
        let group_end = row + row_count - 1;

        let (displace_start, displace_end) = if delta > 0 {
            (group_end + 1, group_end + delta)
        } else {
            (group_start + delta, group_start - 1)
        };

        let overlaps = |a_start: i32, a_end: i32, b_start: i32, b_end: i32| {
            a_start <= b_end && b_start <= a_end
        };

        let contains = |a_start: i32, a_end: i32, b_start: i32, b_end: i32| {
            a_start <= b_start && b_end <= a_end
        };

        let interval_is_safe = |array_start: i32, array_end: i32| {
            let safe_for = |start: i32, end: i32| {
                !overlaps(start, end, array_start, array_end)
                    || contains(start, end, array_start, array_end)
            };

            safe_for(group_start, group_end) && safe_for(displace_start, displace_end)
        };

        // list of all the cells in the sheet
        let cell_coords: Vec<(i32, i32)> = {
            let worksheet = self.workbook.worksheet(sheet)?;
            worksheet
                .sheet_data
                .cells()
                .map(|(r, c, _)| (r, c))
                .collect()
        };

        for (r, c) in cell_coords {
            match self.get_cell_structure(sheet, r, c)? {
                CellStructure::ArrayFormula { range } => {
                    let (_, height) = range;
                    let array_start_row = r;
                    let array_end_row = r + height - 1;

                    if !interval_is_safe(array_start_row, array_end_row) {
                        return Ok(false);
                    }
                }
                CellStructure::SpillArray { anchor, range } => {
                    let (_, height) = range;
                    let (array_start_row, _) = anchor;
                    let array_end_row = array_start_row + height - 1;

                    if !interval_is_safe(array_start_row, array_end_row) {
                        return Ok(false);
                    }
                }
                _ => {}
            }
        }

        Ok(true)
    }

    /// Moves a group of columns [column, column+column_count-1] by delta positions.
    /// CSE array formulas fully within the moved group are preserved as arrays.
    /// Displaces cells due to a move column action
    /// from initial_column to target_column = initial_column + column_delta
    /// References will be updated following:
    /// Cell references:
    ///    * All cell references to initial_column will go to target_column
    ///    * All cell references to columns in between (initial_column, target_column] will be displaced one to the left
    ///    * All other cell references are left unchanged
    ///      Ranges. This is the tricky bit:
    ///    * Column is one of the extremes of the range. The new extreme would be target_column.
    ///      Range is then normalized
    ///    * Any other case, range is left unchanged.
    ///      NOTE: This moves the data and column styles along with the formulas
    pub fn move_columns_action(
        &mut self,
        sheet: u32,
        column: i32,
        column_count: i32,
        delta: i32,
    ) -> Result<(), String> {
        if column_count <= 0 || delta == 0 {
            return Ok(());
        }
        let target_first = column + delta;
        let target_last = column + column_count - 1 + delta;
        if !(1..=LAST_COLUMN).contains(&target_first) || !(1..=LAST_COLUMN).contains(&target_last) {
            return Err("Target column out of boundaries".to_string());
        }
        if !(1..=LAST_COLUMN).contains(&column)
            || !(1..=LAST_COLUMN).contains(&(column + column_count - 1))
        {
            return Err("Initial column out of boundaries".to_string());
        }
        if !self.can_move_columns_action(sheet, column, column_count, delta)? {
            return Err(
                "Cannot move columns because that would split an array formula".to_string(),
            );
        }
        let group_end = column + column_count - 1;
        if self
            .workbook
            .worksheet(sheet)?
            .merged_cells
            .iter()
            .any(|m| !interval_survives_move(m.column, m.last_column(), column, group_end, delta))
        {
            return Err("Cannot move columns because that would split a merged cell".to_string());
        }
        self.reset_dynamic_array_spills(sheet)?;

        // Merged ranges are remapped wholesale at the end; take them out so the
        // per-column rebuild (which goes through `set_user_input`) does not trip
        // over the covered-cell guard.
        let merged_cells = std::mem::take(&mut self.workbook.worksheet_mut(sheet)?.merged_cells);

        // Move columns in the correct order
        if delta > 0 {
            for col in (column..column + column_count).rev() {
                self.move_column_unchecked(sheet, col, delta)?;
            }
        } else {
            for col in column..column + column_count {
                self.move_column_unchecked(sheet, col, delta)?;
            }
        }

        self.workbook.worksheet_mut(sheet)?.merged_cells = merged_cells
            .into_iter()
            .map(|mut m| {
                let (first, last) = displace_interval_for_move(
                    m.column,
                    m.last_column(),
                    column,
                    group_end,
                    delta,
                    column_count,
                );
                m.column = first;
                m.width = last - first + 1;
                m
            })
            .collect();

        Ok(())
    }

    /// Displaces cells due to a move row action
    /// from initial_row to target_row = initial_row + row_delta
    /// References will be updated following the same rules as move_column_action
    /// NOTE: This moves the data and row styles along with the formulas
    /// Moves a group of rows [row, row+row_count-1] by delta positions.
    /// CSE array formulas fully within the moved group are preserved as arrays.
    pub fn move_rows_action(
        &mut self,
        sheet: u32,
        row: i32,
        row_count: i32,
        delta: i32,
    ) -> Result<(), String> {
        if row_count <= 0 || delta == 0 {
            return Ok(());
        }
        let target_first = row + delta;
        let target_last = row + row_count - 1 + delta;
        if !(1..=LAST_ROW).contains(&target_first) || !(1..=LAST_ROW).contains(&target_last) {
            return Err("Target row out of boundaries".to_string());
        }
        if !(1..=LAST_ROW).contains(&row) || !(1..=LAST_ROW).contains(&(row + row_count - 1)) {
            return Err("Initial row out of boundaries".to_string());
        }
        if !self.can_move_rows_action(sheet, row, row_count, delta)? {
            return Err("Cannot move rows because that would split an array formula".to_string());
        }
        let group_end = row + row_count - 1;
        if self
            .workbook
            .worksheet(sheet)?
            .merged_cells
            .iter()
            .any(|m| !interval_survives_move(m.row, m.last_row(), row, group_end, delta))
        {
            return Err("Cannot move rows because that would split a merged cell".to_string());
        }
        self.reset_dynamic_array_spills(sheet)?;

        // Merged ranges are remapped wholesale at the end; take them out so the
        // per-row rebuild (which goes through `set_user_input`) does not trip
        // over the covered-cell guard.
        let merged_cells = std::mem::take(&mut self.workbook.worksheet_mut(sheet)?.merged_cells);

        // Move rows in the correct order
        if delta > 0 {
            for r in (row..row + row_count).rev() {
                self.move_row_unchecked(sheet, r, delta)?;
            }
        } else {
            for r in row..row + row_count {
                self.move_row_unchecked(sheet, r, delta)?;
            }
        }

        self.workbook.worksheet_mut(sheet)?.merged_cells = merged_cells
            .into_iter()
            .map(|mut m| {
                let (first, last) = displace_interval_for_move(
                    m.row,
                    m.last_row(),
                    row,
                    group_end,
                    delta,
                    row_count,
                );
                m.row = first;
                m.height = last - first + 1;
                m
            })
            .collect();

        Ok(())
    }
}
