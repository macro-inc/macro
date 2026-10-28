#[cfg(test)]
mod test;

use lazy_static::lazy_static;
use regex::Regex;

/// Normalizes a contact name for storage.
///
/// Returns `None` if:
/// - The email is a generic/no-reply address
/// - The name contains an email address pattern
/// - The input name is `None`
///
/// Otherwise returns the name with service suffixes stripped and non-breaking spaces normalized.
pub fn normalize_contact_name(email: &str, name: Option<&str>) -> Option<String> {
    if crate::is_generic_email(email) {
        return None;
    }

    name.and_then(|name_str| {
        if contains_email(name_str) {
            None
        } else {
            Some(remove_name_suffix(name_str))
        }
    })
}

/// Checks if a string contains an email address pattern
///
/// This function detects email patterns like "user@domain.com" but not
/// patterns like "Gordon @ Calendly" (spaces around @ without domain).
fn contains_email(text: &str) -> bool {
    lazy_static! {
        static ref EMAIL_PATTERN: Regex = Regex::new(r"\S+@\S+\.\S+").unwrap();
    }
    EMAIL_PATTERN.is_match(text)
}

/// Removes service suffixes from a contact name and normalizes spaces
///
/// This function detects and removes:
/// 1. Suffixes in the format " (via ServiceName)"
/// 2. Suffixes in the format " via ServiceName"
/// 3. Specific known suffixes like " (Figma)" and " (Google Calendar)"
///
/// # Arguments
/// * `name` - The name to process
///
/// # Returns
/// * The processed name with suffixes removed and non-breaking spaces replaced
fn remove_name_suffix(name: &str) -> String {
    lazy_static! {
        static ref VIA_PATTERN: Regex = Regex::new(r" via [^()]+$").unwrap();
        static ref VIA_PARENS_PATTERN: Regex = Regex::new(r" \(via [^()]+\)$").unwrap();
        static ref SPECIFIC_SUFFIX_PATTERN: Regex = Regex::new(
            r" \((Figma|Google Calendar|Shared via Google|Google Drive|Dropbox|Microsoft 365)\)$",
        )
        .unwrap();
    }

    // First remove any non-breaking spaces (U+00A0) and replace with regular spaces
    let name = name.replace('\u{00A0}', " ");

    // Apply the regex replacements in sequence
    let name = VIA_PATTERN.replace(&name, "").to_string();
    let name = VIA_PARENS_PATTERN.replace(&name, "").to_string();

    SPECIFIC_SUFFIX_PATTERN.replace(&name, "").to_string()
}
