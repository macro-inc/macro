#![deny(missing_docs)]

use std::{
    collections::{HashMap, HashSet},
    io::Cursor,
};

use csv::{ReaderBuilder, WriterBuilder};
use serde::{Deserialize, Serialize};

use crate::{
    cf_types::ConditionalFormatting,
    expressions::types::{Area, CellReferenceIndex},
    model::CellStructure,
    types::{ArrayKind, Cell, Link, MergedCell, Style},
    UserModel,
};

use crate::user_model::history::Diff;

const PARTIAL_MERGE_PASTE_ERROR: &str =
    "Cannot paste: a merged cell partially overlaps the paste area";

/// Data for the clipboard
pub type ClipboardData = HashMap<i32, HashMap<i32, ClipboardCell>>;

pub type ClipboardTuple = (i32, i32, i32, i32);

#[derive(Serialize, Deserialize)]
pub struct ClipboardCell {
    text: String,
    is_spill: bool,
    style: Style,
    // the link attached to the cell, if any (`default` keeps older clipboard
    // payloads without the field deserializable)
    #[serde(default)]
    link: Option<Link>,
}

#[derive(Serialize, Deserialize)]
pub struct Clipboard {
    pub(crate) csv: String,
    pub(crate) data: ClipboardData,
    pub(crate) sheet: u32,
    pub(crate) range: (i32, i32, i32, i32),
}

impl<'a> UserModel<'a> {
    // Applies the merge containment rule to a paste into `target_area`
    // (whose top-left cell is the paste anchor). The paste footprint is the
    // target rectangle plus `pasted_merges`, the translated merges of the
    // copied area it will recreate — they can stick out of the target
    // because the copied range is clamped to the sheet dimension while a
    // merge always travels whole.
    //
    // * a merged cell fully contained in the footprint is removed — the
    //   paste replaces it. The removal diff is pushed before the cell diffs
    //   so a forward replay writes on unmerged cells; the merges the paste
    //   creates get their own diff afterwards, so an undo unmerges them
    //   first.
    // * a single-cell paste into the anchor of a merged cell keeps the
    //   merge (only the anchor is written);
    // * any other overlap rejects the paste, before anything changed.
    fn remove_merges_replaced_by_paste(
        &mut self,
        target_area: &Area,
        pasted_merges: &[MergedCell],
        diff_list: &mut Vec<Diff>,
    ) -> Result<(), String> {
        let sheet = target_area.sheet;
        let old_merged_cells = self.model.get_merged_cells(sheet)?.to_vec();
        let single_cell_target = target_area.width == 1 && target_area.height == 1;
        let cell_in_footprint = |row: i32, column: i32| -> bool {
            (row >= target_area.row
                && row < target_area.row + target_area.height
                && column >= target_area.column
                && column < target_area.column + target_area.width)
                || pasted_merges.iter().any(|p| {
                    row >= p.row
                        && row < p.row + p.height
                        && column >= p.column
                        && column < p.column + p.width
                })
        };
        let mut merged_cells_after_removal = Vec::new();
        let mut removed_any = false;
        for m in &old_merged_cells {
            let intersects_footprint = m.intersects(
                target_area.row,
                target_area.column,
                target_area.width,
                target_area.height,
            ) || pasted_merges
                .iter()
                .any(|p| m.intersects(p.row, p.column, p.width, p.height));
            if !intersects_footprint {
                merged_cells_after_removal.push(*m);
                continue;
            }
            let mut contained = true;
            'cells: for row in m.row..m.row + m.height {
                for column in m.column..m.column + m.width {
                    if !cell_in_footprint(row, column) {
                        contained = false;
                        break 'cells;
                    }
                }
            }
            if contained {
                // replaced by the paste
                removed_any = true;
            } else if single_cell_target
                && (m.row, m.column) == (target_area.row, target_area.column)
            {
                // pasting a single cell into a merged cell writes its anchor
                merged_cells_after_removal.push(*m);
            } else {
                return Err(PARTIAL_MERGE_PASTE_ERROR.to_string());
            }
        }
        if removed_any {
            self.model.workbook.worksheet_mut(sheet)?.merged_cells =
                merged_cells_after_removal.clone();
            diff_list.push(Diff::SetMergedCells {
                sheet,
                old_value: old_merged_cells,
                new_value: merged_cells_after_removal,
            });
        }
        Ok(())
    }

    /// Returns a copy of the selected area
    pub fn copy_to_clipboard(&self) -> Result<Clipboard, String> {
        let selected_area = self.get_selected_view();
        let sheet = selected_area.sheet;
        let mut wtr = WriterBuilder::new().delimiter(b'\t').from_writer(vec![]);

        let mut data = HashMap::new();
        let [row_start, column_start, row_end, column_end] = selected_area.range;
        let dimension = self.model.workbook.worksheet(sheet)?.dimension();
        let row_end = row_end.min(dimension.max_row).max(row_start);
        let column_end = column_end.min(dimension.max_column).max(column_start);
        for row in row_start..=row_end {
            let mut data_row = HashMap::new();
            let mut text_row = Vec::new();
            for column in column_start..=column_end {
                let text = self.get_formatted_cell_value(sheet, row, column)?;
                let content = self.get_cell_content(sheet, row, column)?;
                let style = self.model.get_style_for_cell(sheet, row, column)?;
                let is_spill = matches!(
                    self.model.get_cell_structure(sheet, row, column)?,
                    CellStructure::SpillArray { .. } | CellStructure::SpillDynamic { .. }
                );
                let link = self.model.get_cell_link(sheet, row, column)?;
                data_row.insert(
                    column,
                    ClipboardCell {
                        text: content,
                        is_spill,
                        style,
                        link,
                    },
                );
                text_row.push(text);
            }
            wtr.write_record(text_row)
                .map_err(|e| format!("Error while processing csv: {e}"))?;
            data.insert(row, data_row);
        }

        let csv = String::from_utf8(
            wtr.into_inner()
                .map_err(|e| format!("Processing error: '{e}'"))?,
        )
        .map_err(|e| format!("Error converting from utf8: '{e}'"))?;

        Ok(Clipboard {
            csv: csv.trim().to_string(),
            data,
            sheet,
            range: (row_start, column_start, row_end, column_end),
        })
    }

    /// Paste text that we copied
    pub fn paste_from_clipboard(
        &mut self,
        source_sheet: u32,
        source_range: ClipboardTuple,
        clipboard: &ClipboardData,
        is_cut: bool,
    ) -> Result<(), String> {
        let mut diff_list = Vec::new();
        let view = self.get_selected_view();
        let (source_first_row, source_first_column, source_last_row, source_last_column) =
            source_range;
        let sheet = view.sheet;
        // Paste is anchored at the selected cell (the range is normalized, so
        // its start corner is not necessarily where the selection began)
        let (selected_row, selected_column) = (view.row, view.column);
        let mut max_row = selected_row;
        let mut max_column = selected_column;
        let area = &Area {
            sheet,
            row: source_first_row,
            column: source_first_column,
            width: source_last_column - source_first_column + 1,
            height: source_last_row - source_first_row + 1,
        };
        let target_area = &Area {
            sheet,
            row: selected_row,
            column: selected_column,
            width: source_last_column - source_first_column + 1,
            height: source_last_row - source_first_row + 1,
        };

        // The merges of the copied area, captured before the containment
        // step below can remove target merges: when the paste overlaps its
        // own source, a source merge can also be a replaced target merge and
        // must still be recreated.
        let source_merges: Vec<MergedCell> = self
            .model
            .get_merged_cells(source_sheet)?
            .iter()
            .filter(|m| {
                m.intersects(
                    source_first_row,
                    source_first_column,
                    source_last_column - source_first_column + 1,
                    source_last_row - source_first_row + 1,
                )
            })
            .copied()
            .collect();

        // Merged cells in the target are replaced by the paste (or reject it)
        let pasted_merges: Vec<MergedCell> = source_merges
            .iter()
            .map(|m| MergedCell {
                row: m.row + selected_row - source_first_row,
                column: m.column + selected_column - source_first_column,
                width: m.width,
                height: m.height,
            })
            .collect();
        self.remove_merges_replaced_by_paste(target_area, &pasted_merges, &mut diff_list)?;

        let mut seen_cells = HashSet::new();
        // Compute all changes
        let mut changes = Vec::new();
        for (source_row, data_row) in clipboard {
            let delta_row = source_row - source_first_row;
            let target_row = selected_row + delta_row;
            max_row = max_row.max(target_row);
            for (source_column, value) in data_row {
                let delta_column = source_column - source_first_column;
                let target_column = selected_column + delta_column;
                max_column = max_column.max(target_column);

                if value.is_spill {
                    // Spill cells carry no formula/value, but their style should still be copied.
                    let old_style =
                        self.model
                            .get_cell_style_or_none(sheet, target_row, target_column)?;
                    changes.push((
                        target_row,
                        target_column,
                        None,
                        old_style,
                        None,
                        value.style.clone(),
                    ));
                    seen_cells.insert((target_row, target_column));
                    continue;
                }

                // We are copying the value in
                // (source_row, source_column) to (target_row , target_column)
                // References in formulas are displaced

                // remain in the copied area
                let source = &CellReferenceIndex {
                    sheet,
                    column: *source_column,
                    row: *source_row,
                };
                let target = &CellReferenceIndex {
                    sheet,
                    column: target_column,
                    row: target_row,
                };
                let new_value = if is_cut {
                    self.model
                        .move_cell_value_to_area(&value.text, source, target, area)?
                } else {
                    self.model
                        .extend_copied_value(&value.text, source, target)?
                };

                let old_value = self
                    .model
                    .workbook
                    .worksheet(sheet)?
                    .cell(target_row, target_column)
                    .cloned();

                let old_style =
                    self.model
                        .get_cell_style_or_none(sheet, target_row, target_column)?;
                changes.push((
                    target_row,
                    target_column,
                    old_value.clone(),
                    old_style.clone(),
                    Some(new_value.clone()),
                    value.style.clone(),
                ));
                seen_cells.insert((target_row, target_column));
            }
        }
        // Clearing the target area also removes its links: capture them for undo
        diff_list.extend(self.range_link_diffs(target_area)?);
        // clear the whole area (this resets array formulas)
        self.model.range_clear_contents(target_area)?;
        // set the new values and styles
        for (target_row, target_column, old_value, old_style, new_value, style) in changes {
            if let Some(ref v) = new_value {
                self.model
                    .set_user_input(sheet, target_row, target_column, v.clone())?;
                diff_list.push(Diff::SetCellValue {
                    sheet,
                    row: target_row,
                    column: target_column,
                    new_value: v.clone(),
                    old_value: Box::new(old_value),
                });
            }
            self.model
                .set_cell_style(sheet, target_row, target_column, &style)?;

            diff_list.push(Diff::SetCellStyle {
                sheet,
                row: target_row,
                column: target_column,
                old_value: Box::new(old_style),
                new_value: Box::new(style),
            });
        }
        // Paste the links of the copied cells. This runs after the values are
        // set so that it also overrides any link auto-created by an URL value.
        for (source_row, data_row) in clipboard {
            let target_row = selected_row + (source_row - source_first_row);
            for (source_column, value) in data_row {
                let target_column = selected_column + (source_column - source_first_column);
                let old_link = self.model.get_cell_link(sheet, target_row, target_column)?;
                if old_link == value.link {
                    continue;
                }
                match &value.link {
                    Some(link) => {
                        self.model
                            .set_cell_link(sheet, target_row, target_column, link.clone())?
                    }
                    None => self
                        .model
                        .delete_cell_link(sheet, target_row, target_column)?,
                }
                diff_list.push(Diff::SetCellLink {
                    sheet,
                    row: target_row,
                    column: target_column,
                    old_value: Box::new(old_link),
                    new_value: Box::new(value.link.clone()),
                });
            }
        }
        if is_cut {
            // A cut moves the merged cells of the source area to the target:
            // they are removed from the source and recreated, translated by
            // the paste offset. A merge is matched by intersection: it can
            // stick out of the cut range when its covered cells are empty (the
            // copied range is clamped to the sheet dimension), and it moves
            // whole.
            let old_source_merged_cells = self.model.get_merged_cells(source_sheet)?.to_vec();
            let old_target_merged_cells = self.model.get_merged_cells(sheet)?.to_vec();
            self.model.unmerge_cells(&Area {
                sheet: source_sheet,
                row: source_first_row,
                column: source_first_column,
                width: source_last_column - source_first_column + 1,
                height: source_last_row - source_first_row + 1,
            })?;
            for m in source_merges {
                let merge_area = Area {
                    sheet,
                    row: m.row + selected_row - source_first_row,
                    column: m.column + selected_column - source_first_column,
                    width: m.width,
                    height: m.height,
                };
                // Capture the content and links the merge will clear: a merge
                // sticking out of the pasted block can swallow cells that were
                // not part of the paste
                let mut merge_diffs = self.covered_cells_clear_diffs(&merge_area)?;
                // A translated merge can conflict outside the checked target
                // area (another merge, an array formula) or fall off the
                // sheet: those are dropped, the rest of the cut still lands
                // merge_cells_keep_styles: the pasted cells already carry the
                // merged style pattern of the source; stamping the anchor's
                // style would drop the perimeter borders of non-anchor cells
                if self.model.merge_cells_keep_styles(&merge_area).is_ok() {
                    diff_list.append(&mut merge_diffs);
                }
            }
            // One snapshot per touched sheet (source and target coincide on a
            // same-sheet cut)
            let mut snapshot_sheets = vec![source_sheet];
            if sheet != source_sheet {
                snapshot_sheets.push(sheet);
            }
            for (snapshot_sheet, old_value) in snapshot_sheets
                .into_iter()
                .zip([old_source_merged_cells, old_target_merged_cells])
            {
                let new_value = self.model.get_merged_cells(snapshot_sheet)?.to_vec();
                if old_value != new_value {
                    diff_list.push(Diff::SetMergedCells {
                        sheet: snapshot_sheet,
                        old_value,
                        new_value,
                    });
                }
            }
            for row in source_first_row..=source_last_row {
                for column in source_first_column..=source_last_column {
                    if (source_sheet == sheet) && seen_cells.contains(&(row, column)) {
                        continue;
                    }
                    let old_value = self
                        .model
                        .workbook
                        .worksheet(source_sheet)?
                        .cell(row, column)
                        .cloned();

                    diff_list.push(Diff::RangeClearContents {
                        sheet: source_sheet,
                        row,
                        column,
                        width: 1,
                        height: 1,
                        old_value: vec![vec![old_value.clone()]],
                    });

                    // a cut also moves the link away from the source cell
                    let old_link = self.model.get_cell_link(source_sheet, row, column)?;
                    if let Some(old_link) = old_link {
                        self.model.delete_cell_link(source_sheet, row, column)?;
                        diff_list.push(Diff::SetCellLink {
                            sheet: source_sheet,
                            row,
                            column,
                            old_value: Box::new(Some(old_link)),
                            new_value: Box::new(None),
                        });
                    }

                    // If the source is a dynamic formula anchor, range_clear_contents
                    // would erase its entire spill — including cells that were just
                    // written to by this paste.  Clear the anchor and its spill cells
                    // individually instead, skipping any paste-target cells.
                    let spill_dims = match &old_value {
                        Some(Cell::ArrayFormula {
                            kind: ArrayKind::Dynamic,
                            r,
                            ..
                        }) => Some(*r),
                        _ => None,
                    };
                    if let Some((spill_w, spill_h)) = spill_dims {
                        let ws = self.model.workbook.worksheet_mut(source_sheet)?;
                        for sr in row..row + spill_h {
                            for sc in column..column + spill_w {
                                if (source_sheet == sheet) && seen_cells.contains(&(sr, sc)) {
                                    continue;
                                }
                                let _ = ws.cell_clear_contents(sr, sc);
                            }
                        }
                    } else {
                        let area = Area {
                            sheet: source_sheet,
                            row,
                            column,
                            width: 1,
                            height: 1,
                        };
                        self.model.range_clear_contents(&area)?;
                    }
                    let old_style = self
                        .model
                        .get_cell_style_or_none(source_sheet, row, column)?;
                    let default_style = Style::default();
                    self.model
                        .set_cell_style(source_sheet, row, column, &default_style)?;
                    diff_list.push(Diff::SetCellStyle {
                        sheet: source_sheet,
                        row,
                        column,
                        old_value: Box::new(old_style),
                        new_value: Box::new(default_style),
                    });
                }
            }
            // Update external formulas that reference cells in the moved area.
            // source_sheet is used here (not `sheet`) so cross-sheet paste works.
            let ext_area = Area {
                sheet: source_sheet,
                row: source_first_row,
                column: source_first_column,
                width: source_last_column - source_first_column + 1,
                height: source_last_row - source_first_row + 1,
            };
            let ext_updates = self.model.get_external_formula_updates_for_cut(
                &ext_area,
                selected_row,
                selected_column,
            )?;
            for (ext_sheet, ext_row, ext_col, new_formula) in ext_updates {
                let old_cell = self
                    .model
                    .workbook
                    .worksheet(ext_sheet)?
                    .cell(ext_row, ext_col)
                    .cloned();
                self.model
                    .set_user_input(ext_sheet, ext_row, ext_col, new_formula.clone())?;
                diff_list.push(Diff::SetCellValue {
                    sheet: ext_sheet,
                    row: ext_row,
                    column: ext_col,
                    new_value: new_formula,
                    old_value: Box::new(old_cell),
                });
            }
            // Update defined names whose references land inside the moved area.
            let dn_updates = self.model.get_defined_name_updates_for_cut(
                &ext_area,
                selected_row,
                selected_column,
            );
            for (dn_name, dn_scope, old_formula, new_formula) in dn_updates {
                diff_list.push(Diff::UpdateDefinedName {
                    name: dn_name.clone(),
                    scope: dn_scope,
                    old_formula: old_formula.clone(),
                    new_name: dn_name.clone(),
                    new_scope: dn_scope,
                    new_formula: new_formula.clone(),
                });
                self.model.update_defined_name(
                    &dn_name,
                    dn_scope,
                    &dn_name,
                    dn_scope,
                    &new_formula,
                )?;
            }
            // Update conditional formatting ranges and formula references.
            let cf_updates = self.model.get_conditional_formatting_updates_for_cut(
                &ext_area,
                selected_row,
                selected_column,
            )?;
            for (cf_sheet, cf_idx, new_range, new_rule) in cf_updates {
                let old_cf = self
                    .model
                    .workbook
                    .worksheet(cf_sheet)?
                    .conditional_formatting
                    .get(cf_idx)
                    .ok_or_else(|| format!("CF index {cf_idx} not found"))?
                    .clone();
                {
                    let ws = self.model.workbook.worksheet_mut(cf_sheet)?;
                    ws.conditional_formatting[cf_idx].range = new_range.clone();
                    ws.conditional_formatting[cf_idx].cf_rule = new_rule.clone();
                }
                diff_list.push(Diff::UpdateConditionalFormatting {
                    sheet: cf_sheet,
                    index: cf_idx as u32,
                    old_range: old_cf.range,
                    old_rule: Box::new(old_cf.cf_rule),
                    old_priority: old_cf.priority,
                    new_range,
                    new_rule: Box::new(new_rule),
                });
            }
        } else {
            // Copy-paste recreates the merged cells of the copied area at the
            // target. A merge is matched by intersection: it can stick out of
            // the copied range when its covered cells are empty (the copied
            // range is clamped to the sheet dimension), and is recreated whole.
            if !source_merges.is_empty() {
                let old_merged_cells = self.model.get_merged_cells(sheet)?.to_vec();
                for m in source_merges {
                    let merge_area = Area {
                        sheet,
                        row: m.row + selected_row - source_first_row,
                        column: m.column + selected_column - source_first_column,
                        width: m.width,
                        height: m.height,
                    };
                    // Capture the content and links the merge will clear: a
                    // merge sticking out of the pasted block can swallow cells
                    // that were not part of the paste
                    let mut merge_diffs = self.covered_cells_clear_diffs(&merge_area)?;
                    // A translated merge can conflict outside the checked
                    // target area (another merge, an array formula) or fall
                    // off the sheet: those are skipped, the rest still paste
                    // merge_cells_keep_styles: the pasted cells already carry
                    // the merged style pattern of the source; stamping the
                    // anchor's style would drop the perimeter borders of
                    // non-anchor cells
                    if self.model.merge_cells_keep_styles(&merge_area).is_ok() {
                        diff_list.append(&mut merge_diffs);
                    }
                }
                let new_merged_cells = self.model.get_merged_cells(sheet)?.to_vec();
                if old_merged_cells != new_merged_cells {
                    diff_list.push(Diff::SetMergedCells {
                        sheet,
                        old_value: old_merged_cells,
                        new_value: new_merged_cells,
                    });
                }
            }

            // Copy-paste: duplicate CF rules from the source area to the target.
            let cf_copies = self.model.get_cf_rules_to_copy(
                source_sheet,
                source_first_row,
                source_first_column,
                source_last_row,
                source_last_column,
                selected_row,
                selected_column,
            );
            for (new_range, new_rule) in cf_copies {
                let priority = self
                    .model
                    .workbook
                    .worksheet(sheet)?
                    .conditional_formatting
                    .iter()
                    .map(|cf| cf.priority)
                    .max()
                    .map(|m| m + 1)
                    .unwrap_or(1);
                self.model
                    .workbook
                    .worksheet_mut(sheet)?
                    .conditional_formatting
                    .push(ConditionalFormatting {
                        range: new_range.clone(),
                        cf_rule: new_rule.clone(),
                        priority,
                    });
                diff_list.push(Diff::AddConditionalFormatting {
                    sheet,
                    range: new_range,
                    rule: Box::new(new_rule),
                    priority,
                });
            }
        }
        self.push_diff_list(diff_list);
        // select the pasted area
        self.set_selected_range(selected_row, selected_column, max_row, max_column)?;
        self.evaluate_if_not_paused();
        Ok(())
    }

    /// Paste a csv-string into the model
    pub fn paste_csv_string(&mut self, area: &Area, csv: &str) -> Result<(), String> {
        let sheet = area.sheet;

        // First pass: parse all records so we know the full extent before touching any cells.
        let mut records: Vec<Vec<String>> = Vec::new();
        let mut max_width: i32 = 0;
        let csv_reader = Cursor::new(csv);
        let mut reader = ReaderBuilder::new()
            .delimiter(b'\t')
            .has_headers(false)
            .from_reader(csv_reader);
        for r in reader.records().flatten() {
            let row_data: Vec<String> = r.iter().map(|v| v.to_string()).collect();
            max_width = max_width.max(row_data.len() as i32);
            records.push(row_data);
        }
        if records.is_empty() {
            return Ok(());
        }

        // Check whether any static array formula would be partially overwritten.
        let paste_area = Area {
            sheet,
            row: area.row,
            column: area.column,
            width: max_width,
            height: records.len() as i32,
        };

        // Merged cells in the target are replaced by the paste (or reject
        // it); plain text carries no merges, so contained ones just go
        let mut diff_list = Vec::new();
        self.remove_merges_replaced_by_paste(&paste_area, &[], &mut diff_list)?;

        // Capture old values BEFORE clearing so undo can restore them correctly.
        let mut old_values: HashMap<(i32, i32), Option<Cell>> = HashMap::new();
        {
            let ws = self.model.workbook.worksheet(sheet)?;
            for r in area.row..area.row + records.len() as i32 {
                for c in area.column..area.column + max_width {
                    old_values.insert((r, c), ws.cell(r, c).cloned());
                }
            }
        }

        // Clearing the target area also removes its links: capture them for undo
        diff_list.extend(self.range_link_diffs(&paste_area)?);
        self.model.range_clear_contents(&paste_area)?;

        // Second pass: write values and build diff list.
        let mut row = area.row;
        let mut last_column = area.column;
        for row_data in &records {
            let mut column = area.column;
            for value in row_data {
                let old_value = old_values.remove(&(row, column)).unwrap_or(None);
                diff_list.push(Diff::SetCellValue {
                    sheet,
                    row,
                    column,
                    new_value: value.to_string(),
                    old_value: Box::new(old_value),
                });
                // pasted URLs are auto-linked: capture the link and style diffs too
                self.set_user_input_with_link_diffs(
                    sheet,
                    row,
                    column,
                    value.to_string(),
                    &mut diff_list,
                )?;
                column += 1;
            }
            last_column = last_column.max(column - 1);
            row += 1;
        }
        self.push_diff_list(diff_list);
        // select the pasted area
        self.set_selected_range(area.row, area.column, row - 1, last_column)?;
        self.evaluate_if_not_paused();
        Ok(())
    }
}
