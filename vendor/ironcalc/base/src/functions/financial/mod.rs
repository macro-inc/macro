use chrono::Datelike;

use crate::{
    calc_result::CalcResult,
    constants::{LAST_COLUMN, LAST_ROW, MAXIMUM_DATE_SERIAL_NUMBER, MINIMUM_DATE_SERIAL_NUMBER},
    expressions::{
        parser::{ArrayNode, Node},
        token::Error,
        types::CellReferenceIndex,
    },
    formatter::dates::from_excel_date,
    model::Model,
};

mod accrint;
mod financial_bonds;
mod financial_depreciation;
mod financial_util;

use financial_util::{compute_irr, compute_npv, compute_rate, compute_xirr, compute_xnpv};

// See:
// https://github.com/apache/openoffice/blob/c014b5f2b55cff8d4b0c952d5c16d62ecde09ca1/main/scaddins/source/analysis/financial.cxx

fn is_less_than_one_year(start_date: i64, end_date: i64) -> Result<bool, String> {
    let end = from_excel_date(end_date)?;
    let start = from_excel_date(start_date)?;
    if end_date - start_date < 365 {
        return Ok(true);
    }
    let end_year = end.year();
    let start_year = start.year();
    if end_year == start_year {
        return Ok(true);
    }
    if end_year != start_year + 1 {
        return Ok(false);
    }
    let start_month = start.month();
    let end_month = end.month();
    if end_month < start_month {
        return Ok(true);
    }
    if end_month > start_month {
        return Ok(false);
    }
    // we are one year later same month
    let start_day = start.day();
    let end_day = end.day();
    Ok(end_day <= start_day)
}

fn compute_payment(
    rate: f64,
    nper: f64,
    pv: f64,
    fv: f64,
    period_start: bool,
) -> Result<f64, (Error, String)> {
    if rate == 0.0 {
        if nper == 0.0 {
            return Err((Error::NUM, "Period count must be non zero".to_string()));
        }
        return Ok(-(pv + fv) / nper);
    }
    if rate <= -1.0 {
        return Err((Error::NUM, "Rate must be > -1".to_string()));
    };
    let rate_nper = if nper == 0.0 {
        1.0
    } else {
        (1.0 + rate).powf(nper)
    };
    let result = if period_start {
        // type = 1
        (fv + pv * rate_nper) * rate / ((1.0 + rate) * (1.0 - rate_nper))
    } else {
        (fv * rate + pv * rate * rate_nper) / (1.0 - rate_nper)
    };
    if result.is_nan() || result.is_infinite() {
        return Err((Error::NUM, "Invalid result".to_string()));
    }
    Ok(result)
}

fn compute_future_value(
    rate: f64,
    nper: f64,
    pmt: f64,
    pv: f64,
    period_start: bool,
) -> Result<f64, (Error, String)> {
    if rate == 0.0 {
        return Ok(-pv - pmt * nper);
    }
    if rate == -1.0 && nper < 0.0 {
        return Err((Error::DIV, "Divide by zero".to_string()));
    }

    let rate_nper = (1.0 + rate).powf(nper);
    let fv = if period_start {
        // type = 1
        -pv * rate_nper - pmt * (1.0 + rate) * (rate_nper - 1.0) / rate
    } else {
        -pv * rate_nper - pmt * (rate_nper - 1.0) / rate
    };
    if fv.is_nan() {
        return Err((Error::NUM, "Invalid result".to_string()));
    }
    if !fv.is_finite() {
        return Err((Error::DIV, "Divide by zero".to_string()));
    }
    Ok(fv)
}

fn compute_ipmt(
    rate: f64,
    period: f64,
    period_count: f64,
    present_value: f64,
    future_value: f64,
    period_start: bool,
) -> Result<f64, (Error, String)> {
    // http://www.staff.city.ac.uk/o.s.kerr/CompMaths/WSheet4.pdf
    // https://www.experts-exchange.com/articles/1948/A-Guide-to-the-PMT-FV-IPMT-and-PPMT-Functions.html
    // type = 0 (end of period)
    // impt = -[(1+rate)^(period-1)*(pv*rate+pmt)-pmt]
    // ipmt = FV(rate, period-1, payment, pv, type) * rate
    // type = 1 (beginning of period)
    // ipmt = (FV(rate, period-2, payment, pv, type) - payment) * rate
    let payment = compute_payment(
        rate,
        period_count,
        present_value,
        future_value,
        period_start,
    )?;
    if period < 1.0 || period >= period_count + 1.0 {
        return Err((
            Error::NUM,
            format!("Period must be between 1 and {}", period_count + 1.0),
        ));
    }
    if period == 1.0 && period_start {
        Ok(0.0)
    } else {
        let p = if period_start {
            period - 2.0
        } else {
            period - 1.0
        };
        let c = if period_start { -payment } else { 0.0 };
        let fv = compute_future_value(rate, p, payment, present_value, period_start)?;
        Ok((fv + c) * rate)
    }
}

fn compute_ppmt(
    rate: f64,
    period: f64,
    period_count: f64,
    present_value: f64,
    future_value: f64,
    period_start: bool,
) -> Result<f64, (Error, String)> {
    let payment = compute_payment(
        rate,
        period_count,
        present_value,
        future_value,
        period_start,
    )?;
    // It's a bit unfortunate that the first thing compute_ipmt does is compute_payment again
    let ipmt = compute_ipmt(
        rate,
        period,
        period_count,
        present_value,
        future_value,
        period_start,
    )?;
    Ok(payment - ipmt)
}

// These formulas revolve around compound interest and annuities.
// The financial functions pv, rate, nper, pmt and fv:
// rate = interest rate per period
// nper (number of periods) = loan term
// pv (present value) = loan amount
// fv (future value) = cash balance after last payment. Default is 0
// type = the annuity type indicates when payments are due
//         * 0 (default) Payments are made at the end of the period
//         * 1 Payments are made at the beginning of the period (like a lease or rent)
// The variable period_start is true if type is 1
// They are linked by the formulas:
// If rate != 0
//   $pv*(1+rate)^nper+pmt*(1+rate*type)*((1+rate)^nper-1)/rate+fv=0$
// If rate = 0
//   $pmt*nper+pv+fv=0$
// All, except for rate are easily solvable in terms of the others.
// In these formulas the payment (pmt) is normally negative

impl<'a> Model<'a> {
    fn get_array_of_numbers_generic(
        &mut self,
        arg: &Node,
        cell: &CellReferenceIndex,
        accept_number_node: bool,
        handle_empty_cell: impl Fn() -> Result<Option<f64>, CalcResult>,
        handle_non_number_cell: impl Fn() -> Result<Option<f64>, CalcResult>,
    ) -> Result<Vec<f64>, CalcResult> {
        let mut values = Vec::new();
        match self.evaluate_node_in_context(arg, *cell) {
            CalcResult::Number(value) if accept_number_node => values.push(value),
            CalcResult::Number(_) => {
                return Err(CalcResult::new_error(
                    Error::VALUE,
                    *cell,
                    "Expected range of numbers".to_string(),
                ));
            }
            CalcResult::Range { left, right } => {
                if left.sheet != right.sheet {
                    return Err(CalcResult::new_error(
                        Error::VALUE,
                        *cell,
                        "Ranges are in different sheets".to_string(),
                    ));
                }
                let sheet = left.sheet;
                let row1 = left.row;
                let mut row2 = right.row;
                let column1 = left.column;
                let mut column2 = right.column;
                if row1 == 1 && row2 == LAST_ROW {
                    row2 = self
                        .workbook
                        .worksheet(sheet)
                        .map_err(|_| {
                            CalcResult::new_error(
                                Error::ERROR,
                                *cell,
                                format!("Invalid worksheet index: '{sheet}'"),
                            )
                        })?
                        .dimension()
                        .max_row;
                }
                if column1 == 1 && column2 == LAST_COLUMN {
                    column2 = self
                        .workbook
                        .worksheet(sheet)
                        .map_err(|_| {
                            CalcResult::new_error(
                                Error::ERROR,
                                *cell,
                                format!("Invalid worksheet index: '{sheet}'"),
                            )
                        })?
                        .dimension()
                        .max_column;
                }
                for row in row1..=row2 {
                    for column in column1..=column2 {
                        let cell_ref = CellReferenceIndex { sheet, row, column };
                        match self.evaluate_cell(cell_ref) {
                            CalcResult::Number(value) => values.push(value),
                            error @ CalcResult::Error { .. } => return Err(error),
                            CalcResult::EmptyCell => {
                                if let Some(value) = handle_empty_cell()? {
                                    values.push(value);
                                }
                            }
                            _ => {
                                if let Some(value) = handle_non_number_cell()? {
                                    values.push(value);
                                }
                            }
                        }
                    }
                }
            }
            CalcResult::Array(arr) => {
                for row in arr {
                    for node in row {
                        match node {
                            ArrayNode::Number(f) => values.push(f),
                            ArrayNode::Error(e) => {
                                return Err(CalcResult::new_error(
                                    e,
                                    *cell,
                                    "Error in array".to_string(),
                                ));
                            }
                            ArrayNode::Empty => {
                                if let Some(value) = handle_empty_cell()? {
                                    values.push(value);
                                }
                            }
                            _ => {
                                if let Some(value) = handle_non_number_cell()? {
                                    values.push(value);
                                }
                            }
                        }
                    }
                }
            }
            error @ CalcResult::Error { .. } => return Err(error),
            _ => {
                handle_non_number_cell()?;
            }
        }
        Ok(values)
    }

    fn get_array_of_numbers(
        &mut self,
        arg: &Node,
        cell: &CellReferenceIndex,
    ) -> Result<Vec<f64>, CalcResult> {
        self.get_array_of_numbers_generic(
            arg,
            cell,
            true,        // accept_number_node
            || Ok(None), // Ignore empty cells
            || Ok(None), // Ignore non-number cells
        )
    }

    fn get_array_of_numbers_xpnv(
        &mut self,
        arg: &Node,
        cell: &CellReferenceIndex,
        error: Error,
    ) -> Result<Vec<f64>, CalcResult> {
        self.get_array_of_numbers_generic(
            arg,
            cell,
            true, // accept_number_node
            || {
                Err(CalcResult::new_error(
                    Error::NUM,
                    *cell,
                    "Expected number".to_string(),
                ))
            },
            || {
                Err(CalcResult::new_error(
                    error.clone(),
                    *cell,
                    "Expected number".to_string(),
                ))
            },
        )
    }

    fn get_array_of_numbers_xirr(
        &mut self,
        arg: &Node,
        cell: &CellReferenceIndex,
    ) -> Result<Vec<f64>, CalcResult> {
        self.get_array_of_numbers_generic(
            arg,
            cell,
            false,            // Do not accept a single number node
            || Ok(Some(0.0)), // Treat empty cells as zero
            || {
                Err(CalcResult::new_error(
                    Error::VALUE,
                    *cell,
                    "Expected number".to_string(),
                ))
            },
        )
    }

    /// PMT(rate, nper, pv, [fv], [type])
    pub(crate) fn fn_pmt(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        let arg_count = args.len();
        if !(3..=5).contains(&arg_count) {
            return CalcResult::new_args_number_error(cell);
        }
        let rate = match self.get_number(&args[0], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        // number of periods
        let nper = match self.get_number(&args[1], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        // present value
        let pv = match self.get_number(&args[2], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        // future_value
        let fv = if arg_count > 3 {
            match self.get_number(&args[3], cell) {
                Ok(f) => f,
                Err(s) => return s,
            }
        } else {
            0.0
        };
        let period_start = if arg_count > 4 {
            match self.get_number(&args[4], cell) {
                Ok(f) => f != 0.0,
                Err(s) => return s,
            }
        } else {
            // at the end of the period
            false
        };
        match compute_payment(rate, nper, pv, fv, period_start) {
            Ok(p) => CalcResult::Number(p),
            Err(error) => CalcResult::Error {
                error: error.0,
                origin: cell,
                message: error.1,
            },
        }
    }

    // PV(rate, nper, pmt, [fv], [type])
    pub(crate) fn fn_pv(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        let arg_count = args.len();
        if !(3..=5).contains(&arg_count) {
            return CalcResult::new_args_number_error(cell);
        }
        let rate = match self.get_number(&args[0], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        // nper
        let period_count = match self.get_number(&args[1], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        // pmt
        let payment = match self.get_number(&args[2], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        // fv
        let future_value = if arg_count > 3 {
            match self.get_number(&args[3], cell) {
                Ok(f) => f,
                Err(s) => return s,
            }
        } else {
            0.0
        };
        let period_start = if arg_count > 4 {
            match self.get_number(&args[4], cell) {
                Ok(f) => f != 0.0,
                Err(s) => return s,
            }
        } else {
            // at the end of the period
            false
        };
        if rate == 0.0 {
            return CalcResult::Number(-future_value - payment * period_count);
        }
        if rate == -1.0 {
            return CalcResult::Error {
                error: Error::DIV,
                origin: cell,
                message: "Rate must be != -1".to_string(),
            };
        };
        let rate_nper = (1.0 + rate).powf(period_count);
        let result = if period_start {
            // type = 1
            -(future_value * rate + payment * (1.0 + rate) * (rate_nper - 1.0)) / (rate * rate_nper)
        } else {
            (-future_value * rate - payment * (rate_nper - 1.0)) / (rate * rate_nper)
        };
        if result.is_nan() || result.is_infinite() {
            return CalcResult::Error {
                error: Error::NUM,
                origin: cell,
                message: "Invalid result".to_string(),
            };
        }

        CalcResult::Number(result)
    }

    // RATE(nper, pmt, pv, [fv], [type], [guess])
    pub(crate) fn fn_rate(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        let arg_count = args.len();
        if !(3..=5).contains(&arg_count) {
            return CalcResult::new_args_number_error(cell);
        }
        let nper = match self.get_number(&args[0], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        let pmt = match self.get_number(&args[1], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        let pv = match self.get_number(&args[2], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        // fv
        let fv = if arg_count > 3 {
            match self.get_number(&args[3], cell) {
                Ok(f) => f,
                Err(s) => return s,
            }
        } else {
            0.0
        };
        let annuity_type = if arg_count > 4 {
            match self.get_number(&args[4], cell) {
                Ok(f) => i32::from(f != 0.0),
                Err(s) => return s,
            }
        } else {
            // at the end of the period
            0
        };

        let guess = if arg_count > 5 {
            match self.get_number(&args[5], cell) {
                Ok(f) => f,
                Err(s) => return s,
            }
        } else {
            0.1
        };

        match compute_rate(pv, fv, nper, pmt, annuity_type, guess) {
            Ok(f) => CalcResult::Number(f),
            Err(error) => CalcResult::Error {
                error: error.0,
                origin: cell,
                message: error.1,
            },
        }
    }

    // NPER(rate,pmt,pv,[fv],[type])
    pub(crate) fn fn_nper(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        let arg_count = args.len();
        if !(3..=5).contains(&arg_count) {
            return CalcResult::new_args_number_error(cell);
        }
        let rate = match self.get_number(&args[0], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        // pmt
        let payment = match self.get_number(&args[1], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        // pv
        let present_value = match self.get_number(&args[2], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        // fv
        let future_value = if arg_count > 3 {
            match self.get_number(&args[3], cell) {
                Ok(f) => f,
                Err(s) => return s,
            }
        } else {
            0.0
        };
        let period_start = if arg_count > 4 {
            match self.get_number(&args[4], cell) {
                Ok(f) => f != 0.0,
                Err(s) => return s,
            }
        } else {
            // at the end of the period
            false
        };
        if rate == 0.0 {
            if payment == 0.0 {
                return CalcResult::Error {
                    error: Error::DIV,
                    origin: cell,
                    message: "Divide by zero".to_string(),
                };
            }
            return CalcResult::Number(-(future_value + present_value) / payment);
        }
        if rate < -1.0 {
            return CalcResult::Error {
                error: Error::NUM,
                origin: cell,
                message: "Rate must be > -1".to_string(),
            };
        };
        let rate_nper = if period_start {
            // type = 1
            if payment != 0.0 {
                let term = payment * (1.0 + rate) / rate;
                (1.0 - future_value / term) / (1.0 + present_value / term)
            } else {
                -future_value / present_value
            }
        } else {
            // type = 0
            if payment != 0.0 {
                let term = payment / rate;
                (1.0 - future_value / term) / (1.0 + present_value / term)
            } else {
                -future_value / present_value
            }
        };
        if rate_nper <= 0.0 {
            return CalcResult::Error {
                error: Error::NUM,
                origin: cell,
                message: "Cannot compute.".to_string(),
            };
        }
        let result = rate_nper.ln() / (1.0 + rate).ln();
        CalcResult::Number(result)
    }

    // FV(rate, nper, pmt, [pv], [type])
    pub(crate) fn fn_fv(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        let arg_count = args.len();
        if !(3..=5).contains(&arg_count) {
            return CalcResult::new_args_number_error(cell);
        }
        let rate = match self.get_number(&args[0], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        // number of periods
        let nper = match self.get_number(&args[1], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        // payment
        let pmt = match self.get_number(&args[2], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        // present value
        let pv = if arg_count > 3 {
            match self.get_number(&args[3], cell) {
                Ok(f) => f,
                Err(s) => return s,
            }
        } else {
            0.0
        };
        let period_start = if arg_count > 4 {
            match self.get_number(&args[4], cell) {
                Ok(f) => f != 0.0,
                Err(s) => return s,
            }
        } else {
            // at the end of the period
            false
        };
        match compute_future_value(rate, nper, pmt, pv, period_start) {
            Ok(f) => CalcResult::Number(f),
            Err(error) => CalcResult::Error {
                error: error.0,
                origin: cell,
                message: error.1,
            },
        }
    }

    // IPMT(rate, per, nper, pv, [fv], [type])
    pub(crate) fn fn_ipmt(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        let arg_count = args.len();
        if !(4..=6).contains(&arg_count) {
            return CalcResult::new_args_number_error(cell);
        }
        let rate = match self.get_number(&args[0], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        // per
        let period = match self.get_number(&args[1], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        // nper
        let period_count = match self.get_number(&args[2], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        // pv
        let present_value = match self.get_number(&args[3], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        // fv
        let future_value = if arg_count > 4 {
            match self.get_number(&args[4], cell) {
                Ok(f) => f,
                Err(s) => return s,
            }
        } else {
            0.0
        };
        let period_start = if arg_count > 5 {
            match self.get_number(&args[5], cell) {
                Ok(f) => f != 0.0,
                Err(s) => return s,
            }
        } else {
            // at the end of the period
            false
        };
        let ipmt = match compute_ipmt(
            rate,
            period,
            period_count,
            present_value,
            future_value,
            period_start,
        ) {
            Ok(f) => f,
            Err(error) => {
                return CalcResult::Error {
                    error: error.0,
                    origin: cell,
                    message: error.1,
                }
            }
        };
        CalcResult::Number(ipmt)
    }

    // PPMT(rate, per, nper, pv, [fv], [type])
    pub(crate) fn fn_ppmt(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        let arg_count = args.len();
        if !(4..=6).contains(&arg_count) {
            return CalcResult::new_args_number_error(cell);
        }
        let rate = match self.get_number(&args[0], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        // per
        let period = match self.get_number(&args[1], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        // nper
        let period_count = match self.get_number(&args[2], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        // pv
        let present_value = match self.get_number(&args[3], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        // fv
        let future_value = if arg_count > 4 {
            match self.get_number(&args[4], cell) {
                Ok(f) => f,
                Err(s) => return s,
            }
        } else {
            0.0
        };
        let period_start = if arg_count > 5 {
            match self.get_number(&args[5], cell) {
                Ok(f) => f != 0.0,
                Err(s) => return s,
            }
        } else {
            // at the end of the period
            false
        };

        let ppmt = match compute_ppmt(
            rate,
            period,
            period_count,
            present_value,
            future_value,
            period_start,
        ) {
            Ok(f) => f,
            Err(error) => {
                return CalcResult::Error {
                    error: error.0,
                    origin: cell,
                    message: error.1,
                }
            }
        };
        CalcResult::Number(ppmt)
    }

    // NPV(rate, value1, [value2],...)
    // npv = Sum[value[i]/(1+rate)^i, {i, 1, n}]
    pub(crate) fn fn_npv(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        let arg_count = args.len();
        if arg_count < 2 {
            return CalcResult::new_args_number_error(cell);
        }
        let rate = match self.get_number(&args[0], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        let mut values = Vec::new();
        for arg in &args[1..] {
            match self.evaluate_node_in_context(arg, cell) {
                CalcResult::Number(value) => values.push(value),
                CalcResult::Range { left, right } => {
                    if left.sheet != right.sheet {
                        return CalcResult::new_error(
                            Error::VALUE,
                            cell,
                            "Ranges are in different sheets".to_string(),
                        );
                    }
                    let row1 = left.row;
                    let mut row2 = right.row;
                    let column1 = left.column;
                    let mut column2 = right.column;
                    match self.clip_to_used_area(left.sheet, row1, column1, row2, column2) {
                        Ok((r, c)) => {
                            row2 = r;
                            column2 = c;
                        }
                        Err(message) => return CalcResult::new_error(Error::ERROR, cell, message),
                    }
                    for row in row1..row2 + 1 {
                        for column in column1..(column2 + 1) {
                            match self.evaluate_cell(CellReferenceIndex {
                                sheet: left.sheet,
                                row,
                                column,
                            }) {
                                CalcResult::Number(value) => {
                                    values.push(value);
                                }
                                error @ CalcResult::Error { .. } => return error,
                                _ => {
                                    // We ignore booleans and strings
                                }
                            }
                        }
                    }
                }
                error @ CalcResult::Error { .. } => return error,
                _ => {
                    // We ignore booleans and strings
                }
            };
        }
        match compute_npv(rate, &values) {
            Ok(f) => CalcResult::Number(f),
            Err(error) => CalcResult::new_error(error.0, cell, error.1),
        }
    }

    // Returns the internal rate of return for a series of cash flows represented by the numbers
    // in values.
    // These cash flows do not have to be even, as they would be for an annuity.
    // However, the cash flows must occur at regular intervals, such as monthly or annually.
    // The internal rate of return is the interest rate received for an investment consisting
    // of payments (negative values) and income (positive values) that occur at regular periods

    // IRR(values, [guess])
    pub(crate) fn fn_irr(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        let arg_count = args.len();
        if arg_count > 2 || arg_count == 0 {
            return CalcResult::new_args_number_error(cell);
        }
        let values = match self.get_array_of_numbers(&args[0], &cell) {
            Ok(s) => s,
            Err(error) => return error,
        };
        let guess = if arg_count == 2 {
            match self.get_number(&args[1], cell) {
                Ok(f) => f,
                Err(s) => return s,
            }
        } else {
            0.1
        };
        match compute_irr(&values, guess) {
            Ok(f) => CalcResult::Number(f),
            Err(error) => CalcResult::Error {
                error: error.0,
                origin: cell,
                message: error.1,
            },
        }
    }

    // XNPV(rate, values, dates)
    pub(crate) fn fn_xnpv(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        let arg_count = args.len();
        if !(2..=3).contains(&arg_count) {
            return CalcResult::new_args_number_error(cell);
        }
        let rate = match self.get_number(&args[0], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        let values = match self.get_array_of_numbers_xpnv(&args[1], &cell, Error::NUM) {
            Ok(s) => s,
            Err(error) => return error,
        };
        let dates = match self.get_array_of_numbers_xpnv(&args[2], &cell, Error::VALUE) {
            Ok(s) => s,
            Err(error) => return error,
        };
        // Decimal points on dates are truncated
        let dates: Vec<f64> = dates.iter().map(|s| s.floor()).collect();
        let values_count = values.len();
        // If values and dates contain a different number of values, XNPV returns the #NUM! error value.
        if values_count != dates.len() {
            return CalcResult::new_error(
                Error::NUM,
                cell,
                "Values and dates must be the same length".to_string(),
            );
        }
        if values_count == 0 {
            return CalcResult::new_error(Error::NUM, cell, "Not enough values".to_string());
        }
        let first_date = dates[0];
        for date in &dates {
            if *date < MINIMUM_DATE_SERIAL_NUMBER as f64
                || *date > MAXIMUM_DATE_SERIAL_NUMBER as f64
            {
                // Excel docs claim that if any number in dates is not a valid date,
                // XNPV returns the #VALUE! error value, but it seems to return #VALUE!
                return CalcResult::new_error(
                    Error::NUM,
                    cell,
                    "Invalid number for date".to_string(),
                );
            }
            // If any number in dates precedes the starting date, XNPV returns the #NUM! error value.
            if date < &first_date {
                return CalcResult::new_error(
                    Error::NUM,
                    cell,
                    "Date precedes the starting date".to_string(),
                );
            }
        }
        // It seems Excel returns #NUM! if rate < 0, this is only necessary if r <= -1
        if rate <= 0.0 {
            return CalcResult::new_error(Error::NUM, cell, "rate needs to be > 0".to_string());
        }
        match compute_xnpv(rate, &values, &dates) {
            Ok(f) => CalcResult::Number(f),
            Err((error, message)) => CalcResult::new_error(error, cell, message),
        }
    }

    // XIRR(values, dates, [guess])
    pub(crate) fn fn_xirr(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        let arg_count = args.len();
        if !(2..=3).contains(&arg_count) {
            return CalcResult::new_args_number_error(cell);
        }
        let values = match self.get_array_of_numbers_xirr(&args[0], &cell) {
            Ok(s) => s,
            Err(error) => return error,
        };
        let dates = match self.get_array_of_numbers_xirr(&args[1], &cell) {
            Ok(s) => s,
            Err(error) => return error,
        };
        let guess = if arg_count == 3 {
            match self.get_number(&args[2], cell) {
                Ok(f) => f,
                Err(s) => return s,
            }
        } else {
            0.1
        };
        // Decimal points on dates are truncated
        let dates: Vec<f64> = dates.iter().map(|s| s.floor()).collect();
        let values_count = values.len();
        // If values and dates contain a different number of values, XNPV returns the #NUM! error value.
        if values_count != dates.len() {
            return CalcResult::new_error(
                Error::NUM,
                cell,
                "Values and dates must be the same length".to_string(),
            );
        }
        if values_count == 0 {
            return CalcResult::new_error(Error::NUM, cell, "Not enough values".to_string());
        }
        let first_date = dates[0];
        for date in &dates {
            if *date < MINIMUM_DATE_SERIAL_NUMBER as f64
                || *date > MAXIMUM_DATE_SERIAL_NUMBER as f64
            {
                return CalcResult::new_error(
                    Error::NUM,
                    cell,
                    "Invalid number for date".to_string(),
                );
            }
            // If any number in dates precedes the starting date, XIRR returns the #NUM! error value.
            if date < &first_date {
                return CalcResult::new_error(
                    Error::NUM,
                    cell,
                    "Date precedes the starting date".to_string(),
                );
            }
        }
        match compute_xirr(&values, &dates, guess) {
            Ok(f) => CalcResult::Number(f),
            Err((error, message)) => CalcResult::Error {
                error,
                origin: cell,
                message,
            },
        }
    }

    //  MIRR(values, finance_rate, reinvest_rate)
    // The formula is:
    // $$ (-NPV(r1, v_p) * (1+r1)^y)/(NPV(r2, v_n)*(1+r2))^(1/y)-1$$
    // where:
    // $r1$ is the reinvest_rate, $r2$ the finance_rate
    // $v_p$ the vector of positive values
    // $v_n$ the vector of negative values
    // and $y$ is dimension of $v$ - 1 (number of years)
    pub(crate) fn fn_mirr(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 3 {
            return CalcResult::new_args_number_error(cell);
        }
        let values = match self.get_array_of_numbers(&args[0], &cell) {
            Ok(s) => s,
            Err(error) => return error,
        };
        let finance_rate = match self.get_number(&args[1], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        let reinvest_rate = match self.get_number(&args[2], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        let mut positive_values = Vec::new();
        let mut negative_values = Vec::new();
        let mut last_negative_index = -1;
        for (index, &value) in values.iter().enumerate() {
            let (p, n) = if value >= 0.0 {
                (value, 0.0)
            } else {
                last_negative_index = index as i32;
                (0.0, value)
            };
            positive_values.push(p);
            negative_values.push(n);
        }
        if last_negative_index == -1 {
            return CalcResult::new_error(
                Error::DIV,
                cell,
                "Invalid data for MIRR function".to_string(),
            );
        }
        // We do a bit of analysis if the rates are -1 as there are some cancellations
        // It is probably not important.
        let years = values.len() as f64;
        let top = if reinvest_rate == -1.0 {
            // This is finite
            match positive_values.last() {
                Some(f) => *f,
                None => 0.0,
            }
        } else {
            match compute_npv(reinvest_rate, &positive_values) {
                Ok(npv) => -npv * ((1.0 + reinvest_rate).powf(years)),
                Err((error, message)) => {
                    return CalcResult::Error {
                        error,
                        origin: cell,
                        message,
                    }
                }
            }
        };
        let bottom = if finance_rate == -1.0 {
            if last_negative_index == 0 {
                // This is still finite
                negative_values[last_negative_index as usize]
            } else {
                // or -Infinity depending of the sign in the last_negative_index coef.
                // But it is irrelevant for the calculation
                f64::INFINITY
            }
        } else {
            match compute_npv(finance_rate, &negative_values) {
                Ok(npv) => npv * (1.0 + finance_rate),
                Err((error, message)) => {
                    return CalcResult::Error {
                        error,
                        origin: cell,
                        message,
                    }
                }
            }
        };

        let result = (top / bottom).powf(1.0 / (years - 1.0)) - 1.0;
        if result.is_infinite() {
            return CalcResult::new_error(Error::DIV, cell, "Division by 0".to_string());
        }
        if result.is_nan() {
            return CalcResult::new_error(Error::NUM, cell, "Invalid data for MIRR".to_string());
        }
        CalcResult::Number(result)
    }

    // ISPMT(rate, per, nper, pv)
    // Formula is:
    // $$pv*rate*\left(\frac{per}{nper}-1\right)$$
    pub(crate) fn fn_ispmt(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 4 {
            return CalcResult::new_args_number_error(cell);
        }
        let rate = match self.get_number(&args[0], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        let per = match self.get_number(&args[1], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        let nper = match self.get_number(&args[2], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        let pv = match self.get_number(&args[3], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        if nper == 0.0 {
            return CalcResult::new_error(Error::DIV, cell, "Division by 0".to_string());
        }
        CalcResult::Number(pv * rate * (per / nper - 1.0))
    }

    // RRI(nper, pv, fv)
    // Formula is
    // $$ \left(\frac{fv}{pv}\right)^{\frac{1}{nper}}-1  $$
    pub(crate) fn fn_rri(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 3 {
            return CalcResult::new_args_number_error(cell);
        }
        let nper = match self.get_number(&args[0], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        let pv = match self.get_number(&args[1], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        let fv = match self.get_number(&args[2], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        if nper <= 0.0 {
            return CalcResult::new_error(Error::NUM, cell, "nper should be >0".to_string());
        }
        // When the value is unchanged the rate is zero (this also covers the
        // pv == fv == 0 case, which Excel returns as 0 rather than an error).
        if fv == pv {
            return CalcResult::Number(0.0);
        }
        if pv == 0.0 {
            // Note error is NUM not DIV/0 also bellow
            return CalcResult::new_error(Error::NUM, cell, "Division by 0".to_string());
        }
        let result = (fv / pv).powf(1.0 / nper) - 1.0;
        if result.is_infinite() {
            return CalcResult::new_error(Error::NUM, cell, "Division by 0".to_string());
        }
        if result.is_nan() {
            return CalcResult::new_error(Error::NUM, cell, "Invalid data for RRI".to_string());
        }

        CalcResult::Number(result)
    }

    // SLN(cost, salvage, life)
    // Formula is:
    // $$ \frac{cost-salvage}{life} $$
    pub(crate) fn fn_sln(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 3 {
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
        if life == 0.0 {
            return CalcResult::new_error(Error::DIV, cell, "Division by 0".to_string());
        }
        let result = (cost - salvage) / life;

        CalcResult::Number(result)
    }

    // SYD(cost, salvage, life, per)
    // Formula is:
    // $$ \frac{(cost-salvage)*(life-per+1)*2}{life*(life+1)} $$
    pub(crate) fn fn_syd(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 4 {
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
        let per = match self.get_number(&args[3], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        if life == 0.0 {
            return CalcResult::new_error(Error::NUM, cell, "Division by 0".to_string());
        }
        if per > life || per <= 0.0 {
            return CalcResult::new_error(Error::NUM, cell, "per should be <= life".to_string());
        }
        let result = ((cost - salvage) * (life - per + 1.0) * 2.0) / (life * (life + 1.0));

        CalcResult::Number(result)
    }

    // NOMINAL(effective_rate, npery)
    // Formula is:
    // $$ n\times\left(\left(1+r\right)^{\frac{1}{n}}-1\right) $$
    // where:
    //   $r$ is the effective interest rate
    //   $n$ is the number of periods per year
    pub(crate) fn fn_nominal(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 2 {
            return CalcResult::new_args_number_error(cell);
        }
        let effect_rate = match self.get_number_no_bools(&args[0], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        let npery = match self.get_number_no_bools(&args[1], cell) {
            Ok(f) => f.floor(),
            Err(s) => return s,
        };
        if effect_rate <= 0.0 || npery < 1.0 {
            return CalcResult::new_error(Error::NUM, cell, "Invalid arguments".to_string());
        }
        let result = ((1.0 + effect_rate).powf(1.0 / npery) - 1.0) * npery;
        if result.is_infinite() {
            return CalcResult::new_error(Error::DIV, cell, "Division by 0".to_string());
        }
        if result.is_nan() {
            return CalcResult::new_error(Error::NUM, cell, "Invalid data for RRI".to_string());
        }

        CalcResult::Number(result)
    }

    // EFFECT(nominal_rate, npery)
    // Formula is:
    // $$ \left(1+\frac{r}{n}\right)^n-1 $$
    // where:
    //   $r$ is the nominal interest rate
    //   $n$ is the number of periods per year
    pub(crate) fn fn_effect(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 2 {
            return CalcResult::new_args_number_error(cell);
        }
        let nominal_rate = match self.get_number_no_bools(&args[0], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        let npery = match self.get_number_no_bools(&args[1], cell) {
            Ok(f) => f.floor(),
            Err(s) => return s,
        };
        if nominal_rate <= 0.0 || npery < 1.0 {
            return CalcResult::new_error(Error::NUM, cell, "Invalid arguments".to_string());
        }
        let result = (1.0 + nominal_rate / npery).powf(npery) - 1.0;
        if result.is_infinite() {
            return CalcResult::new_error(Error::DIV, cell, "Division by 0".to_string());
        }
        if result.is_nan() {
            return CalcResult::new_error(Error::NUM, cell, "Invalid data for RRI".to_string());
        }

        CalcResult::Number(result)
    }

    // PDURATION(rate, pv, fv)
    // Formula is:
    // $$ \frac{log(fv) - log(pv)}{log(1+r)} $$
    // where:
    //   * $r$ is the interest rate per period
    //   * $pv$ is the present value of the investment
    //   * $fv$ is the desired future value of the investment
    pub(crate) fn fn_pduration(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 3 {
            return CalcResult::new_args_number_error(cell);
        }
        let rate = match self.get_number(&args[0], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        let pv = match self.get_number(&args[1], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        let fv = match self.get_number(&args[2], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        if fv <= 0.0 || pv <= 0.0 || rate <= 0.0 {
            return CalcResult::new_error(Error::NUM, cell, "Invalid arguments".to_string());
        }
        let result = (fv.ln() - pv.ln()) / ((1.0 + rate).ln());
        if result.is_infinite() {
            return CalcResult::new_error(Error::DIV, cell, "Division by 0".to_string());
        }
        if result.is_nan() {
            return CalcResult::new_error(Error::NUM, cell, "Invalid data for RRI".to_string());
        }

        CalcResult::Number(result)
    }

    // This next three functions deal with Treasure Bills or T-Bills for short
    // They are zero-coupon that mature in one year or less.
    //  Definitions:
    //    $r$ be the discount rate
    //    $v$ the face value of the Bill
    //    $p$ the price of the Bill
    //    $d_m$ is the number of days from the settlement to maturity
    // Then:
    //   $$ p = v \times\left(1-\frac{d_m}{r}\right) $$
    // If d_m is less than 183 days the he Bond Equivalent Yield (BEY, here $y$) is given by:
    // $$ y = \frac{F - B}{M}\times \frac{365}{d_m} = \frac{365\times r}{360-r\times d_m}
    // If d_m>= 183 days things are a bit more complicated.
    // Let $d_e = d_m - 365/2$ if $d_m <= 365$ or $d_e = 183$ if $d_m = 366$.
    // $$ v = p\times \left(1+\frac{y}{2}\right)\left(1+d_e\times\frac{y}{365}\right) $$
    // Together with the previous relation of $p$ and $v$ gives us a quadratic equation for $y$.

    // TBILLEQ(settlement, maturity, discount)
    pub(crate) fn fn_tbilleq(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 3 {
            return CalcResult::new_args_number_error(cell);
        }
        let settlement = match self.get_number_no_bools(&args[0], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        let maturity = match self.get_number_no_bools(&args[1], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        let discount = match self.get_number_no_bools(&args[2], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        let less_than_one_year = match is_less_than_one_year(settlement as i64, maturity as i64) {
            Ok(f) => f,
            Err(_) => return CalcResult::new_error(Error::NUM, cell, "Invalid date".to_string()),
        };
        if settlement > maturity {
            return CalcResult::new_error(
                Error::NUM,
                cell,
                "settlement should be <= maturity".to_string(),
            );
        }
        if !less_than_one_year {
            return CalcResult::new_error(
                Error::NUM,
                cell,
                "maturity <= settlement + year".to_string(),
            );
        }
        if discount <= 0.0 {
            return CalcResult::new_error(Error::NUM, cell, "discount should be >0".to_string());
        }
        // days to maturity
        let d_m = maturity - settlement;
        let result = if d_m < 183.0 {
            365.0 * discount / (360.0 - discount * d_m)
        } else {
            // Equation here is:
            // (1-days*rate/360)*(1+y/2)*(1+d_extra*y/year)=1
            let year = if d_m == 366.0 { 366.0 } else { 365.0 };
            let d_extra = d_m - year / 2.0;
            let alpha = 1.0 - d_m * discount / 360.0;
            let beta = 0.5 + d_extra / year;
            // ay^2+by+c=0
            let a = d_extra * alpha / (year * 2.0);
            let b = alpha * beta;
            let c = alpha - 1.0;
            (-b + (b * b - 4.0 * a * c).sqrt()) / (2.0 * a)
        };
        if result.is_infinite() {
            return CalcResult::new_error(Error::DIV, cell, "Division by 0".to_string());
        }
        if result.is_nan() {
            return CalcResult::new_error(Error::NUM, cell, "Invalid data for RRI".to_string());
        }

        CalcResult::Number(result)
    }

    // TBILLPRICE(settlement, maturity, discount)
    pub(crate) fn fn_tbillprice(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 3 {
            return CalcResult::new_args_number_error(cell);
        }
        let settlement = match self.get_number_no_bools(&args[0], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        let maturity = match self.get_number_no_bools(&args[1], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        let discount = match self.get_number_no_bools(&args[2], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        let less_than_one_year = match is_less_than_one_year(settlement as i64, maturity as i64) {
            Ok(f) => f,
            Err(_) => return CalcResult::new_error(Error::NUM, cell, "Invalid date".to_string()),
        };
        if settlement > maturity {
            return CalcResult::new_error(
                Error::NUM,
                cell,
                "settlement should be <= maturity".to_string(),
            );
        }
        if !less_than_one_year {
            return CalcResult::new_error(
                Error::NUM,
                cell,
                "maturity <= settlement + year".to_string(),
            );
        }
        if discount <= 0.0 {
            return CalcResult::new_error(Error::NUM, cell, "discount should be >0".to_string());
        }
        // days to maturity
        let d_m = maturity - settlement;
        let result = 100.0 * (1.0 - discount * d_m / 360.0);
        if result.is_infinite() {
            return CalcResult::new_error(Error::DIV, cell, "Division by 0".to_string());
        }
        if result.is_nan() || result < 0.0 {
            return CalcResult::new_error(Error::NUM, cell, "Invalid data for RRI".to_string());
        }

        CalcResult::Number(result)
    }

    // TBILLYIELD(settlement, maturity, pr)
    pub(crate) fn fn_tbillyield(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 3 {
            return CalcResult::new_args_number_error(cell);
        }
        let settlement = match self.get_number_no_bools(&args[0], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        let maturity = match self.get_number_no_bools(&args[1], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        let pr = match self.get_number_no_bools(&args[2], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        let less_than_one_year = match is_less_than_one_year(settlement as i64, maturity as i64) {
            Ok(f) => f,
            Err(_) => return CalcResult::new_error(Error::NUM, cell, "Invalid date".to_string()),
        };
        if settlement > maturity {
            return CalcResult::new_error(
                Error::NUM,
                cell,
                "settlement should be <= maturity".to_string(),
            );
        }
        if !less_than_one_year {
            return CalcResult::new_error(
                Error::NUM,
                cell,
                "maturity <= settlement + year".to_string(),
            );
        }
        if pr <= 0.0 {
            return CalcResult::new_error(Error::NUM, cell, "discount should be >0".to_string());
        }
        let days = maturity - settlement;
        let result = (100.0 - pr) * 360.0 / (pr * days);

        CalcResult::Number(result)
    }

    // DOLLARDE(fractional_dollar, fraction)
    pub(crate) fn fn_dollarde(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 2 {
            return CalcResult::new_args_number_error(cell);
        }
        let fractional_dollar = match self.get_number_no_bools(&args[0], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        let fraction = match self.get_number_no_bools(&args[1], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        if fraction < 0.0 {
            return CalcResult::new_error(Error::NUM, cell, "fraction should be >= 1".to_string());
        }
        // `fraction` is truncated to an integer; if that is 0 it is a DIV/0.
        let a_base = fraction.trunc();
        if a_base < 1.0 {
            return CalcResult::new_error(Error::DIV, cell, "fraction should be >= 1".to_string());
        }
        // See LibreOffice/ExcelFinancialFunctions: the fractional part is scaled
        // by 10^ceil(log10(a_base)) and divided by the fraction base.
        let dollar = fractional_dollar.trunc();
        let remainder = fractional_dollar - dollar;
        let digits = 10f64.powf(a_base.log10().ceil());
        CalcResult::Number(remainder * digits / a_base + dollar)
    }

    // DOLLARFR(decimal_dollar, fraction)
    pub(crate) fn fn_dollarfr(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 2 {
            return CalcResult::new_args_number_error(cell);
        }
        let decimal_dollar = match self.get_number_no_bools(&args[0], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        let fraction = match self.get_number_no_bools(&args[1], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        if fraction < 0.0 {
            return CalcResult::new_error(Error::NUM, cell, "fraction should be >= 1".to_string());
        }
        // `fraction` is truncated to an integer; if that is 0 it is a DIV/0.
        let a_base = fraction.trunc();
        if a_base < 1.0 {
            return CalcResult::new_error(Error::DIV, cell, "fraction should be >= 1".to_string());
        }
        // Inverse of DOLLARDE: the decimal remainder is expressed in fractional
        // units (a_base) and scaled down by 10^ceil(log10(a_base)).
        let dollar = decimal_dollar.trunc();
        let remainder = decimal_dollar - dollar;
        let digits = 10f64.powf(a_base.log10().ceil());
        CalcResult::Number(remainder * a_base / digits.abs() + dollar)
    }

    // CUMIPMT(rate, nper, pv, start_period, end_period, type)
    pub(crate) fn fn_cumipmt(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 6 {
            return CalcResult::new_args_number_error(cell);
        }
        let rate = match self.get_number_no_bools(&args[0], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        let nper = match self.get_number_no_bools(&args[1], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        let pv = match self.get_number_no_bools(&args[2], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        let start_period = match self.get_number_no_bools(&args[3], cell) {
            Ok(f) => f.ceil() as i32,
            Err(s) => return s,
        };
        let end_period = match self.get_number_no_bools(&args[4], cell) {
            Ok(f) => f.trunc() as i32,
            Err(s) => return s,
        };
        // 0 at the end of the period, 1 at the beginning of the period
        let period_type = match self.get_number_no_bools(&args[5], cell) {
            Ok(f) => {
                if f == 0.0 {
                    false
                } else if f == 1.0 {
                    true
                } else {
                    return CalcResult::new_error(
                        Error::NUM,
                        cell,
                        "invalid period type".to_string(),
                    );
                }
            }
            Err(s) => return s,
        };
        if start_period > end_period {
            return CalcResult::new_error(
                Error::NUM,
                cell,
                "start period should come before end period".to_string(),
            );
        }
        if rate <= 0.0 || nper <= 0.0 || pv <= 0.0 || start_period < 1 {
            return CalcResult::new_error(Error::NUM, cell, "invalid parameters".to_string());
        }
        let mut result = 0.0;
        for period in start_period..=end_period {
            result += match compute_ipmt(rate, period as f64, nper, pv, 0.0, period_type) {
                Ok(f) => f,
                Err(error) => {
                    return CalcResult::Error {
                        error: error.0,
                        origin: cell,
                        message: error.1,
                    }
                }
            }
        }
        CalcResult::Number(result)
    }

    // CUMPRINC(rate, nper, pv, start_period, end_period, type)
    pub(crate) fn fn_cumprinc(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 6 {
            return CalcResult::new_args_number_error(cell);
        }
        let rate = match self.get_number_no_bools(&args[0], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        let nper = match self.get_number_no_bools(&args[1], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        let pv = match self.get_number_no_bools(&args[2], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        let start_period = match self.get_number_no_bools(&args[3], cell) {
            Ok(f) => f.ceil() as i32,
            Err(s) => return s,
        };
        let end_period = match self.get_number_no_bools(&args[4], cell) {
            Ok(f) => f.trunc() as i32,
            Err(s) => return s,
        };
        // 0 at the end of the period, 1 at the beginning of the period
        let period_type = match self.get_number_no_bools(&args[5], cell) {
            Ok(f) => {
                if f == 0.0 {
                    false
                } else if f == 1.0 {
                    true
                } else {
                    return CalcResult::new_error(
                        Error::NUM,
                        cell,
                        "invalid period type".to_string(),
                    );
                }
            }
            Err(s) => return s,
        };
        if start_period > end_period {
            return CalcResult::new_error(
                Error::NUM,
                cell,
                "start period should come before end period".to_string(),
            );
        }
        if rate <= 0.0 || nper <= 0.0 || pv <= 0.0 || start_period < 1 {
            return CalcResult::new_error(Error::NUM, cell, "invalid parameters".to_string());
        }
        let mut result = 0.0;
        for period in start_period..=end_period {
            result += match compute_ppmt(rate, period as f64, nper, pv, 0.0, period_type) {
                Ok(f) => f,
                Err(error) => {
                    return CalcResult::Error {
                        error: error.0,
                        origin: cell,
                        message: error.1,
                    }
                }
            }
        }
        CalcResult::Number(result)
    }

    // DDB(cost, salvage, life, period, [factor])
    pub(crate) fn fn_ddb(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        let arg_count = args.len();
        if !(4..=5).contains(&arg_count) {
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
        let period = match self.get_number(&args[3], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        // The rate at which the balance declines.
        let factor = if arg_count > 4 {
            match self.get_number_no_bools(&args[4], cell) {
                Ok(f) => f,
                Err(s) => return s,
            }
        } else {
            // If factor is omitted, it is assumed to be 2 (the double-declining balance method).
            2.0
        };
        if period > life || cost < 0.0 || salvage < 0.0 || period <= 0.0 || factor <= 0.0 {
            return CalcResult::new_error(Error::NUM, cell, "invalid parameters".to_string());
        };
        let result = financial_depreciation::ddb_depreciation(cost, salvage, life, period, factor);
        CalcResult::Number(result)
    }

    // DB(cost, salvage, life, period, [month])
    pub(crate) fn fn_db(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        let arg_count = args.len();
        if !(4..=5).contains(&arg_count) {
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
        let period = match self.get_number(&args[3], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        let month = if arg_count > 4 {
            match self.get_number_no_bools(&args[4], cell) {
                Ok(f) => f.trunc(),
                Err(s) => return s,
            }
        } else {
            12.0
        };
        if month == 12.0 && period > life
            || (period > life + 1.0)
            || month <= 0.0
            || month > 12.0
            || period <= 0.0
            || cost < 0.0
        {
            return CalcResult::new_error(Error::NUM, cell, "invalid parameters".to_string());
        };
        if cost == 0.0 {
            return CalcResult::Number(0.0);
        }
        let result = financial_depreciation::db_depreciation(cost, salvage, life, period, month);
        CalcResult::Number(result)
    }

    // ACCRINTM(issue, settlement, rate, [par], [basis])
    pub(crate) fn fn_accrintm(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        let arg_count = args.len();
        if !(3..=5).contains(&arg_count) {
            return CalcResult::new_args_number_error(cell);
        }
        let issue_serial = match self.get_number(&args[0], cell) {
            Ok(c) => c.floor() as i64,
            Err(s) => return s,
        };
        let settlement_serial = match self.get_number(&args[1], cell) {
            Ok(c) => c.floor() as i64,
            Err(s) => return s,
        };
        let rate = match self.get_number(&args[2], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        let par = if arg_count > 3 {
            match self.get_number(&args[3], cell) {
                Ok(f) => f,
                Err(s) => return s,
            }
        } else {
            1000.0
        };
        if rate <= 0.0 {
            return CalcResult::new_error(Error::NUM, cell, "rate must be > 0".to_string());
        }
        if par <= 0.0 {
            return CalcResult::new_error(Error::NUM, cell, "par must be > 0".to_string());
        }
        if issue_serial >= settlement_serial {
            return CalcResult::new_error(
                Error::NUM,
                cell,
                "issue must be before settlement".to_string(),
            );
        }
        let basis_node = if arg_count > 4 {
            args[4].clone()
        } else {
            Node::NumberKind(0.0)
        };
        let yearfrac_args = [
            Node::NumberKind(issue_serial as f64),
            Node::NumberKind(settlement_serial as f64),
            basis_node,
        ];
        match self.fn_yearfrac(&yearfrac_args, cell) {
            CalcResult::Number(yf) => CalcResult::Number(par * rate * yf),
            error => error,
        }
    }

    fn get_yearfrac(
        &mut self,
        start: i64,
        end: i64,
        basis: f64,
        cell: CellReferenceIndex,
    ) -> Result<f64, CalcResult> {
        let args = [
            Node::NumberKind(start as f64),
            Node::NumberKind(end as f64),
            Node::NumberKind(basis),
        ];
        match self.fn_yearfrac(&args, cell) {
            CalcResult::Number(yf) => Ok(yf),
            error => Err(error),
        }
    }

    // Day-count factors shared by PRICEMAT and YIELDMAT, mirroring
    // `getMatFactors` in ExcelFinancialFunctions: all three terms share a single
    // denominator `b = DaysInYear(issue, settlement)`, and the settlement→maturity
    // span is `dim - a` (issue-anchored), not an independent year fraction.
    //
    // Returns `(a, dim, dsm)` already divided by `b`, i.e. in year units:
    //   a   = DaysBetween(issue, settlement) / b   (= YEARFRAC(issue, settlement))
    //   dim = DaysBetween(issue, maturity)   / b
    //   dsm = dim - a
    fn get_mat_factors(
        &mut self,
        issue: i64,
        settlement: i64,
        maturity: i64,
        basis: f64,
        cell: CellReferenceIndex,
    ) -> Result<(f64, f64, f64), CalcResult> {
        let a = self.get_yearfrac(issue, settlement, basis, cell)?;
        let dim = if basis == 1.0 {
            // Actual/Actual has a date-dependent DaysInYear, so YEARFRAC(issue,
            // maturity) would use a different denominator. Re-base onto `b` via
            // the actual day counts: dim = dim_days * a / a_days = dim_days / b.
            let a_days = (settlement - issue) as f64;
            let dim_days = (maturity - issue) as f64;
            // Callers guarantee `issue < settlement`, so `a_days > 0`; this guard
            // is defensive only.
            if a_days == 0.0 {
                return Err(CalcResult::new_error(
                    Error::DIV,
                    cell,
                    "Division by zero".to_string(),
                ));
            }
            dim_days * a / a_days
        } else {
            // Constant DaysInYear, so the common denominator is automatic.
            self.get_yearfrac(issue, maturity, basis, cell)?
        };
        Ok((a, dim, dim - a))
    }

    // DISC(settlement, maturity, pr, redemption, [basis])
    pub(crate) fn fn_disc(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        let arg_count = args.len();
        if !(4..=5).contains(&arg_count) {
            return CalcResult::new_args_number_error(cell);
        }
        let settlement = match self.get_number_no_bools(&args[0], cell) {
            Ok(f) => f.floor() as i64,
            Err(s) => return s,
        };
        let maturity = match self.get_number_no_bools(&args[1], cell) {
            Ok(f) => f.floor() as i64,
            Err(s) => return s,
        };
        let pr = match self.get_number_no_bools(&args[2], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        let redemption = match self.get_number_no_bools(&args[3], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        let basis = if arg_count == 5 {
            match self.get_number_no_bools(&args[4], cell) {
                Ok(f) => f,
                Err(s) => return s,
            }
        } else {
            0.0
        };
        if pr <= 0.0 || redemption <= 0.0 {
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
        let yf = match self.get_yearfrac(settlement, maturity, basis, cell) {
            Ok(f) => f,
            Err(e) => return e,
        };
        if yf == 0.0 {
            return CalcResult::new_error(Error::DIV, cell, "Division by zero".to_string());
        }
        CalcResult::Number((1.0 - pr / redemption) / yf)
    }

    // FVSCHEDULE(principal, schedule)
    pub(crate) fn fn_fvschedule(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 2 {
            return CalcResult::new_args_number_error(cell);
        }
        let principal = match self.get_number(&args[0], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        let schedule = match self.get_array_of_numbers(&args[1], &cell) {
            Ok(s) => s,
            Err(e) => return e,
        };
        let mut result = principal;
        for rate in schedule {
            result *= 1.0 + rate;
        }
        if result.is_infinite() {
            return CalcResult::new_error(Error::DIV, cell, "Division by zero".to_string());
        }
        CalcResult::Number(result)
    }

    // INTRATE(settlement, maturity, investment, redemption, [basis])
    pub(crate) fn fn_intrate(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        let arg_count = args.len();
        if !(4..=5).contains(&arg_count) {
            return CalcResult::new_args_number_error(cell);
        }
        let settlement = match self.get_number_no_bools(&args[0], cell) {
            Ok(f) => f.floor() as i64,
            Err(s) => return s,
        };
        let maturity = match self.get_number_no_bools(&args[1], cell) {
            Ok(f) => f.floor() as i64,
            Err(s) => return s,
        };
        let investment = match self.get_number_no_bools(&args[2], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        let redemption = match self.get_number_no_bools(&args[3], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        let basis = if arg_count == 5 {
            match self.get_number_no_bools(&args[4], cell) {
                Ok(f) => f,
                Err(s) => return s,
            }
        } else {
            0.0
        };
        if investment <= 0.0 || redemption <= 0.0 {
            return CalcResult::new_error(
                Error::NUM,
                cell,
                "investment and redemption must be > 0".to_string(),
            );
        }
        if settlement >= maturity {
            return CalcResult::new_error(
                Error::NUM,
                cell,
                "settlement must be before maturity".to_string(),
            );
        }
        let yf = match self.get_yearfrac(settlement, maturity, basis, cell) {
            Ok(f) => f,
            Err(e) => return e,
        };
        if yf == 0.0 {
            return CalcResult::new_error(Error::DIV, cell, "Division by zero".to_string());
        }
        CalcResult::Number((redemption / investment - 1.0) / yf)
    }

    // PRICEDISC(settlement, maturity, discount, redemption, [basis])
    pub(crate) fn fn_pricedisc(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        let arg_count = args.len();
        if !(4..=5).contains(&arg_count) {
            return CalcResult::new_args_number_error(cell);
        }
        let settlement = match self.get_number_no_bools(&args[0], cell) {
            Ok(f) => f.floor() as i64,
            Err(s) => return s,
        };
        let maturity = match self.get_number_no_bools(&args[1], cell) {
            Ok(f) => f.floor() as i64,
            Err(s) => return s,
        };
        let discount = match self.get_number_no_bools(&args[2], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        let redemption = match self.get_number_no_bools(&args[3], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        let basis = if arg_count == 5 {
            match self.get_number_no_bools(&args[4], cell) {
                Ok(f) => f,
                Err(s) => return s,
            }
        } else {
            0.0
        };
        if discount <= 0.0 || redemption <= 0.0 {
            return CalcResult::new_error(
                Error::NUM,
                cell,
                "discount and redemption must be > 0".to_string(),
            );
        }
        if settlement >= maturity {
            return CalcResult::new_error(
                Error::NUM,
                cell,
                "settlement must be before maturity".to_string(),
            );
        }
        let yf = match self.get_yearfrac(settlement, maturity, basis, cell) {
            Ok(f) => f,
            Err(e) => return e,
        };
        CalcResult::Number(redemption * (1.0 - discount * yf))
    }

    // PRICEMAT(settlement, maturity, issue, rate, yld, [basis])
    pub(crate) fn fn_pricemat(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        let arg_count = args.len();
        if !(5..=6).contains(&arg_count) {
            return CalcResult::new_args_number_error(cell);
        }
        let settlement = match self.get_number_no_bools(&args[0], cell) {
            Ok(f) => f.floor() as i64,
            Err(s) => return s,
        };
        let maturity = match self.get_number_no_bools(&args[1], cell) {
            Ok(f) => f.floor() as i64,
            Err(s) => return s,
        };
        let issue = match self.get_number_no_bools(&args[2], cell) {
            Ok(f) => f.floor() as i64,
            Err(s) => return s,
        };
        let rate = match self.get_number_no_bools(&args[3], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        let yld = match self.get_number_no_bools(&args[4], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        let basis = if arg_count == 6 {
            match self.get_number_no_bools(&args[5], cell) {
                Ok(f) => f,
                Err(s) => return s,
            }
        } else {
            0.0
        };
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
        if issue >= settlement {
            return CalcResult::new_error(
                Error::NUM,
                cell,
                "issue must be before settlement".to_string(),
            );
        }
        let (a, dim, dsm) = match self.get_mat_factors(issue, settlement, maturity, basis, cell) {
            Ok(v) => v,
            Err(e) => return e,
        };
        let denom = 1.0 + yld * dsm;
        if denom == 0.0 {
            return CalcResult::new_error(Error::DIV, cell, "Division by zero".to_string());
        }
        CalcResult::Number(100.0 * ((1.0 + rate * dim) / denom - rate * a))
    }

    // RECEIVED(settlement, maturity, investment, discount, [basis])
    pub(crate) fn fn_received(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        let arg_count = args.len();
        if !(4..=5).contains(&arg_count) {
            return CalcResult::new_args_number_error(cell);
        }
        let settlement = match self.get_number_no_bools(&args[0], cell) {
            Ok(f) => f.floor() as i64,
            Err(s) => return s,
        };
        let maturity = match self.get_number_no_bools(&args[1], cell) {
            Ok(f) => f.floor() as i64,
            Err(s) => return s,
        };
        let investment = match self.get_number_no_bools(&args[2], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        let discount = match self.get_number_no_bools(&args[3], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        let basis = if arg_count == 5 {
            match self.get_number_no_bools(&args[4], cell) {
                Ok(f) => f,
                Err(s) => return s,
            }
        } else {
            0.0
        };
        if investment <= 0.0 || discount <= 0.0 {
            return CalcResult::new_error(
                Error::NUM,
                cell,
                "investment and discount must be > 0".to_string(),
            );
        }
        if settlement >= maturity {
            return CalcResult::new_error(
                Error::NUM,
                cell,
                "settlement must be before maturity".to_string(),
            );
        }
        let yf = match self.get_yearfrac(settlement, maturity, basis, cell) {
            Ok(f) => f,
            Err(e) => return e,
        };
        let denom = 1.0 - discount * yf;
        if denom <= 0.0 {
            return CalcResult::new_error(Error::NUM, cell, "discount * yearfrac >= 1".to_string());
        }
        CalcResult::Number(investment / denom)
    }

    // YIELDDISC(settlement, maturity, pr, redemption, [basis])
    pub(crate) fn fn_yielddisc(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        let arg_count = args.len();
        if !(4..=5).contains(&arg_count) {
            return CalcResult::new_args_number_error(cell);
        }
        let settlement = match self.get_number_no_bools(&args[0], cell) {
            Ok(f) => f.floor() as i64,
            Err(s) => return s,
        };
        let maturity = match self.get_number_no_bools(&args[1], cell) {
            Ok(f) => f.floor() as i64,
            Err(s) => return s,
        };
        let pr = match self.get_number_no_bools(&args[2], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        let redemption = match self.get_number_no_bools(&args[3], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        let basis = if arg_count == 5 {
            match self.get_number_no_bools(&args[4], cell) {
                Ok(f) => f,
                Err(s) => return s,
            }
        } else {
            0.0
        };
        if pr <= 0.0 || redemption <= 0.0 {
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
        let yf = match self.get_yearfrac(settlement, maturity, basis, cell) {
            Ok(f) => f,
            Err(e) => return e,
        };
        if yf == 0.0 {
            return CalcResult::new_error(Error::DIV, cell, "Division by zero".to_string());
        }
        CalcResult::Number((redemption / pr - 1.0) / yf)
    }

    // YIELDMAT(settlement, maturity, issue, rate, price, [basis])
    pub(crate) fn fn_yieldmat(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        let arg_count = args.len();
        if !(5..=6).contains(&arg_count) {
            return CalcResult::new_args_number_error(cell);
        }
        let settlement = match self.get_number_no_bools(&args[0], cell) {
            Ok(f) => f.floor() as i64,
            Err(s) => return s,
        };
        let maturity = match self.get_number_no_bools(&args[1], cell) {
            Ok(f) => f.floor() as i64,
            Err(s) => return s,
        };
        let issue = match self.get_number_no_bools(&args[2], cell) {
            Ok(f) => f.floor() as i64,
            Err(s) => return s,
        };
        let rate = match self.get_number_no_bools(&args[3], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        let price = match self.get_number_no_bools(&args[4], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };
        let basis = if arg_count == 6 {
            match self.get_number_no_bools(&args[5], cell) {
                Ok(f) => f,
                Err(s) => return s,
            }
        } else {
            0.0
        };
        if price <= 0.0 || rate < 0.0 {
            return CalcResult::new_error(
                Error::NUM,
                cell,
                "price must be > 0 and rate >= 0".to_string(),
            );
        }
        if settlement >= maturity {
            return CalcResult::new_error(
                Error::NUM,
                cell,
                "settlement must be before maturity".to_string(),
            );
        }
        if issue >= settlement {
            return CalcResult::new_error(
                Error::NUM,
                cell,
                "issue must be before settlement".to_string(),
            );
        }
        let (a, dim, dsm) = match self.get_mat_factors(issue, settlement, maturity, basis, cell) {
            Ok(v) => v,
            Err(e) => return e,
        };
        let denom = price / 100.0 + rate * a;
        if denom == 0.0 {
            return CalcResult::new_error(Error::DIV, cell, "Division by zero".to_string());
        }
        if dsm == 0.0 {
            return CalcResult::new_error(Error::DIV, cell, "Division by zero".to_string());
        }
        CalcResult::Number(((1.0 + rate * dim) / denom - 1.0) / dsm)
    }
}
