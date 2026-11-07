//! A small Excel number-format formatter for chart labels.
//!
//! Covers the codes charts use in practice: `General`, digit placeholders
//! with grouping and scaling commas, percentages, scientific notation,
//! literal text (quoted, escaped, `_x` padding), multi-section codes with
//! optional conditions, currency/locale tags, and dates in the 1900 or 1904
//! serial systems.

/// Formats `v` with an Excel number format code.
pub(crate) fn format(v: f64, code: &str, date1904: bool) -> String {
    if !v.is_finite() {
        return String::new();
    }
    let sections = split_sections(code);
    let parsed: Vec<Section> = sections.iter().map(|s| parse_section(s)).collect();
    let (section, value) = pick_section(&parsed, v);
    render(section, value, date1904)
}

/// Whether a format code shows values as percentages.
pub(crate) fn is_percent(code: &str) -> bool {
    split_sections(code).first().is_some_and(|s| {
        parse_section(s)
            .tokens
            .iter()
            .any(|t| matches!(t, Tok::Percent))
    })
}

/// Excel's `General` format: at most 11 characters, scientific beyond that.
pub(crate) fn general(v: f64) -> String {
    if v == 0.0 || !v.is_finite() {
        return "0".into();
    }
    let a = v.abs();
    let sign = if v < 0.0 { "-" } else { "" };
    let (digits, point) = decimal_digits(a);
    if !(1e-4..1e11).contains(&a) {
        // Scientific with up to five decimals.
        let mut exp = point - 1;
        let mut m = round_digits(&digits, 1, 5);
        if m.int.len() > 1 {
            exp += 1;
            m = round_digits(&[1], 1, 5);
        }
        let frac = m.frac.trim_end_matches('0');
        let mant = if frac.is_empty() {
            m.int.clone()
        } else {
            format!("{}.{frac}", m.int)
        };
        let es = if exp < 0 { '-' } else { '+' };
        return format!("{sign}{mant}E{es}{:02}", exp.abs());
    }
    let width = 11 - sign.len();
    let int_len = point.max(1) as usize;
    let decimals = width.saturating_sub(int_len + 1);
    let r = round_digits(&digits, point, decimals);
    let frac = r.frac.trim_end_matches('0');
    if frac.is_empty() {
        format!("{sign}{}", r.int)
    } else {
        format!("{sign}{}.{frac}", r.int)
    }
}

/// Splits a code into `;` sections (outside quotes, brackets, and escapes).
fn split_sections(code: &str) -> Vec<String> {
    let mut out = vec![String::new()];
    let mut chars = code.chars();
    let mut quoted = false;
    let mut bracket = false;
    while let Some(c) = chars.next() {
        let cur = out.last_mut().expect("non-empty");
        match c {
            '"' if !bracket => {
                quoted = !quoted;
                cur.push(c);
            }
            '\\' | '_' | '*' if !quoted && !bracket => {
                cur.push(c);
                if let Some(n) = chars.next() {
                    cur.push(n);
                }
            }
            '[' if !quoted => {
                bracket = true;
                cur.push(c);
            }
            ']' if !quoted => {
                bracket = false;
                cur.push(c);
            }
            ';' if !quoted && !bracket => out.push(String::new()),
            _ => cur.push(c),
        }
    }
    out.truncate(4);
    out
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum DatePart {
    Year2,
    Year4,
    Month,
    Month2,
    MonthAbbr,
    MonthName,
    MonthLetter,
    Day,
    Day2,
    DayAbbr,
    DayName,
    Hour,
    Hour2,
    Minute,
    Minute2,
    Second,
    Second2,
    AmPm,
    AmPmShort,
}

#[derive(Clone, Debug, PartialEq)]
enum Tok {
    Lit(String),
    /// `0`, `#`, or `?`.
    Digit(char),
    Point,
    Comma,
    Percent,
    /// Scientific exponent; `true` shows a `+` for positive exponents.
    Exp(bool),
    Date(DatePart),
    General,
    Text,
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum Cond {
    Lt(f64),
    Le(f64),
    Gt(f64),
    Ge(f64),
    Eq(f64),
    Ne(f64),
}

impl Cond {
    fn test(self, v: f64) -> bool {
        match self {
            Cond::Lt(x) => v < x,
            Cond::Le(x) => v <= x,
            Cond::Gt(x) => v > x,
            Cond::Ge(x) => v >= x,
            Cond::Eq(x) => v == x,
            Cond::Ne(x) => v != x,
        }
    }

    fn parse(s: &str) -> Option<Cond> {
        let s = s.trim();
        let (ctor, rest): (fn(f64) -> Cond, &str) = if let Some(r) = s.strip_prefix("<=") {
            (Cond::Le, r)
        } else if let Some(r) = s.strip_prefix(">=") {
            (Cond::Ge, r)
        } else if let Some(r) = s.strip_prefix("<>") {
            (Cond::Ne, r)
        } else if let Some(r) = s.strip_prefix('<') {
            (Cond::Lt, r)
        } else if let Some(r) = s.strip_prefix('>') {
            (Cond::Gt, r)
        } else if let Some(r) = s.strip_prefix('=') {
            (Cond::Eq, r)
        } else {
            return None;
        };
        rest.trim().parse::<f64>().ok().map(ctor)
    }
}

#[derive(Clone, Debug, Default)]
struct Section {
    tokens: Vec<Tok>,
    cond: Option<Cond>,
}

fn parse_section(s: &str) -> Section {
    let chars: Vec<char> = s.chars().collect();
    let mut toks: Vec<Tok> = Vec::new();
    let mut cond = None;
    let mut i = 0;
    let lit = |toks: &mut Vec<Tok>, s: &str| {
        if let Some(Tok::Lit(prev)) = toks.last_mut() {
            prev.push_str(s);
        } else {
            toks.push(Tok::Lit(s.to_owned()));
        }
    };
    while i < chars.len() {
        let c = chars[i];
        let rest: String = chars[i..].iter().collect();
        let lower = rest.to_ascii_lowercase();
        match c {
            '"' => {
                let end = chars[i + 1..]
                    .iter()
                    .position(|&x| x == '"')
                    .map_or(chars.len(), |p| i + 1 + p);
                let text: String = chars[i + 1..end.min(chars.len())].iter().collect();
                lit(&mut toks, &text);
                i = end + 1;
                continue;
            }
            '\\' => {
                if let Some(&n) = chars.get(i + 1) {
                    lit(&mut toks, &n.to_string());
                }
                i += 2;
                continue;
            }
            '_' => {
                lit(&mut toks, " ");
                i += 2;
                continue;
            }
            '*' => {
                i += 2;
                continue;
            }
            '[' => {
                let end = chars[i + 1..]
                    .iter()
                    .position(|&x| x == ']')
                    .map_or(chars.len(), |p| i + 1 + p);
                let inner: String = chars[i + 1..end.min(chars.len())].iter().collect();
                if let Some(cur) = inner.strip_prefix('$') {
                    let symbol = cur.split('-').next().unwrap_or("");
                    lit(&mut toks, symbol);
                } else if let Some(cd) = Cond::parse(&inner) {
                    cond = Some(cd);
                } else {
                    match inner.to_ascii_lowercase().as_str() {
                        "h" | "hh" => toks.push(Tok::Date(DatePart::Hour)),
                        "m" | "mm" => toks.push(Tok::Date(DatePart::Minute)),
                        "s" | "ss" => toks.push(Tok::Date(DatePart::Second)),
                        _ => {} // Colors and other tags.
                    }
                }
                i = end + 1;
                continue;
            }
            '0' | '#' | '?' => toks.push(Tok::Digit(c)),
            '.' => toks.push(Tok::Point),
            ',' => toks.push(Tok::Comma),
            '%' => toks.push(Tok::Percent),
            '@' => toks.push(Tok::Text),
            'E' | 'e' if matches!(chars.get(i + 1), Some('+') | Some('-')) => {
                toks.push(Tok::Exp(chars[i + 1] == '+'));
                i += 2;
                continue;
            }
            _ if lower.starts_with("general") => {
                toks.push(Tok::General);
                i += 7;
                continue;
            }
            _ if lower.starts_with("am/pm") => {
                toks.push(Tok::Date(DatePart::AmPm));
                i += 5;
                continue;
            }
            _ if lower.starts_with("a/p") => {
                toks.push(Tok::Date(DatePart::AmPmShort));
                i += 3;
                continue;
            }
            'y' | 'Y' | 'm' | 'M' | 'd' | 'D' | 'h' | 'H' | 's' | 'S' => {
                let lc = c.to_ascii_lowercase();
                let n = chars[i..]
                    .iter()
                    .take_while(|x| x.to_ascii_lowercase() == lc)
                    .count();
                let part = match (lc, n) {
                    ('y', 1 | 2) => DatePart::Year2,
                    ('y', _) => DatePart::Year4,
                    ('m', 1) => DatePart::Month,
                    ('m', 2) => DatePart::Month2,
                    ('m', 3) => DatePart::MonthAbbr,
                    ('m', 5) => DatePart::MonthLetter,
                    ('m', _) => DatePart::MonthName,
                    ('d', 1) => DatePart::Day,
                    ('d', 2) => DatePart::Day2,
                    ('d', 3) => DatePart::DayAbbr,
                    ('d', _) => DatePart::DayName,
                    ('h', 1) => DatePart::Hour,
                    ('h', _) => DatePart::Hour2,
                    ('s', 1) => DatePart::Second,
                    _ => DatePart::Second2,
                };
                toks.push(Tok::Date(part));
                i += n;
                continue;
            }
            _ => lit(&mut toks, &c.to_string()),
        }
        i += 1;
    }
    resolve_minutes(&mut toks);
    Section { tokens: toks, cond }
}

/// `m`/`mm` after an hour or before a second means minutes.
fn resolve_minutes(toks: &mut [Tok]) {
    let date_idx: Vec<usize> = toks
        .iter()
        .enumerate()
        .filter(|(_, t)| matches!(t, Tok::Date(_)))
        .map(|(i, _)| i)
        .collect();
    for (k, &i) in date_idx.iter().enumerate() {
        let Tok::Date(p) = toks[i] else { continue };
        if !matches!(p, DatePart::Month | DatePart::Month2) {
            continue;
        }
        let prev = k.checked_sub(1).map(|j| &toks[date_idx[j]]);
        let next = date_idx.get(k + 1).map(|&j| &toks[j]);
        let after_hour = matches!(prev, Some(Tok::Date(DatePart::Hour | DatePart::Hour2)));
        let before_sec = matches!(next, Some(Tok::Date(DatePart::Second | DatePart::Second2)));
        if after_hour || before_sec {
            toks[i] = Tok::Date(if p == DatePart::Month {
                DatePart::Minute
            } else {
                DatePart::Minute2
            });
        }
    }
}

/// Chooses the section for `v` and the value it formats (sections after the
/// first show magnitudes; their sign comes from the literal text).
fn pick_section(sections: &[Section], v: f64) -> (Section, f64) {
    let first = sections.first().cloned().unwrap_or_default();
    if sections.iter().any(|s| s.cond.is_some()) {
        for s in sections {
            if s.cond.is_some_and(|c| c.test(v)) {
                return (
                    s.clone(),
                    if v < 0.0 && s.cond.is_some_and(|c| c.test(-1.0)) {
                        v.abs()
                    } else {
                        v
                    },
                );
            }
        }
        let rest: Vec<&Section> = sections.iter().filter(|s| s.cond.is_none()).collect();
        return match rest.first() {
            Some(s) => ((*s).clone(), v),
            None => (
                Section {
                    tokens: vec![Tok::General],
                    cond: None,
                },
                v,
            ),
        };
    }
    match sections.len() {
        0 | 1 => (first, v),
        2 => {
            if v < 0.0 {
                (sections[1].clone(), v.abs())
            } else {
                (first, v)
            }
        }
        _ => {
            if v < 0.0 {
                (sections[1].clone(), v.abs())
            } else if v == 0.0 {
                (sections[2].clone(), 0.0)
            } else {
                (first, v)
            }
        }
    }
}

fn render(s: Section, v: f64, date1904: bool) -> String {
    let toks = &s.tokens;
    if toks.iter().any(|t| matches!(t, Tok::Date(_))) {
        return render_date(toks, v, date1904).unwrap_or_else(|| general(v));
    }
    let has_digits = toks.iter().any(|t| matches!(t, Tok::Digit(_)));
    if !has_digits {
        // Literal-only, General, or text sections.
        let mut out = String::new();
        let mut used = false;
        for t in toks {
            match t {
                Tok::Lit(l) => out.push_str(l),
                Tok::General | Tok::Text => {
                    out.push_str(&general(v));
                    used = true;
                }
                Tok::Percent => out.push('%'),
                Tok::Point => out.push('.'),
                Tok::Comma => out.push(','),
                _ => {}
            }
        }
        if toks.is_empty() || (!used && toks.iter().all(|t| matches!(t, Tok::Comma | Tok::Point))) {
            return general(v);
        }
        if !used && v < 0.0 && s.cond.is_none() {
            return format!("-{out}");
        }
        return out;
    }
    render_number(toks, v)
}

fn render_number(toks: &[Tok], v: f64) -> String {
    let mut x = v.abs();
    let negative = v < 0.0;
    let percents = toks.iter().filter(|t| matches!(t, Tok::Percent)).count();
    for _ in 0..percents.min(4) {
        x *= 100.0;
    }
    // Commas right after the last digit placeholder scale by 1000 each.
    let last_digit = toks
        .iter()
        .rposition(|t| matches!(t, Tok::Digit(_)))
        .unwrap_or(0);
    let mut scaling = vec![false; toks.len()];
    let mut j = last_digit + 1;
    while j < toks.len() && toks[j] == Tok::Comma {
        scaling[j] = true;
        x /= 1000.0;
        j += 1;
    }
    let exp_at = toks.iter().position(|t| matches!(t, Tok::Exp(_)));
    let point_at = toks
        .iter()
        .position(|t| *t == Tok::Point)
        .filter(|p| exp_at.is_none_or(|e| *p < e));
    let int_end = point_at.or(exp_at).unwrap_or(toks.len());
    let frac_end = exp_at.unwrap_or(toks.len());
    let int_ph: Vec<char> = toks[..int_end]
        .iter()
        .filter_map(|t| {
            if let Tok::Digit(c) = t {
                Some(*c)
            } else {
                None
            }
        })
        .collect();
    let frac_ph: Vec<char> = point_at
        .map(|p| {
            toks[p + 1..frac_end]
                .iter()
                .filter_map(|t| {
                    if let Tok::Digit(c) = t {
                        Some(*c)
                    } else {
                        None
                    }
                })
                .collect()
        })
        .unwrap_or_default();
    let exp_ph = exp_at.map_or(0, |e| {
        toks[e + 1..]
            .iter()
            .filter(|t| matches!(t, Tok::Digit(_)))
            .count()
    });
    let grouping = toks[..int_end].iter().enumerate().any(|(i, t)| {
        *t == Tok::Comma
            && !scaling[i]
            && toks[..i].iter().any(|t| matches!(t, Tok::Digit(_)))
            && toks[i + 1..int_end]
                .iter()
                .any(|t| matches!(t, Tok::Digit(_)))
    });
    let decimals = frac_ph.len();
    let mut exponent = 0i32;
    let rounded = if exp_at.is_some() && x > 0.0 {
        let int_digits = int_ph.iter().filter(|c| **c == '0').count().max(1) as i32;
        let (digits, point) = decimal_digits(x);
        exponent = point - int_digits;
        let mut r = round_digits(&digits, int_digits, decimals);
        if r.int.len() as i32 > int_digits {
            // 9.99E+00 rounded up to 10.0: renormalize.
            exponent += 1;
            r = round_digits(&[1], int_digits, decimals);
        }
        r
    } else {
        let (digits, point) = decimal_digits(x);
        round_digits(&digits, point, decimals)
    };
    let mut int_str = rounded.int.trim_start_matches('0').to_owned();
    let zeros = int_ph.iter().filter(|c| **c == '0').count();
    let qmarks = int_ph.iter().filter(|c| **c == '?').count();
    while int_str.len() < zeros {
        int_str.insert(0, '0');
    }
    if grouping {
        int_str = group(&int_str);
    }
    while int_str.chars().count() < zeros + qmarks {
        int_str.insert(0, ' ');
    }
    let mut frac: Vec<char> = rounded.frac.chars().collect();
    // Optional trailing decimals: `#` drops zeros, `?` pads them with spaces.
    let mut k = frac_ph.len().min(frac.len());
    while k > 0 {
        k -= 1;
        if frac[k] != '0' {
            break;
        }
        match frac_ph[k] {
            '#' => frac.truncate(k),
            '?' => frac[k] = ' ',
            _ => break,
        }
    }
    let frac_str: String = frac.into_iter().collect();
    let is_zero = int_str.trim().is_empty() && frac_str.trim().chars().all(|c| c == '0');
    let mut out = String::new();
    let mut int_done = false;
    let mut frac_done = false;
    for (i, t) in toks.iter().enumerate() {
        match t {
            Tok::Lit(l) => out.push_str(l),
            Tok::Digit(_) if i < int_end => {
                if !int_done {
                    out.push_str(&int_str);
                    int_done = true;
                }
            }
            Tok::Digit(_) if exp_at.is_some_and(|e| i > e) => {}
            Tok::Digit(_) => {
                if !frac_done {
                    out.push_str(&frac_str);
                    frac_done = true;
                }
            }
            Tok::Point if Some(i) == point_at => out.push('.'),
            Tok::Point => out.push('.'),
            Tok::Comma => {
                if !(scaling[i] || i < int_end && grouping) {
                    out.push(',');
                }
            }
            Tok::Percent => out.push('%'),
            Tok::Exp(plus) => {
                let sign = if exponent < 0 {
                    "-"
                } else if *plus {
                    "+"
                } else {
                    ""
                };
                out.push('E');
                out.push_str(sign);
                out.push_str(&format!(
                    "{:0width$}",
                    exponent.abs(),
                    width = exp_ph.max(1)
                ));
            }
            Tok::General | Tok::Text => out.push_str(&general(x)),
            Tok::Date(_) => {}
        }
    }
    if negative && !is_zero {
        out.insert(0, '-');
    }
    out
}

fn group(int: &str) -> String {
    let digits: Vec<char> = int.chars().collect();
    let mut out = String::new();
    for (i, c) in digits.iter().enumerate() {
        if i > 0 && (digits.len() - i).is_multiple_of(3) {
            out.push(',');
        }
        out.push(*c);
    }
    out
}

/// The 15 significant decimal digits of `x > 0` and the decimal point
/// position (number of integer digits; may be negative).
fn decimal_digits(x: f64) -> (Vec<u8>, i32) {
    if x == 0.0 || !x.is_finite() {
        return (vec![0], 1);
    }
    let s = format!("{:.14e}", x);
    let (mant, exp) = s.split_once('e').unwrap_or((&s, "0"));
    let digits: Vec<u8> = mant
        .bytes()
        .filter(u8::is_ascii_digit)
        .map(|b| b - b'0')
        .collect();
    (digits, exp.parse::<i32>().unwrap_or(0) + 1)
}

struct Rounded {
    int: String,
    frac: String,
}

/// Rounds digits (with `point` integer digits) to `decimals` places, half away from zero.
fn round_digits(digits: &[u8], point: i32, decimals: usize) -> Rounded {
    let decimals = decimals.min(30);
    // Digits with an explicit position: value = Σ d_i · 10^(point - 1 - i).
    let keep = point + decimals as i32;
    let mut kept: Vec<u8> = if keep <= 0 {
        Vec::new()
    } else {
        (0..keep as usize)
            .map(|i| digits.get(i).copied().unwrap_or(0))
            .collect()
    };
    let next = if keep < 0 {
        0
    } else {
        digits.get(keep as usize).copied().unwrap_or(0)
    };
    let mut point = point;
    if next >= 5 {
        let mut i = kept.len();
        loop {
            if i == 0 {
                kept.insert(0, 1);
                point += 1;
                break;
            }
            i -= 1;
            if kept[i] == 9 {
                kept[i] = 0;
            } else {
                kept[i] += 1;
                break;
            }
        }
    }
    // Re-align into integer and fraction parts.
    let total = point + decimals as i32;
    while (kept.len() as i32) < total {
        kept.insert(0, 0);
    }
    let int_len = (kept.len() as i32 - decimals as i32).max(0) as usize;
    let int: String = kept[..int_len]
        .iter()
        .map(|d| char::from(b'0' + d))
        .collect();
    let mut frac: String = kept[int_len..]
        .iter()
        .map(|d| char::from(b'0' + d))
        .collect();
    while frac.len() < decimals {
        frac.insert(0, '0');
    }
    Rounded {
        int: if int.is_empty() { "0".into() } else { int },
        frac,
    }
}

const MONTHS: [&str; 12] = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
];
const DAYS: [&str; 7] = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
];

/// Converts a serial date to (year, month, day, weekday).
pub(crate) fn serial_to_date(serial: f64, date1904: bool) -> Option<(i64, u32, u32, u32)> {
    if !(0.0..=2_958_465.0).contains(&serial) {
        return None;
    }
    let days = serial.floor() as i64;
    if !date1904 && days == 60 {
        return Some((1900, 2, 29, 3));
    }
    if !date1904 && days == 0 {
        // Excel's "January 0, 1900".
        return Some((1900, 1, 0, 6));
    }
    // Days since 1970-01-01.
    let unix = if date1904 {
        days - 24_107
    } else if days < 60 {
        days - 25_568
    } else {
        days - 25_569
    };
    let (y, m, d) = civil_from_days(unix);
    let weekday = (unix + 4).rem_euclid(7) as u32;
    Some((y, m, d, weekday))
}

/// Howard Hinnant's civil-from-days algorithm.
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

fn render_date(toks: &[Tok], v: f64, date1904: bool) -> Option<String> {
    let (y, m, d, wd) = serial_to_date(v, date1904)?;
    let secs = ((v - v.floor()) * 86_400.0).round() as i64;
    let (hh, mi, ss) = (secs / 3600 % 24, secs / 60 % 60, secs % 60);
    let ampm = toks
        .iter()
        .any(|t| matches!(t, Tok::Date(DatePart::AmPm | DatePart::AmPmShort)));
    let h12 = if hh % 12 == 0 { 12 } else { hh % 12 };
    let hour = if ampm { h12 } else { hh };
    let mut out = String::new();
    let month = MONTHS[(m as usize).saturating_sub(1).min(11)];
    for t in toks {
        match t {
            Tok::Lit(l) => out.push_str(l),
            Tok::Date(p) => match p {
                DatePart::Year2 => out.push_str(&format!("{:02}", y.rem_euclid(100))),
                DatePart::Year4 => out.push_str(&format!("{y:04}")),
                DatePart::Month => out.push_str(&m.to_string()),
                DatePart::Month2 => out.push_str(&format!("{m:02}")),
                DatePart::MonthAbbr => out.push_str(&month[..3]),
                DatePart::MonthName => out.push_str(month),
                DatePart::MonthLetter => out.push_str(&month[..1]),
                DatePart::Day => out.push_str(&d.to_string()),
                DatePart::Day2 => out.push_str(&format!("{d:02}")),
                DatePart::DayAbbr => out.push_str(&DAYS[wd as usize % 7][..3]),
                DatePart::DayName => out.push_str(DAYS[wd as usize % 7]),
                DatePart::Hour => out.push_str(&hour.to_string()),
                DatePart::Hour2 => out.push_str(&format!("{hour:02}")),
                DatePart::Minute => out.push_str(&mi.to_string()),
                DatePart::Minute2 => out.push_str(&format!("{mi:02}")),
                DatePart::Second => out.push_str(&ss.to_string()),
                DatePart::Second2 => out.push_str(&format!("{ss:02}")),
                DatePart::AmPm => out.push_str(if hh < 12 { "AM" } else { "PM" }),
                DatePart::AmPmShort => out.push_str(if hh < 12 { "A" } else { "P" }),
            },
            Tok::Point => out.push('.'),
            Tok::Comma => out.push(','),
            Tok::Percent => out.push('%'),
            Tok::Digit(c) => out.push(*c),
            Tok::Exp(_) | Tok::General | Tok::Text => {}
        }
    }
    Some(out)
}
