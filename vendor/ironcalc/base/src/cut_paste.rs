use crate::{
    cf_types::CfRule,
    expressions::{
        parser::move_formula::{move_formula, ref_is_in_area, MoveContext},
        types::{Area, CellReferenceRC},
        utils,
    },
    language::get_default_language,
    locale::get_default_locale,
    model::Model,
    utils as common,
};

// ---------------------------------------------------------------------------
// sqref helpers
// ---------------------------------------------------------------------------

/// Updates a single sqref range part if both corners are fully inside the cut area.
fn cf_range_part_update_for_cut(part: &str, area: &Area, row_delta: i32, col_delta: i32) -> String {
    let upper = part.to_uppercase();
    let segs: Vec<&str> = upper.splitn(2, ':').collect();
    match segs.len() {
        1 => {
            if let Some(r) = utils::parse_reference_a1(segs[0]) {
                if ref_is_in_area(area.sheet, r.row, r.column, area) {
                    if let Some(c) = utils::number_to_column(r.column + col_delta) {
                        return format!("{}{}", c, r.row + row_delta);
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
                if ref_is_in_area(area.sheet, r1.row, r1.column, area)
                    && ref_is_in_area(area.sheet, r2.row, r2.column, area)
                {
                    if let (Some(c1), Some(c2)) = (
                        utils::number_to_column(r1.column + col_delta),
                        utils::number_to_column(r2.column + col_delta),
                    ) {
                        return format!(
                            "{}{}:{}{}",
                            c1,
                            r1.row + row_delta,
                            c2,
                            r2.row + row_delta
                        );
                    }
                }
            }
            part.to_string()
        }
        _ => part.to_string(),
    }
}

/// Maps a single CF sqref range part to the target location, intersecting with the copied area.
/// Returns `None` if the CF range part does not overlap the copy source.
fn map_cf_range_part_to_target(
    part: &str,
    src_r1: i32,
    src_c1: i32,
    src_r2: i32,
    src_c2: i32,
    tgt_row: i32,
    tgt_col: i32,
) -> Option<String> {
    let upper = part.to_uppercase();
    let segs: Vec<&str> = upper.splitn(2, ':').collect();
    let (rule_r1, rule_c1, rule_r2, rule_c2) = match segs.len() {
        1 => {
            let r = utils::parse_reference_a1(segs[0])?;
            (r.row, r.column, r.row, r.column)
        }
        2 => {
            let r1 = utils::parse_reference_a1(segs[0])?;
            let r2 = utils::parse_reference_a1(segs[1])?;
            (r1.row, r1.column, r2.row, r2.column)
        }
        _ => return None,
    };

    // Intersection with copy source
    let int_r1 = rule_r1.max(src_r1);
    let int_c1 = rule_c1.max(src_c1);
    let int_r2 = rule_r2.min(src_r2);
    let int_c2 = rule_c2.min(src_c2);
    if int_r1 > int_r2 || int_c1 > int_c2 {
        return None;
    }

    // Map intersection to target coordinates
    let new_r1 = tgt_row + (int_r1 - src_r1);
    let new_c1 = tgt_col + (int_c1 - src_c1);
    let new_r2 = tgt_row + (int_r2 - src_r1);
    let new_c2 = tgt_col + (int_c2 - src_c1);

    let c1 = utils::number_to_column(new_c1)?;
    let c2 = utils::number_to_column(new_c2)?;
    if new_r1 == new_r2 && new_c1 == new_c2 {
        Some(format!("{c1}{new_r1}"))
    } else {
        Some(format!("{c1}{new_r1}:{c2}{new_r2}"))
    }
}

/// Maps every part of a space-separated sqref string to the target location,
/// dropping parts that fall entirely outside the copy source.
fn map_cf_sqref_to_target(
    sqref: &str,
    src_r1: i32,
    src_c1: i32,
    src_r2: i32,
    src_c2: i32,
    tgt_row: i32,
    tgt_col: i32,
) -> String {
    sqref
        .split_whitespace()
        .filter_map(|p| {
            map_cf_range_part_to_target(p, src_r1, src_c1, src_r2, src_c2, tgt_row, tgt_col)
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// Updates every part of a space-separated sqref string for a cut operation.
fn cf_sqref_update_for_cut(sqref: &str, area: &Area, row_delta: i32, col_delta: i32) -> String {
    sqref
        .split_whitespace()
        .map(|p| cf_range_part_update_for_cut(p, area, row_delta, col_delta))
        .collect::<Vec<_>>()
        .join(" ")
}

/// Returns the (row, column) of the top-left cell in a sqref string.
pub(crate) fn cf_sqref_anchor(sqref: &str) -> Option<(i32, i32)> {
    let part = sqref.split_whitespace().next()?;
    let upper = part.to_uppercase();
    let first = upper.split(':').next()?;
    let r = utils::parse_reference_a1(first)?;
    Some((r.row, r.column))
}

// ---------------------------------------------------------------------------
// Model methods
// ---------------------------------------------------------------------------

impl<'a> Model<'a> {
    /// Returns updated formula strings for all cells whose formulas reference
    /// cells inside `area`, excluding cells that are themselves inside `area`.
    /// Used during cut-paste to propagate the move to external observers.
    ///
    /// Returns `(sheet_index, row, column, new_formula_string)` for each cell
    /// whose formula changed.
    pub(crate) fn get_external_formula_updates_for_cut(
        &mut self,
        area: &Area,
        target_row: i32,
        target_column: i32,
    ) -> Result<Vec<(u32, i32, i32, String)>, String> {
        let row_delta = target_row - area.row;
        let column_delta = target_column - area.column;
        if row_delta == 0 && column_delta == 0 {
            return Ok(vec![]);
        }

        let num_sheets = self.workbook.worksheets.len();

        // Phase 1 – collect formula cells outside the cut area (immutable reads only)
        let mut candidates: Vec<(u32, i32, i32, String)> = Vec::new();
        for ws_idx in 0..num_sheets {
            let ws_idx_u32 = ws_idx as u32;
            // collect (row, col) pairs first to avoid holding the ws borrow
            let formula_positions: Vec<(i32, i32)> = {
                let ws = &self.workbook.worksheets[ws_idx];
                ws.sheet_data
                    .cells()
                    .filter_map(|(row, col, cell)| {
                        cell.get_formula()?;
                        // skip cells inside the area being moved
                        if ws_idx_u32 == area.sheet
                            && row >= area.row
                            && row < area.row + area.height
                            && col >= area.column
                            && col < area.column + area.width
                        {
                            return None;
                        }
                        Some((row, col))
                    })
                    .collect()
            };
            // now collect the user-facing formula strings
            for (row, col) in formula_positions {
                let formula_str = self.get_localized_cell_content(ws_idx_u32, row, col)?;
                candidates.push((ws_idx_u32, row, col, formula_str));
            }
        }

        // Phase 2 – rewrite references that land inside the moved area
        let mut updates: Vec<(u32, i32, i32, String)> = Vec::new();
        for (ws_idx_u32, row, col, formula_str) in candidates {
            let sheet_name = self.workbook.worksheets[ws_idx_u32 as usize].get_name();
            let formula_body = match self.formula_without_prefix(&formula_str) {
                Some(s) => s.to_owned(),
                None => continue,
            };
            let cell_ref = CellReferenceRC {
                sheet: sheet_name.clone(),
                row,
                column: col,
            };
            let node = self.parser.parse(&formula_body, &cell_ref);
            let new_body = move_formula(
                &node,
                &MoveContext {
                    source_sheet_name: &sheet_name,
                    row,
                    column: col,
                    area,
                    target_sheet_name: &sheet_name,
                    row_delta,
                    column_delta,
                },
                self.locale,
                self.language,
            );
            let new_formula = format!("={new_body}");
            if new_formula != formula_str {
                updates.push((ws_idx_u32, row, col, new_formula));
            }
        }

        Ok(updates)
    }

    /// Returns updated formula strings for all defined names whose cell or range
    /// reference falls entirely inside `area`, after a cut-paste that moves `area`
    /// to (`target_row`, `target_column`).
    ///
    /// Returns `(name, scope_sheet_index, old_formula, new_formula)` for each
    /// defined name whose formula changed.
    pub(crate) fn get_defined_name_updates_for_cut(
        &self,
        area: &Area,
        target_row: i32,
        target_column: i32,
    ) -> Vec<(String, Option<u32>, String, String)> {
        let row_delta = target_row - area.row;
        let column_delta = target_column - area.column;
        if row_delta == 0 && column_delta == 0 {
            return vec![];
        }

        let names_with_scope = self.workbook.get_defined_names_with_scope();
        let mut updates = Vec::new();

        for (name, scope, formula) in names_with_scope {
            let parsed = common::ParsedReference::parse_reference_formula(
                None,
                &formula,
                self.locale,
                |n| self.get_sheet_index_by_name(n),
            );
            let Ok(parsed) = parsed else {
                continue; // LAMBDA or invalid — skip
            };

            let new_formula = match parsed {
                common::ParsedReference::CellReference(cell_ref) => {
                    if !ref_is_in_area(cell_ref.sheet, cell_ref.row, cell_ref.column, area) {
                        continue;
                    }
                    let new_row = cell_ref.row + row_delta;
                    let new_col = cell_ref.column + column_delta;
                    let sheet_name = utils::quote_name(
                        &self.workbook.worksheets[cell_ref.sheet as usize].get_name(),
                    );
                    let Some(col_str) = utils::number_to_column(new_col) else {
                        continue;
                    };
                    format!("{sheet_name}!${col_str}${new_row}")
                }
                common::ParsedReference::Range(left, right) => {
                    if !ref_is_in_area(left.sheet, left.row, left.column, area)
                        || !ref_is_in_area(right.sheet, right.row, right.column, area)
                    {
                        continue;
                    }
                    let new_row1 = left.row + row_delta;
                    let new_col1 = left.column + column_delta;
                    let new_row2 = right.row + row_delta;
                    let new_col2 = right.column + column_delta;
                    let sheet_name = utils::quote_name(
                        &self.workbook.worksheets[left.sheet as usize].get_name(),
                    );
                    let (Some(col1_str), Some(col2_str)) = (
                        utils::number_to_column(new_col1),
                        utils::number_to_column(new_col2),
                    ) else {
                        continue;
                    };
                    format!("{sheet_name}!${col1_str}${new_row1}:${col2_str}${new_row2}")
                }
            };

            if new_formula != formula {
                updates.push((name, scope, formula, new_formula));
            }
        }

        updates
    }

    /// Returns updated range strings and CF rules for all conditional formatting entries
    /// on `area.sheet` whose applied range or formula references land inside `area`,
    /// after a cut-paste that moves `area` to (`target_row`, `target_column`).
    ///
    /// Returns `(sheet, cf_idx, new_range, new_rule)` for each entry that changed.
    pub(crate) fn get_conditional_formatting_updates_for_cut(
        &mut self,
        area: &Area,
        target_row: i32,
        target_column: i32,
    ) -> Result<Vec<(u32, usize, String, CfRule)>, String> {
        let row_delta = target_row - area.row;
        let column_delta = target_column - area.column;
        if row_delta == 0 && column_delta == 0 {
            return Ok(vec![]);
        }

        let sheet = area.sheet;
        let sheet_name = self
            .workbook
            .worksheets
            .get(sheet as usize)
            .ok_or_else(|| format!("Sheet {sheet} not found"))?
            .get_name();

        // Phase 1 – collect CF data (immutable reads)
        let cf_entries: Vec<(String, CfRule)> = self.workbook.worksheets[sheet as usize]
            .conditional_formatting
            .iter()
            .map(|cf| (cf.range.clone(), cf.cf_rule.clone()))
            .collect();

        // Phase 2 – compute updates (may need &mut self.parser)
        let mut updates = Vec::new();
        for (cf_idx, (old_range, old_rule)) in cf_entries.into_iter().enumerate() {
            let new_range = cf_sqref_update_for_cut(&old_range, area, row_delta, column_delta);

            // Use the top-left cell of the CF range as the formula parse anchor.
            let anchor = cf_sqref_anchor(&old_range);
            let new_rule = if let Some((anchor_row, anchor_col)) = anchor {
                self.cf_rule_move_formulas(
                    old_rule.clone(),
                    &sheet_name,
                    anchor_row,
                    anchor_col,
                    area,
                    row_delta,
                    column_delta,
                )
            } else {
                old_rule.clone()
            };

            if new_range != old_range || new_rule != old_rule {
                updates.push((sheet, cf_idx, new_range, new_rule));
            }
        }

        Ok(updates)
    }

    /// Updates formula fields inside a `CfRule` using `move_formula`.
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn cf_rule_move_formulas(
        &mut self,
        rule: CfRule,
        sheet_name: &str,
        anchor_row: i32,
        anchor_col: i32,
        area: &Area,
        row_delta: i32,
        col_delta: i32,
    ) -> CfRule {
        let mut move_f = |formula: &str| -> String {
            let trimmed = formula.trim();
            let has_eq = trimmed.starts_with('=');
            let body = if has_eq { &trimmed[1..] } else { trimmed };
            let cell_ref = CellReferenceRC {
                sheet: sheet_name.to_string(),
                row: anchor_row,
                column: anchor_col,
            };
            // CF formulas are stored internally in English.
            let node = self.parse_internal_formula(body, &cell_ref);
            let new_body = move_formula(
                &node,
                &MoveContext {
                    source_sheet_name: sheet_name,
                    row: anchor_row,
                    column: anchor_col,
                    area,
                    target_sheet_name: sheet_name,
                    row_delta,
                    column_delta: col_delta,
                },
                get_default_locale(),
                get_default_language(),
            );
            if has_eq {
                format!("={new_body}")
            } else {
                new_body
            }
        };

        match rule {
            CfRule::Formula {
                formula,
                dxf_id,
                stop_if_true,
            } => CfRule::Formula {
                formula: move_f(&formula),
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
                formula: move_f(&formula),
                formula2: formula2.as_deref().map(move_f),
                dxf_id,
                stop_if_true,
            },
            other => other,
        }
    }

    /// Returns CF rules to add when copy-pasting cells from `source_sheet`.
    ///
    /// For each CF rule on `source_sheet` that overlaps the copied rectangle
    /// (`src_row1..src_row2`, `src_col1..src_col2`), computes the intersection
    /// and maps it to the target location starting at (`tgt_row`, `tgt_col`).
    ///
    /// Returns `(new_range_sqref, cf_rule)` for each overlapping CF entry.
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn get_cf_rules_to_copy(
        &self,
        source_sheet: u32,
        src_row1: i32,
        src_col1: i32,
        src_row2: i32,
        src_col2: i32,
        tgt_row: i32,
        tgt_col: i32,
    ) -> Vec<(String, CfRule)> {
        let ws = match self.workbook.worksheets.get(source_sheet as usize) {
            Some(ws) => ws,
            None => return vec![],
        };

        let mut results = Vec::new();
        for cf in &ws.conditional_formatting {
            let new_range = map_cf_sqref_to_target(
                &cf.range, src_row1, src_col1, src_row2, src_col2, tgt_row, tgt_col,
            );
            if !new_range.is_empty() {
                results.push((new_range, cf.cf_rule.clone()));
            }
        }
        results
    }
}
