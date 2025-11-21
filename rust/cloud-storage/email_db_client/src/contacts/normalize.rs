use models_email::db::contact::ContactPhotoless;
use once_cell::sync::Lazy;
use regex::Regex;

pub fn normalize_contact(contact: ContactPhotoless) -> ContactPhotoless {
    let normalized_name = if email_utils::is_generic_email(&contact.email_address) {
        None
    } else {
        contact
            .name
            .as_ref()
            .map(|name_str| remove_name_suffix(name_str))
    };

    ContactPhotoless {
        id: contact.id,
        link_id: contact.link_id,
        email_address: contact.email_address.to_lowercase(),
        name: normalized_name,
    }
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

#[test]
fn test_remove_name_suffix() {
    // Test "via X" pattern (without parentheses)
    assert_eq!(remove_name_suffix("John Doe via Gmail"), "John Doe");
    assert_eq!(remove_name_suffix("Jane Smith via Outlook"), "Jane Smith");
    assert_eq!(
        remove_name_suffix("Alice Johnson via Yahoo Mail"),
        "Alice Johnson"
    );

    // Test "(via X)" pattern (with parentheses)
    assert_eq!(
        remove_name_suffix("Bob Williams (via Gmail)"),
        "Bob Williams"
    );
    assert_eq!(
        remove_name_suffix("Charlie Brown (via Outlook)"),
        "Charlie Brown"
    );
    assert_eq!(
        remove_name_suffix("Diana Prince (via Yahoo Mail)"),
        "Diana Prince"
    );

    // Test specific common suffixes
    assert_eq!(remove_name_suffix("Ethan Hunt (Figma)"), "Ethan Hunt");
    assert_eq!(
        remove_name_suffix("Fiona Apple (Google Calendar)"),
        "Fiona Apple"
    );
    assert_eq!(
        remove_name_suffix("George Lucas (Shared via Google)"),
        "George Lucas"
    );
    assert_eq!(
        remove_name_suffix("Hannah Montana (Google Drive)"),
        "Hannah Montana"
    );
    assert_eq!(remove_name_suffix("Ian McKellen (Dropbox)"), "Ian McKellen");
    assert_eq!(
        remove_name_suffix("Jennifer Lopez (Microsoft 365)"),
        "Jennifer Lopez"
    );

    // Test with non-breaking spaces
    let name_with_nbsp = format!("John{}Doe via Teams", '\u{00A0}');
    assert_eq!(remove_name_suffix(&name_with_nbsp), "John Doe");

    // Test with combined issues
    let complex_name = format!("Jane{}Smith (via Microsoft 365)", '\u{00A0}');
    assert_eq!(remove_name_suffix(&complex_name), "Jane Smith");

    // Test with no changes needed
    assert_eq!(remove_name_suffix("Regular Name"), "Regular Name");

    // Test with more complex cases
    assert_eq!(
        remove_name_suffix("Team Notification via Slack"),
        "Team Notification"
    );
    assert_eq!(
        remove_name_suffix("Project Update (via Jira Cloud)"),
        "Project Update"
    );
    assert_eq!(
        remove_name_suffix("Marketing Team via MailChimp"),
        "Marketing Team"
    );
    assert_eq!(
        remove_name_suffix("Olivia Rios (via MailChimp)"),
        "Olivia Rios"
    );
    assert_eq!(
        remove_name_suffix("Aviation Week & Space Technology"),
        "Aviation Week & Space Technology"
    );
}
