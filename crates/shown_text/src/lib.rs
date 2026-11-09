#![deny(missing_docs)]

//! Checks for text an AI session writes for a person to read, after reading
//! untrusted data such as their mail: it is one plain line, and names no
//! email address, phone number or street address.

#[cfg(test)]
mod test;

/// `text` trimmed, when it is one line of at most `max` characters with no
/// control or formatting characters.
pub fn line(text: &str, max: usize) -> Option<String> {
    let text = text.trim();
    let plain = !text.is_empty()
        && text.chars().count() <= max
        && !text.chars().any(|c| c.is_control() || is_invisible(c));
    plain.then(|| text.to_owned())
}

/// Characters that change how text displays without showing: bidirectional
/// overrides and zero-width characters.
pub fn is_invisible(c: char) -> bool {
    matches!(c, '\u{200B}'..='\u{200F}' | '\u{202A}'..='\u{202E}' | '\u{2060}'..='\u{2064}' | '\u{2066}'..='\u{2069}' | '\u{FEFF}')
}

/// What personal detail `text` names, if any: an email address, a phone
/// number or a street address, by their shape.
pub fn personal_detail(text: &str) -> Option<&'static str> {
    if lazy_regex::regex_is_match!(
        r"(?i)\b[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}\b",
        text
    ) {
        return Some("an email address");
    }
    if lazy_regex::regex_is_match!(
        r"(?:\+\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)|\d{2,4})[\s.-]\d{3,4}[\s.-]\d{3,4}\b",
        text
    ) {
        return Some("a phone number");
    }
    if lazy_regex::regex_is_match!(
        r"\b\d{1,6}[A-Za-z]?\s+(?:[A-Z][A-Za-z.'-]*\s+){1,4}(?i:street|st|avenue|ave|road|rd|boulevard|blvd|lane|ln|drive|dr|way|court|ct|place|pl|terrace|parkway|pkwy|highway|hwy|square|sq)\b",
        text
    ) {
        return Some("a street address");
    }
    None
}
