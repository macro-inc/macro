use std::collections::HashMap;

use crate::expressions::utils::parse_reference_a1;
use crate::formatter::dates::{date_to_serial_number, from_excel_date};
use crate::number_format::parse_finite_number;
use crate::{
    calc_result::CalcResult,
    cell::CellValue,
    cf_types::{
        CfCellResult, CfDataBar, CfIcon, CfRating, CfRule, CfRuleInput, Cfvo, ColorScaleThreshold,
        ConditionalFormatting, ConditionalFormattingView, ExtendedStyle, Icon, IconThreshold,
        PeriodType, TextOperator, ValueOperator,
    },
    expressions::types::{CellReferenceIndex, CellReferenceRC},
    types::{Color, Dxf},
    Model,
};

use chrono::{Datelike, Duration, Months, NaiveDate};

// ---------------------------------------------------------------------------
// Free helper functions for CF evaluation
// ---------------------------------------------------------------------------

/// Parses a space-separated sqref like "A1:C3 E5" into a list of (row1,col1,row2,col2) tuples.
fn parse_sqref(sqref: &str) -> Vec<(i32, i32, i32, i32)> {
    sqref
        .split_whitespace()
        .filter_map(parse_range_part)
        .collect()
}

fn parse_range_part(s: &str) -> Option<(i32, i32, i32, i32)> {
    let upper = s.to_uppercase();
    let parts: Vec<&str> = upper.splitn(2, ':').collect();
    match parts.len() {
        1 => {
            let r = parse_reference_a1(parts[0])?;
            Some((r.row, r.column, r.row, r.column))
        }
        2 => {
            let r1 = parse_reference_a1(parts[0])?;
            let r2 = parse_reference_a1(parts[1])?;
            let (row_min, row_max) = (r1.row.min(r2.row), r1.row.max(r2.row));
            let (col_min, col_max) = (r1.column.min(r2.column), r1.column.max(r2.column));
            Some((row_min, col_min, row_max, col_max))
        }
        _ => None,
    }
}

/// Interpolates a color along the color scale for a given value.
fn interpolate_color(v: f64, thresholds: &[f64], colors: &[String]) -> String {
    let n = thresholds.len();
    if n == 0 || colors.len() != n {
        return "#000000".to_string();
    }
    if v <= thresholds[0] {
        return colors[0].clone();
    }
    if v >= thresholds[n - 1] {
        return colors[n - 1].clone();
    }
    for i in 0..n - 1 {
        if v >= thresholds[i] && v <= thresholds[i + 1] {
            let span = thresholds[i + 1] - thresholds[i];
            let t = if span.abs() < f64::EPSILON {
                0.0
            } else {
                (v - thresholds[i]) / span
            };
            return lerp_color(&colors[i], &colors[i + 1], t);
        }
    }
    colors[0].clone()
}

fn lerp_color(c1: &str, c2: &str, t: f64) -> String {
    let (r1, g1, b1) = parse_hex_color(c1);
    let (r2, g2, b2) = parse_hex_color(c2);
    let r = (r1 as f64 + (r2 as f64 - r1 as f64) * t).round() as u8;
    let g = (g1 as f64 + (g2 as f64 - g1 as f64) * t).round() as u8;
    let b = (b1 as f64 + (b2 as f64 - b1 as f64) * t).round() as u8;
    format!("#{r:02X}{g:02X}{b:02X}")
}

fn parse_hex_color(s: &str) -> (u8, u8, u8) {
    let s = s.trim_start_matches('#');
    if s.len() == 6 {
        let r = u8::from_str_radix(&s[0..2], 16).unwrap_or(0);
        let g = u8::from_str_radix(&s[2..4], 16).unwrap_or(0);
        let b = u8::from_str_radix(&s[4..6], 16).unwrap_or(0);
        (r, g, b)
    } else {
        (0, 0, 0)
    }
}

/// Returns the 0-indexed icon position for `v` given the ordered thresholds.
/// The icon with index `i` applies when `v >= thresholds[i]`.
fn compute_icon_index(v: f64, thresholds: &[(f64, bool)]) -> u32 {
    let mut idx = 0u32;
    for (i, &(value, is_strict)) in thresholds.iter().enumerate() {
        if v > value || (v == value && is_strict) {
            idx = i as u32;
        }
    }
    idx
}

/// Parses a date bound of a Between/NotBetween time-period rule: either a
/// date string in any format DATEVALUE accepts (e.g. "2025-04-25",
/// "4/25/2025") or a plain Excel serial number.
fn parse_cf_date_bound(value: &str) -> Option<f64> {
    let trimmed = value.trim();
    if let Ok(serial) = crate::functions::date_and_time::parse_datevalue_text(trimmed) {
        return Some(serial as f64);
    }
    parse_finite_number(trimmed).map(f64::floor)
}

/// Stable string key for a CellValue, used for duplicate detection.
fn cell_value_key(v: &crate::cell::CellValue) -> Option<String> {
    use crate::cell::CellValue;
    match v {
        CellValue::Number(n) => Some(format!("{n}")),
        CellValue::String(s) => Some(s.to_lowercase()),
        CellValue::Boolean(b) => Some(b.to_string()),
        CellValue::None => None,
    }
}

impl<'a> Model<'a> {
    /// Evaluates all conditional formatting rules for the workbook.
    ///
    /// Iterates every worksheet's CF rules in priority order (lowest priority number,
    /// processed last). The result for each cell is stored in
    /// `cf_cache` and consumed by `get_extended_style_for_cell`.
    pub fn evaluate_conditional_formatting(&mut self) {
        self.cf_cache.clear();
        let sheet_count = self.workbook.worksheets.len();
        for sheet_idx in 0..sheet_count {
            let mut cfs = self.workbook.worksheets[sheet_idx]
                .conditional_formatting
                .clone();
            // Lower priority number = higher priority; process high-priority first so that
            // the first writer into cf_cache wins.
            cfs.sort_by_key(|cf| cf.priority);
            for cf in cfs {
                let ranges = parse_sqref(&cf.range);
                if ranges.is_empty() {
                    continue;
                }
                self.apply_cf_rule(sheet_idx as u32, &cf.cf_rule, &ranges);
            }
        }
    }

    // -----------------------------------------------------------------------
    // CF evaluation helpers
    // -----------------------------------------------------------------------

    fn apply_cf_rule(&mut self, sheet: u32, rule: &CfRule, ranges: &[(i32, i32, i32, i32)]) {
        match rule {
            CfRule::ColorScale { thresholds } => {
                self.apply_cf_color_scale(sheet, thresholds, ranges);
            }
            CfRule::CellIs {
                operator,
                formula,
                formula2,
                dxf_id,
                stop_if_true,
            } => {
                self.apply_cf_cell_is(
                    sheet,
                    operator,
                    formula,
                    formula2.as_deref(),
                    *dxf_id,
                    *stop_if_true,
                    ranges,
                );
            }
            CfRule::Formula {
                formula,
                dxf_id,
                stop_if_true,
            } => {
                self.apply_cf_formula(sheet, formula, *dxf_id, *stop_if_true, ranges);
            }
            CfRule::DuplicateValues {
                dxf_id,
                stop_if_true,
            } => {
                self.apply_cf_duplicate_values(sheet, *dxf_id, *stop_if_true, ranges);
            }
            CfRule::AboveAverage {
                dxf_id,
                stop_if_true,
            } => {
                self.apply_cf_average(sheet, *dxf_id, true, *stop_if_true, ranges);
            }
            CfRule::BelowAverage {
                dxf_id,
                stop_if_true,
            } => {
                self.apply_cf_average(sheet, *dxf_id, false, *stop_if_true, ranges);
            }
            CfRule::Top10 {
                rank,
                percent,
                dxf_id,
                stop_if_true,
            } => {
                self.apply_cf_top_n(
                    sheet,
                    *rank,
                    *percent,
                    false,
                    *dxf_id,
                    *stop_if_true,
                    ranges,
                );
            }
            CfRule::Bottom10 {
                rank,
                percent,
                dxf_id,
                stop_if_true,
            } => {
                self.apply_cf_top_n(sheet, *rank, *percent, true, *dxf_id, *stop_if_true, ranges);
            }
            CfRule::DataBar {
                min,
                max,
                positive_color,
                negative_color,
                is_gradient,
                show_value,
            } => {
                self.apply_cf_data_bar(
                    sheet,
                    min.as_ref(),
                    max.as_ref(),
                    positive_color,
                    negative_color,
                    *is_gradient,
                    *show_value,
                    ranges,
                );
            }
            CfRule::IconSet {
                thresholds,
                show_value,
            } => {
                self.apply_cf_icon_set(sheet, thresholds, *show_value, ranges);
            }
            CfRule::Text {
                operator,
                value,
                dxf_id,
                stop_if_true,
            } => {
                self.apply_cf_text(sheet, operator, value, *dxf_id, *stop_if_true, ranges);
            }
            CfRule::UniqueValues {
                dxf_id,
                stop_if_true,
            } => {
                self.apply_cf_unique_values(sheet, *dxf_id, *stop_if_true, ranges);
            }
            CfRule::TimePeriod {
                time_period,
                date1,
                date2,
                dxf_id,
                stop_if_true,
            } => {
                self.apply_cf_time_period(
                    sheet,
                    time_period,
                    date1.as_deref(),
                    date2.as_deref(),
                    *dxf_id,
                    *stop_if_true,
                    ranges,
                );
            }
            CfRule::IconRating {
                icon,
                color,
                show_value,
                thresholds,
            } => {
                self.apply_cf_icon_rating(sheet, icon, color, thresholds, *show_value, ranges);
            }
            CfRule::Blanks {
                dxf_id,
                stop_if_true,
            } => {
                self.apply_cf_blanks(sheet, *dxf_id, false, *stop_if_true, ranges);
            }
            CfRule::NotBlanks {
                dxf_id,
                stop_if_true,
            } => {
                self.apply_cf_blanks(sheet, *dxf_id, true, *stop_if_true, ranges);
            }
            CfRule::Errors {
                dxf_id,
                stop_if_true,
            } => {
                self.apply_cf_errors(sheet, *dxf_id, false, *stop_if_true, ranges);
            }
            CfRule::NoErrors {
                dxf_id,
                stop_if_true,
            } => {
                self.apply_cf_errors(sheet, *dxf_id, true, *stop_if_true, ranges);
            }
        }
    }

    fn update_cf_cache(
        &mut self,
        sheet: u32,
        row: i32,
        col: i32,
        result: CfCellResult,
        stop_if_true: bool,
    ) {
        if stop_if_true {
            // Replace any lower-priority results already in the cache for this cell.
            self.cf_cache.insert((sheet, row, col), vec![result]);
        } else {
            self.cf_cache
                .entry((sheet, row, col))
                .or_default()
                .push(result);
        }
    }

    /// Collects all numeric values from the given set of ranges on `sheet`.
    fn collect_numeric_values(&self, sheet: u32, ranges: &[(i32, i32, i32, i32)]) -> Vec<f64> {
        let mut values = Vec::new();
        for &(r1, c1, r2, c2) in ranges {
            for row in r1..=r2 {
                for col in c1..=c2 {
                    if let Ok(CellValue::Number(n)) = self.get_cell_value_by_index(sheet, row, col)
                    {
                        values.push(n);
                    }
                }
            }
        }
        values
    }

    /// Resolves a Cfvo threshold to a concrete f64 value.
    fn resolve_cfvo(&mut self, cfvo: &Cfvo, values: &[f64], sheet: u32) -> f64 {
        match cfvo {
            Cfvo::Min => values.iter().cloned().fold(f64::INFINITY, f64::min),
            Cfvo::Max => values.iter().cloned().fold(f64::NEG_INFINITY, f64::max),
            Cfvo::Number(n) => *n,
            Cfvo::Percent(p) => {
                if values.is_empty() {
                    return 0.0;
                }
                let min = values.iter().cloned().fold(f64::INFINITY, f64::min);
                let max = values.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
                let p = *p;
                min + (max - min) * p / 100.0
            }
            Cfvo::Percentile(p) => {
                if values.is_empty() {
                    return 0.0;
                }
                let mut sorted = values.to_vec();
                sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
                let idx = ((p / 100.0) * (sorted.len() - 1) as f64).floor() as usize;
                sorted[idx.min(sorted.len() - 1)]
            }
            Cfvo::Formula(f) => self.evaluate_formula(f, sheet).unwrap_or(0.0),
        }
    }

    fn apply_cf_color_scale(
        &mut self,
        sheet: u32,
        thresholds: &[ColorScaleThreshold],
        ranges: &[(i32, i32, i32, i32)],
    ) {
        if thresholds.len() < 2 {
            return;
        }
        let values = self.collect_numeric_values(sheet, ranges);
        if values.is_empty() {
            return;
        }
        let colors: Vec<String> = thresholds
            .iter()
            .map(|t| t.color.to_rgb(&self.workbook.theme))
            .collect();
        let mut stops: Vec<f64> = Vec::with_capacity(thresholds.len());
        for t in thresholds {
            stops.push(self.resolve_cfvo(&t.cfvo, &values, sheet));
        }
        // Excel sorts only the threshold values, keeping colors at their original
        // positional indices. A formula cfvo that resolves out-of-order (e.g. $G$13=0
        // appearing after cfvo num=20) must be sorted into place while color[i] still
        // maps to the i-th stop in sorted order.
        stops.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));

        for &(r1, c1, r2, c2) in ranges {
            for row in r1..=r2 {
                for col in c1..=c2 {
                    if let Ok(CellValue::Number(v)) = self.get_cell_value_by_index(sheet, row, col)
                    {
                        let color = interpolate_color(v, &stops, &colors);
                        self.update_cf_cache(
                            sheet,
                            row,
                            col,
                            CfCellResult::ColorScale(Color::Rgb(color)),
                            false,
                        );
                    }
                }
            }
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn apply_cf_data_bar(
        &mut self,
        sheet: u32,
        min: Option<&Cfvo>,
        max: Option<&Cfvo>,
        positive_color: &Color,
        negative_color: &Color,
        is_gradient: bool,
        show_value: bool,
        ranges: &[(i32, i32, i32, i32)],
    ) {
        let values = self.collect_numeric_values(sheet, ranges);
        if values.is_empty() {
            return;
        }
        let min_val = match min {
            Some(cfvo) => self.resolve_cfvo(cfvo, &values, sheet),
            None => values.iter().cloned().fold(0.0_f64, f64::min),
        };
        let max_val = match max {
            Some(cfvo) => self.resolve_cfvo(cfvo, &values, sheet),
            None => values.iter().cloned().fold(0.0_f64, f64::max),
        };
        let span = max_val - min_val;
        if span.abs() < f64::EPSILON {
            return;
        }
        let axis_position = (-min_val / span).clamp(0.0, 1.0);

        for &(r1, c1, r2, c2) in ranges {
            for row in r1..=r2 {
                for col in c1..=c2 {
                    if let Ok(CellValue::Number(v)) = self.get_cell_value_by_index(sheet, row, col)
                    {
                        let proportion = ((v - min_val) / span).clamp(0.0, 1.0);
                        self.update_cf_cache(
                            sheet,
                            row,
                            col,
                            CfCellResult::DataBar {
                                positive_color: positive_color.clone(),
                                negative_color: negative_color.clone(),
                                is_gradient,
                                value: proportion,
                                axis_position,
                                show_value,
                            },
                            false,
                        );
                    }
                }
            }
        }
    }

    fn apply_cf_icon_set(
        &mut self,
        sheet: u32,
        thresholds: &[IconThreshold],
        show_value: bool,
        ranges: &[(i32, i32, i32, i32)],
    ) {
        if thresholds.is_empty() {
            return;
        }
        let values = self.collect_numeric_values(sheet, ranges);
        let stops: Vec<(f64, bool)> = thresholds
            .iter()
            .map(|t| (self.resolve_cfvo(&t.cfvo, &values, sheet), t.is_strict))
            .collect();
        let n = thresholds.len();

        for &(r1, c1, r2, c2) in ranges {
            for row in r1..=r2 {
                for col in c1..=c2 {
                    if let Ok(CellValue::Number(v)) = self.get_cell_value_by_index(sheet, row, col)
                    {
                        let idx = (compute_icon_index(v, &stops) as usize).min(n - 1);
                        self.update_cf_cache(
                            sheet,
                            row,
                            col,
                            CfCellResult::Icon {
                                icon: thresholds[idx].icon.clone(),
                                color: thresholds[idx].color.clone(),
                                show_value,
                            },
                            false,
                        );
                    }
                }
            }
        }
    }

    fn apply_cf_icon_rating(
        &mut self,
        sheet: u32,
        icon: &Icon,
        color: &Color,
        thresholds: &[(Cfvo, bool)],
        show_value: bool,
        ranges: &[(i32, i32, i32, i32)],
    ) {
        if thresholds.is_empty() {
            return;
        }
        // Thresholds are stored lowest-value-first. count = how many thresholds the
        // cell value exceeds; count ∈ [0, max] where max = thresholds.len().
        // is_strict=true → threshold applies when v >= value (gte).
        // is_strict=false → threshold applies when v > value (gt).
        let max = thresholds.len() as u32;

        let values = self.collect_numeric_values(sheet, ranges);
        // Pre-resolve all Cfvo entries before iterating cells.
        let resolved: Vec<(f64, bool)> = thresholds
            .iter()
            .map(|(cfvo, is_strict)| (self.resolve_cfvo(cfvo, &values, sheet), *is_strict))
            .collect();

        for &(r1, c1, r2, c2) in ranges {
            for row in r1..=r2 {
                for col in c1..=c2 {
                    if let Ok(CellValue::Number(v)) = self.get_cell_value_by_index(sheet, row, col)
                    {
                        let mut count = 0u32;
                        for &(threshold_val, is_strict) in resolved.iter().rev() {
                            let exceeds = if is_strict {
                                v >= threshold_val
                            } else {
                                v > threshold_val
                            };
                            if exceeds {
                                count += 1;
                            }
                        }
                        self.update_cf_cache(
                            sheet,
                            row,
                            col,
                            CfCellResult::Rating {
                                icon: icon.clone(),
                                count: count.min(max),
                                max,
                                color: color.clone(),
                                show_value,
                            },
                            false,
                        );
                    }
                }
            }
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn apply_cf_cell_is(
        &mut self,
        sheet: u32,
        operator: &ValueOperator,
        formula: &str,
        formula2: Option<&str>,
        dxf_id: u32,
        stop_if_true: bool,
        ranges: &[(i32, i32, i32, i32)],
    ) {
        let threshold = match self.evaluate_formula(formula, sheet) {
            Some(v) => v,
            None => return,
        };
        let threshold2 = formula2.and_then(|f| self.evaluate_formula(f, sheet));

        for &(r1, c1, r2, c2) in ranges {
            for row in r1..=r2 {
                for col in c1..=c2 {
                    if let Ok(CellValue::Number(v)) = self.get_cell_value_by_index(sheet, row, col)
                    {
                        let matches = match operator {
                            ValueOperator::Equal => (v - threshold).abs() < f64::EPSILON,
                            ValueOperator::GreaterThan => v > threshold,
                            ValueOperator::GreaterThanOrEqual => v >= threshold,
                            ValueOperator::LessThan => v < threshold,
                            ValueOperator::LessThanOrEqual => v <= threshold,
                            ValueOperator::NotEqual => (v - threshold).abs() >= f64::EPSILON,
                            ValueOperator::Between => {
                                let t2 = threshold2.unwrap_or(threshold);
                                v >= threshold.min(t2) && v <= threshold.max(t2)
                            }
                            ValueOperator::NotBetween => {
                                let t2 = threshold2.unwrap_or(threshold);
                                v < threshold.min(t2) || v > threshold.max(t2)
                            }
                        };
                        if matches {
                            self.update_cf_cache(
                                sheet,
                                row,
                                col,
                                CfCellResult::Dxf(dxf_id),
                                stop_if_true,
                            );
                        }
                    }
                }
            }
        }
    }

    fn apply_cf_average(
        &mut self,
        sheet: u32,
        dxf_id: u32,
        above: bool,
        stop_if_true: bool,
        ranges: &[(i32, i32, i32, i32)],
    ) {
        let values = self.collect_numeric_values(sheet, ranges);
        if values.is_empty() {
            return;
        }
        let avg = values.iter().sum::<f64>() / values.len() as f64;

        for &(r1, c1, r2, c2) in ranges {
            for row in r1..=r2 {
                for col in c1..=c2 {
                    if let Ok(CellValue::Number(v)) = self.get_cell_value_by_index(sheet, row, col)
                    {
                        if (above && v > avg) || (!above && v < avg) {
                            self.update_cf_cache(
                                sheet,
                                row,
                                col,
                                CfCellResult::Dxf(dxf_id),
                                stop_if_true,
                            );
                        }
                    }
                }
            }
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn apply_cf_top_n(
        &mut self,
        sheet: u32,
        rank: u32,
        percent: bool,
        bottom: bool,
        dxf_id: u32,
        stop_if_true: bool,
        ranges: &[(i32, i32, i32, i32)],
    ) {
        let values = self.collect_numeric_values(sheet, ranges);
        if values.is_empty() {
            return;
        }
        let n = if percent {
            ((rank as f64 / 100.0) * values.len() as f64).ceil() as usize
        } else {
            rank as usize
        }
        .max(1);

        let mut sorted = values.clone();
        if bottom {
            sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        } else {
            sorted.sort_by(|a, b| b.partial_cmp(a).unwrap_or(std::cmp::Ordering::Equal));
        }
        let threshold = sorted[n.min(sorted.len()) - 1];

        for &(r1, c1, r2, c2) in ranges {
            for row in r1..=r2 {
                for col in c1..=c2 {
                    if let Ok(CellValue::Number(v)) = self.get_cell_value_by_index(sheet, row, col)
                    {
                        let matches = if bottom {
                            v <= threshold
                        } else {
                            v >= threshold
                        };
                        if matches {
                            self.update_cf_cache(
                                sheet,
                                row,
                                col,
                                CfCellResult::Dxf(dxf_id),
                                stop_if_true,
                            );
                        }
                    }
                }
            }
        }
    }

    fn apply_cf_text(
        &mut self,
        sheet: u32,
        operator: &TextOperator,
        value: &str,
        dxf_id: u32,
        stop_if_true: bool,
        ranges: &[(i32, i32, i32, i32)],
    ) {
        let search = value.to_lowercase();
        for &(r1, c1, r2, c2) in ranges {
            for row in r1..=r2 {
                for col in c1..=c2 {
                    if let Ok(CellValue::String(s)) = self.get_cell_value_by_index(sheet, row, col)
                    {
                        let cell_lower = s.to_lowercase();
                        let matches = match operator {
                            TextOperator::Contains => cell_lower.contains(search.as_str()),
                            TextOperator::DoesNotContain => !cell_lower.contains(search.as_str()),
                            TextOperator::BeginsWith => cell_lower.starts_with(search.as_str()),
                            TextOperator::EndsWith => cell_lower.ends_with(search.as_str()),
                            TextOperator::Equals => cell_lower == search.as_str(),
                        };
                        if matches {
                            self.update_cf_cache(
                                sheet,
                                row,
                                col,
                                CfCellResult::Dxf(dxf_id),
                                stop_if_true,
                            );
                        }
                    }
                }
            }
        }
    }

    /// Evaluates a boolean CF formula rule across the given ranges.
    ///
    /// The formula is parsed once using the top-left cell of the first range as the parse
    /// anchor.
    fn apply_cf_formula(
        &mut self,
        sheet: u32,
        formula: &str,
        dxf_id: u32,
        stop_if_true: bool,
        ranges: &[(i32, i32, i32, i32)],
    ) {
        // The parse anchor is the top-left of the bounding box of *all* areas:
        // the minimum row and minimum column across every range. For a
        // single-area rule this is just its top-left, but for a multiple-areas
        // rule like "D4:D8 B10:D10" the anchor is B4 (min row 4, min col 2),
        // not the first area's top-left (D4).
        let Some((anchor_row, anchor_col)) = ranges
            .iter()
            .map(|&(r1, c1, _, _)| (r1, c1))
            .reduce(|(r, c), (r1, c1)| (r.min(r1), c.min(c1)))
        else {
            return;
        };
        let body = formula.trim().strip_prefix('=').unwrap_or(formula.trim());
        if body.is_empty() {
            return;
        }
        let sheet_name = match self.workbook.worksheets.get(sheet as usize) {
            Some(ws) => ws.get_name(),
            None => return,
        };
        let context_rc = CellReferenceRC {
            sheet: sheet_name,
            row: anchor_row,
            column: anchor_col,
        };
        // CF formulas are stored internally in English.
        let node = self.parse_internal_formula(body, &context_rc);

        for &(r1, c1, r2, c2) in ranges {
            for row in r1..=r2 {
                for column in c1..=c2 {
                    let ctx = CellReferenceIndex { sheet, row, column };
                    let matches = match self.evaluate_node_in_context(&node, ctx) {
                        CalcResult::Number(n) => n != 0.0,
                        CalcResult::Boolean(b) => b,
                        _ => false,
                    };
                    if matches {
                        self.update_cf_cache(
                            sheet,
                            row,
                            column,
                            CfCellResult::Dxf(dxf_id),
                            stop_if_true,
                        );
                    }
                }
            }
        }
    }

    fn apply_cf_unique_values(
        &mut self,
        sheet: u32,
        dxf_id: u32,
        stop_if_true: bool,
        ranges: &[(i32, i32, i32, i32)],
    ) {
        let mut counts: HashMap<String, u32> = HashMap::new();
        for &(r1, c1, r2, c2) in ranges {
            for row in r1..=r2 {
                for col in c1..=c2 {
                    if let Ok(v) = self.get_cell_value_by_index(sheet, row, col) {
                        if let Some(k) = cell_value_key(&v) {
                            *counts.entry(k).or_insert(0) += 1;
                        }
                    }
                }
            }
        }
        for &(r1, c1, r2, c2) in ranges {
            for row in r1..=r2 {
                for col in c1..=c2 {
                    if let Ok(v) = self.get_cell_value_by_index(sheet, row, col) {
                        if let Some(k) = cell_value_key(&v) {
                            if counts.get(&k).copied().unwrap_or(0) == 1 {
                                self.update_cf_cache(
                                    sheet,
                                    row,
                                    col,
                                    CfCellResult::Dxf(dxf_id),
                                    stop_if_true,
                                );
                            }
                        }
                    }
                }
            }
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn apply_cf_time_period(
        &mut self,
        sheet: u32,
        period: &PeriodType,
        date1: Option<&str>,
        date2: Option<&str>,
        dxf_id: u32,
        stop_if_true: bool,
        ranges: &[(i32, i32, i32, i32)],
    ) {
        let today_serial = match crate::tz::excel_serial_for_now(&self.tz) {
            Some(s) => s.floor() as i64,
            None => return,
        };
        let today = match from_excel_date(today_serial) {
            Ok(d) => d,
            Err(_) => return,
        };

        let serial_of = |d: NaiveDate| -> f64 {
            date_to_serial_number(d.day(), d.month(), d.year()).unwrap_or(0) as f64
        };

        let range: (f64, f64) = match period {
            PeriodType::Yesterday => {
                let s = today_serial as f64 - 1.0;
                (s, s)
            }
            PeriodType::Today => (today_serial as f64, today_serial as f64),
            PeriodType::Tomorrow => {
                let s = today_serial as f64 + 1.0;
                (s, s)
            }
            PeriodType::Last7Days => (today_serial as f64 - 6.0, today_serial as f64),
            PeriodType::Next7Days => (today_serial as f64, today_serial as f64 + 6.0),
            PeriodType::LastWeek => {
                let dow = today.weekday().num_days_from_monday() as i64;
                let this_mon = today - Duration::days(dow);
                let last_mon = this_mon - Duration::days(7);
                let last_sun = this_mon - Duration::days(1);
                (serial_of(last_mon), serial_of(last_sun))
            }
            PeriodType::ThisWeek => {
                let dow = today.weekday().num_days_from_monday() as i64;
                let this_mon = today - Duration::days(dow);
                let this_sun = this_mon + Duration::days(6);
                (serial_of(this_mon), serial_of(this_sun))
            }
            PeriodType::NextWeek => {
                let dow = today.weekday().num_days_from_monday() as i64;
                let next_mon = today - Duration::days(dow) + Duration::days(7);
                let next_sun = next_mon + Duration::days(6);
                (serial_of(next_mon), serial_of(next_sun))
            }
            PeriodType::LastMonth => {
                let Some(this_month_start) =
                    NaiveDate::from_ymd_opt(today.year(), today.month(), 1)
                else {
                    return;
                };
                let last_month_end = this_month_start - Duration::days(1);
                let Some(last_month_start) =
                    NaiveDate::from_ymd_opt(last_month_end.year(), last_month_end.month(), 1)
                else {
                    return;
                };
                (serial_of(last_month_start), serial_of(last_month_end))
            }
            PeriodType::ThisMonth => {
                let Some(start) = NaiveDate::from_ymd_opt(today.year(), today.month(), 1) else {
                    return;
                };
                let end = start + Months::new(1) - Duration::days(1);
                (serial_of(start), serial_of(end))
            }
            PeriodType::NextMonth => {
                let Some(this_start) = NaiveDate::from_ymd_opt(today.year(), today.month(), 1)
                else {
                    return;
                };
                let next_start = this_start + Months::new(1);
                let next_end = next_start + Months::new(1) - Duration::days(1);
                (serial_of(next_start), serial_of(next_end))
            }
            PeriodType::LastYear => {
                let y = today.year() - 1;
                let Some(start) = NaiveDate::from_ymd_opt(y, 1, 1) else {
                    return;
                };
                let Some(end) = NaiveDate::from_ymd_opt(y, 12, 31) else {
                    return;
                };
                (serial_of(start), serial_of(end))
            }
            PeriodType::ThisYear => {
                let y = today.year();
                let Some(start) = NaiveDate::from_ymd_opt(y, 1, 1) else {
                    return;
                };
                let Some(end) = NaiveDate::from_ymd_opt(y, 12, 31) else {
                    return;
                };
                (serial_of(start), serial_of(end))
            }
            PeriodType::NextYear => {
                let y = today.year() + 1;
                let Some(start) = NaiveDate::from_ymd_opt(y, 1, 1) else {
                    return;
                };
                let Some(end) = NaiveDate::from_ymd_opt(y, 12, 31) else {
                    return;
                };
                (serial_of(start), serial_of(end))
            }
            PeriodType::Between | PeriodType::NotBetween => {
                let (Some(d1), Some(d2)) = (date1, date2) else {
                    return;
                };
                let (Some(s1), Some(s2)) = (parse_cf_date_bound(d1), parse_cf_date_bound(d2))
                else {
                    return;
                };
                (s1.min(s2), s1.max(s2))
            }
        };
        let negate = matches!(period, PeriodType::NotBetween);

        for &(r1, c1, r2, c2) in ranges {
            for row in r1..=r2 {
                for col in c1..=c2 {
                    if let Ok(CellValue::Number(v)) = self.get_cell_value_by_index(sheet, row, col)
                    {
                        let day = v.floor();
                        let inside = day >= range.0 && day <= range.1;
                        if inside != negate {
                            self.update_cf_cache(
                                sheet,
                                row,
                                col,
                                CfCellResult::Dxf(dxf_id),
                                stop_if_true,
                            );
                        }
                    }
                }
            }
        }
    }

    fn apply_cf_duplicate_values(
        &mut self,
        sheet: u32,
        dxf_id: u32,
        stop_if_true: bool,
        ranges: &[(i32, i32, i32, i32)],
    ) {
        let mut counts: HashMap<String, u32> = HashMap::new();
        for &(r1, c1, r2, c2) in ranges {
            for row in r1..=r2 {
                for col in c1..=c2 {
                    if let Ok(v) = self.get_cell_value_by_index(sheet, row, col) {
                        let key = cell_value_key(&v);
                        if let Some(k) = key {
                            *counts.entry(k).or_insert(0) += 1;
                        }
                    }
                }
            }
        }
        for &(r1, c1, r2, c2) in ranges {
            for row in r1..=r2 {
                for col in c1..=c2 {
                    if let Ok(v) = self.get_cell_value_by_index(sheet, row, col) {
                        if let Some(k) = cell_value_key(&v) {
                            if counts.get(&k).copied().unwrap_or(0) > 1 {
                                self.update_cf_cache(
                                    sheet,
                                    row,
                                    col,
                                    CfCellResult::Dxf(dxf_id),
                                    stop_if_true,
                                );
                            }
                        }
                    }
                }
            }
        }
    }

    fn apply_cf_blanks(
        &mut self,
        sheet: u32,
        dxf_id: u32,
        invert: bool,
        stop_if_true: bool,
        ranges: &[(i32, i32, i32, i32)],
    ) {
        for &(r1, c1, r2, c2) in ranges {
            for row in r1..=r2 {
                for col in c1..=c2 {
                    let is_blank = matches!(
                        self.get_cell_value_by_index(sheet, row, col),
                        Ok(CellValue::None)
                    );
                    if is_blank != invert {
                        self.update_cf_cache(
                            sheet,
                            row,
                            col,
                            CfCellResult::Dxf(dxf_id),
                            stop_if_true,
                        );
                    }
                }
            }
        }
    }

    fn apply_cf_errors(
        &mut self,
        sheet: u32,
        dxf_id: u32,
        invert: bool,
        stop_if_true: bool,
        ranges: &[(i32, i32, i32, i32)],
    ) {
        use crate::types::CellType;
        for &(r1, c1, r2, c2) in ranges {
            for row in r1..=r2 {
                for col in c1..=c2 {
                    let is_error = self
                        .workbook
                        .worksheet(sheet)
                        .ok()
                        .and_then(|ws| ws.cell(row, col))
                        .is_some_and(|c| c.get_type() == CellType::ErrorValue);
                    if is_error != invert {
                        self.update_cf_cache(
                            sheet,
                            row,
                            col,
                            CfCellResult::Dxf(dxf_id),
                            stop_if_true,
                        );
                    }
                }
            }
        }
    }

    // -----------------------------------------------------------------------

    /// Returns the extended cell style for (`sheet`, `row`, `column`), including
    /// any conditional-formatting overlay computed by the last evaluate() call.
    pub fn get_extended_style_for_cell(
        &self,
        sheet: u32,
        row: i32,
        column: i32,
    ) -> Result<ExtendedStyle, String> {
        let base = self.get_style_for_cell(sheet, row, column)?;
        let extended = match self.cf_cache.get(&(sheet, row, column)) {
            Some(c) => c,
            None => {
                return Ok(ExtendedStyle {
                    style: base,
                    icon: None,
                    data_bar: None,
                    rating: None,
                })
            }
        };
        let mut style = base;
        let mut icon = None;
        let mut data_bar = None;
        let mut rating = None;
        // `extended` contains the cached conditional-formatting results for this cell in the
        // order produced by the evaluator. Dxf results accumulate as we iterate; for exclusive
        // types (ColorScale, DataBar, Icon, Rating), the last assignment in this evaluated
        // result order wins.
        for cf_result in extended {
            match cf_result {
                CfCellResult::Dxf(dxf_id) => {
                    if let Some(dxf) = self.workbook.styles.dxfs.get(*dxf_id as usize) {
                        style = dxf.apply_to(&style);
                    }
                }
                CfCellResult::ColorScale(color) => {
                    style.fill.color = color.clone();
                }
                CfCellResult::DataBar {
                    positive_color,
                    negative_color,
                    is_gradient,
                    value,
                    axis_position,
                    show_value,
                } => {
                    data_bar = Some(CfDataBar {
                        positive_color: positive_color.clone(),
                        negative_color: negative_color.clone(),
                        is_gradient: *is_gradient,
                        value: *value,
                        axis_position: *axis_position,
                        show_value: *show_value,
                    });
                }
                CfCellResult::Icon {
                    icon: cf_icon,
                    color,
                    show_value,
                } => {
                    icon = Some(CfIcon {
                        icon: cf_icon.clone(),
                        color: color.clone(),
                        show_value: *show_value,
                    });
                }
                CfCellResult::Rating {
                    icon: cf_icon,
                    count,
                    max,
                    color,
                    show_value,
                } => {
                    rating = Some(CfRating {
                        icon: cf_icon.clone(),
                        count: *count,
                        max: *max,
                        color: color.clone(),
                        show_value: *show_value,
                    });
                }
            }
        }
        Ok(ExtendedStyle {
            style,
            icon,
            data_bar,
            rating,
        })
    }

    // -----------------------------------------------------------------------
    // CRUD API for conditional formatting rules
    // -----------------------------------------------------------------------

    /// Appends `dxf` to the workbook's dxf table and returns its new index.
    fn create_dxf(&mut self, dxf: Dxf) -> u32 {
        let id = self.workbook.styles.dxfs.len() as u32;
        self.workbook.styles.dxfs.push(dxf);
        id
    }

    /// Converts a `CfRuleInput` into a stored `CfRule`, creating a dxf entry when a format is provided.
    fn cf_rule_from_input(&mut self, rule: CfRuleInput) -> CfRule {
        match rule {
            CfRuleInput::ColorScale { thresholds } => CfRule::ColorScale { thresholds },
            CfRuleInput::CellIs {
                operator,
                formula,
                formula2,
                format,
                stop_if_true,
            } => CfRule::CellIs {
                operator,
                formula,
                formula2,
                dxf_id: self.create_dxf(format),
                stop_if_true,
            },
            CfRuleInput::Text {
                operator,
                value,
                format,
                stop_if_true,
            } => CfRule::Text {
                operator,
                value,
                dxf_id: self.create_dxf(format),
                stop_if_true,
            },
            CfRuleInput::Formula {
                formula,
                format,
                stop_if_true,
            } => CfRule::Formula {
                formula,
                dxf_id: self.create_dxf(format),
                stop_if_true,
            },
            CfRuleInput::TimePeriod {
                time_period,
                date1,
                date2,
                format,
                stop_if_true,
            } => CfRule::TimePeriod {
                time_period,
                date1,
                date2,
                dxf_id: self.create_dxf(format),
                stop_if_true,
            },
            CfRuleInput::DuplicateValues {
                format,
                stop_if_true,
            } => CfRule::DuplicateValues {
                dxf_id: self.create_dxf(format),
                stop_if_true,
            },
            CfRuleInput::UniqueValues {
                format,
                stop_if_true,
            } => CfRule::UniqueValues {
                dxf_id: self.create_dxf(format),
                stop_if_true,
            },
            CfRuleInput::Blanks {
                format,
                stop_if_true,
            } => CfRule::Blanks {
                dxf_id: self.create_dxf(format),
                stop_if_true,
            },
            CfRuleInput::NotBlanks {
                format,
                stop_if_true,
            } => CfRule::NotBlanks {
                dxf_id: self.create_dxf(format),
                stop_if_true,
            },
            CfRuleInput::Errors {
                format,
                stop_if_true,
            } => CfRule::Errors {
                dxf_id: self.create_dxf(format),
                stop_if_true,
            },
            CfRuleInput::NoErrors {
                format,
                stop_if_true,
            } => CfRule::NoErrors {
                dxf_id: self.create_dxf(format),
                stop_if_true,
            },
            CfRuleInput::AboveAverage {
                format,
                stop_if_true,
            } => CfRule::AboveAverage {
                dxf_id: self.create_dxf(format),
                stop_if_true,
            },
            CfRuleInput::BelowAverage {
                format,
                stop_if_true,
            } => CfRule::BelowAverage {
                dxf_id: self.create_dxf(format),
                stop_if_true,
            },
            CfRuleInput::Top10 {
                rank,
                percent,
                format,
                stop_if_true,
            } => CfRule::Top10 {
                rank,
                percent,
                dxf_id: self.create_dxf(format),
                stop_if_true,
            },
            CfRuleInput::Bottom10 {
                rank,
                percent,
                format,
                stop_if_true,
            } => CfRule::Bottom10 {
                rank,
                percent,
                dxf_id: self.create_dxf(format),
                stop_if_true,
            },
            CfRuleInput::DataBar {
                min,
                max,
                positive_color,
                negative_color,
                is_gradient,
                show_value,
            } => CfRule::DataBar {
                min,
                max,
                positive_color,
                negative_color,
                is_gradient,
                show_value,
            },
            CfRuleInput::IconSet {
                thresholds,
                show_value,
            } => CfRule::IconSet {
                thresholds,
                show_value,
            },
            CfRuleInput::IconRating {
                icon,
                color,
                thresholds,
                show_value,
            } => CfRule::IconRating {
                icon,
                color,
                thresholds,
                show_value,
            },
        }
    }

    /// The anchor used to parse/stringify a conditional-formatting formula on
    /// `sheet`. References round trip identically regardless of the anchor, so a
    /// fixed A1 anchor is enough.
    fn cf_formula_context(&self, sheet: u32) -> CellReferenceRC {
        let sheet_name = self
            .workbook
            .worksheets
            .get(sheet as usize)
            .map(|w| w.get_name())
            .unwrap_or_default();
        CellReferenceRC {
            sheet: sheet_name,
            row: 1,
            column: 1,
        }
    }

    /// Translates every formula in a CF rule input from the active
    /// language/locale into the internal English representation that is stored.
    ///
    /// This runs before the rule is materialized (and before any dxf entry is
    /// created), so an invalid formula fails the whole operation without leaving
    /// behind an orphan dxf or storing a non-canonical formula that would later
    /// fail to parse as English.
    fn cf_rule_input_to_internal(
        &mut self,
        rule: &mut CfRuleInput,
        sheet: u32,
    ) -> Result<(), String> {
        let ctx = self.cf_formula_context(sheet);
        match rule {
            CfRuleInput::CellIs {
                formula, formula2, ..
            } => {
                *formula = self.user_formula_to_internal(formula, &ctx)?;
                if let Some(f2) = formula2 {
                    *f2 = self.user_formula_to_internal(f2, &ctx)?;
                }
            }
            CfRuleInput::Formula { formula, .. } => {
                *formula = self.user_formula_to_internal(formula, &ctx)?;
            }
            CfRuleInput::ColorScale { thresholds } => {
                for t in thresholds {
                    self.cfvo_to_internal(&mut t.cfvo, &ctx)?;
                }
            }
            CfRuleInput::DataBar { min, max, .. } => {
                if let Some(min) = min {
                    self.cfvo_to_internal(min, &ctx)?;
                }
                if let Some(max) = max {
                    self.cfvo_to_internal(max, &ctx)?;
                }
            }
            CfRuleInput::IconSet { thresholds, .. } => {
                for t in thresholds {
                    self.cfvo_to_internal(&mut t.cfvo, &ctx)?;
                }
            }
            CfRuleInput::IconRating { thresholds, .. } => {
                for (cfvo, _) in thresholds {
                    self.cfvo_to_internal(cfvo, &ctx)?;
                }
            }
            // Remaining rule kinds carry no formula strings.
            _ => {}
        }
        Ok(())
    }

    fn cfvo_to_internal(&mut self, cfvo: &mut Cfvo, ctx: &CellReferenceRC) -> Result<(), String> {
        if let Cfvo::Formula(f) = cfvo {
            *f = self.user_formula_to_internal(f, ctx)?;
        }
        Ok(())
    }

    /// Translates every formula in a CF rule from the internal English
    /// representation into the active language/locale for display.
    fn cf_rule_to_display(&self, rule: &mut CfRule, sheet: u32) {
        let ctx = self.cf_formula_context(sheet);
        match rule {
            CfRule::CellIs {
                formula, formula2, ..
            } => {
                *formula = self.internal_formula_to_display(formula, &ctx);
                if let Some(f2) = formula2 {
                    *f2 = self.internal_formula_to_display(f2, &ctx);
                }
            }
            CfRule::Formula { formula, .. } => {
                *formula = self.internal_formula_to_display(formula, &ctx);
            }
            CfRule::ColorScale { thresholds } => {
                for t in thresholds {
                    self.cfvo_to_display(&mut t.cfvo, &ctx);
                }
            }
            CfRule::DataBar { min, max, .. } => {
                if let Some(min) = min {
                    self.cfvo_to_display(min, &ctx);
                }
                if let Some(max) = max {
                    self.cfvo_to_display(max, &ctx);
                }
            }
            CfRule::IconSet { thresholds, .. } => {
                for t in thresholds {
                    self.cfvo_to_display(&mut t.cfvo, &ctx);
                }
            }
            CfRule::IconRating { thresholds, .. } => {
                for (cfvo, _) in thresholds {
                    self.cfvo_to_display(cfvo, &ctx);
                }
            }
            _ => {}
        }
    }

    fn cfvo_to_display(&self, cfvo: &mut Cfvo, ctx: &CellReferenceRC) {
        if let Cfvo::Formula(f) = cfvo {
            *f = self.internal_formula_to_display(f, ctx);
        }
    }

    /// Returns all CF rules for the given sheet, sorted by priority descending
    /// (highest priority first).
    ///
    /// Each entry carries its `index` into the worksheet's stored
    /// `conditional_formatting` vector so callers can pass it back to the
    /// index-based mutators ([`Self::get_dxf_for_conditional_formatting`],
    /// [`Self::update_conditional_formatting`], [`Self::delete_conditional_formatting`],
    /// [`Self::raise_conditional_formatting_priority`],
    /// [`Self::lower_conditional_formatting_priority`]) without having to infer the
    /// index from the display position.
    ///
    /// Formulas are stored internally in English; they are translated into the
    /// active language/locale for display.
    pub fn get_conditional_formatting_list(
        &self,
        sheet: u32,
    ) -> Result<Vec<ConditionalFormattingView>, String> {
        let mut list: Vec<(usize, ConditionalFormatting)> = self
            .workbook
            .worksheet(sheet)?
            .conditional_formatting
            .iter()
            .cloned()
            .enumerate()
            .collect();
        // sort by priority descending (highest first)
        list.sort_by_key(|(_, cf)| std::cmp::Reverse(cf.priority));
        let mut result = Vec::with_capacity(list.len());
        for (index, mut cf) in list {
            self.cf_rule_to_display(&mut cf.cf_rule, sheet);
            result.push(ConditionalFormattingView {
                index,
                range: cf.range,
                cf_rule: cf.cf_rule,
                priority: cf.priority,
            });
        }
        Ok(result)
    }

    /// Returns the differential format (Dxf) for the CF rule at `index` on `sheet`,
    /// or `None` if the rule type has no dxf (e.g. ColorScale, DataBar, IconSet).
    pub fn get_dxf_for_conditional_formatting(
        &self,
        sheet: u32,
        index: usize,
    ) -> Result<Option<Dxf>, String> {
        let ws = self.workbook.worksheet(sheet)?;
        let cf = ws
            .conditional_formatting
            .get(index)
            .ok_or_else(|| format!("Conditional formatting index {index} out of bounds"))?;
        let dxf_id = match &cf.cf_rule {
            CfRule::CellIs { dxf_id, .. }
            | CfRule::Text { dxf_id, .. }
            | CfRule::TimePeriod { dxf_id, .. }
            | CfRule::DuplicateValues { dxf_id, .. }
            | CfRule::UniqueValues { dxf_id, .. }
            | CfRule::Blanks { dxf_id, .. }
            | CfRule::NotBlanks { dxf_id, .. }
            | CfRule::Errors { dxf_id, .. }
            | CfRule::NoErrors { dxf_id, .. }
            | CfRule::AboveAverage { dxf_id, .. }
            | CfRule::BelowAverage { dxf_id, .. }
            | CfRule::Top10 { dxf_id, .. }
            | CfRule::Bottom10 { dxf_id, .. }
            | CfRule::Formula { dxf_id, .. } => *dxf_id,
            _ => return Ok(None),
        };
        Ok(self.workbook.styles.dxfs.get(dxf_id as usize).cloned())
    }

    /// Adds a new CF rule to `sheet`, appended with priority = 1 + current max.
    /// Returns the assigned priority.
    pub fn add_conditional_formatting(
        &mut self,
        sheet: u32,
        range: &str,
        rule: CfRuleInput,
    ) -> Result<u32, String> {
        if parse_sqref(range).is_empty() {
            return Err(format!("Invalid conditional formatting range: '{range}'"));
        }
        // Formulas are stored internally in English regardless of the user's
        // active language. Translate before materializing the rule so an invalid
        // formula fails without creating an orphan dxf.
        let mut rule = rule;
        self.cf_rule_input_to_internal(&mut rule, sheet)?;
        let final_rule = self.cf_rule_from_input(rule);
        let ws = self.workbook.worksheet_mut(sheet)?;
        let priority = ws
            .conditional_formatting
            .iter()
            .map(|cf| cf.priority)
            .max()
            .map(|m| m + 1)
            .unwrap_or(1);
        ws.conditional_formatting.push(ConditionalFormatting {
            range: range.to_string(),
            cf_rule: final_rule,
            priority,
        });
        Ok(priority)
    }

    /// Removes the CF rule at `index` from `sheet`.  Returns the removed rule.
    pub fn delete_conditional_formatting(
        &mut self,
        sheet: u32,
        index: usize,
    ) -> Result<crate::cf_types::ConditionalFormatting, String> {
        let ws = self.workbook.worksheet_mut(sheet)?;
        if index >= ws.conditional_formatting.len() {
            return Err(format!(
                "Conditional formatting index {index} out of bounds"
            ));
        }
        Ok(ws.conditional_formatting.remove(index))
    }

    /// Replaces the range and rule of the CF entry at `index` on `sheet`.
    /// The priority is preserved.  Returns the previous entry.
    pub fn update_conditional_formatting(
        &mut self,
        sheet: u32,
        index: usize,
        new_range: &str,
        new_rule: CfRuleInput,
    ) -> Result<ConditionalFormatting, String> {
        if parse_sqref(new_range).is_empty() {
            return Err(format!(
                "Invalid conditional formatting range: '{new_range}'"
            ));
        }
        // Formulas are stored internally in English regardless of the user's
        // active language. Translate before materializing the rule so an invalid
        // formula fails without creating an orphan dxf.
        let mut new_rule = new_rule;
        self.cf_rule_input_to_internal(&mut new_rule, sheet)?;
        let final_rule = self.cf_rule_from_input(new_rule);
        let ws = self.workbook.worksheet_mut(sheet)?;
        if index >= ws.conditional_formatting.len() {
            return Err(format!(
                "Conditional formatting index {index} out of bounds"
            ));
        }
        let old = ws.conditional_formatting[index].clone();
        ws.conditional_formatting[index].range = new_range.to_string();
        ws.conditional_formatting[index].cf_rule = final_rule;
        Ok(old)
    }

    /// Raises the priority of the CF rule at `index` on `sheet`.
    ///
    /// In IronCalc a higher priority *number* means higher priority. Raising a
    /// rule swaps its priority with the rule that has the next-higher priority
    /// number (the closest rule above it). If the rule is already the
    /// highest-priority one, this is a no-op.
    pub fn raise_conditional_formatting_priority(
        &mut self,
        sheet: u32,
        index: usize,
    ) -> Result<(), String> {
        let ws = self.workbook.worksheet_mut(sheet)?;
        if index >= ws.conditional_formatting.len() {
            return Err(format!(
                "Conditional formatting index {index} out of bounds"
            ));
        }
        let current = ws.conditional_formatting[index].priority;
        // The neighbour is the rule with the smallest priority strictly greater
        // than `current`.
        let neighbour = ws
            .conditional_formatting
            .iter()
            .enumerate()
            .filter(|(_, cf)| cf.priority > current)
            .min_by_key(|(_, cf)| cf.priority)
            .map(|(i, _)| i);
        if let Some(j) = neighbour {
            let other = ws.conditional_formatting[j].priority;
            ws.conditional_formatting[j].priority = current;
            ws.conditional_formatting[index].priority = other;
        }
        Ok(())
    }

    /// Lowers the priority of the CF rule at `index` on `sheet`.
    ///
    /// In IronCalc a higher priority *number* means higher priority. Lowering a
    /// rule swaps its priority with the rule that has the next-lower priority
    /// number (the closest rule below it). If the rule is already the
    /// lowest-priority one, this is a no-op.
    pub fn lower_conditional_formatting_priority(
        &mut self,
        sheet: u32,
        index: usize,
    ) -> Result<(), String> {
        let ws = self.workbook.worksheet_mut(sheet)?;
        if index >= ws.conditional_formatting.len() {
            return Err(format!(
                "Conditional formatting index {index} out of bounds"
            ));
        }
        let current = ws.conditional_formatting[index].priority;
        // The neighbour is the rule with the largest priority strictly less than
        // `current`.
        let neighbour = ws
            .conditional_formatting
            .iter()
            .enumerate()
            .filter(|(_, cf)| cf.priority < current)
            .max_by_key(|(_, cf)| cf.priority)
            .map(|(i, _)| i);
        if let Some(j) = neighbour {
            let other = ws.conditional_formatting[j].priority;
            ws.conditional_formatting[j].priority = current;
            ws.conditional_formatting[index].priority = other;
        }
        Ok(())
    }

    /// Inserts a CF entry at `index` without modifying priority (used for undo/redo).
    pub(crate) fn insert_conditional_formatting_at(
        &mut self,
        sheet: u32,
        index: usize,
        cf: crate::cf_types::ConditionalFormatting,
    ) -> Result<(), String> {
        let ws = self.workbook.worksheet_mut(sheet)?;
        if index > ws.conditional_formatting.len() {
            return Err(format!(
                "Conditional formatting index {index} out of bounds"
            ));
        }
        ws.conditional_formatting.insert(index, cf);
        Ok(())
    }
}
