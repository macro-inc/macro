use std::fmt;

use crate::{
    calc_result::CalcResult,
    expressions::{
        lexer::util::get_tokens,
        parser::Node,
        token::{Error, OpSum, TokenType},
        types::CellReferenceIndex,
    },
    model::Model,
    number_format::to_precision,
};

/// This implements all functions with complex arguments in the standard
/// NOTE: If performance is ever needed we should have a new entry in CalcResult,
/// So this functions will return CalcResult::Complex(x,y, Suffix)
/// and not having to parse it over and over again.

#[derive(PartialEq, Debug)]
enum Suffix {
    I,
    J,
}

impl fmt::Display for Suffix {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        match self {
            Suffix::I => write!(f, "i"),
            Suffix::J => write!(f, "j"),
        }
    }
}

struct Complex {
    x: f64,
    y: f64,
    suffix: Suffix,
}

impl fmt::Display for Complex {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        let x = to_precision(self.x, 15);
        let y = to_precision(self.y, 15);
        let suffix = &self.suffix;
        // it is a bit weird what Excel does but it seems it uses general notation for
        // numbers > 1e-20 and scientific notation for the rest
        let y_str = if y.abs() <= 9e-20 {
            format!("{y:E}")
        } else if y == 1.0 {
            "".to_string()
        } else if y == -1.0 {
            "-".to_string()
        } else {
            format!("{y}")
        };
        let x_str = if x.abs() <= 9e-20 {
            format!("{x:E}")
        } else {
            format!("{x}")
        };
        if y == 0.0 && x == 0.0 {
            write!(f, "0")
        } else if y == 0.0 {
            write!(f, "{x_str}")
        } else if x == 0.0 {
            write!(f, "{y_str}{suffix}")
        } else if y > 0.0 {
            write!(f, "{x_str}+{y_str}{suffix}")
        } else {
            write!(f, "{x_str}{y_str}{suffix}")
        }
    }
}

fn parse_complex_number(s: &str) -> Result<(f64, f64, Suffix), String> {
    // Check for i, j, -i, -j
    let (sign, s) = match s.strip_prefix('-') {
        Some(r) => (-1.0, r),
        None => (1.0, s),
    };
    match s {
        "i" => return Ok((0.0, sign * 1.0, Suffix::I)),
        "j" => return Ok((0.0, sign * 1.0, Suffix::J)),
        _ => {
            // Let it go
        }
    };

    // TODO: This is an overuse
    let tokens = get_tokens(s);

    // There has to be 1, 2 3, or 4 tokens
    // number
    // number suffix
    // number1+suffix
    // number1+number2 suffix

    match tokens.len() {
        1 => {
            // Real number
            let number1 = match tokens[0].token {
                TokenType::Number(f) => f,
                _ => return Err(format!("Not a complex number: {s}")),
            };
            // i is the default
            Ok((sign * number1, 0.0, Suffix::I))
        }
        2 => {
            // number2 i
            let number2 = match tokens[0].token {
                TokenType::Number(f) => f,
                _ => return Err(format!("Not a complex number: {s}")),
            };
            let suffix = match &tokens[1].token {
                TokenType::Ident(w) => match w.as_str() {
                    "i" => Suffix::I,
                    "j" => Suffix::J,
                    _ => return Err(format!("Not a complex number: {s}")),
                },
                _ => {
                    return Err(format!("Not a complex number: {s}"));
                }
            };
            Ok((0.0, sign * number2, suffix))
        }
        3 => {
            let number1 = match tokens[0].token {
                TokenType::Number(f) => f,
                _ => return Err(format!("Not a complex number: {s}")),
            };
            let operation = match &tokens[1].token {
                TokenType::Addition(f) => f,
                _ => return Err(format!("Not a complex number: {s}")),
            };
            let suffix = match &tokens[2].token {
                TokenType::Ident(w) => match w.as_str() {
                    "i" => Suffix::I,
                    "j" => Suffix::J,
                    _ => return Err(format!("Not a complex number: {s}")),
                },
                _ => {
                    return Err(format!("Not a complex number: {s}"));
                }
            };
            let number2 = if matches!(operation, OpSum::Minus) {
                -1.0
            } else {
                1.0
            };
            Ok((sign * number1, number2, suffix))
        }
        4 => {
            let number1 = match tokens[0].token {
                TokenType::Number(f) => f,
                _ => return Err(format!("Not a complex number: {s}")),
            };
            let operation = match &tokens[1].token {
                TokenType::Addition(f) => f,
                _ => return Err(format!("Not a complex number: {s}")),
            };
            let mut number2 = match tokens[2].token {
                TokenType::Number(f) => f,
                _ => return Err(format!("Not a complex number: {s}")),
            };
            let suffix = match &tokens[3].token {
                TokenType::Ident(w) => match w.as_str() {
                    "i" => Suffix::I,
                    "j" => Suffix::J,
                    _ => return Err(format!("Not a complex number: {s}")),
                },
                _ => {
                    return Err(format!("Not a complex number: {s}"));
                }
            };
            if matches!(operation, OpSum::Minus) {
                number2 = -number2
            }
            Ok((sign * number1, number2, suffix))
        }
        _ => Err(format!("Not a complex number: {s}")),
    }
}

impl<'a> Model<'a> {
    fn get_complex_number(
        &mut self,
        node: &Node,
        cell: CellReferenceIndex,
    ) -> Result<(f64, f64, Suffix), CalcResult> {
        let value = self.get_string(node, cell)?;
        if value.is_empty() {
            return Ok((0.0, 0.0, Suffix::I));
        }
        match parse_complex_number(&value) {
            Ok(s) => Ok(s),
            Err(message) => Err(CalcResult::new_error(Error::NUM, cell, message)),
        }
    }
    // COMPLEX(real_num, i_num, [suffix])
    pub(crate) fn fn_complex(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if !(2..=3).contains(&args.len()) {
            return CalcResult::new_args_number_error(cell);
        }
        let x = match self.get_number(&args[0], cell) {
            Ok(s) => s,
            Err(s) => return s,
        };
        let y = match self.get_number(&args[1], cell) {
            Ok(s) => s,
            Err(s) => return s,
        };
        let suffix = if args.len() == 3 {
            match self.get_string(&args[2], cell) {
                Ok(s) => {
                    if s == "i" || s.is_empty() {
                        Suffix::I
                    } else if s == "j" {
                        Suffix::J
                    } else {
                        return CalcResult::new_error(
                            Error::VALUE,
                            cell,
                            "Invalid suffix".to_string(),
                        );
                    }
                }
                Err(s) => return s,
            }
        } else {
            Suffix::I
        };

        let complex = Complex { x, y, suffix };
        CalcResult::String(complex.to_string())
    }

    pub(crate) fn fn_imabs(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 1 {
            return CalcResult::new_args_number_error(cell);
        }
        let (x, y, _) = match self.get_complex_number(&args[0], cell) {
            Ok(s) => s,
            Err(error) => return error,
        };
        CalcResult::Number(f64::sqrt(x * x + y * y))
    }

    pub(crate) fn fn_imaginary(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 1 {
            return CalcResult::new_args_number_error(cell);
        }
        let (_, y, _) = match self.get_complex_number(&args[0], cell) {
            Ok(s) => s,
            Err(error) => return error,
        };
        CalcResult::Number(y)
    }
    pub(crate) fn fn_imargument(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 1 {
            return CalcResult::new_args_number_error(cell);
        }
        let (x, y, _) = match self.get_complex_number(&args[0], cell) {
            Ok(s) => s,
            Err(error) => return error,
        };
        if x == 0.0 && y == 0.0 {
            return CalcResult::new_error(Error::DIV, cell, "Division by zero".to_string());
        }
        let angle = f64::atan2(y, x);
        CalcResult::Number(angle)
    }
    pub(crate) fn fn_imconjugate(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 1 {
            return CalcResult::new_args_number_error(cell);
        }
        let (x, y, suffix) = match self.get_complex_number(&args[0], cell) {
            Ok(s) => s,
            Err(error) => return error,
        };
        let complex = Complex { x, y: -y, suffix };
        CalcResult::String(complex.to_string())
    }
    pub(crate) fn fn_imcos(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 1 {
            return CalcResult::new_args_number_error(cell);
        }
        let value = match self.get_string(&args[0], cell) {
            Ok(s) => s,
            Err(s) => return s,
        };
        let (x, y, suffix) = match parse_complex_number(&value) {
            Ok(s) => s,
            Err(message) => return CalcResult::new_error(Error::NUM, cell, message),
        };

        let complex = Complex {
            x: x.cos() * y.cosh(),
            y: -x.sin() * y.sinh(),
            suffix,
        };
        CalcResult::String(complex.to_string())
    }
    pub(crate) fn fn_imcosh(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 1 {
            return CalcResult::new_args_number_error(cell);
        }
        let value = match self.get_string(&args[0], cell) {
            Ok(s) => s,
            Err(s) => return s,
        };
        let (x, y, suffix) = match parse_complex_number(&value) {
            Ok(s) => s,
            Err(message) => return CalcResult::new_error(Error::NUM, cell, message),
        };

        let complex = Complex {
            x: x.cosh() * y.cos(),
            y: x.sinh() * y.sin(),
            suffix,
        };
        CalcResult::String(complex.to_string())
    }
    pub(crate) fn fn_imcot(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 1 {
            return CalcResult::new_args_number_error(cell);
        }
        let value = match self.get_string(&args[0], cell) {
            Ok(s) => s,
            Err(s) => return s,
        };
        let (x, y, suffix) = match parse_complex_number(&value) {
            Ok(s) => s,
            Err(message) => return CalcResult::new_error(Error::NUM, cell, message),
        };

        if x == 0.0 && y != 0.0 {
            let complex = Complex {
                x: 0.0,
                y: -1.0 / y.tanh(),
                suffix,
            };
            return CalcResult::String(complex.to_string());
        } else if y == 0.0 {
            let complex = Complex {
                x: 1.0 / x.tan(),
                y: 0.0,
                suffix,
            };
            return CalcResult::String(complex.to_string());
        }

        let x_cot = 1.0 / x.tan();
        let y_coth = 1.0 / y.tanh();

        let t = x_cot * x_cot + y_coth * y_coth;
        let x = (x_cot * y_coth * y_coth - x_cot) / t;
        let y = (-x_cot * x_cot * y_coth - y_coth) / t;

        if x.is_infinite() || y.is_infinite() || x.is_nan() || y.is_nan() {
            return CalcResult::new_error(Error::NUM, cell, "Invalid operation".to_string());
        }

        let complex = Complex { x, y, suffix };
        CalcResult::String(complex.to_string())
    }

    pub(crate) fn fn_imcsc(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 1 {
            return CalcResult::new_args_number_error(cell);
        }
        let value = match self.get_string(&args[0], cell) {
            Ok(s) => s,
            Err(s) => return s,
        };
        let (x, y, suffix) = match parse_complex_number(&value) {
            Ok(s) => s,
            Err(message) => return CalcResult::new_error(Error::NUM, cell, message),
        };
        let x_cos = x.cos();
        let x_sin = x.sin();

        let y_cosh = y.cosh();
        let y_sinh = y.sinh();

        let t = x_sin * x_sin * y_cosh * y_cosh + x_cos * x_cos * y_sinh * y_sinh;

        let complex = Complex {
            x: x_sin * y_cosh / t,
            y: -x_cos * y_sinh / t,
            suffix,
        };
        CalcResult::String(complex.to_string())
    }

    pub(crate) fn fn_imcsch(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 1 {
            return CalcResult::new_args_number_error(cell);
        }
        let value = match self.get_string(&args[0], cell) {
            Ok(s) => s,
            Err(s) => return s,
        };
        let (x, y, suffix) = match parse_complex_number(&value) {
            Ok(s) => s,
            Err(message) => return CalcResult::new_error(Error::NUM, cell, message),
        };
        let x_cosh = x.cosh();
        let x_sinh = x.sinh();

        let y_cos = y.cos();
        let y_sin = y.sin();

        let t = x_sinh * x_sinh * y_cos * y_cos + x_cosh * x_cosh * y_sin * y_sin;

        let complex = Complex {
            x: x_sinh * y_cos / t,
            y: -x_cosh * y_sin / t,
            suffix,
        };
        CalcResult::String(complex.to_string())
    }

    pub(crate) fn fn_imdiv(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 2 {
            return CalcResult::new_args_number_error(cell);
        }
        let (x1, y1, suffix) = match self.get_complex_number(&args[0], cell) {
            Ok(s) => s,
            Err(error) => return error,
        };
        let (x2, y2, suffix2) = match self.get_complex_number(&args[1], cell) {
            Ok(s) => s,
            Err(error) => return error,
        };
        if suffix != suffix2 {
            return CalcResult::new_error(Error::VALUE, cell, "Different suffixes".to_string());
        }
        let t = x2 * x2 + y2 * y2;
        if t == 0.0 {
            return CalcResult::new_error(Error::NUM, cell, "Invalid".to_string());
        }
        let complex = Complex {
            x: (x1 * x2 + y1 * y2) / t,
            y: (-x1 * y2 + y1 * x2) / t,
            suffix,
        };
        CalcResult::String(complex.to_string())
    }

    pub(crate) fn fn_imexp(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 1 {
            return CalcResult::new_args_number_error(cell);
        }
        let (x, y, suffix) = match self.get_complex_number(&args[0], cell) {
            Ok(s) => s,
            Err(error) => return error,
        };

        let complex = Complex {
            x: x.exp() * y.cos(),
            y: x.exp() * y.sin(),
            suffix,
        };
        CalcResult::String(complex.to_string())
    }
    pub(crate) fn fn_imln(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 1 {
            return CalcResult::new_args_number_error(cell);
        }
        let (x, y, suffix) = match self.get_complex_number(&args[0], cell) {
            Ok(s) => s,
            Err(error) => return error,
        };

        let r = f64::sqrt(x * x + y * y);
        let a = f64::atan2(y, x);

        let complex = Complex {
            x: r.ln(),
            y: a,
            suffix,
        };
        CalcResult::String(complex.to_string())
    }
    pub(crate) fn fn_imlog10(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 1 {
            return CalcResult::new_args_number_error(cell);
        }
        let (x, y, suffix) = match self.get_complex_number(&args[0], cell) {
            Ok(s) => s,
            Err(error) => return error,
        };

        let r = f64::sqrt(x * x + y * y);
        let a = f64::atan2(y, x);

        let complex = Complex {
            x: r.log10(),
            y: a * f64::log10(f64::exp(1.0)),
            suffix,
        };
        CalcResult::String(complex.to_string())
    }
    pub(crate) fn fn_imlog2(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 1 {
            return CalcResult::new_args_number_error(cell);
        }
        let (x, y, suffix) = match self.get_complex_number(&args[0], cell) {
            Ok(s) => s,
            Err(error) => return error,
        };

        let r = f64::sqrt(x * x + y * y);
        let a = f64::atan2(y, x);

        let complex = Complex {
            x: r.log2(),
            y: a * f64::log2(f64::exp(1.0)),
            suffix,
        };
        CalcResult::String(complex.to_string())
    }

    // IMPOWER(imnumber, power)
    // If $(r, \theta)$ is the polar representation the formula is:
    //  $$ x = r^n*\cos(n\dot\theta), y = r^n*\csin(n\dot\theta) $
    pub(crate) fn fn_impower(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 2 {
            return CalcResult::new_args_number_error(cell);
        }

        let (x, y, suffix) = match self.get_complex_number(&args[0], cell) {
            Ok(s) => s,
            Err(error) => return error,
        };

        let n = match self.get_number_no_bools(&args[1], cell) {
            Ok(f) => f,
            Err(s) => return s,
        };

        // if n == n.trunc() && n < 10.0 {
        //     // for small powers we compute manually
        //     let (mut x0, mut y0) = (x, y);
        //     for _ in 1..(n.trunc() as i32) {
        //         (x0, y0) = (x0 * x - y0 * y, x0 * y + y0 * x);
        //     }
        //     let complex = Complex {
        //         x: x0,
        //         y: y0,
        //         suffix,
        //     };
        //     return CalcResult::String(complex.to_string());
        // };

        let r = f64::sqrt(x * x + y * y);
        let a = f64::atan2(y, x);

        let x = r.powf(n) * f64::cos(a * n);
        let y = r.powf(n) * f64::sin(a * n);

        if x.is_infinite() || y.is_infinite() || x.is_nan() || y.is_nan() {
            return CalcResult::new_error(Error::NUM, cell, "Invalid operation".to_string());
        }

        let complex = Complex { x, y, suffix };
        CalcResult::String(complex.to_string())
    }

    pub(crate) fn fn_improduct(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 2 {
            return CalcResult::new_args_number_error(cell);
        }

        let (x1, y1, suffix) = match self.get_complex_number(&args[0], cell) {
            Ok(s) => s,
            Err(error) => return error,
        };

        let (x2, y2, suffix2) = match self.get_complex_number(&args[1], cell) {
            Ok(s) => s,
            Err(error) => return error,
        };

        if suffix != suffix2 {
            return CalcResult::new_error(Error::VALUE, cell, "Different suffixes".to_string());
        }
        let complex = Complex {
            x: x1 * x2 - y1 * y2,
            y: x1 * y2 + y1 * x2,
            suffix,
        };
        CalcResult::String(complex.to_string())
    }
    pub(crate) fn fn_imreal(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 1 {
            return CalcResult::new_args_number_error(cell);
        }
        let (x, _, _) = match self.get_complex_number(&args[0], cell) {
            Ok(s) => s,
            Err(error) => return error,
        };
        CalcResult::Number(x)
    }
    pub(crate) fn fn_imsec(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 1 {
            return CalcResult::new_args_number_error(cell);
        }
        let (x, y, suffix) = match self.get_complex_number(&args[0], cell) {
            Ok(s) => s,
            Err(error) => return error,
        };
        let x_cos = x.cos();
        let x_sin = x.sin();

        let y_cosh = y.cosh();
        let y_sinh = y.sinh();

        let t = x_cos * x_cos * y_cosh * y_cosh + x_sin * x_sin * y_sinh * y_sinh;

        let complex = Complex {
            x: x_cos * y_cosh / t,
            y: x_sin * y_sinh / t,
            suffix,
        };
        CalcResult::String(complex.to_string())
    }
    pub(crate) fn fn_imsech(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 1 {
            return CalcResult::new_args_number_error(cell);
        }
        let (x, y, suffix) = match self.get_complex_number(&args[0], cell) {
            Ok(s) => s,
            Err(error) => return error,
        };
        let x_cosh = x.cosh();
        let x_sinh = x.sinh();

        let y_cos = y.cos();
        let y_sin = y.sin();

        let t = x_cosh * x_cosh * y_cos * y_cos + x_sinh * x_sinh * y_sin * y_sin;

        let complex = Complex {
            x: x_cosh * y_cos / t,
            y: -x_sinh * y_sin / t,
            suffix,
        };
        CalcResult::String(complex.to_string())
    }
    pub(crate) fn fn_imsin(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 1 {
            return CalcResult::new_args_number_error(cell);
        }
        let (x, y, suffix) = match self.get_complex_number(&args[0], cell) {
            Ok(s) => s,
            Err(error) => return error,
        };

        let complex = Complex {
            x: x.sin() * y.cosh(),
            y: x.cos() * y.sinh(),
            suffix,
        };
        CalcResult::String(complex.to_string())
    }
    pub(crate) fn fn_imsinh(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 1 {
            return CalcResult::new_args_number_error(cell);
        }
        let (x, y, suffix) = match self.get_complex_number(&args[0], cell) {
            Ok(s) => s,
            Err(error) => return error,
        };

        let complex = Complex {
            x: x.sinh() * y.cos(),
            y: x.cosh() * y.sin(),
            suffix,
        };
        CalcResult::String(complex.to_string())
    }
    pub(crate) fn fn_imsqrt(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 1 {
            return CalcResult::new_args_number_error(cell);
        }
        let (x, y, suffix) = match self.get_complex_number(&args[0], cell) {
            Ok(s) => s,
            Err(error) => return error,
        };

        let r = f64::sqrt(x * x + y * y).sqrt();
        let a = f64::atan2(y, x);

        let complex = Complex {
            x: r * f64::cos(a / 2.0),
            y: r * f64::sin(a / 2.0),
            suffix,
        };
        CalcResult::String(complex.to_string())
    }
    pub(crate) fn fn_imsub(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 2 {
            return CalcResult::new_args_number_error(cell);
        }
        let (x1, y1, suffix) = match self.get_complex_number(&args[0], cell) {
            Ok(s) => s,
            Err(error) => return error,
        };
        let (x2, y2, suffix2) = match self.get_complex_number(&args[1], cell) {
            Ok(s) => s,
            Err(error) => return error,
        };
        if suffix != suffix2 {
            return CalcResult::new_error(Error::VALUE, cell, "Different suffixes".to_string());
        }
        let complex = Complex {
            x: x1 - x2,
            y: y1 - y2,
            suffix,
        };
        CalcResult::String(complex.to_string())
    }

    pub(crate) fn fn_imsum(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 2 {
            return CalcResult::new_args_number_error(cell);
        }
        let (x1, y1, suffix) = match self.get_complex_number(&args[0], cell) {
            Ok(s) => s,
            Err(error) => return error,
        };
        let (x2, y2, suffix2) = match self.get_complex_number(&args[1], cell) {
            Ok(s) => s,
            Err(error) => return error,
        };
        if suffix != suffix2 {
            return CalcResult::new_error(Error::VALUE, cell, "Different suffixes".to_string());
        }
        let complex = Complex {
            x: x1 + x2,
            y: y1 + y2,
            suffix,
        };
        CalcResult::String(complex.to_string())
    }

    pub(crate) fn fn_imtan(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 1 {
            return CalcResult::new_args_number_error(cell);
        }
        let (x, y, suffix) = match self.get_complex_number(&args[0], cell) {
            Ok(s) => s,
            Err(error) => return error,
        };

        let x_tan = x.tan();
        let y_tanh = y.tanh();

        let t = 1.0 + x_tan * x_tan * y_tanh * y_tanh;

        let complex = Complex {
            x: (x_tan - x_tan * y_tanh * y_tanh) / t,
            y: (y_tanh + x_tan * x_tan * y_tanh) / t,
            suffix,
        };
        CalcResult::String(complex.to_string())
    }
}

#[cfg(test)]
mod tests {
    use crate::functions::engineering::complex::Suffix;

    use super::parse_complex_number as parse;

    #[test]
    fn test_parse_complex() {
        assert_eq!(parse("1+2i"), Ok((1.0, 2.0, Suffix::I)));
        assert_eq!(parse("2i"), Ok((0.0, 2.0, Suffix::I)));
        assert_eq!(parse("7.5"), Ok((7.5, 0.0, Suffix::I)));
        assert_eq!(parse("-7.5"), Ok((-7.5, 0.0, Suffix::I)));
        assert_eq!(parse("7-5i"), Ok((7.0, -5.0, Suffix::I)));
        assert_eq!(parse("i"), Ok((0.0, 1.0, Suffix::I)));
        assert_eq!(parse("7+i"), Ok((7.0, 1.0, Suffix::I)));
        assert_eq!(parse("7-i"), Ok((7.0, -1.0, Suffix::I)));
        assert_eq!(parse("-i"), Ok((0.0, -1.0, Suffix::I)));
        assert_eq!(parse("0"), Ok((0.0, 0.0, Suffix::I)));
    }
}
