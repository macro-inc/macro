use chrono::{Datelike, NaiveDate};

use crate::{
    calc_result::CalcResult,
    expressions::{parser::Node, token::Error, types::CellReferenceIndex},
    formatter::dates::from_excel_date,
    model::Model,
};

use super::accrint::acc_days_between;

// ---------------------------------------------------------------------------
// VDB / AMORDEGRC / AMORLINC
//
// Port of the depreciation calculations as implemented in the
// `ExcelFinancialFunctions` library (depreciation.fs).
// See https://github.com/fsprojects/ExcelFinancialFunctions
// ---------------------------------------------------------------------------

// `totalDepr`: cumulative depreciation between period 0 and `period`.
//
// Walks the declining-balance schedule one (integer) period at a time,
// optionally switching to straight line when that yields a larger amount,
// and prorates the contribution of the period that contains the fractional
// part of `period`.
fn vdb_total_depr(
    cost: f64,
    salvage: f64,
    life: f64,
    period: f64,
    factor: f64,
    straight_line: bool,
) -> f64 {
    let frac = period - period.trunc();
    let int_period = period.trunc() as i64;
    let int_life = life.trunc() as i64;

    let ddb_formula = |tot: f64| ((cost - tot) * (factor / life)).min(cost - salvage - tot);
    let sln_formula = |tot: f64, a_period: f64| (cost - tot - salvage) / (life - a_period);

    let mut tot_depr = 0.0;
    let mut per = 0.0_f64;
    loop {
        let ddb_depr = ddb_formula(tot_depr);
        let sln_depr = sln_formula(tot_depr, per);
        let is_sln = straight_line && ddb_depr < sln_depr;
        let depr = if is_sln { sln_depr } else { ddb_depr };
        let new_total = tot_depr + depr;

        if int_period == 0 {
            return new_total * frac;
        } else if per.trunc() as i64 == int_period - 1 {
            let ddb_next = ddb_formula(new_total);
            let sln_next = sln_formula(new_total, per + 1.0);
            let is_sln_next = straight_line && ddb_next < sln_next;
            let depr_next = if is_sln_next {
                if int_period == int_life {
                    0.0
                } else {
                    sln_next
                }
            } else {
                ddb_next
            };
            return new_total + depr_next * frac;
        } else {
            tot_depr = new_total;
            per += 1.0;
        }
    }
}

fn vdb_depr_between(
    cost: f64,
    salvage: f64,
    life: f64,
    start_period: f64,
    end_period: f64,
    factor: f64,
    straight_line: bool,
) -> f64 {
    vdb_total_depr(cost, salvage, life, end_period, factor, straight_line)
        - vdb_total_depr(cost, salvage, life, start_period, factor, straight_line)
}

// `db`: fixed-declining-balance depreciation for a single `period`.
pub(super) fn db_depreciation(cost: f64, salvage: f64, life: f64, period: f64, month: f64) -> f64 {
    // The depreciation rate, rounded to three decimal places.
    let rate = ((1.0 - (salvage / cost).powf(1.0 / life)) * 1000.0).round() / 1000.0;
    let int_period = period.trunc() as i64;
    let int_life = life.trunc() as i64;

    // First period (also covers a fractional period below 1).
    let mut accumulated = cost * rate * month / 12.0;
    if int_period <= 1 {
        return accumulated;
    }
    // Accumulate the declining balance through the period before the one asked.
    for _ in 2..int_period {
        accumulated += (cost - accumulated) * rate;
    }
    if int_period == int_life + 1 {
        (cost - accumulated) * rate * (12.0 - month) / 12.0
    } else {
        (cost - accumulated) * rate
    }
}

// `ddb`: double-declining-balance depreciation for a single `period`.
// (see LibreOffice's `ScGetDDB`)
pub(super) fn ddb_depreciation(
    cost: f64,
    salvage: f64,
    life: f64,
    period: f64,
    factor: f64,
) -> f64 {
    // Excel special-cases a fractional period in (0, 1), treating it as period 1
    // (`period` is already guaranteed > 0 by the caller's validation).
    let period = if period < 1.0 { 1.0 } else { period };

    let mut rate = factor / life;
    let old_value = if rate >= 1.0 {
        rate = 1.0;
        if period == 1.0 {
            cost
        } else {
            0.0
        }
    } else {
        cost * (1.0 - rate).powf(period - 1.0)
    };
    let new_value = cost * (1.0 - rate).powf(period);

    let ddb = if new_value < salvage {
        old_value - salvage
    } else {
        old_value - new_value
    };
    ddb.max(0.0)
}

fn is_leap_year(year: i32) -> bool {
    (year % 4 == 0 && year % 100 != 0) || year % 400 == 0
}

// `daysInYear` for the AMOR* functions. Actual/Actual (basis 1) uses the
// length of the calendar year that contains `date`; Actual/365 (basis 3)
// uses 365; the 30/360 bases (0 and 4) use 360. Actual/360 (basis 2) is
// rejected before reaching here.
fn amor_days_in_year(date: NaiveDate, basis: i32) -> f64 {
    match basis {
        1 => {
            if is_leap_year(date.year()) {
                366.0
            } else {
                365.0
            }
        }
        3 => 365.0,
        _ => 360.0,
    }
}

// `fix29February`: for the actual-day bases (1 and 3) a Feb 29 (or any late
// February day) is snapped to Feb 28 so leap days don't distort the day count.
fn amor_fix_29_february(d: NaiveDate, basis: i32) -> NaiveDate {
    if (basis == 1 || basis == 3) && is_leap_year(d.year()) && d.month() == 2 && d.day() >= 28 {
        // Feb 28 always exists.
        NaiveDate::from_ymd_opt(d.year(), 2, 28).unwrap_or(d)
    } else {
        d
    }
}

// `firstDeprLinc`: depreciation of the (possibly partial) first period and the
// resulting asset life. Returns `(first_depreciation, asset_life)`.
#[allow(clippy::too_many_arguments)]
fn amor_first_depr_linc(
    cost: f64,
    date_purchased: NaiveDate,
    first_period: NaiveDate,
    salvage: f64,
    rate: f64,
    ass_life: f64,
    basis: i32,
) -> Result<(f64, f64), String> {
    let days_in_yr = amor_days_in_year(date_purchased, basis);
    let date_purchased = amor_fix_29_february(date_purchased, basis);
    let first_period = amor_fix_29_february(first_period, basis);
    let first_len = acc_days_between(date_purchased, first_period, true, basis)?;
    let first_depr_temp = first_len / days_in_yr * rate * cost;
    let first_depr = if first_depr_temp == 0.0 {
        cost * rate
    } else {
        first_depr_temp
    };
    let asset_life = if first_depr_temp == 0.0 {
        ass_life
    } else {
        ass_life + 1.0
    };
    let avail_depr = cost - salvage;
    if first_depr > avail_depr {
        Ok((avail_depr, asset_life))
    } else {
        Ok((first_depr, asset_life))
    }
}

fn amor_linc(
    cost: f64,
    date_purchased: NaiveDate,
    first_period: NaiveDate,
    salvage: f64,
    period: f64,
    rate: f64,
    basis: i32,
) -> Result<f64, String> {
    let asset_life_temp = (1.0 / rate).ceil();
    if cost == salvage || period > asset_life_temp {
        return Ok(0.0);
    }
    let (first_depr, _) = amor_first_depr_linc(
        cost,
        date_purchased,
        first_period,
        salvage,
        rate,
        asset_life_temp,
        basis,
    )?;
    if period == 0.0 {
        return Ok(first_depr);
    }
    // findDepr: clamp the constant `rate * cost` depreciation to whatever is
    // still available, period after period.
    let mut depr = rate * cost;
    let mut avail = cost - salvage - first_depr;
    let mut counted = 1.0;
    while counted <= period {
        if depr > avail {
            depr = avail;
        }
        let avail_temp = avail - depr;
        avail = if avail_temp < 0.0 { 0.0 } else { avail_temp };
        counted += 1.0;
    }
    Ok(depr)
}

// Depreciation coefficient as a function of asset life (in years).
fn amor_depr_coeff(asset_life: f64) -> f64 {
    if (3.0..=4.0).contains(&asset_life) {
        1.5
    } else if (5.0..=6.0).contains(&asset_life) {
        2.0
    } else if asset_life > 6.0 {
        2.5
    } else {
        1.0
    }
}

fn amor_are_equal(x: f64, y: f64) -> bool {
    (x - y).abs() < 0.0001
}

// `round excelComplaint`: pre-round to 13 significant digits (Excel's internal
// precision) then round to the nearest integer, ties away from zero.
fn amor_round(x: f64) -> f64 {
    let k = (x * 1e13).round() / 1e13;
    k.round()
}

fn amor_degrc(
    cost: f64,
    date_purchased: NaiveDate,
    first_period: NaiveDate,
    salvage: f64,
    period: f64,
    rate: f64,
    basis: i32,
) -> Result<f64, String> {
    let ass_life = (1.0 / rate).ceil();
    if cost == salvage || period > ass_life {
        return Ok(0.0);
    }
    let depr_coeff = amor_depr_coeff(ass_life);
    let depr_r = rate * depr_coeff;
    let (first_depr_linc, asset_life) = amor_first_depr_linc(
        cost,
        date_purchased,
        first_period,
        salvage,
        depr_r,
        ass_life,
        basis,
    )?;
    let first_depr = amor_round(first_depr_linc);
    if period == 0.0 {
        return Ok(first_depr);
    }
    let mut counted = 1.0;
    let mut depr = 0.0;
    let mut depr_rate = depr_r;
    let mut remain_cost = cost - first_depr;
    while counted <= period {
        counted += 1.0;
        let calc_t = asset_life - counted;
        let depr_temp = if amor_are_equal(calc_t, 2.0) {
            remain_cost * 0.5
        } else {
            depr_rate * remain_cost
        };
        if amor_are_equal(calc_t, 2.0) {
            depr_rate = 1.0;
        }
        depr = if remain_cost < salvage {
            if remain_cost - salvage < 0.0 {
                0.0
            } else {
                remain_cost - salvage
            }
        } else {
            depr_temp
        };
        remain_cost -= depr;
    }
    Ok(amor_round(depr))
}

impl<'a> Model<'a> {
    // VDB(cost, salvage, life, start_period, end_period, [factor], [no_switch])
    //
    // Variable declining balance depreciation between `start_period` and
    // `end_period`. By default (no_switch = FALSE) the calculation switches to
    // straight-line depreciation when that is more advantageous; passing
    // no_switch = TRUE keeps it on declining balance throughout.
    pub(crate) fn fn_vdb(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        let arg_count = args.len();
        if !(5..=7).contains(&arg_count) {
            return CalcResult::new_args_number_error(cell);
        }
        let cost = match self.get_number(&args[0], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        let salvage = match self.get_number(&args[1], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        let life = match self.get_number(&args[2], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        let start_period = match self.get_number(&args[3], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        let end_period = match self.get_number(&args[4], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        let factor = if arg_count > 5 {
            match self.get_number(&args[5], cell) {
                Ok(f) => f,
                Err(s) => return s,
            }
        } else {
            2.0
        };
        // no_switch defaults to FALSE => switch to straight line.
        let no_switch = if arg_count > 6 {
            match self.get_number(&args[6], cell) {
                Ok(f) => f != 0.0,
                Err(s) => return s,
            }
        } else {
            false
        };
        if cost < 0.0
            || salvage < 0.0
            || life <= 0.0
            || factor <= 0.0
            || start_period < 0.0
            || start_period > life
            || end_period > life
            || start_period > end_period
            || end_period <= 0.0
        {
            return CalcResult::new_error(Error::NUM, cell, "invalid parameters".to_string());
        }
        // When switching to straight line, life, start and end cannot all coincide.
        if !no_switch && life == start_period && start_period == end_period {
            return CalcResult::new_error(Error::NUM, cell, "invalid parameters".to_string());
        }
        let straight_line = !no_switch;
        let result = vdb_depr_between(
            cost,
            salvage,
            life,
            start_period,
            end_period,
            factor,
            straight_line,
        );
        CalcResult::Number(result)
    }

    // AMORLINC(cost, date_purchased, first_period, salvage, period, rate, [basis])
    //
    // French linear depreciation: a (possibly prorated) first period followed
    // by a constant `rate * cost` charge each subsequent period.
    pub(crate) fn fn_amorlinc(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        let arg_count = args.len();
        if !(6..=7).contains(&arg_count) {
            return CalcResult::new_args_number_error(cell);
        }
        let cost = match self.get_number(&args[0], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        let date_purchased_serial = match self.get_number(&args[1], cell) {
            Ok(f) => f.floor() as i64,
            Err(s) => return s,
        };
        let first_period_serial = match self.get_number(&args[2], cell) {
            Ok(f) => f.floor() as i64,
            Err(s) => return s,
        };
        let salvage = match self.get_number(&args[3], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        let period = match self.get_number(&args[4], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        let rate = match self.get_number(&args[5], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        let basis = if arg_count > 6 {
            match self.get_number_no_bools(&args[6], cell) {
                Ok(f) => f.trunc() as i32,
                Err(s) => return s,
            }
        } else {
            0
        };
        if cost < 0.0
            || salvage < 0.0
            || salvage >= cost
            || period < 0.0
            || rate <= 0.0
            || date_purchased_serial >= first_period_serial
        {
            return CalcResult::new_error(Error::NUM, cell, "invalid parameters".to_string());
        }
        if !(0..=4).contains(&basis) || basis == 2 {
            return CalcResult::new_error(Error::NUM, cell, "invalid basis".to_string());
        }
        let date_purchased = match from_excel_date(date_purchased_serial) {
            Ok(d) => d,
            Err(s) => return CalcResult::new_error(Error::NUM, cell, s),
        };
        let first_period = match from_excel_date(first_period_serial) {
            Ok(d) => d,
            Err(s) => return CalcResult::new_error(Error::NUM, cell, s),
        };
        match amor_linc(
            cost,
            date_purchased,
            first_period,
            salvage,
            period,
            rate,
            basis,
        ) {
            Ok(f) => CalcResult::Number(f),
            Err(s) => CalcResult::new_error(Error::NUM, cell, s),
        }
    }

    // AMORDEGRC(cost, date_purchased, first_period, salvage, period, rate, [basis])
    //
    // French degressive depreciation: like AMORLINC but the rate is scaled by a
    // coefficient that depends on the asset life and the result of each period
    // is rounded to the nearest integer.
    pub(crate) fn fn_amordegrc(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        let arg_count = args.len();
        if !(6..=7).contains(&arg_count) {
            return CalcResult::new_args_number_error(cell);
        }
        let cost = match self.get_number(&args[0], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        let date_purchased_serial = match self.get_number(&args[1], cell) {
            Ok(f) => f.floor() as i64,
            Err(s) => return s,
        };
        let first_period_serial = match self.get_number(&args[2], cell) {
            Ok(f) => f.floor() as i64,
            Err(s) => return s,
        };
        let salvage = match self.get_number(&args[3], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        let period = match self.get_number(&args[4], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        let rate = match self.get_number(&args[5], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        let basis = if arg_count > 6 {
            match self.get_number_no_bools(&args[6], cell) {
                Ok(f) => f.trunc() as i32,
                Err(s) => return s,
            }
        } else {
            0
        };
        if cost < 0.0
            || salvage < 0.0
            || salvage >= cost
            || period < 0.0
            || rate <= 0.0
            || date_purchased_serial >= first_period_serial
        {
            return CalcResult::new_error(Error::NUM, cell, "invalid parameters".to_string());
        }
        if !(0..=4).contains(&basis) || basis == 2 {
            return CalcResult::new_error(Error::NUM, cell, "invalid basis".to_string());
        }
        // Asset life must not fall in the (0, 3] or (4, 5] ranges.
        let asset_life = 1.0 / rate;
        if (0.0..=3.0).contains(&asset_life) || (4.0..=5.0).contains(&asset_life) {
            return CalcResult::new_error(
                Error::NUM,
                cell,
                "asset life cannot be in [0,3] or [4,5]".to_string(),
            );
        }
        let date_purchased = match from_excel_date(date_purchased_serial) {
            Ok(d) => d,
            Err(s) => return CalcResult::new_error(Error::NUM, cell, s),
        };
        let first_period = match from_excel_date(first_period_serial) {
            Ok(d) => d,
            Err(s) => return CalcResult::new_error(Error::NUM, cell, s),
        };
        match amor_degrc(
            cost,
            date_purchased,
            first_period,
            salvage,
            period,
            rate,
            basis,
        ) {
            Ok(f) => CalcResult::Number(f),
            Err(s) => CalcResult::new_error(Error::NUM, cell, s),
        }
    }
}
