//! Evaluate expressions against a variable environment.

use crate::error::{DesmosError, Result};
use crate::expr::{Expr, is_builtin};
use std::collections::HashMap;

const MAX_CALL_DEPTH: usize = 64;

/// Names to values, plus user functions.
#[derive(Debug, Clone, Default)]
pub struct Env {
    /// Bound identifiers.
    pub vars: HashMap<String, f64>,
    /// User-defined functions.
    pub fns: HashMap<String, (Vec<String>, Expr)>,
    /// Nesting depth of user-function calls (not cloned across plot samples).
    depth: usize,
}

impl Env {
    /// Bind a variable.
    pub fn set(&mut self, name: impl Into<String>, value: f64) {
        self.vars.insert(name.into(), value);
    }

    /// Evaluate `expr`.
    pub fn eval(&self, expr: &Expr) -> Result<f64> {
        match expr {
            Expr::Number(n) => Ok(*n),
            Expr::Name(name) => match name.as_str() {
                "pi" => Ok(std::f64::consts::PI),
                "e" => Ok(std::f64::consts::E),
                "tau" => Ok(std::f64::consts::TAU),
                "Infinity" => Ok(f64::INFINITY),
                other => self
                    .vars
                    .get(other)
                    .copied()
                    .ok_or_else(|| DesmosError::Eval(format!("undefined {other}"))),
            },
            Expr::Add(a, b) => Ok(self.eval(a)? + self.eval(b)?),
            Expr::Sub(a, b) => Ok(self.eval(a)? - self.eval(b)?),
            Expr::Mul(a, b) => Ok(self.eval(a)? * self.eval(b)?),
            Expr::Div(a, b) => Ok(self.eval(a)? / self.eval(b)?),
            Expr::Pow(a, b) => Ok(self.eval(a)?.powf(self.eval(b)?)),
            Expr::Neg(inner) => Ok(-self.eval(inner)?),
            Expr::Abs(inner) => Ok(self.eval(inner)?.abs()),
            Expr::Fact(inner) => factorial(self.eval(inner)?),
            Expr::Cmp(left, kind, right) => {
                let left = self.eval(left)?;
                let right = self.eval(right)?;
                Ok(if cmp(*kind, left, right) { 1.0 } else { 0.0 })
            }
            Expr::Piecewise(arms) => {
                for (cond, value) in arms {
                    match cond {
                        None => return self.eval(value),
                        Some(cond) if self.eval(cond)? != 0.0 => return self.eval(value),
                        Some(_) => {}
                    }
                }
                Err(DesmosError::Eval("piecewise matched no arm".into()))
            }
            Expr::Call(name, args) => self.eval_call(name, args),
            Expr::Point(_, _) => Err(DesmosError::Eval("point is not a number".into())),
        }
    }

    fn eval_call(&self, name: &str, args: &[Expr]) -> Result<f64> {
        if let Some((params, body)) = self.fns.get(name) {
            if self.depth >= MAX_CALL_DEPTH {
                return Err(DesmosError::Eval(format!("{name} recurses too deeply")));
            }
            if params.len() != args.len() {
                return Err(DesmosError::Eval(format!(
                    "{name} takes {} arguments",
                    params.len()
                )));
            }
            let mut child = self.clone();
            child.depth = self.depth + 1;
            for (param, arg) in params.iter().zip(args) {
                child.set(param.clone(), self.eval(arg)?);
            }
            return child.eval(body);
        }
        if !is_builtin(name) {
            if args.len() == 1
                && let Ok(coeff) = self.eval(&Expr::Name(name.to_string()))
            {
                return Ok(coeff * self.eval(&args[0])?);
            }
            return Err(DesmosError::Eval(format!("undefined {name}")));
        }
        let values: Result<Vec<f64>> = args.iter().map(|a| self.eval(a)).collect();
        let values = values?;
        builtin(name, &values)
    }
}

fn builtin(name: &str, args: &[f64]) -> Result<f64> {
    let one = |f: fn(f64) -> f64| {
        if args.len() != 1 {
            return Err(DesmosError::Eval(format!("{name} takes 1 argument")));
        }
        Ok(f(args[0]))
    };
    let two = |f: fn(f64, f64) -> f64| {
        if args.len() != 2 {
            return Err(DesmosError::Eval(format!("{name} takes 2 arguments")));
        }
        Ok(f(args[0], args[1]))
    };
    match name {
        "sin" => one(f64::sin),
        "cos" => one(f64::cos),
        "tan" => one(f64::tan),
        "asin" => one(f64::asin),
        "acos" => one(f64::acos),
        "atan" => one(f64::atan),
        "sinh" => one(f64::sinh),
        "cosh" => one(f64::cosh),
        "tanh" => one(f64::tanh),
        "log" | "log10" => one(f64::log10),
        "ln" => one(f64::ln),
        "sqrt" => one(f64::sqrt),
        "abs" => one(f64::abs),
        "exp" => one(f64::exp),
        "floor" => one(f64::floor),
        "ceil" => one(f64::ceil),
        "round" => one(f64::round),
        "sign" => one(f64::signum),
        "csc" => one(|x| 1.0 / x.sin()),
        "sec" => one(|x| 1.0 / x.cos()),
        "cot" => one(|x| 1.0 / x.tan()),
        "log2" => one(f64::log2),
        "cbrt" => one(f64::cbrt),
        "fact" => {
            if args.len() != 1 {
                return Err(DesmosError::Eval("fact takes 1 argument".into()));
            }
            factorial(args[0])
        }
        "atan2" => two(f64::atan2),
        "hypot" => two(f64::hypot),
        "mod" => two(|a, b| a - b * (a / b).floor()),
        "nCr" => two(ncr),
        "nPr" => two(npr),
        "gcd" => two(|a, b| gcd(a, b) as f64),
        "lcm" => two(|a, b| {
            let g = gcd(a, b);
            if g == 0 {
                0.0
            } else {
                (a.round() as i64 / g * b.round() as i64).unsigned_abs() as f64
            }
        }),
        "min" => {
            if args.len() < 2 {
                return Err(DesmosError::Eval("min takes at least 2 arguments".into()));
            }
            Ok(args.iter().copied().fold(f64::INFINITY, f64::min))
        }
        "max" => {
            if args.len() < 2 {
                return Err(DesmosError::Eval("max takes at least 2 arguments".into()));
            }
            Ok(args.iter().copied().fold(f64::NEG_INFINITY, f64::max))
        }
        other => Err(DesmosError::Eval(format!("undefined {other}"))),
    }
}

use crate::expr::RelationKind;

pub(crate) fn cmp(kind: RelationKind, left: f64, right: f64) -> bool {
    match kind {
        RelationKind::Equal => (left - right).abs() <= 1e-9 * (1.0 + left.abs().max(right.abs())),
        RelationKind::Lt => left < right,
        RelationKind::Gt => left > right,
        RelationKind::Le => left <= right,
        RelationKind::Ge => left >= right,
    }
}

fn factorial(n: f64) -> Result<f64> {
    if !n.is_finite() || n < 0.0 || (n - n.round()).abs() > 1e-9 || n > 170.0 {
        return Err(DesmosError::Eval("factorial domain".into()));
    }
    let mut acc = 1.0;
    for k in 2..=n.round() as i32 {
        acc *= f64::from(k);
    }
    Ok(acc)
}

fn ncr(n: f64, k: f64) -> f64 {
    if n < k || n < 0.0 || k < 0.0 {
        return f64::NAN;
    }
    let n = n.round() as i32;
    let k = k.round() as i32;
    let k = k.min(n - k);
    let mut acc = 1.0;
    for i in 0..k {
        acc *= f64::from(n - i);
        acc /= f64::from(i + 1);
    }
    acc
}

fn npr(n: f64, k: f64) -> f64 {
    if n < k || n < 0.0 || k < 0.0 {
        return f64::NAN;
    }
    let n = n.round() as i32;
    let k = k.round() as i32;
    let mut acc = 1.0;
    for i in 0..k {
        acc *= f64::from(n - i);
    }
    acc
}

fn gcd(a: f64, b: f64) -> i64 {
    let mut a = a.round().abs() as i64;
    let mut b = b.round().abs() as i64;
    while b != 0 {
        let t = a % b;
        a = b;
        b = t;
    }
    a
}

#[cfg(test)]
mod test;
