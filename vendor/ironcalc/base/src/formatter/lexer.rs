use crate::number_format::parse_finite_number;

pub struct Lexer {
    position: usize,
    len: usize,
    chars: Vec<char>,
    error_message: String,
    error_position: usize,
}

#[derive(PartialEq, Debug)]
pub enum Token {
    Color(i32),              // [Red] or [Color 23]
    Condition(Compare, f64), // [<=100] (Comparator, number)
    Currency(char),          // [$€] ($ currency symbol)
    Literal(char), // €, $, (, ), /, :, +, -, ^, ', {, }, <, =, !, ~, > and space or escaped \X
    Spacer(char),  // *X
    Ghost(char),   // _X
    Text(String),  // "Text"
    Separator,     // ;
    Raw,           // @
    Percent,       // %
    Comma,         // ,
    Period,        // .
    Sharp,         // #
    Zero,          // 0
    QuestionMark,  // ?
    Scientific,    // E+
    ScientificMinus, // E-
    General,       // General
    // Dates and time
    Day,                 // d
    DayPadded,           // dd
    DayNameShort,        // ddd
    DayName,             // dddd+
    Month,               // m (or minute)
    MonthPadded,         // mm (or minute padded)
    MonthNameShort,      // mmm
    MonthName,           // mmmm or mmmmmm+
    MonthLetter,         // mmmmm
    YearShort,           // y or yy
    Year,                // yyy+
    Hour,                // h
    HourPadded,          // hh
    Second,              // s
    SecondPadded,        // ss
    ElapsedHour,         // [h]
    ElapsedMinute,       // [m]
    ElapsedSecond,       // [s]
    ElapsedHourPadded,   // [hh]
    ElapsedMinutePadded, // [mm]
    ElapsedSecondPadded, // [ss]
    AMPM,                // AM/PM (or A/P)
    ILLEGAL,
    EOF,
}

#[derive(PartialEq, Eq, Debug)]
pub enum Compare {
    Equal,
    LessThan,
    GreaterThan,
    LessOrEqualThan,
    GreaterOrEqualThan,
}

impl Token {
    pub fn is_digit(&self) -> bool {
        (self == &Token::Zero) || (self == &Token::Sharp) || (self == &Token::QuestionMark)
    }

    pub fn is_date(&self) -> bool {
        self == &Token::Day
            || self == &Token::DayPadded
            || self == &Token::DayNameShort
            || self == &Token::DayName
            || self == &Token::MonthName
            || self == &Token::MonthNameShort
            || self == &Token::Month
            || self == &Token::MonthPadded
            || self == &Token::MonthLetter
            || self == &Token::YearShort
            || self == &Token::Year
    }
}

impl Lexer {
    pub fn new(format: &str) -> Lexer {
        let chars: Vec<char> = format.chars().collect();
        let len = chars.len();
        Lexer {
            chars,
            position: 0,
            len,
            error_message: "".to_string(),
            error_position: 0,
        }
    }

    fn peek_char(&self) -> Option<char> {
        let position = self.position;
        if position < self.len {
            Some(self.chars[position])
        } else {
            None
        }
    }

    fn read_next_char(&mut self) -> Option<char> {
        let position = self.position;
        if position < self.len {
            self.position = position + 1;
            Some(self.chars[position])
        } else {
            None
        }
    }

    fn set_error(&mut self, error: &str) {
        self.error_message = error.to_string();
        self.error_position = self.position;
        self.position = self.len;
    }

    fn consume_string(&mut self) -> Option<String> {
        let mut position = self.position;
        let len = self.len;
        let mut chars = "".to_string();
        while position < len {
            let x = self.chars[position];
            position += 1;
            if x != '"' {
                chars.push(x);
            } else if position < len && self.chars[position] == '"' {
                chars.push(x);
                position += 1;
            } else {
                self.position = position;
                return Some(chars);
            }
        }
        None
    }

    fn consume_number(&mut self) -> Option<f64> {
        let mut position = self.position;
        let len = self.len;
        let mut chars = "".to_string();
        // first optional '-' sign
        if position < len && self.chars[position] == '-' {
            chars.push('-');
            position += 1;
        }
        // numbers before the '.'
        while position < len {
            let x = self.chars[position];
            if x.is_ascii_digit() {
                chars.push(x);
            } else {
                break;
            }
            position += 1;
        }
        if position < len && self.chars[position] == '.' {
            // numbers after the'.'
            chars.push('.');
            position += 1;
            while position < len {
                let x = self.chars[position];
                if x.is_ascii_digit() {
                    chars.push(x);
                } else {
                    break;
                }
                position += 1;
            }
        }
        if position + 1 < len && self.chars[position].eq_ignore_ascii_case(&'e') {
            // exponential side
            let x = self.chars[position + 1];
            if x == '-' || x == '+' || x.is_ascii_digit() {
                chars.push('e');
                chars.push(x);
                position += 2;
                while position < len {
                    let x = self.chars[position];
                    if x.is_ascii_digit() {
                        chars.push(x);
                    } else {
                        break;
                    }
                    position += 1;
                }
            }
        }
        self.position = position;
        parse_finite_number(&chars)
    }

    fn consume_condition(&mut self) -> Option<(Compare, f64)> {
        let cmp;
        match self.read_next_char() {
            Some('<') => {
                if let Some('=') = self.peek_char() {
                    self.read_next_char();
                    cmp = Compare::LessOrEqualThan;
                } else {
                    cmp = Compare::LessThan;
                }
            }
            Some('>') => {
                if let Some('=') = self.peek_char() {
                    self.read_next_char();
                    cmp = Compare::GreaterOrEqualThan;
                } else {
                    cmp = Compare::GreaterThan;
                }
            }
            Some('=') => {
                cmp = Compare::Equal;
            }
            _ => {
                return None;
            }
        }

        let start = self.position;
        let value = match self.consume_number() {
            Some(v) => v,
            // Without a number, as in `[>]`, the condition compares with 0
            None if self.position == start => 0.0,
            // There is something that should be a number and is not one,
            // like `1e400` that is too large to hold: that is no condition
            None => return None,
        };
        if self.read_next_char() == Some(']') {
            return Some((cmp, value));
        }
        None
    }

    // Consume elapsed time like [h], [hh], [m], [mm], [s], [ss]
    fn consume_elapsed_time(&mut self) -> Option<Token> {
        // We are called right after '['
        let start_pos = self.position;

        // First char must be one of: h, m, s
        let unit = match self.read_next_char() {
            Some(c) if ['h', 'H', 'm', 'M', 's', 'S'].contains(&c) => c.to_ascii_lowercase(),
            _ => {
                // Not elapsed time → rewind
                self.position = start_pos;
                return None;
            }
        };

        // Count how many times the same unit repeats (so we detect h vs hh, etc.)
        let mut count = 1;
        while let Some(ch) = self.peek_char() {
            if ch.to_ascii_lowercase() == unit {
                count += 1;
                self.read_next_char();
            } else {
                break;
            }
        }

        // Must be closed by ']'
        if self.read_next_char() != Some(']') {
            // Not a well-formed [h], [hh], etc. → rewind
            self.position = start_pos;
            return None;
        }

        // Map (unit, count) to a token
        let token = match (unit, count) {
            ('h', 1) => Token::ElapsedHour,
            ('h', 2) => Token::ElapsedHourPadded,
            ('m', 1) => Token::ElapsedMinute,
            ('m', 2) => Token::ElapsedMinutePadded,
            ('s', 1) => Token::ElapsedSecond,
            ('s', 2) => Token::ElapsedSecondPadded,
            // Anything else like [hhh], [mmm], [sss] → not considered elapsed time
            _ => {
                self.position = start_pos;
                return None;
            }
        };

        Some(token)
    }

    fn consume_color(&mut self) -> Option<i32> {
        let colors = [
            "black", "white", "red", "green", "blue", "yellow", "magenta",
        ];
        let mut chars = "".to_string();
        while let Some(ch) = self.read_next_char() {
            if ch == ']' {
                let lc = chars.to_lowercase();
                if let Some(index) = colors.iter().position(|&x| x == lc) {
                    return Some(index as i32);
                }
                if !chars.starts_with("Color") {
                    return None;
                }
                if let Ok(index) = chars[5..].trim().parse::<i32>() {
                    if index < 57 && index > 0 {
                        return Some(index);
                    } else {
                        return None;
                    }
                }
                return None;
            } else {
                chars.push(ch);
            }
        }
        None
    }

    pub fn peek_token(&mut self) -> Token {
        let position = self.position;
        let token = self.next_token();
        self.position = position;
        token
    }

    pub fn next_token(&mut self) -> Token {
        let ch = self.read_next_char();
        match ch {
            Some(x) => match x {
                '$' | '€' | '(' | ')' | '/' | ':' | '+' | '-' | '^' | '\'' | '{' | '}' | '<'
                | '=' | '!' | '~' | '>' | ' ' => Token::Literal(x),
                '?' => Token::QuestionMark,
                ';' => Token::Separator,
                '#' => Token::Sharp,
                ',' => Token::Comma,
                '.' => Token::Period,
                '0' => Token::Zero,
                '@' => Token::Raw,
                '%' => Token::Percent,
                '[' => {
                    if let Some(c) = self.peek_char() {
                        if c == '<' || c == '>' || c == '=' {
                            // Condition
                            if let Some((cmp, value)) = self.consume_condition() {
                                Token::Condition(cmp, value)
                            } else {
                                self.set_error("Failed to parse condition");
                                Token::ILLEGAL
                            }
                        } else if c == '$' {
                            // currency: [$<symbol>] or [$<symbol>-<locale>]
                            // IronCalc ignores the currency/locale modifiers for now
                            // They are of two types:
                            //  * BCP-47 locale tag (like [$€-fr-FR])
                            //  * hex LCID (old format)
                            //      Like [$$-409] (=1033 for en-US) or
                            //           [$$-40C] (=1036 for fr-FR)
                            self.read_next_char();
                            if let Some(currency) = self.read_next_char() {
                                // ignore the locale part for now, just check if it ends with ']'
                                if Some('-') == self.peek_char() {
                                    self.read_next_char();

                                    while let Some(c) = self.peek_char() {
                                        if c == ']' {
                                            break;
                                        }
                                        self.read_next_char();
                                    }
                                }
                                if self.read_next_char() == Some(']') {
                                    return Token::Currency(currency);
                                }
                            }
                            self.set_error("Failed to parse currency");
                            Token::ILLEGAL
                        } else {
                            // try bracketed (elapsed) time
                            if let Some(token) = self.consume_elapsed_time() {
                                return token;
                            }
                            // Color
                            if let Some(index) = self.consume_color() {
                                return Token::Color(index);
                            }
                            self.set_error("Failed to parse color");
                            Token::ILLEGAL
                        }
                    } else {
                        self.set_error("Unexpected end of input");
                        Token::ILLEGAL
                    }
                }
                '_' => {
                    if let Some(y) = self.read_next_char() {
                        Token::Ghost(y)
                    } else {
                        self.set_error("Unexpected end of input");
                        Token::ILLEGAL
                    }
                }
                '*' => {
                    if let Some(y) = self.read_next_char() {
                        Token::Spacer(y)
                    } else {
                        self.set_error("Unexpected end of input");
                        Token::ILLEGAL
                    }
                }
                '\\' => {
                    if let Some(y) = self.read_next_char() {
                        Token::Literal(y)
                    } else {
                        self.set_error("Unexpected end of input");
                        Token::ILLEGAL
                    }
                }
                '"' => {
                    if let Some(s) = self.consume_string() {
                        Token::Text(s)
                    } else {
                        self.set_error("Did not find end of text string");
                        Token::ILLEGAL
                    }
                }
                'E' => {
                    if let Some(s) = self.read_next_char() {
                        if s == '+' {
                            Token::Scientific
                        } else if s == '-' {
                            Token::ScientificMinus
                        } else {
                            self.set_error(&format!("Unexpected char: {s}. Expected + or -"));
                            Token::ILLEGAL
                        }
                    } else {
                        self.set_error("Unexpected end of input");
                        Token::ILLEGAL
                    }
                }
                'd' | 'D' => {
                    let mut d = 1;
                    while let Some(c) = self.peek_char() {
                        if c.eq_ignore_ascii_case(&'d') {
                            d += 1;
                            self.read_next_char();
                        } else {
                            break;
                        }
                    }
                    match d {
                        1 => Token::Day,
                        2 => Token::DayPadded,
                        3 => Token::DayNameShort,
                        _ => Token::DayName,
                    }
                }
                'm' | 'M' => {
                    let mut m = 1;
                    while let Some(c) = self.peek_char() {
                        if c.eq_ignore_ascii_case(&'m') {
                            m += 1;
                            self.read_next_char();
                        } else {
                            break;
                        }
                    }
                    match m {
                        1 => Token::Month,       // (or minute)
                        2 => Token::MonthPadded, // (or minute padded)
                        3 => Token::MonthNameShort,
                        4 => Token::MonthName,
                        5 => Token::MonthLetter,
                        _ => Token::MonthName,
                    }
                }
                'y' | 'Y' => {
                    let mut y = 1;
                    while let Some(c) = self.peek_char() {
                        if c.eq_ignore_ascii_case(&'y') {
                            y += 1;
                            self.read_next_char();
                        } else {
                            break;
                        }
                    }
                    if y == 1 || y == 2 {
                        Token::YearShort
                    } else {
                        Token::Year
                    }
                }
                'h' | 'H' => {
                    let mut h = 1;
                    while let Some(c) = self.peek_char() {
                        if c.eq_ignore_ascii_case(&'h') {
                            h += 1;
                            self.read_next_char();
                        } else {
                            break;
                        }
                    }
                    if h == 1 {
                        Token::Hour
                    } else if h == 2 {
                        Token::HourPadded
                    } else {
                        self.set_error("Unexpected character after 'h'");
                        Token::ILLEGAL
                    }
                }
                's' | 'S' => {
                    let mut s = 1;
                    while let Some(c) = self.peek_char() {
                        if c.eq_ignore_ascii_case(&'s') {
                            s += 1;
                            self.read_next_char();
                        } else {
                            break;
                        }
                    }
                    if s == 1 {
                        Token::Second
                    } else if s == 2 {
                        Token::SecondPadded
                    } else {
                        self.set_error("Unexpected character after 's'");
                        Token::ILLEGAL
                    }
                }
                'A' | 'a' => {
                    if let Some('M') | Some('m') = self.peek_char() {
                        self.read_next_char();
                    } else {
                        self.set_error("Unexpected character after 'A'");
                        return Token::ILLEGAL;
                    }
                    if let Some('/') = self.peek_char() {
                        self.read_next_char();
                    } else {
                        self.set_error("Unexpected character after 'AM'");
                        return Token::ILLEGAL;
                    }
                    if let Some('P') | Some('p') = self.peek_char() {
                        self.read_next_char();
                    } else {
                        self.set_error("Unexpected character after 'AM'");
                        return Token::ILLEGAL;
                    }
                    if let Some('M') | Some('m') = self.peek_char() {
                        self.read_next_char();
                    } else {
                        self.set_error("Unexpected character after 'AMP'");
                        return Token::ILLEGAL;
                    }
                    Token::AMPM
                }
                'g' | 'G' => {
                    for c in "eneral".chars() {
                        let cc = self.read_next_char();
                        if Some(c) != cc {
                            self.set_error(&format!("Unexpected character: {x}"));
                            return Token::ILLEGAL;
                        }
                    }
                    Token::General
                }
                _ => {
                    self.set_error(&format!("Unexpected character: {x}"));
                    Token::ILLEGAL
                }
            },
            None => Token::EOF,
        }
    }
}

pub fn is_likely_date_number_format(format: &str) -> bool {
    let mut lexer = Lexer::new(format);
    loop {
        let token = lexer.next_token();
        if token == Token::EOF {
            return false;
        }
        if token.is_date() {
            return true;
        }
    }
}
