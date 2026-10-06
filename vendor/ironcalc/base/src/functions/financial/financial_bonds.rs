use chrono::{Datelike, Months, NaiveDate};

use crate::{
    calc_result::CalcResult,
    constants::EXCEL_DATE_BASE,
    expressions::{parser::Node, token::Error, types::CellReferenceIndex},
    formatter::dates::from_excel_date,
    model::Model,
};

// ============================================================
// Date helpers
// ============================================================

fn naivedate_to_serial(d: NaiveDate) -> i64 {
    (d.num_days_from_ce() - EXCEL_DATE_BASE) as i64
}

fn last_day_of_feb(year: i32) -> u32 {
    if (year % 4 == 0 && year % 100 != 0) || year % 400 == 0 {
        29
    } else {
        28
    }
}

// Days d1→d2 via the US (NASD) 30/360 convention (basis 0).
//
// Port of `dateDiff360Us` with the `ModifyStartDate` method from
// ExcelFinancialFunctions (the variant used by `DaysBetween` in the
// Numerator position). The order matters: the `day == 31 → 30` adjustment for
// the end date tests the *original* start day, before the start day is itself
// normalised.
fn days_30_360_us(d1: NaiveDate, d2: NaiveDate) -> f64 {
    let y1 = d1.year();
    let m1 = d1.month() as i32;
    let mut day1 = d1.day() as i32;
    let y2 = d2.year();
    let m2 = d2.month() as i32;
    let mut day2 = d2.day() as i32;

    let start_is_feb_last = m1 == 2 && d1.day() == last_day_of_feb(y1);
    let end_is_feb_last = m2 == 2 && d2.day() == last_day_of_feb(y2);

    if end_is_feb_last && start_is_feb_last {
        day2 = 30;
    }
    if day2 == 31 && day1 >= 30 {
        day2 = 30;
    }
    if day1 == 31 {
        day1 = 30;
    }
    if start_is_feb_last {
        day1 = 30;
    }
    (360 * (y2 - y1) + 30 * (m2 - m1) + (day2 - day1)) as f64
}

// Days d1→d2 via the EU 30/360 convention (basis 4).
fn days_30_360_eu(d1: NaiveDate, d2: NaiveDate) -> f64 {
    let y1 = d1.year();
    let m1 = d1.month() as i32;
    let day1 = (d1.day() as i32).min(30);
    let y2 = d2.year();
    let m2 = d2.month() as i32;
    let day2 = (d2.day() as i32).min(30);
    (360 * (y2 - y1) + 30 * (m2 - m1) + (day2 - day1)) as f64
}

fn actual_days(d1: NaiveDate, d2: NaiveDate) -> f64 {
    (d2 - d1).num_days() as f64
}

// Basis-aware days from d1 to d2.
fn basis_days(d1: NaiveDate, d2: NaiveDate, basis: u32) -> f64 {
    match basis {
        0 => days_30_360_us(d1, d2),
        1..=3 => actual_days(d1, d2),
        4 => days_30_360_eu(d1, d2),
        _ => 0.0,
    }
}

// ============================================================
// Coupon-schedule helpers
// ============================================================

fn last_day_of_month(year: i32, month: u32) -> u32 {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 => last_day_of_feb(year),
        _ => 30,
    }
}

fn is_last_day_of_month(d: NaiveDate) -> bool {
    d.day() == last_day_of_month(d.year(), d.month())
}

// Shifts `date` by `num_months` (clamping the day to the target month.
// When `return_last` is set the result rounds to the last
// day of the target month.
// The end-of-month coupon rule: when maturity
// falls on a month end, every coupon date does too (so a 11/30 maturity yields
// coupons on 5/31, not 5/30).
fn change_month(date: NaiveDate, num_months: i32, return_last: bool) -> Result<NaiveDate, String> {
    let shifted = if num_months >= 0 {
        date.checked_add_months(Months::new(num_months as u32))
    } else {
        date.checked_sub_months(Months::new((-num_months) as u32))
    }
    .ok_or("Date arithmetic error")?;
    if return_last {
        let last = last_day_of_month(shifted.year(), shifted.month());
        NaiveDate::from_ymd_opt(shifted.year(), shifted.month(), last)
            .ok_or("Date error".to_string())
    } else {
        Ok(shifted)
    }
}

// Walks the coupon schedule backwards from maturity to find the previous coupon
// date (<= settlement) and the next coupon date (> settlement). Port of
// `findPcdNcd`/`findCouponDates` from ExcelFinancialFunctions, including the
// end-of-month rule anchored on the maturity date.
fn find_pcd_ncd(settlement: i64, maturity: i64, frequency: u32) -> Result<(i64, i64), String> {
    let months_per = (12 / frequency) as i32;
    let mat = from_excel_date(maturity)?;
    let return_last = is_last_day_of_month(mat);

    let mut front = mat;
    let mut trailing = mat;
    while naivedate_to_serial(front) > settlement {
        trailing = front;
        front = change_month(front, -months_per, return_last)?;
    }
    Ok((naivedate_to_serial(front), naivedate_to_serial(trailing)))
}

// Latest coupon date that is <= settlement, anchored by maturity & frequency.
fn prev_coupon_date(settlement: i64, maturity: i64, frequency: u32) -> Result<i64, String> {
    Ok(find_pcd_ncd(settlement, maturity, frequency)?.0)
}

// Earliest coupon date strictly after settlement.
fn next_coupon_date(settlement: i64, maturity: i64, frequency: u32) -> Result<i64, String> {
    Ok(find_pcd_ncd(settlement, maturity, frequency)?.1)
}

// Number of coupon payments strictly after settlement up to and including maturity.
fn coupon_count(settlement: i64, maturity: i64, frequency: u32) -> Result<u32, String> {
    let months_per = 12 / frequency as i32;
    let next = from_excel_date(next_coupon_date(settlement, maturity, frequency)?)?;
    let mat = from_excel_date(maturity)?;

    let next_months = next.year() * 12 + next.month() as i32;
    let mat_months = mat.year() * 12 + mat.month() as i32;
    let diff = mat_months - next_months;
    if diff < 0 {
        return Err("Maturity before next coupon".to_string());
    }
    Ok((diff / months_per) as u32 + 1)
}

// Total days in the coupon period that contains settlement (E).
fn coupon_days_e(
    settlement: i64,
    maturity: i64,
    frequency: u32,
    basis: u32,
) -> Result<f64, String> {
    match basis {
        0 | 2 | 4 => Ok(360.0 / frequency as f64),
        1 => {
            let prev = from_excel_date(prev_coupon_date(settlement, maturity, frequency)?)?;
            let next = from_excel_date(next_coupon_date(settlement, maturity, frequency)?)?;
            Ok(actual_days(prev, next))
        }
        3 => Ok(365.0 / frequency as f64),
        _ => Err("Invalid basis".to_string()),
    }
}

// Accrued days from the previous coupon to settlement (A).
fn coupon_days_a(
    settlement: i64,
    maturity: i64,
    frequency: u32,
    basis: u32,
) -> Result<f64, String> {
    let prev = from_excel_date(prev_coupon_date(settlement, maturity, frequency)?)?;
    let set = from_excel_date(settlement)?;
    Ok(basis_days(prev, set, basis))
}

// ============================================================
// Validation helpers
// ============================================================

fn validate_frequency(frequency: u32, cell: CellReferenceIndex) -> Result<(), CalcResult> {
    if frequency == 1 || frequency == 2 || frequency == 4 {
        Ok(())
    } else {
        Err(CalcResult::new_error(
            Error::NUM,
            cell,
            "frequency must be 1, 2, or 4".to_string(),
        ))
    }
}

fn validate_basis(basis: u32, cell: CellReferenceIndex) -> Result<(), CalcResult> {
    if basis <= 4 {
        Ok(())
    } else {
        Err(CalcResult::new_error(
            Error::NUM,
            cell,
            "basis must be 0–4".to_string(),
        ))
    }
}

fn map_date_err(e: String, cell: CellReferenceIndex) -> CalcResult {
    CalcResult::new_error(Error::NUM, cell, e)
}

// ============================================================
// Core bond price computation (standard coupon bond)
// ============================================================

// Returns the clean price (per `redemption` par) for a standard coupon bond.
fn compute_price(
    settlement: i64,
    maturity: i64,
    rate: f64,
    yld: f64,
    redemption: f64,
    frequency: u32,
    basis: u32,
) -> Result<f64, String> {
    let n = coupon_count(settlement, maturity, frequency)? as f64;
    let e = coupon_days_e(settlement, maturity, frequency, basis)?;
    let a = coupon_days_a(settlement, maturity, frequency, basis)?;
    let dsc_over_e = (e - a) / e;

    let coupon = 100.0 * rate / frequency as f64;
    let accrued = coupon * (a / e);

    // A single remaining coupon is discounted with simple (linear) interest
    if n == 1.0 {
        return Ok((redemption + coupon) / (1.0 + dsc_over_e * yld / frequency as f64) - accrued);
    }

    let v = 1.0 + yld / frequency as f64;
    let first_term = redemption / v.powf(dsc_over_e + n - 1.0);

    let mut second_term = 0.0;
    for k in 1..=(n as u32) {
        let t = dsc_over_e + k as f64 - 1.0;
        second_term += coupon / v.powf(t);
    }

    Ok(first_term + second_term - accrued)
}

// ============================================================
// Yield solver (Newton-Raphson + bisection)
// ============================================================

fn compute_yield_from_price(
    target: f64,
    settlement: i64,
    maturity: i64,
    rate: f64,
    redemption: f64,
    frequency: u32,
    basis: u32,
) -> Result<f64, String> {
    let obj = |y: f64| -> Option<f64> {
        compute_price(settlement, maturity, rate, y, redemption, frequency, basis)
            .ok()
            .map(|p| p - target)
    };

    let h = 1e-5;
    let eps = 1e-8;

    // Newton-Raphson starting near the coupon rate.
    let mut y = rate;
    for _ in 0..100 {
        let fv = match obj(y) {
            Some(v) if v.is_finite() => v,
            _ => break,
        };
        let fp = match (obj(y + h), obj(y - h)) {
            (Some(a), Some(b)) => (a - b) / (2.0 * h),
            _ => break,
        };
        if !fp.is_finite() || fp.abs() < 1e-15 {
            break;
        }
        let yn = y - fv / fp;
        if yn <= -1.0 {
            break;
        }
        if (yn - y).abs() < eps {
            return Ok(yn);
        }
        y = yn;
    }

    // Bisection fallback.
    let x1 = -0.9999_f64;
    let x2 = 100.0_f64;
    let f1 = obj(x1).ok_or("bisection failed")?;
    let f2 = obj(x2).ok_or("bisection failed")?;
    if f1 * f2 > 0.0 {
        return Err("YIELD: failed to converge".to_string());
    }
    let (mut lo, mut hi, fl_sign) = if f1 < 0.0 {
        (x1, x2, -1.0_f64)
    } else {
        (x2, x1, 1.0_f64)
    };
    let _ = fl_sign; // used only implicitly through lo/hi ordering

    for _ in 0..200 {
        let mid = (lo + hi) / 2.0;
        let fm = obj(mid).ok_or("bisection failed")?;
        if fm.abs() < eps || (hi - lo).abs() < 1e-12 {
            return Ok(mid);
        }
        let f_lo = obj(lo).ok_or("bisection failed")?;
        if f_lo * fm < 0.0 {
            hi = mid;
        } else {
            lo = mid;
        }
    }
    Err("YIELD: failed to converge".to_string())
}

// ============================================================
// Odd-coupon helpers (port of ExcelFinancialFunctions oddbonds.fs)
// ============================================================

// Days d1→d2 via US 30/360 with the `ModifyBothDates` rule — the "PSA hack"
// the odd-last-coupon code uses for basis 0.
fn days_30_360_us_both(d1: NaiveDate, d2: NaiveDate) -> f64 {
    let y1 = d1.year();
    let m1 = d1.month() as i32;
    let mut day1 = d1.day() as i32;
    let y2 = d2.year();
    let m2 = d2.month() as i32;
    let mut day2 = d2.day() as i32;

    let start_is_feb_last = m1 == 2 && d1.day() == last_day_of_feb(y1);
    let end_is_feb_last = m2 == 2 && d2.day() == last_day_of_feb(y2);

    if end_is_feb_last {
        day2 = 30;
    }
    if day2 == 31 {
        day2 = 30;
    }
    if day1 == 31 {
        day1 = 30;
    }
    if start_is_feb_last {
        day1 = 30;
    }
    (360 * (y2 - y1) + 30 * (m2 - m1) + (day2 - day1)) as f64
}

// `DaysBetween` (Numerator position), clamped to be non-negative.
fn days_between_not_neg(d1: NaiveDate, d2: NaiveDate, basis: u32) -> f64 {
    basis_days(d1, d2, basis).max(0.0)
}

// As above, but basis 0 uses the 30/360 ModifyBothDates rule.
fn days_between_not_neg_with_hack(d1: NaiveDate, d2: NaiveDate, basis: u32) -> f64 {
    if basis == 0 {
        days_30_360_us_both(d1, d2).max(0.0)
    } else {
        days_between_not_neg(d1, d2, basis)
    }
}

// Port of `coupNumber`: counts whole quasi-coupon periods between
// `settl` and the anchor date `mat`, walking forward by `num_months` from a
// (possibly month-end-adjusted) settlement.
fn coup_number(
    mat: i64,
    settl: i64,
    num_months: i32,
    is_whole_number: bool,
) -> Result<f64, String> {
    let mat_d = from_excel_date(mat)?;
    let settl_d = from_excel_date(settl)?;

    let coupons_temp = if is_whole_number { 0.0 } else { 1.0 };
    let end_of_month_temp = is_last_day_of_month(mat_d);
    let end_of_month = if !end_of_month_temp
        && mat_d.month() != 2
        && mat_d.day() > 28
        && mat_d.day() < last_day_of_month(mat_d.year(), mat_d.month())
    {
        is_last_day_of_month(settl_d)
    } else {
        end_of_month_temp
    };

    let start_date = change_month(settl_d, 0, end_of_month)?;
    let mut coupons = if settl_d < start_date {
        coupons_temp + 1.0
    } else {
        coupons_temp
    };

    let mut front = change_month(start_date, num_months, end_of_month)?;
    while front < mat_d {
        coupons += 1.0;
        front = change_month(front, num_months, end_of_month)?;
    }
    Ok(coupons)
}

// ============================================================
// Odd-first-period price
// ============================================================

// Clean price for a bond with an odd first coupon period.
// settlement:   settlement date
// maturity:     maturity date
// issue:        issue date (defines start of odd first period)
// first_coupon: first coupon date
// rate, yld, redemption, frequency, basis: standard
#[allow(clippy::too_many_arguments)]
fn compute_oddfprice(
    settlement: i64,
    maturity: i64,
    issue: i64,
    first_coupon: i64,
    rate: f64,
    yld: f64,
    redemption: f64,
    frequency: u32,
    basis: u32,
) -> Result<f64, String> {
    let m = frequency as f64;
    let num_months = (12 / frequency) as i32;

    let settlement_d = from_excel_date(settlement)?;
    let issue_d = from_excel_date(issue)?;
    let first_coupon_d = from_excel_date(first_coupon)?;

    // E: length of the quasi-coupon period that ends on the first coupon.
    let e = coupon_days_e(settlement, first_coupon, frequency, basis)?;
    let dfc = days_between_not_neg(issue_d, first_coupon_d, basis);

    if dfc < e {
        // --- Short odd first coupon period ---
        let n = coupon_count(settlement, maturity, frequency)? as f64;
        let dsc = days_between_not_neg(settlement_d, first_coupon_d, basis);
        let a = days_between_not_neg(issue_d, settlement_d, basis);
        let x = yld / m + 1.0;
        let y = dsc / e;

        let term1 = redemption / x.powf(n - 1.0 + y);
        let term2 = 100.0 * rate / m * dfc / e / x.powf(y);
        let mut term3 = 0.0;
        for index in 2..=(n as i64) {
            term3 += 100.0 * rate / m / x.powf(index as f64 - 1.0 + y);
        }
        let term4 = a / e * (rate / m) * 100.0;
        Ok(term1 + term2 + term3 - term4)
    } else {
        // --- Long odd first coupon period (spans several quasi-coupon periods) ---
        let nc = coupon_count(issue, first_coupon, frequency)? as i64;

        let mut late_coupon = first_coupon_d;
        let mut dcnl = 0.0_f64;
        let mut anl = 0.0_f64;
        for index in (1..=nc).rev() {
            let early_coupon = change_month(late_coupon, -num_months, false)?;
            let nl = if basis == 1 {
                days_between_not_neg(early_coupon, late_coupon, basis)
            } else {
                e
            };
            let dci = if index > 1 {
                nl
            } else {
                days_between_not_neg(issue_d, late_coupon, basis)
            };
            let start_date = issue_d.max(early_coupon);
            let end_date = settlement_d.min(late_coupon);
            let a = days_between_not_neg(start_date, end_date, basis);
            late_coupon = early_coupon;
            dcnl += dci / nl;
            anl += a / nl;
        }

        let dsc = if basis == 2 || basis == 3 {
            let ncd = from_excel_date(next_coupon_date(settlement, first_coupon, frequency)?)?;
            days_between_not_neg(settlement_d, ncd, basis)
        } else {
            let pcd = from_excel_date(prev_coupon_date(settlement, first_coupon, frequency)?)?;
            e - basis_days(pcd, settlement_d, basis)
        };

        let nq = coup_number(first_coupon, settlement, num_months, true)?;
        let n = coupon_count(first_coupon, maturity, frequency)? as f64;
        let x = yld / m + 1.0;
        let y = dsc / e;

        let term1 = redemption / x.powf(y + nq + n);
        let term2 = 100.0 * rate / m * dcnl / x.powf(nq + y);
        let mut term3 = 0.0;
        for index in 1..=(n as i64) {
            term3 += 100.0 * rate / m / x.powf(index as f64 + nq + y);
        }
        let term4 = 100.0 * rate / m * anl;
        Ok(term1 + term2 + term3 - term4)
    }
}
// ============================================================
// Odd-last-period price / yield
// ============================================================

// Port of `oddLFunc` from oddbonds.fs. With `is_l_price` it returns the
// ODDLPRICE clean price; otherwise it returns the ODDLYIELD yield in closed form.
// last_interest: last regular interest (coupon) date before the odd last period.
#[allow(clippy::too_many_arguments)]
fn odd_l_func(
    settlement: i64,
    maturity: i64,
    last_interest: i64,
    rate: f64,
    pr_or_yld: f64,
    redemption: f64,
    frequency: u32,
    basis: u32,
    is_l_price: bool,
) -> Result<f64, String> {
    let m = frequency as f64;
    let num_months = (12 / frequency) as i32;

    let settlement_d = from_excel_date(settlement)?;
    let maturity_d = from_excel_date(maturity)?;
    let last_interest_d = from_excel_date(last_interest)?;

    let nc = coupon_count(last_interest, maturity, frequency)? as i64;

    let mut early_coupon = last_interest_d;
    let mut dcnl = 0.0_f64;
    let mut anl = 0.0_f64;
    let mut dscnl = 0.0_f64;
    for index in 1..=nc {
        let late_coupon = change_month(early_coupon, num_months, false)?;
        let nl = days_between_not_neg_with_hack(early_coupon, late_coupon, basis);
        let dci = if index < nc {
            nl
        } else {
            days_between_not_neg_with_hack(early_coupon, maturity_d, basis)
        };
        let a = if late_coupon < settlement_d {
            dci
        } else if early_coupon < settlement_d {
            days_between_not_neg(early_coupon, settlement_d, basis)
        } else {
            0.0
        };
        let start_date = settlement_d.max(early_coupon);
        let end_date = maturity_d.min(late_coupon);
        let dsc = days_between_not_neg(start_date, end_date, basis);
        early_coupon = late_coupon;
        dcnl += dci / nl;
        anl += a / nl;
        dscnl += dsc / nl;
    }

    let x = 100.0 * rate / m;
    let term1 = dcnl * x + redemption;
    if is_l_price {
        let term2 = dscnl * pr_or_yld / m + 1.0;
        let term3 = anl * x;
        Ok(term1 / term2 - term3)
    } else {
        let term2 = anl * x + pr_or_yld;
        let term3 = m / dscnl;
        Ok((term1 - term2) / term2 * term3)
    }
}

#[allow(clippy::too_many_arguments)]
fn compute_oddlprice(
    settlement: i64,
    maturity: i64,
    last_interest: i64,
    rate: f64,
    yld: f64,
    redemption: f64,
    frequency: u32,
    basis: u32,
) -> Result<f64, String> {
    odd_l_func(
        settlement,
        maturity,
        last_interest,
        rate,
        yld,
        redemption,
        frequency,
        basis,
        true,
    )
}

// ============================================================
// Generic yield solver (wraps any price function)
// ============================================================

fn solve_yield<F>(target_price: f64, rate: f64, price_fn: F) -> Result<f64, String>
where
    F: Fn(f64) -> Option<f64>,
{
    let obj = |y: f64| price_fn(y).map(|p| p - target_price);

    let h = 1e-5;
    let eps = 1e-8;

    let mut y = rate;
    for _ in 0..100 {
        let fv = match obj(y) {
            Some(v) if v.is_finite() => v,
            _ => break,
        };
        let fp = match (obj(y + h), obj(y - h)) {
            (Some(a), Some(b)) => (a - b) / (2.0 * h),
            _ => break,
        };
        if !fp.is_finite() || fp.abs() < 1e-15 {
            break;
        }
        let yn = y - fv / fp;
        if yn <= -1.0 {
            break;
        }
        if (yn - y).abs() < eps {
            return Ok(yn);
        }
        y = yn;
    }

    // Bisection fallback
    let (x1, x2) = (-0.9999_f64, 100.0_f64);
    let f1 = obj(x1).ok_or("bisection failed")?;
    let f2 = obj(x2).ok_or("bisection failed")?;
    if f1 * f2 > 0.0 {
        return Err("yield solver: failed to converge".to_string());
    }
    let (mut lo, mut hi) = if f1 < 0.0 { (x1, x2) } else { (x2, x1) };

    for _ in 0..200 {
        let mid = (lo + hi) / 2.0;
        let fm = obj(mid).ok_or("bisection failed")?;
        if fm.abs() < eps || (hi - lo).abs() < 1e-12 {
            return Ok(mid);
        }
        let f_lo = obj(lo).ok_or("bisection failed")?;
        if f_lo * fm < 0.0 {
            hi = mid;
        } else {
            lo = mid;
        }
    }
    Err("yield solver: failed to converge".to_string())
}

// ============================================================
// Shared argument parser for COUP* functions
// (settlement, maturity, frequency, [basis])
// ============================================================

fn parse_coupon_args(
    model: &mut Model<'_>,
    args: &[Node],
    cell: CellReferenceIndex,
) -> Result<(i64, i64, u32, u32), CalcResult> {
    let arg_count = args.len();
    if !(3..=4).contains(&arg_count) {
        return Err(CalcResult::new_args_number_error(cell));
    }
    let settlement = {
        let f = model.get_number_no_bools(&args[0], cell)?;
        f.floor() as i64
    };
    let maturity = {
        let f = model.get_number_no_bools(&args[1], cell)?;
        f.floor() as i64
    };
    let frequency = {
        let f = model.get_number_no_bools(&args[2], cell)?;
        f.floor() as u32
    };
    let basis = if arg_count == 4 {
        {
            let f = model.get_number_no_bools(&args[3], cell)?;
            f.floor() as u32
        }
    } else {
        0
    };
    validate_frequency(frequency, cell)?;
    validate_basis(basis, cell)?;
    if settlement >= maturity {
        return Err(CalcResult::new_error(
            Error::NUM,
            cell,
            "settlement must be before maturity".to_string(),
        ));
    }
    Ok((settlement, maturity, frequency, basis))
}

// ============================================================
// Model implementations
// ============================================================

impl<'a> Model<'a> {
    // DURATION(settlement, maturity, coupon, yld, frequency, [basis])
    pub(crate) fn fn_duration(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        let arg_count = args.len();
        if !(5..=6).contains(&arg_count) {
            return CalcResult::new_args_number_error(cell);
        }
        let settlement = match self.get_number_no_bools(&args[0], cell) {
            Ok(f) => f.floor() as i64,
            Err(e) => return e,
        };
        let maturity = match self.get_number_no_bools(&args[1], cell) {
            Ok(f) => f.floor() as i64,
            Err(e) => return e,
        };
        let rate = match self.get_number_no_bools(&args[2], cell) {
            Ok(f) => f,
            Err(e) => return e,
        };
        let yld = match self.get_number_no_bools(&args[3], cell) {
            Ok(f) => f,
            Err(e) => return e,
        };
        let frequency = match self.get_number_no_bools(&args[4], cell) {
            Ok(f) => f.floor() as u32,
            Err(e) => return e,
        };
        let basis = if arg_count == 6 {
            match self.get_number_no_bools(&args[5], cell) {
                Ok(f) => f.floor() as u32,
                Err(e) => return e,
            }
        } else {
            0
        };

        if let Err(e) = validate_frequency(frequency, cell) {
            return e;
        }
        if let Err(e) = validate_basis(basis, cell) {
            return e;
        }
        if rate < 0.0 || yld < 0.0 {
            return CalcResult::new_error(
                Error::NUM,
                cell,
                "rate and yld must be >= 0".to_string(),
            );
        }
        if settlement >= maturity {
            return CalcResult::new_error(
                Error::NUM,
                cell,
                "settlement must be before maturity".to_string(),
            );
        }

        let n = match coupon_count(settlement, maturity, frequency) {
            Ok(v) => v as f64,
            Err(e) => return map_date_err(e, cell),
        };
        let e = match coupon_days_e(settlement, maturity, frequency, basis) {
            Ok(v) => v,
            Err(e) => return map_date_err(e, cell),
        };
        let a = match coupon_days_a(settlement, maturity, frequency, basis) {
            Ok(v) => v,
            Err(e) => return map_date_err(e, cell),
        };
        let dsc_over_e = (e - a) / e;

        let redemption = 100.0;
        let coupon = redemption * rate / frequency as f64;
        let v = 1.0 + yld / frequency as f64;

        let mut num = 0.0; // sum of t * PV(CF)
        let mut den = 0.0; // dirty price (sum of PV(CF))

        for k in 1..=(n as u32) {
            let t = dsc_over_e + k as f64 - 1.0;
            let pv = coupon / v.powf(t);
            num += t * pv;
            den += pv;
        }
        let t_final = dsc_over_e + n - 1.0;
        let pv_red = redemption / v.powf(t_final);
        num += t_final * pv_red;
        den += pv_red;

        if den == 0.0 {
            return CalcResult::new_error(Error::DIV, cell, "Division by zero".to_string());
        }

        CalcResult::Number(num / den / frequency as f64)
    }

    // MDURATION(settlement, maturity, coupon, yld, frequency, [basis])
    pub(crate) fn fn_mduration(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        let arg_count = args.len();
        if !(5..=6).contains(&arg_count) {
            return CalcResult::new_args_number_error(cell);
        }
        // Reuse DURATION, then apply the Modified Duration adjustment.
        let yld = match self.get_number_no_bools(&args[3], cell) {
            Ok(f) => f,
            Err(e) => return e,
        };
        let frequency = match self.get_number_no_bools(&args[4], cell) {
            Ok(f) => f.floor() as u32,
            Err(e) => return e,
        };
        match self.fn_duration(args, cell) {
            CalcResult::Number(d) => CalcResult::Number(d / (1.0 + yld / frequency as f64)),
            other => other,
        }
    }

    // PRICE(settlement, maturity, rate, yld, redemption, frequency, [basis])
    pub(crate) fn fn_price(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        let arg_count = args.len();
        if !(6..=7).contains(&arg_count) {
            return CalcResult::new_args_number_error(cell);
        }
        let settlement = match self.get_number_no_bools(&args[0], cell) {
            Ok(f) => f.floor() as i64,
            Err(e) => return e,
        };
        let maturity = match self.get_number_no_bools(&args[1], cell) {
            Ok(f) => f.floor() as i64,
            Err(e) => return e,
        };
        let rate = match self.get_number_no_bools(&args[2], cell) {
            Ok(f) => f,
            Err(e) => return e,
        };
        let yld = match self.get_number_no_bools(&args[3], cell) {
            Ok(f) => f,
            Err(e) => return e,
        };
        let redemption = match self.get_number_no_bools(&args[4], cell) {
            Ok(f) => f,
            Err(e) => return e,
        };
        let frequency = match self.get_number_no_bools(&args[5], cell) {
            Ok(f) => f.floor() as u32,
            Err(e) => return e,
        };
        let basis = if arg_count == 7 {
            match self.get_number_no_bools(&args[6], cell) {
                Ok(f) => f.floor() as u32,
                Err(e) => return e,
            }
        } else {
            0
        };

        if let Err(e) = validate_frequency(frequency, cell) {
            return e;
        }
        if let Err(e) = validate_basis(basis, cell) {
            return e;
        }
        if rate < 0.0 || yld < 0.0 || redemption <= 0.0 {
            return CalcResult::new_error(
                Error::NUM,
                cell,
                "rate and yld must be >= 0; redemption must be > 0".to_string(),
            );
        }
        if settlement >= maturity {
            return CalcResult::new_error(
                Error::NUM,
                cell,
                "settlement must be before maturity".to_string(),
            );
        }

        match compute_price(
            settlement, maturity, rate, yld, redemption, frequency, basis,
        ) {
            Ok(p) => CalcResult::Number(p),
            Err(e) => map_date_err(e, cell),
        }
    }

    // YIELD(settlement, maturity, rate, pr, redemption, frequency, [basis])
    pub(crate) fn fn_yield(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        let arg_count = args.len();
        if !(6..=7).contains(&arg_count) {
            return CalcResult::new_args_number_error(cell);
        }
        let settlement = match self.get_number_no_bools(&args[0], cell) {
            Ok(f) => f.floor() as i64,
            Err(e) => return e,
        };
        let maturity = match self.get_number_no_bools(&args[1], cell) {
            Ok(f) => f.floor() as i64,
            Err(e) => return e,
        };
        let rate = match self.get_number_no_bools(&args[2], cell) {
            Ok(f) => f,
            Err(e) => return e,
        };
        let pr = match self.get_number_no_bools(&args[3], cell) {
            Ok(f) => f,
            Err(e) => return e,
        };
        let redemption = match self.get_number_no_bools(&args[4], cell) {
            Ok(f) => f,
            Err(e) => return e,
        };
        let frequency = match self.get_number_no_bools(&args[5], cell) {
            Ok(f) => f.floor() as u32,
            Err(e) => return e,
        };
        let basis = if arg_count == 7 {
            match self.get_number_no_bools(&args[6], cell) {
                Ok(f) => f.floor() as u32,
                Err(e) => return e,
            }
        } else {
            0
        };

        if let Err(e) = validate_frequency(frequency, cell) {
            return e;
        }
        if let Err(e) = validate_basis(basis, cell) {
            return e;
        }
        if rate < 0.0 || pr <= 0.0 || redemption <= 0.0 {
            return CalcResult::new_error(
                Error::NUM,
                cell,
                "pr and redemption must be > 0".to_string(),
            );
        }
        if settlement >= maturity {
            return CalcResult::new_error(
                Error::NUM,
                cell,
                "settlement must be before maturity".to_string(),
            );
        }

        match compute_yield_from_price(pr, settlement, maturity, rate, redemption, frequency, basis)
        {
            Ok(y) => CalcResult::Number(y),
            Err(e) => map_date_err(e, cell),
        }
    }

    // ODDFPRICE(settlement, maturity, issue, first_coupon, rate, yld, redemption, frequency, [basis])
    pub(crate) fn fn_oddfprice(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        let arg_count = args.len();
        if !(8..=9).contains(&arg_count) {
            return CalcResult::new_args_number_error(cell);
        }
        let settlement = match self.get_number_no_bools(&args[0], cell) {
            Ok(f) => f.floor() as i64,
            Err(e) => return e,
        };
        let maturity = match self.get_number_no_bools(&args[1], cell) {
            Ok(f) => f.floor() as i64,
            Err(e) => return e,
        };
        let issue = match self.get_number_no_bools(&args[2], cell) {
            Ok(f) => f.floor() as i64,
            Err(e) => return e,
        };
        let first_coupon = match self.get_number_no_bools(&args[3], cell) {
            Ok(f) => f.floor() as i64,
            Err(e) => return e,
        };
        let rate = match self.get_number_no_bools(&args[4], cell) {
            Ok(f) => f,
            Err(e) => return e,
        };
        let yld = match self.get_number_no_bools(&args[5], cell) {
            Ok(f) => f,
            Err(e) => return e,
        };
        let redemption = match self.get_number_no_bools(&args[6], cell) {
            Ok(f) => f,
            Err(e) => return e,
        };
        let frequency = match self.get_number_no_bools(&args[7], cell) {
            Ok(f) => f.floor() as u32,
            Err(e) => return e,
        };
        let basis = if arg_count == 9 {
            match self.get_number_no_bools(&args[8], cell) {
                Ok(f) => f.floor() as u32,
                Err(e) => return e,
            }
        } else {
            0
        };

        if let Err(e) = validate_frequency(frequency, cell) {
            return e;
        }
        if let Err(e) = validate_basis(basis, cell) {
            return e;
        }
        if issue >= first_coupon || first_coupon > maturity || settlement >= maturity {
            return CalcResult::new_error(Error::NUM, cell, "invalid date ordering".to_string());
        }
        if rate < 0.0 || yld < 0.0 || redemption <= 0.0 {
            return CalcResult::new_error(
                Error::NUM,
                cell,
                "invalid rate/yld/redemption".to_string(),
            );
        }

        match compute_oddfprice(
            settlement,
            maturity,
            issue,
            first_coupon,
            rate,
            yld,
            redemption,
            frequency,
            basis,
        ) {
            Ok(p) => CalcResult::Number(p),
            Err(e) => map_date_err(e, cell),
        }
    }

    // ODDFYIELD(settlement, maturity, issue, first_coupon, rate, pr, redemption, frequency, [basis])
    pub(crate) fn fn_oddfyield(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        let arg_count = args.len();
        if !(8..=9).contains(&arg_count) {
            return CalcResult::new_args_number_error(cell);
        }
        let settlement = match self.get_number_no_bools(&args[0], cell) {
            Ok(f) => f.floor() as i64,
            Err(e) => return e,
        };
        let maturity = match self.get_number_no_bools(&args[1], cell) {
            Ok(f) => f.floor() as i64,
            Err(e) => return e,
        };
        let issue = match self.get_number_no_bools(&args[2], cell) {
            Ok(f) => f.floor() as i64,
            Err(e) => return e,
        };
        let first_coupon = match self.get_number_no_bools(&args[3], cell) {
            Ok(f) => f.floor() as i64,
            Err(e) => return e,
        };
        let rate = match self.get_number_no_bools(&args[4], cell) {
            Ok(f) => f,
            Err(e) => return e,
        };
        let pr = match self.get_number_no_bools(&args[5], cell) {
            Ok(f) => f,
            Err(e) => return e,
        };
        let redemption = match self.get_number_no_bools(&args[6], cell) {
            Ok(f) => f,
            Err(e) => return e,
        };
        let frequency = match self.get_number_no_bools(&args[7], cell) {
            Ok(f) => f.floor() as u32,
            Err(e) => return e,
        };
        let basis = if arg_count == 9 {
            match self.get_number_no_bools(&args[8], cell) {
                Ok(f) => f.floor() as u32,
                Err(e) => return e,
            }
        } else {
            0
        };

        if let Err(e) = validate_frequency(frequency, cell) {
            return e;
        }
        if let Err(e) = validate_basis(basis, cell) {
            return e;
        }
        if issue >= first_coupon || first_coupon > maturity || settlement >= maturity {
            return CalcResult::new_error(Error::NUM, cell, "invalid date ordering".to_string());
        }
        if rate < 0.0 || pr <= 0.0 || redemption <= 0.0 {
            return CalcResult::new_error(
                Error::NUM,
                cell,
                "invalid rate/pr/redemption".to_string(),
            );
        }

        let price_fn = |yld: f64| {
            compute_oddfprice(
                settlement,
                maturity,
                issue,
                first_coupon,
                rate,
                yld,
                redemption,
                frequency,
                basis,
            )
            .ok()
        };

        match solve_yield(pr, rate, price_fn) {
            Ok(y) => CalcResult::Number(y),
            Err(e) => map_date_err(e, cell),
        }
    }

    // ODDLPRICE(settlement, maturity, last_interest, rate, yld, redemption, frequency, [basis])
    pub(crate) fn fn_oddlprice(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        let arg_count = args.len();
        if !(7..=8).contains(&arg_count) {
            return CalcResult::new_args_number_error(cell);
        }
        let settlement = match self.get_number_no_bools(&args[0], cell) {
            Ok(f) => f.floor() as i64,
            Err(e) => return e,
        };
        let maturity = match self.get_number_no_bools(&args[1], cell) {
            Ok(f) => f.floor() as i64,
            Err(e) => return e,
        };
        let last_interest = match self.get_number_no_bools(&args[2], cell) {
            Ok(f) => f.floor() as i64,
            Err(e) => return e,
        };
        let rate = match self.get_number_no_bools(&args[3], cell) {
            Ok(f) => f,
            Err(e) => return e,
        };
        let yld = match self.get_number_no_bools(&args[4], cell) {
            Ok(f) => f,
            Err(e) => return e,
        };
        let redemption = match self.get_number_no_bools(&args[5], cell) {
            Ok(f) => f,
            Err(e) => return e,
        };
        let frequency = match self.get_number_no_bools(&args[6], cell) {
            Ok(f) => f.floor() as u32,
            Err(e) => return e,
        };
        let basis = if arg_count == 8 {
            match self.get_number_no_bools(&args[7], cell) {
                Ok(f) => f.floor() as u32,
                Err(e) => return e,
            }
        } else {
            0
        };

        if let Err(e) = validate_frequency(frequency, cell) {
            return e;
        }
        if let Err(e) = validate_basis(basis, cell) {
            return e;
        }
        if last_interest >= maturity || settlement >= maturity {
            return CalcResult::new_error(Error::NUM, cell, "invalid date ordering".to_string());
        }
        if rate < 0.0 || yld < 0.0 || redemption <= 0.0 {
            return CalcResult::new_error(
                Error::NUM,
                cell,
                "invalid rate/yld/redemption".to_string(),
            );
        }

        match compute_oddlprice(
            settlement,
            maturity,
            last_interest,
            rate,
            yld,
            redemption,
            frequency,
            basis,
        ) {
            Ok(p) => CalcResult::Number(p),
            Err(e) => map_date_err(e, cell),
        }
    }

    // ODDLYIELD(settlement, maturity, last_interest, rate, pr, redemption, frequency, [basis])
    pub(crate) fn fn_oddlyield(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        let arg_count = args.len();
        if !(7..=8).contains(&arg_count) {
            return CalcResult::new_args_number_error(cell);
        }
        let settlement = match self.get_number_no_bools(&args[0], cell) {
            Ok(f) => f.floor() as i64,
            Err(e) => return e,
        };
        let maturity = match self.get_number_no_bools(&args[1], cell) {
            Ok(f) => f.floor() as i64,
            Err(e) => return e,
        };
        let last_interest = match self.get_number_no_bools(&args[2], cell) {
            Ok(f) => f.floor() as i64,
            Err(e) => return e,
        };
        let rate = match self.get_number_no_bools(&args[3], cell) {
            Ok(f) => f,
            Err(e) => return e,
        };
        let pr = match self.get_number_no_bools(&args[4], cell) {
            Ok(f) => f,
            Err(e) => return e,
        };
        let redemption = match self.get_number_no_bools(&args[5], cell) {
            Ok(f) => f,
            Err(e) => return e,
        };
        let frequency = match self.get_number_no_bools(&args[6], cell) {
            Ok(f) => f.floor() as u32,
            Err(e) => return e,
        };
        let basis = if arg_count == 8 {
            match self.get_number_no_bools(&args[7], cell) {
                Ok(f) => f.floor() as u32,
                Err(e) => return e,
            }
        } else {
            0
        };

        if let Err(e) = validate_frequency(frequency, cell) {
            return e;
        }
        if let Err(e) = validate_basis(basis, cell) {
            return e;
        }
        if last_interest >= maturity || settlement >= maturity {
            return CalcResult::new_error(Error::NUM, cell, "invalid date ordering".to_string());
        }
        if rate < 0.0 || pr <= 0.0 || redemption <= 0.0 {
            return CalcResult::new_error(
                Error::NUM,
                cell,
                "invalid rate/pr/redemption".to_string(),
            );
        }

        match odd_l_func(
            settlement,
            maturity,
            last_interest,
            rate,
            pr,
            redemption,
            frequency,
            basis,
            false,
        ) {
            Ok(y) => CalcResult::Number(y),
            Err(e) => map_date_err(e, cell),
        }
    }

    // COUPDAYBS(settlement, maturity, frequency, [basis])
    // Days from the beginning of the coupon period to settlement.
    pub(crate) fn fn_coupdaybs(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        let (settlement, maturity, frequency, basis) = match parse_coupon_args(self, args, cell) {
            Ok(v) => v,
            Err(e) => return e,
        };
        match coupon_days_a(settlement, maturity, frequency, basis) {
            Ok(v) => CalcResult::Number(v),
            Err(e) => map_date_err(e, cell),
        }
    }

    // COUPDAYS(settlement, maturity, frequency, [basis])
    // Total days in the coupon period that contains settlement.
    pub(crate) fn fn_coupdays(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        let (settlement, maturity, frequency, basis) = match parse_coupon_args(self, args, cell) {
            Ok(v) => v,
            Err(e) => return e,
        };
        match coupon_days_e(settlement, maturity, frequency, basis) {
            Ok(v) => CalcResult::Number(v),
            Err(e) => map_date_err(e, cell),
        }
    }

    // COUPDAYSNC(settlement, maturity, frequency, [basis])
    // Days from settlement to the next coupon date.
    pub(crate) fn fn_coupdaysnc(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        let (settlement, maturity, frequency, basis) = match parse_coupon_args(self, args, cell) {
            Ok(v) => v,
            Err(e) => return e,
        };
        let next = match next_coupon_date(settlement, maturity, frequency) {
            Ok(v) => v,
            Err(e) => return map_date_err(e, cell),
        };
        let set_date = match from_excel_date(settlement) {
            Ok(d) => d,
            Err(e) => return map_date_err(e, cell),
        };
        let next_date = match from_excel_date(next) {
            Ok(d) => d,
            Err(e) => return map_date_err(e, cell),
        };
        if basis == 0 {
            // ExcelFinancialFunctions enforces coupDaysNC = coupDays - coupDaysBS
            // for the US 30/360 basis: the total 30/360 days in the coupon period
            // (ModifyBothDates) minus the days from its start to settlement
            // (ModifyStartDate). This is *not* simply 30/360(settlement, next).
            let prev = match prev_coupon_date(settlement, maturity, frequency) {
                Ok(v) => v,
                Err(e) => return map_date_err(e, cell),
            };
            let prev_date = match from_excel_date(prev) {
                Ok(d) => d,
                Err(e) => return map_date_err(e, cell),
            };
            let total = days_30_360_us_both(prev_date, next_date);
            let to_settlement = days_30_360_us(prev_date, set_date);
            return CalcResult::Number(total - to_settlement);
        }
        CalcResult::Number(basis_days(set_date, next_date, basis))
    }

    // COUPNCD(settlement, maturity, frequency, [basis])
    // Next coupon date after settlement (returned as an Excel serial date).
    pub(crate) fn fn_coupncd(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        let (settlement, maturity, frequency, _basis) = match parse_coupon_args(self, args, cell) {
            Ok(v) => v,
            Err(e) => return e,
        };
        match next_coupon_date(settlement, maturity, frequency) {
            Ok(serial) => CalcResult::Number(serial as f64),
            Err(e) => map_date_err(e, cell),
        }
    }

    // COUPNUM(settlement, maturity, frequency, [basis])
    // Number of coupons payable between settlement and maturity.
    pub(crate) fn fn_coupnum(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        let (settlement, maturity, frequency, _basis) = match parse_coupon_args(self, args, cell) {
            Ok(v) => v,
            Err(e) => return e,
        };
        match coupon_count(settlement, maturity, frequency) {
            Ok(n) => CalcResult::Number(n as f64),
            Err(e) => map_date_err(e, cell),
        }
    }

    // COUPPCD(settlement, maturity, frequency, [basis])
    // Most recent coupon date at or before settlement (returned as an Excel serial date).
    pub(crate) fn fn_couppcd(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        let (settlement, maturity, frequency, _basis) = match parse_coupon_args(self, args, cell) {
            Ok(v) => v,
            Err(e) => return e,
        };
        match prev_coupon_date(settlement, maturity, frequency) {
            Ok(serial) => CalcResult::Number(serial as f64),
            Err(e) => map_date_err(e, cell),
        }
    }
}
