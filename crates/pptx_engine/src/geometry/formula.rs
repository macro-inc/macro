//! The DrawingML shape-guide formula language.

use std::collections::HashMap;
use std::f64::consts::PI;

/// Angles in guides are 60,000ths of a degree.
const DEG: f64 = 60000.0;

/// Evaluated guide values for one shape size.
pub struct Guides {
    w: f64,
    h: f64,
    values: HashMap<String, f64>,
}

impl Guides {
    /// Guides for a `w`×`h` shape (EMU).
    pub fn new(w: f64, h: f64) -> Self {
        Self {
            w,
            h,
            values: HashMap::with_capacity(32),
        }
    }

    /// Whether a guide has been defined.
    pub fn has(&self, name: &str) -> bool {
        self.values.contains_key(name)
    }

    /// Sets a guide to a literal value.
    pub fn set(&mut self, name: &str, v: f64) {
        self.values.insert(name.to_owned(), v);
    }

    /// Evaluates `fmla` and defines `name` as its result.
    pub fn define(&mut self, name: &str, fmla: &str) {
        let v = self.eval(fmla);
        self.values.insert(name.to_owned(), v);
    }

    /// Resolves an argument: a defined guide, a built-in, or a literal.
    pub fn get(&self, arg: &str) -> f64 {
        if let Some(&v) = self.values.get(arg) {
            return v;
        }
        if let Some(v) = self.builtin(arg) {
            return v;
        }
        arg.trim().parse::<f64>().unwrap_or(0.0)
    }

    fn builtin(&self, name: &str) -> Option<f64> {
        let (w, h) = (self.w, self.h);
        let ss = w.min(h);
        Some(match name {
            "w" | "r" => w,
            "h" | "b" => h,
            "l" | "t" => 0.0,
            "hc" => w / 2.0,
            "vc" => h / 2.0,
            "ls" => w.max(h),
            "ss" => ss,
            "cd2" => 10_800_000.0,
            "cd4" => 5_400_000.0,
            "cd8" => 2_700_000.0,
            "3cd4" => 16_200_000.0,
            "3cd8" => 8_100_000.0,
            "5cd8" => 13_500_000.0,
            "7cd8" => 18_900_000.0,
            _ => {
                let (base, n) = if let Some(n) = name.strip_prefix("wd") {
                    (w, n)
                } else if let Some(n) = name.strip_prefix("hd") {
                    (h, n)
                } else if let Some(n) = name.strip_prefix("ssd") {
                    (ss, n)
                } else {
                    return None;
                };
                let d: f64 = n.parse().ok().filter(|d: &f64| *d != 0.0)?;
                base / d
            }
        })
    }

    /// Evaluates one formula.
    pub fn eval(&self, fmla: &str) -> f64 {
        let mut it = fmla.split_ascii_whitespace();
        let Some(op) = it.next() else { return 0.0 };
        let args: Vec<f64> = it.map(|a| self.get(a)).collect();
        let a = |i: usize| args.get(i).copied().unwrap_or(0.0);
        let rad = |v: f64| v / DEG * PI / 180.0;
        let v = match op {
            "val" => a(0),
            "*/" => {
                if a(2) == 0.0 {
                    0.0
                } else {
                    a(0) * a(1) / a(2)
                }
            }
            "+-" => a(0) + a(1) - a(2),
            "+/" => {
                if a(2) == 0.0 {
                    0.0
                } else {
                    (a(0) + a(1)) / a(2)
                }
            }
            "?:" => {
                if a(0) > 0.0 {
                    a(1)
                } else {
                    a(2)
                }
            }
            "abs" => a(0).abs(),
            "at2" => a(1).atan2(a(0)) * 180.0 / PI * DEG,
            "cat2" => a(0) * a(2).atan2(a(1)).cos(),
            "sat2" => a(0) * a(2).atan2(a(1)).sin(),
            "cos" => a(0) * rad(a(1)).cos(),
            "sin" => a(0) * rad(a(1)).sin(),
            "tan" => a(0) * rad(a(1)).tan(),
            "max" => a(0).max(a(1)),
            "min" => a(0).min(a(1)),
            "mod" => (a(0) * a(0) + a(1) * a(1) + a(2) * a(2)).sqrt(),
            "pin" => {
                if a(1) < a(0) {
                    a(0)
                } else if a(1) > a(2) {
                    a(2)
                } else {
                    a(1)
                }
            }
            "sqrt" => a(0).max(0.0).sqrt(),
            _ => 0.0,
        };
        if v.is_finite() { v } else { 0.0 }
    }
}
