use crate::{
    calc_result::CalcResult,
    expressions::{parser::Node, token::Error, types::CellReferenceIndex, utils::quote_name},
    model::Model,
};

use crate::expressions::utils::number_to_column;

impl<'a> Model<'a> {
    // ── ADDRESS ───────────────────────────────────────────────────────────────

    /// `=ADDRESS(row_num, col_num, [abs_num], [a1], [sheet_text])`
    ///
    /// Returns a cell address as text.
    ///   * abs_num: 1=absolute $A$1 (default), 2=row-abs/col-rel A$1, 3=row-rel/col-abs $A1, 4=relative A1
    ///   * a1: TRUE=A1 style (default), FALSE=R1C1 style
    ///   * sheet_text: optional sheet name prefix
    pub(crate) fn fn_address(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() < 2 || args.len() > 5 {
            return CalcResult::new_args_number_error(cell);
        }

        let row_num = match self.get_number(&args[0], cell) {
            Ok(n) => n as i32,
            Err(e) => return e,
        };
        if row_num < 1 {
            return CalcResult::new_error(Error::VALUE, cell, "row_num must be >= 1".to_string());
        }

        let col_num = match self.get_number(&args[1], cell) {
            Ok(n) => n as i32,
            Err(e) => return e,
        };
        if col_num < 1 {
            return CalcResult::new_error(Error::VALUE, cell, "col_num must be >= 1".to_string());
        }

        let abs_num = if args.len() >= 3 {
            match self.get_number(&args[2], cell) {
                Ok(n) => n as i32,
                Err(e) => return e,
            }
        } else {
            1
        };

        if !(1..=4).contains(&abs_num) {
            return CalcResult::new_error(
                Error::VALUE,
                cell,
                "abs_num must be 1, 2, 3, or 4".to_string(),
            );
        }

        let use_a1 = if args.len() >= 4 {
            match self.get_boolean(&args[3], cell) {
                Ok(b) => b,
                Err(e) => return e,
            }
        } else {
            true
        };

        // When `sheet_text` is present the `!` separator is always emitted, even
        // for an empty string: ADDRESS(1,1,1,TRUE,"") is "!$A$1" in Excel. A
        // `sheet_text` that is omitted entirely produces no prefix.
        let sheet_prefix = if args.len() == 5 {
            match self.get_string(&args[4], cell) {
                Ok(s) => format!("{}!", quote_name(&s)),
                Err(e) => return e,
            }
        } else {
            String::new()
        };

        let address = if use_a1 {
            let col_letter = match number_to_column(col_num) {
                Some(s) => s,
                None => {
                    return CalcResult::new_error(
                        Error::VALUE,
                        cell,
                        "col_num out of range".to_string(),
                    )
                }
            };
            match abs_num {
                1 => format!("{}${}${}", sheet_prefix, col_letter, row_num),
                2 => format!("{}{}${}", sheet_prefix, col_letter, row_num),
                3 => format!("{}${}{}", sheet_prefix, col_letter, row_num),
                4 => format!("{}{}{}", sheet_prefix, col_letter, row_num),
                _ => {
                    // This should never happen due to the earlier check
                    return CalcResult::new_error(
                        Error::VALUE,
                        cell,
                        "invalid abs_num".to_string(),
                    );
                }
            }
        } else {
            // R1C1 style
            let row_part = if abs_num == 1 || abs_num == 2 {
                format!("R{}", row_num)
            } else {
                format!("R[{}]", row_num)
            };
            let col_part = if abs_num == 1 || abs_num == 3 {
                format!("C{}", col_num)
            } else {
                format!("C[{}]", col_num)
            };
            format!("{}{}{}", sheet_prefix, row_part, col_part)
        };

        CalcResult::String(address)
    }

    // ── AREAS ─────────────────────────────────────────────────────────────────

    /// `=AREAS(reference)`
    ///
    /// Returns the number of areas in a reference. IronCalc does not support
    /// multi-area references, so this always returns 1.
    pub(crate) fn fn_areas(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 1 {
            return CalcResult::new_args_number_error(cell);
        }
        let result = self.evaluate_node_in_context(&args[0], cell);
        if result.is_error() {
            return result;
        }
        CalcResult::Number(1.0)
    }
}
