#![deny(missing_docs)]
//! Telephone numbers in E.164 form: `+`, the country code and the subscriber
//! number, with no spacing.
//!
//! Numbers arrive formatted by people (with spaces, dots, dashes and
//! parentheses) or by providers. Each is stored and compared in one canonical form, so the
//! same number typed two ways is one number. A number without its country code
//! is rejected rather than guessed: the same national digits are different
//! people in different countries.

use serde::Serialize;
use std::fmt;

#[cfg(test)]
mod test;

/// E.164 allows at most 15 digits; shorter than 7 is not a dialable number.
const DIGITS: std::ops::RangeInclusive<usize> = 7..=15;

/// A telephone number in E.164 form.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize)]
#[serde(transparent)]
pub struct PhoneNumber(String);

impl PhoneNumber {
    /// Normalize a number written with its country code.
    ///
    /// Accepts a leading `+` or the international `00` prefix, and ignores
    /// spaces, dots, dashes and parentheses. Anything else (letters,
    /// extensions, a national number without its country code) is `None`.
    pub fn parse(text: &str) -> Option<Self> {
        let text = text.trim();
        let rest = text.strip_prefix('+').or_else(|| text.strip_prefix("00"))?;
        let mut digits = String::with_capacity(rest.len());
        for character in rest.chars() {
            match character {
                '0'..='9' => digits.push(character),
                ' ' | '\u{a0}' | '.' | '-' | '(' | ')' => {}
                _ => return None,
            }
        }
        let valid = DIGITS.contains(&digits.len()) && !digits.starts_with('0');
        valid.then(|| Self(format!("+{digits}")))
    }

    /// The number as stored and compared: `+<digits>`.
    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// The number for people to read. North American numbers are grouped as
    /// `+1 NNN-NNN-NNNN`; others stay as stored, since their grouping varies
    /// by country.
    pub fn readable(&self) -> String {
        match self.0.strip_prefix("+1") {
            Some(digits) if digits.len() == 10 => {
                format!("+1 {}-{}-{}", &digits[..3], &digits[3..6], &digits[6..])
            }
            _ => self.0.clone(),
        }
    }
}

impl fmt::Display for PhoneNumber {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl From<PhoneNumber> for String {
    fn from(number: PhoneNumber) -> Self {
        number.0
    }
}
