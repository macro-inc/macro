use crate::expressions::types::CellReferenceIndex;
use crate::{
    calc_result::CalcResult, expressions::parser::Node, expressions::token::Error, model::Model,
};

/// Parse Roman (classic or Excel variants) → number
fn from_roman(s: &str) -> Result<u32, String> {
    if s.is_empty() {
        return Err("empty numeral".into());
    }
    fn val(c: char) -> Option<u32> {
        Some(match c {
            'I' => 1,
            'V' => 5,
            'X' => 10,
            'L' => 50,
            'C' => 100,
            'D' => 500,
            'M' => 1000,
            _ => return None,
        })
    }

    // Accept the union of subtractive pairs used by the tables above (Excel-compatible).
    fn allowed_subtractive(a: char, b: char) -> bool {
        matches!(
            (a, b),
            // classic:
            ('I','V')|('I','X')|('X','L')|('X','C')|('C','D')|('C','M')
            // Excel forms:
            |('V','L')|('L','D')|('L','M') // VL, LD, LM
            |('X','D')|('X','M')          // XD, XM
            |('V','M')                    // VM
            |('I','L')|('I','C')|('I','D')|('I','M') // IL, IC, ID, IM
            |('V','D')|('V','C') // VD, VC
        )
    }

    let chars: Vec<char> = s.chars().map(|c| c.to_ascii_uppercase()).collect();
    let mut total = 0u32;
    let mut i = 0usize;

    // Repetition rules similar to classic Romans:
    // V, L, D cannot repeat; I, X, C, M max 3 in a row.
    let mut last_char: Option<char> = None;
    let mut run_len = 0usize;

    while i < chars.len() {
        let c = chars[i];
        let v = val(c).ok_or_else(|| format!("invalid character '{c}'"))?;

        if Some(c) == last_char {
            run_len += 1;
            match c {
                'V' | 'L' | 'D' => return Err(format!("invalid repetition of '{c}'")),
                _ if run_len >= 3 => return Err(format!("invalid repetition of '{c}'")),
                _ => {}
            }
        } else {
            last_char = Some(c);
            run_len = 0;
        }

        if i + 1 < chars.len() {
            let c2 = chars[i + 1];
            let v2 = val(c2).ok_or_else(|| format!("invalid character '{c2}'"))?;
            if v < v2 {
                if !allowed_subtractive(c, c2) {
                    return Err(format!("invalid subtractive pair '{c}{c2}'"));
                }
                // Disallow stacked subtractives like IIV, XXL:
                if run_len > 0 {
                    return Err(format!("malformed numeral near position {i}"));
                }
                total += v2 - v;
                i += 2;
                last_char = None;
                run_len = 0;
                continue;
            }
        }

        total += v;
        i += 1;
    }
    Ok(total)
}

/// Classic Roman (strict) encoder used as a base for all forms.
fn to_roman(mut n: u32) -> Result<String, String> {
    if !(1..=3999).contains(&n) {
        return Err("value out of range (must be 1..=3999)".into());
    }

    const MAP: &[(u32, &str)] = &[
        (1000, "M"),
        (900, "CM"),
        (500, "D"),
        (400, "CD"),
        (100, "C"),
        (90, "XC"),
        (50, "L"),
        (40, "XL"),
        (10, "X"),
        (9, "IX"),
        (5, "V"),
        (4, "IV"),
        (1, "I"),
    ];

    let mut out = String::with_capacity(15);
    for &(val, sym) in MAP {
        while n >= val {
            out.push_str(sym);
            n -= val;
        }
        if n == 0 {
            break;
        }
    }
    Ok(out)
}

/// Excel/Google Sheets compatible ROMAN(number, [form]) encoder.
/// `form`: 0..=4 (0=Classic, 4=Simplified).
fn to_roman_with_form(n: u32, form: i32) -> Result<String, String> {
    let mut s = to_roman(n)?;
    if form == 0 {
        return Ok(s);
    }
    if !(0..=4).contains(&form) {
        return Err("form must be between 0 and 4".into());
    }

    // Base rules (apply for all f >= 1)
    let base_rules: &[(&str, &str)] = &[
        // C(D|M)XC -> L$1XL
        ("CDXC", "LDXL"),
        ("CMXC", "LMXL"),
        // C(D|M)L -> L$1
        ("CDL", "LD"),
        ("CML", "LM"),
        // X(L|C)IX -> V$1IV
        ("XLIX", "VLIV"),
        ("XCIX", "VCIV"),
        // X(L|C)V -> V$1
        ("XLV", "VL"),
        ("XCV", "VC"),
    ];

    // Level 2 extra rules
    let lvl2_rules: &[(&str, &str)] = &[
        // V(L|C)IV -> I$1
        ("VLIV", "IL"),
        ("VCIV", "IC"),
        // L(D|M)XL -> X$1
        ("LDXL", "XD"),
        ("LMXL", "XM"),
        // L(D|M)VL -> X$1V
        ("LDVL", "XDV"),
        ("LMVL", "XMV"),
        // L(D|M)IL -> X$1IX
        ("LDIL", "XDIX"),
        ("LMIL", "XMIX"),
    ];

    // Level 3 extra rules
    let lvl3_rules: &[(&str, &str)] = &[
        // X(D|M)V -> V$1
        ("XDV", "VD"),
        ("XMV", "VM"),
        // X(D|M)IX -> V$1IV
        ("XDIX", "VDIV"),
        ("XMIX", "VMIV"),
    ];

    // Level 4 extra rules
    let lvl4_rules: &[(&str, &str)] = &[
        // V(D|M)IV -> I$1
        ("VDIV", "ID"),
        ("VMIV", "IM"),
    ];

    // Helper to apply a batch of (from -> to) globally, in order.
    fn apply_rules(mut t: String, rules: &[(&str, &str)]) -> String {
        for (from, to) in rules {
            if t.contains(from) {
                t = t.replace(from, to);
            }
        }
        t
    }

    s = apply_rules(s, base_rules);
    if form >= 2 {
        s = apply_rules(s, lvl2_rules);
    }
    if form >= 3 {
        s = apply_rules(s, lvl3_rules);
    }
    if form >= 4 {
        s = apply_rules(s, lvl4_rules);
    }
    Ok(s)
}

impl<'a> Model<'a> {
    pub(crate) fn fn_roman(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.is_empty() || args.len() > 2 {
            return CalcResult::new_args_number_error(cell);
        }
        let number = match self.get_number(&args[0], cell) {
            Ok(f) => f.floor(),
            Err(s) => return s,
        };

        if number == 0.0 {
            return CalcResult::String(String::new());
        }
        if !(0.0..=3999.0).contains(&number) {
            return CalcResult::Error {
                error: Error::VALUE,
                origin: cell,
                message: "Number must be between 0 and 3999".to_string(),
            };
        }
        let form = if args.len() == 2 {
            let mut t = match self.get_number(&args[1], cell) {
                Ok(f) => f as i32,
                Err(s) => return s,
            };
            // If the value is a boolean TRUE/FALSE, convert to 0/4
            if t == 0 || t == 1 {
                if let CalcResult::Boolean(b) = self.evaluate_node_in_context(&args[1], cell) {
                    if b {
                        // classic form
                        t = 0;
                    } else {
                        // simplified form
                        t = 4;
                    }
                }
            }
            t
        } else {
            0
        };
        if !(0..=4).contains(&form) {
            return CalcResult::Error {
                error: Error::VALUE,
                origin: cell,
                message: "Form must be between 0 and 4".to_string(),
            };
        }
        let roman_numeral = match to_roman_with_form(number as u32, form) {
            Ok(s) => s,
            Err(e) => {
                return CalcResult::Error {
                    error: Error::VALUE,
                    origin: cell,
                    message: format!("Could not convert to Roman numeral: {e}"),
                }
            }
        };
        CalcResult::String(roman_numeral)
    }

    pub(crate) fn fn_arabic(&mut self, args: &[Node], cell: CellReferenceIndex) -> CalcResult {
        if args.len() != 1 {
            return CalcResult::new_args_number_error(cell);
        }
        let roman_numeral = match self.evaluate_node_in_context(&args[0], cell) {
            CalcResult::String(s) => s,
            error @ CalcResult::Error { .. } => return error,
            _ => {
                return CalcResult::Error {
                    error: Error::VALUE,
                    origin: cell,
                    message: "Argument must be a text string".to_string(),
                }
            }
        };
        if roman_numeral.is_empty() {
            return CalcResult::Number(0.0);
        }
        match from_roman(&roman_numeral) {
            Ok(value) => CalcResult::Number(value as f64),
            Err(e) => CalcResult::Error {
                error: Error::VALUE,
                origin: cell,
                message: format!("Invalid Roman numeral: {e}"),
            },
        }
    }
}
