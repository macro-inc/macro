use crate::expressions::token::Error;

// Here we use some numerical routines to solve for some functions:
// RATE, IRR, XIRR
// We use a combination of heuristics, bisection and Newton-Raphson
// If you want to improve on this methods you probably would want to find failing tests first

// From Microsoft docs:
// https://support.microsoft.com/en-us/office/rate-function-9f665657-4a7e-4bb7-a030-83fc59e748ce
// Returns the interest rate per period of an annuity.
// RATE is calculated by iteration (using Newton-Raphson) and can have zero or more solutions.
// If the successive results of RATE do not converge to within 0.0000001 after 20 iterations,
// RATE returns the #NUM! error value.
// NOTE: We need a better algorithm here
pub(crate) fn compute_rate(
    pv: f64,
    fv: f64,
    nper: f64,
    pmt: f64,
    annuity_type: i32,
    guess: f64,
) -> Result<f64, (Error, String)> {
    let mut rate = guess;
    // Excel _claims_ to do 20 iterations, but that will have tests failing
    let max_iterations = 50;
    let eps = 0.0000001;
    let annuity_type = annuity_type as f64;
    if guess <= -1.0 {
        return Err((Error::VALUE, "Rate initial guess must be > -1".to_string()));
    }
    for _ in 1..=max_iterations {
        let t = (1.0 + rate).powf(nper - 1.0);
        let tt = t * (1.0 + rate);
        let f = pv * tt + pmt * (1.0 + rate * annuity_type) * (tt - 1.0) / rate + fv;
        let f_prime = pv * nper * t - pmt * (tt - 1.0) / (rate * rate)
            + pmt * (1.0 + rate * annuity_type) * t * nper / rate;
        let new_rate = rate - f / f_prime;
        if new_rate <= -1.0 {
            return Err((Error::NUM, "Failed to converge".to_string()));
        }
        if (new_rate - rate).abs() < eps {
            return Ok(new_rate);
        }
        rate = new_rate;
    }
    Err((Error::NUM, "Failed to converge".to_string()))
}

pub(crate) fn compute_npv(rate: f64, values: &[f64]) -> Result<f64, (Error, String)> {
    let mut npv = 0.0;
    for (i, item) in values.iter().enumerate() {
        npv += item / (1.0 + rate).powi(i as i32 + 1)
    }
    Ok(npv)
}

// Tries to solve npv(r, values) = 0 for r given values
// Uses a bit of heuristics:
// * First tries Newton-Raphson around the guess
// * Failing that uses bisection and bracketing
// * If that fails (no root found of the interval) uses Newton-Raphson around the edges
// Values for x1, x2 and the guess for N-R are fine tuned using heuristics
pub(crate) fn compute_irr(values: &[f64], guess: f64) -> Result<f64, (Error, String)> {
    if guess <= -1.0 {
        return Err((Error::VALUE, "Rate initial guess must be > -1".to_string()));
    }
    // The values cannot be all positive or all negative
    if values.iter().all(|&x| x >= 0.0) || values.iter().all(|&x| x <= 0.0) {
        return Err((Error::NUM, "Failed to converge".to_string()));
    }
    if let Ok(f) = compute_irr_newton_raphson(values, guess) {
        return Ok(f);
    };
    // We try bisection
    let max_iterations = 50;
    let eps = 1e-10;
    let x1 = -0.99999;
    let x2 = 100.0;
    let f1 = compute_npv(x1, values)?;
    let f2 = compute_npv(x2, values)?;
    if f1 * f2 > 0.0 {
        // The root is not within the limits or there are two roots
        // We try Newton-Raphson a bit above the upper limit and a bit below the lower limit
        if let Ok(f) = compute_irr_newton_raphson(values, 200.0) {
            return Ok(f);
        };
        if let Ok(f) = compute_irr_newton_raphson(values, -2.0) {
            return Ok(f);
        };
        return Err((Error::NUM, "Failed to converge".to_string()));
    }
    let (mut rtb, mut dx) = if f1 < 0.0 {
        (x1, x2 - x1)
    } else {
        (x2, x1 - x2)
    };
    for _ in 1..max_iterations {
        dx *= 0.5;
        let x_mid = rtb + dx;
        let f_mid = compute_npv(x_mid, values)?;
        if f_mid <= 0.0 {
            rtb = x_mid;
        }
        if f_mid.abs() < eps || dx.abs() < eps {
            return Ok(x_mid);
        }
    }

    Err((Error::NUM, "Failed to converge".to_string()))
}

fn compute_npv_prime(rate: f64, values: &[f64]) -> Result<f64, (Error, String)> {
    let mut npv = 0.0;
    for (i, item) in values.iter().enumerate() {
        npv += -item * (i as f64 + 1.0) / (1.0 + rate).powi(i as i32 + 2)
    }
    if npv.is_infinite() || npv.is_nan() {
        return Err((Error::NUM, "NaN".to_string()));
    }
    Ok(npv)
}

fn compute_irr_newton_raphson(values: &[f64], guess: f64) -> Result<f64, (Error, String)> {
    let mut irr = guess;
    let max_iterations = 50;
    let eps = 1e-8;
    for _ in 1..=max_iterations {
        let f = compute_npv(irr, values)?;
        let f_prime = compute_npv_prime(irr, values)?;
        let new_irr = irr - f / f_prime;
        if (new_irr - irr).abs() < eps {
            // A rate <= -1 is outside the valid domain (it is a root of the NPV
            // polynomial but not a real IRR). Reject it so the caller falls back
            // to bisection, which finds the economically meaningful root.
            if new_irr <= -1.0 {
                return Err((Error::NUM, "converged to invalid rate".to_string()));
            }
            return Ok(new_irr);
        }
        irr = new_irr;
    }
    Err((Error::NUM, "Failed to converge".to_string()))
}

// Formula is:
//  $$\sum_{i=1}^n\frac{v_i}{(1+r)^{\frac{(d_j-d_1)}{365}}}$$
// where $v_i$ is the ith-1 value and $d_i$ is the ith-1 date
pub(crate) fn compute_xnpv(
    rate: f64,
    values: &[f64],
    dates: &[f64],
) -> Result<f64, (Error, String)> {
    let mut xnpv = values[0];
    let d0 = dates[0];
    let n = values.len();
    for i in 1..n {
        let vi = values[i];
        let di = dates[i];
        xnpv += vi / ((1.0 + rate).powf((di - d0) / 365.0))
    }
    if xnpv.is_infinite() || xnpv.is_nan() {
        return Err((Error::NUM, "NaN".to_string()));
    }
    Ok(xnpv)
}

fn compute_xnpv_prime(rate: f64, values: &[f64], dates: &[f64]) -> Result<f64, (Error, String)> {
    let mut xnpv = 0.0;
    let d0 = dates[0];
    let n = values.len();
    for i in 1..n {
        let vi = values[i];
        let di = dates[i];
        let ratio = (di - d0) / 365.0;
        let power = (1.0 + rate).powf(ratio + 1.0);
        xnpv -= vi * ratio / power;
    }
    if xnpv.is_infinite() || xnpv.is_nan() {
        return Err((Error::NUM, "NaN".to_string()));
    }
    Ok(xnpv)
}

fn compute_xirr_newton_raphson(
    values: &[f64],
    dates: &[f64],
    guess: f64,
) -> Result<f64, (Error, String)> {
    let mut xirr = guess;
    let max_iterations = 100;
    let eps = 1e-7;
    for _ in 1..=max_iterations {
        let f = compute_xnpv(xirr, values, dates)?;
        let f_prime = compute_xnpv_prime(xirr, values, dates)?;
        let new_xirr = xirr - f / f_prime;
        if (new_xirr - xirr).abs() < eps {
            return Ok(new_xirr);
        }
        xirr = new_xirr;
    }
    Err((Error::NUM, "Failed to converge".to_string()))
}

// NOTES:
// 1. If the cash-flows (value[i] for i > 0) are always of the same sign, the function is monotonous
// 3. Say (d_max, v_max) are the pair where d_max is the largest date,
//    then if v_max and v_0 have different signs, it's guaranteed there is a zero
// The algorithm needs to be improved but it works so far in all practical cases
pub(crate) fn compute_xirr(
    values: &[f64],
    dates: &[f64],
    guess: f64,
) -> Result<f64, (Error, String)> {
    if guess <= -1.0 {
        return Err((Error::VALUE, "Rate initial guess must be > -1".to_string()));
    }
    // The values cannot be all positive or all negative
    if values.iter().all(|&x| x >= 0.0) || values.iter().all(|&x| x <= 0.0) {
        return Err((Error::NUM, "Failed to converge".to_string()));
    }
    if let Ok(f) = compute_xirr_newton_raphson(values, dates, guess) {
        return Ok(f);
    };
    // We try bisection
    let max_iterations = 50;
    let eps = 1e-8;
    // This will miss 0's very close to -1
    let x1 = -0.9999;
    let x2 = 100.0;
    let f1 = compute_xnpv(x1, values, dates)?;
    let f2 = compute_xnpv(x2, values, dates)?;
    if f1 * f2 > 0.0 {
        // The root is not within the limits (or there are two roots)
        // We try Newton-Raphson above the upper limit
        // (we cannot go to the left of -1)
        if let Ok(f) = compute_xirr_newton_raphson(values, dates, 200.0) {
            return Ok(f);
        };
        return Err((Error::NUM, "Failed to converge".to_string()));
    }

    let (mut rtb, mut dx) = if f1 < 0.0 {
        (x1, x2 - x1)
    } else {
        (x2, x1 - x2)
    };

    for _ in 1..max_iterations {
        dx *= 0.5;
        let x_mid = rtb + dx;
        let f_mid = compute_xnpv(x_mid, values, dates)?;
        if f_mid <= 0.0 {
            rtb = x_mid;
        }
        if f_mid.abs() < eps || dx.abs() < eps {
            return Ok(x_mid);
        }
    }

    Err((Error::NUM, "Failed to converge".to_string()))
}
