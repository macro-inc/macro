#[cfg(test)]
mod tests;

use models_email::db::contact::ContactPhotoless;
use once_cell::sync::Lazy;
use regex::Regex;

pub fn normalize_contact(contact: ContactPhotoless) -> ContactPhotoless {
    let normalized_name = if email_utils::is_generic_email(&contact.email_address) {
        None
    } else {
        contact.name.as_ref().and_then(|name_str| {
            if contains_email(name_str) {
                None
            } else {
                Some(remove_name_suffix(name_str))
            }
        })
    };

    ContactPhotoless {
        id: contact.id,
        link_id: contact.link_id,
        email_address: contact.email_address.to_lowercase(),
        name: normalized_name,
    }
}

/// Checks if a string contains an email address pattern
///
/// This function detects email patterns like "user@domain.com" but not
/// patterns like "Gordon @ Calendly" (spaces around @ without domain).
fn contains_email(text: &str) -> bool {
    static EMAIL_PATTERN: Lazy<Regex> = Lazy::new(|| Regex::new(r"\S+@\S+\.\S+").unwrap());
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
    // Static regex patterns compiled only once
    static VIA_PATTERN: Lazy<Regex> = Lazy::new(|| Regex::new(r" via [^()]+$").unwrap());
    static VIA_PARENS_PATTERN: Lazy<Regex> = Lazy::new(|| Regex::new(r" \(via [^()]+\)$").unwrap());
    static SPECIFIC_SUFFIX_PATTERN: Lazy<Regex> = Lazy::new(|| {
        Regex::new(
            r" \((Figma|Google Calendar|Shared via Google|Google Drive|Dropbox|Microsoft 365)\)$",
        )
        .unwrap()
    });

    // First remove any non-breaking spaces (U+00A0) and replace with regular spaces
    let name = name.replace('\u{00A0}', " ");

    // Apply the regex replacements in sequence
    let name = VIA_PATTERN.replace(&name, "").to_string();
    let name = VIA_PARENS_PATTERN.replace(&name, "").to_string();

    SPECIFIC_SUFFIX_PATTERN.replace(&name, "").to_string()
}
