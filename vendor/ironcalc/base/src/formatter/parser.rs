use super::lexer::{Compare, Lexer, Token};

pub struct Digit {
    pub kind: char, // '#' | '?' | '0'
    pub index: i32,
    pub number: NumberState, // 'i' | 'd' | 'e' (integer, decimal or exponent)
}

pub enum TextToken {
    Literal(char),
    Text(String),
    Ghost(char),
    Spacer(char),
    // Text
    Raw,
    Digit(Digit),
    Period,
    // Dates
    Day,
    DayPadded,
    DayNameShort,
    DayName,
    Month,
    MonthPadded,
    MonthNameShort,
    MonthName,
    MonthLetter,
    YearShort,
    Year,
    Hour,
    HourPadded,
    Minute,
    MinutePadded,
    Second,
    SecondPadded,
    ElapsedHour,
    ElapsedHourPadded,
    ElapsedMinute,
    ElapsedMinutePadded,
    ElapsedSecond,
    ElapsedSecondPadded,
    AMPM,
}
pub struct NumberPart {
    pub color: Option<i32>,
    pub condition: Option<(Compare, f64)>,
    pub use_thousands: bool,
    pub percent: i32, // multiply number by 100^percent
    pub comma: i32,   // divide number by 1000^comma
    pub tokens: Vec<TextToken>,
    pub digit_count: i32, // number of digit tokens (#, 0 or ?) to the left of the decimal point
    pub precision: i32,   // number of digits to the right of the decimal point
    pub is_scientific: bool,
    pub scientific_minus: bool,
    pub exponent_digit_count: i32,
    pub currency: Option<char>,
}

pub struct DatePart {
    pub color: Option<i32>,
    pub use_ampm: bool,
    pub tokens: Vec<TextToken>,
}

pub struct ErrorPart {}

pub struct GeneralPart {}

pub enum ParsePart {
    Number(NumberPart),
    Date(DatePart),
    Error(ErrorPart),
    General(GeneralPart),
}

pub struct Parser {
    pub parts: Vec<ParsePart>,
    lexer: Lexer,
}

#[derive(PartialEq, Copy, Clone)]
pub enum NumberState {
    Integer,
    Decimal,
    Exponent,
}

impl NumberState {
    pub fn is_integer(&self) -> bool {
        matches!(self, NumberState::Integer)
    }

    pub fn is_decimal(&self) -> bool {
        matches!(self, NumberState::Decimal)
    }

    pub fn is_exponent(&self) -> bool {
        matches!(self, NumberState::Exponent)
    }
}

impl ParsePart {
    pub fn is_error(&self) -> bool {
        match &self {
            ParsePart::Date(..) => false,
            ParsePart::Number(..) => false,
            ParsePart::Error(..) => true,
            ParsePart::General(..) => false,
        }
    }
    pub fn is_date(&self) -> bool {
        match &self {
            ParsePart::Date(..) => true,
            ParsePart::Number(..) => false,
            ParsePart::Error(..) => false,
            ParsePart::General(..) => false,
        }
    }
}

// Numbers:
// [integer section][decimal point][fractional section][optional exponent]
// So #,##0.00 is valid but 0.00#,## is not.

impl Parser {
    pub fn new(format: &str) -> Self {
        let lexer = Lexer::new(format);
        let parts = vec![];
        Parser { parts, lexer }
    }
    pub fn parse(&mut self) {
        while self.lexer.peek_token() != Token::EOF {
            let part = self.parse_part();
            self.parts.push(part);
        }
    }

    fn parse_part(&mut self) -> ParsePart {
        let mut token = self.lexer.next_token();
        let mut digit_count = 0;
        let mut precision = 0;
        let mut is_date = false;
        let mut use_ampm = false;
        let mut is_number = false;
        let mut found_decimal_dot = false;
        let mut use_thousands = false;
        let mut comma = 0;
        let mut percent = 0;
        let mut last_token_is_digit = false;
        let mut color = None;
        let mut condition = None;
        let mut tokens = vec![];
        let mut is_scientific = false;
        let mut scientific_minus = false;
        let mut exponent_digit_count = 0;
        let mut number = NumberState::Integer;
        let mut index = 0;
        let mut currency = None;
        let mut is_time = false;

        while token != Token::EOF && token != Token::Separator {
            let next_token = self.lexer.next_token();
            let token_is_digit = token.is_digit();
            is_number = is_number || token_is_digit;
            let next_token_is_digit = next_token.is_digit();
            if token_is_digit {
                if is_scientific {
                    exponent_digit_count += 1;
                } else if found_decimal_dot {
                    precision += 1;
                } else {
                    digit_count += 1;
                }
            }
            match token {
                Token::General => {
                    if tokens.is_empty() {
                        return ParsePart::General(GeneralPart {});
                    } else {
                        return ParsePart::Error(ErrorPart {});
                    }
                }
                Token::Comma => {
                    // If it is in between digit tokens then we use the thousand separator
                    if last_token_is_digit && next_token_is_digit {
                        use_thousands = true;
                    } else if digit_count > 0 {
                        comma += 1;
                    } else {
                        // Before the number is just a literal.
                        tokens.push(TextToken::Literal(','));
                    }
                }
                Token::Percent => {
                    tokens.push(TextToken::Literal('%'));
                    percent += 1;
                }
                Token::Period => {
                    if is_number && !found_decimal_dot {
                        tokens.push(TextToken::Period);
                        found_decimal_dot = true;
                        if number.is_integer() {
                            number = NumberState::Decimal;
                            index = 0;
                        }
                    } else {
                        tokens.push(TextToken::Literal('.'));
                    }
                }
                Token::Color(index) => {
                    color = Some(index);
                }
                Token::Condition(cmp, value) => {
                    condition = Some((cmp, value));
                }
                Token::Currency(c) => {
                    currency = Some(c);
                }
                Token::QuestionMark => {
                    tokens.push(TextToken::Digit(Digit {
                        kind: '?',
                        index,
                        number,
                    }));
                    index += 1;
                }
                Token::Sharp => {
                    tokens.push(TextToken::Digit(Digit {
                        kind: '#',
                        index,
                        number,
                    }));
                    index += 1;
                }
                Token::Zero => {
                    tokens.push(TextToken::Digit(Digit {
                        kind: '0',
                        index,
                        number,
                    }));
                    index += 1;
                }
                Token::Literal(value) => {
                    if value == ':' {
                        is_time = true;
                    }
                    tokens.push(TextToken::Literal(value));
                }
                Token::Text(value) => {
                    tokens.push(TextToken::Text(value));
                }
                Token::Ghost(value) => {
                    tokens.push(TextToken::Ghost(value));
                }
                Token::Spacer(value) => {
                    tokens.push(TextToken::Spacer(value));
                }
                Token::Day => {
                    is_date = true;
                    tokens.push(TextToken::Day);
                }
                Token::DayPadded => {
                    is_date = true;
                    tokens.push(TextToken::DayPadded);
                }
                Token::DayNameShort => {
                    is_date = true;
                    tokens.push(TextToken::DayNameShort);
                }
                Token::DayName => {
                    is_date = true;
                    tokens.push(TextToken::DayName);
                }
                Token::MonthNameShort => {
                    is_date = true;
                    tokens.push(TextToken::MonthNameShort);
                }
                Token::MonthName => {
                    is_date = true;
                    tokens.push(TextToken::MonthName);
                }
                Token::Month => {
                    if is_time {
                        // minute
                        tokens.push(TextToken::Minute);
                    } else {
                        is_date = true;
                        tokens.push(TextToken::Month);
                    }
                }
                Token::MonthPadded => {
                    if is_time {
                        // minute padded
                        tokens.push(TextToken::MinutePadded);
                    } else {
                        is_date = true;
                        tokens.push(TextToken::MonthPadded);
                    }
                }
                Token::MonthLetter => {
                    is_date = true;
                    tokens.push(TextToken::MonthLetter);
                }
                Token::YearShort => {
                    is_date = true;
                    tokens.push(TextToken::YearShort);
                }
                Token::Year => {
                    is_date = true;
                    tokens.push(TextToken::Year);
                }
                Token::Hour => {
                    is_date = true;
                    is_time = true;
                    tokens.push(TextToken::Hour);
                }
                Token::HourPadded => {
                    is_date = true;
                    is_time = true;
                    tokens.push(TextToken::HourPadded);
                }
                Token::Second => {
                    is_date = true;
                    is_time = true;
                    tokens.push(TextToken::Second);
                }
                Token::SecondPadded => {
                    is_date = true;
                    is_time = true;
                    tokens.push(TextToken::SecondPadded);
                }
                Token::AMPM => {
                    is_date = true;
                    use_ampm = true;
                    tokens.push(TextToken::AMPM);
                }
                Token::Scientific => {
                    if !is_scientific {
                        index = 0;
                        number = NumberState::Exponent;
                    }
                    is_scientific = true;
                }
                Token::ScientificMinus => {
                    if !is_scientific {
                        index = 0;
                        number = NumberState::Exponent;
                    }
                    is_scientific = true;
                    scientific_minus = true;
                }
                Token::Separator => {}
                Token::Raw => {
                    tokens.push(TextToken::Raw);
                }
                Token::ILLEGAL => {
                    return ParsePart::Error(ErrorPart {});
                }
                Token::EOF => {}
                Token::ElapsedHour => {
                    is_date = true;
                    is_time = true;
                    tokens.push(TextToken::ElapsedHour);
                }
                Token::ElapsedMinute => {
                    is_date = true;
                    is_time = true;
                    tokens.push(TextToken::ElapsedMinute);
                }
                Token::ElapsedSecond => {
                    is_date = true;
                    is_time = true;
                    tokens.push(TextToken::ElapsedSecond);
                }
                Token::ElapsedHourPadded => {
                    is_date = true;
                    is_time = true;
                    tokens.push(TextToken::ElapsedHourPadded);
                }
                Token::ElapsedMinutePadded => {
                    is_date = true;
                    is_time = true;
                    tokens.push(TextToken::ElapsedMinutePadded);
                }
                Token::ElapsedSecondPadded => {
                    is_date = true;
                    is_time = true;
                    tokens.push(TextToken::ElapsedSecondPadded);
                }
            }
            last_token_is_digit = token_is_digit;
            token = next_token;
        }
        if is_date {
            if is_number {
                return ParsePart::Error(ErrorPart {});
            }
            ParsePart::Date(DatePart {
                color,
                use_ampm,
                tokens,
            })
        } else {
            ParsePart::Number(NumberPart {
                color,
                condition,
                use_thousands,
                percent,
                comma,
                tokens,
                digit_count,
                precision,
                is_scientific,
                scientific_minus,
                exponent_digit_count,
                currency,
            })
        }
    }
}
