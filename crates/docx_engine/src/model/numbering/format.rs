//! Number formats for list labels, page numbers and notes.

/// A number format (`w:numFmt`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum NumFmt {
    /// 1, 2, 3.
    Decimal,
    /// 01, 02 ... 10.
    DecimalZero,
    /// I, II, III.
    UpperRoman,
    /// i, ii, iii.
    LowerRoman,
    /// A, B ... Z, AA, BB.
    UpperLetter,
    /// a, b ... z, aa, bb.
    LowerLetter,
    /// 1st, 2nd, 3rd.
    Ordinal,
    /// One, Two, Three.
    CardinalText,
    /// First, Second, Third.
    OrdinalText,
    /// *, †, ‡, §, then doubled.
    Chicago,
    /// Hexadecimal.
    Hex,
    /// ①, ②...
    DecimalEnclosedCircle,
    /// (1), (2)...
    DecimalEnclosedParen,
    /// Full-width digits.
    DecimalFullWidth,
    /// A bullet: the label text is shown as is.
    Bullet,
    /// No number.
    None,
    /// A custom pattern (`w:format`, e.g. `001`).
    Custom(String),
}

impl NumFmt {
    /// Parses a `w:numFmt` value (and its `w:format` attribute for `custom`).
    pub fn parse(v: &str, format: Option<&str>) -> Self {
        match v {
            "decimal" => NumFmt::Decimal,
            "decimalZero" => NumFmt::DecimalZero,
            "upperRoman" => NumFmt::UpperRoman,
            "lowerRoman" => NumFmt::LowerRoman,
            "upperLetter" => NumFmt::UpperLetter,
            "lowerLetter" => NumFmt::LowerLetter,
            "ordinal" => NumFmt::Ordinal,
            "cardinalText" => NumFmt::CardinalText,
            "ordinalText" => NumFmt::OrdinalText,
            "chicago" => NumFmt::Chicago,
            "hex" => NumFmt::Hex,
            "decimalEnclosedCircle" | "decimalEnclosedCircleChinese" => {
                NumFmt::DecimalEnclosedCircle
            }
            "decimalEnclosedParen" => NumFmt::DecimalEnclosedParen,
            "decimalFullWidth" | "decimalFullWidth2" => NumFmt::DecimalFullWidth,
            "bullet" => NumFmt::Bullet,
            "none" => NumFmt::None,
            "custom" => match format {
                Some(f) => NumFmt::Custom(f.to_owned()),
                None => NumFmt::Decimal,
            },
            _ => NumFmt::Decimal,
        }
    }
}

fn roman(mut n: i64) -> String {
    if n <= 0 || n >= 4000 {
        return n.to_string();
    }
    const TABLE: &[(i64, &str)] = &[
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
    let mut out = String::new();
    for &(v, s) in TABLE {
        while n >= v {
            out.push_str(s);
            n -= v;
        }
    }
    out
}

fn letters(n: i64) -> String {
    if n <= 0 {
        return String::new();
    }
    // Word repeats the letter: 27 = AA, 28 = BB.
    let idx = ((n - 1) % 26) as u8;
    let count = ((n - 1) / 26 + 1) as usize;
    std::iter::repeat_n((b'A' + idx) as char, count).collect()
}

const ONES: [&str; 20] = [
    "Zero",
    "One",
    "Two",
    "Three",
    "Four",
    "Five",
    "Six",
    "Seven",
    "Eight",
    "Nine",
    "Ten",
    "Eleven",
    "Twelve",
    "Thirteen",
    "Fourteen",
    "Fifteen",
    "Sixteen",
    "Seventeen",
    "Eighteen",
    "Nineteen",
];
const TENS: [&str; 10] = [
    "", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety",
];

fn cardinal(n: i64) -> String {
    if !(0..1_000_000).contains(&n) {
        return n.to_string();
    }
    if n < 20 {
        return ONES[n as usize].to_owned();
    }
    if n < 100 {
        let t = TENS[(n / 10) as usize];
        return if n % 10 == 0 {
            t.to_owned()
        } else {
            format!("{t}-{}", ONES[(n % 10) as usize].to_lowercase())
        };
    }
    if n < 1000 {
        let rest = n % 100;
        let head = format!("{} Hundred", ONES[(n / 100) as usize]);
        return if rest == 0 {
            head
        } else {
            format!("{head} {}", cardinal(rest).to_lowercase())
        };
    }
    let rest = n % 1000;
    let head = format!("{} Thousand", cardinal(n / 1000));
    if rest == 0 {
        head
    } else {
        format!("{head} {}", cardinal(rest).to_lowercase())
    }
}

fn ordinal_text(n: i64) -> String {
    let c = cardinal(n);
    let irregular = [
        ("One", "First"),
        ("Two", "Second"),
        ("Three", "Third"),
        ("Five", "Fifth"),
        ("Eight", "Eighth"),
        ("Nine", "Ninth"),
        ("Twelve", "Twelfth"),
        ("one", "first"),
        ("two", "second"),
        ("three", "third"),
        ("five", "fifth"),
        ("eight", "eighth"),
        ("nine", "ninth"),
    ];
    for (from, to) in irregular {
        if let Some(stem) = c.strip_suffix(from) {
            return format!("{stem}{to}");
        }
    }
    if let Some(stem) = c.strip_suffix('y') {
        return format!("{stem}ieth");
    }
    format!("{c}th")
}

fn ordinal_suffix(n: i64) -> &'static str {
    match (n % 10, n % 100) {
        (_, 11..=13) => "th",
        (1, _) => "st",
        (2, _) => "nd",
        (3, _) => "rd",
        _ => "th",
    }
}

/// Formats `n` in format `fmt`.
pub fn format_number(n: i64, fmt: &NumFmt) -> String {
    match fmt {
        NumFmt::Decimal => n.to_string(),
        NumFmt::DecimalZero => {
            if (0..10).contains(&n) {
                format!("0{n}")
            } else {
                n.to_string()
            }
        }
        NumFmt::UpperRoman => roman(n),
        NumFmt::LowerRoman => roman(n).to_lowercase(),
        NumFmt::UpperLetter => letters(n),
        NumFmt::LowerLetter => letters(n).to_lowercase(),
        NumFmt::Ordinal => format!("{n}{}", ordinal_suffix(n)),
        NumFmt::CardinalText => cardinal(n),
        NumFmt::OrdinalText => ordinal_text(n),
        NumFmt::Chicago => {
            if n <= 0 {
                return n.to_string();
            }
            let symbols = ['*', '\u{2020}', '\u{2021}', '\u{00A7}'];
            let s = symbols[((n - 1) % 4) as usize];
            std::iter::repeat_n(s, ((n - 1) / 4 + 1) as usize).collect()
        }
        NumFmt::Hex => format!("{n:X}"),
        NumFmt::DecimalEnclosedCircle => match n {
            1..=20 => {
                char::from_u32(0x2460 + (n as u32 - 1)).map_or_else(|| n.to_string(), String::from)
            }
            _ => n.to_string(),
        },
        NumFmt::DecimalEnclosedParen => format!("({n})"),
        NumFmt::DecimalFullWidth => n
            .to_string()
            .chars()
            .map(|c| match c.to_digit(10) {
                Some(d) => char::from_u32(0xFF10 + d).unwrap_or(c),
                None => c,
            })
            .collect(),
        NumFmt::Bullet | NumFmt::None => String::new(),
        NumFmt::Custom(pattern) => {
            // Zero-padded patterns (`001`) pad to their width; others decimal.
            let digits = pattern.chars().filter(|c| c.is_ascii_digit()).count();
            if digits > 1 && pattern.chars().all(|c| c.is_ascii_digit()) {
                format!("{n:0digits$}")
            } else {
                n.to_string()
            }
        }
    }
}
