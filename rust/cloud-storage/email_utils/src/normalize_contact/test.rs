use super::{contains_email, remove_name_suffix};
use crate::normalize_contact::normalize_contact_name;

#[test]
fn test_normalize_contact_name_generic_email() {
    assert_eq!(
        normalize_contact_name("noreply@example.com", Some("No Reply")),
        None
    );
}

#[test]
fn test_normalize_contact_name_with_email_in_name() {
    assert_eq!(
        normalize_contact_name("john@example.com", Some("john@example.com")),
        None
    );
}

#[test]
fn test_normalize_contact_name_with_suffix() {
    assert_eq!(
        normalize_contact_name("john@example.com", Some("John Doe via Gmail")),
        Some("John Doe".to_string())
    );
}

#[test]
fn test_normalize_contact_name_none() {
    assert_eq!(normalize_contact_name("john@example.com", None), None);
}

#[test]
fn test_normalize_contact_name_regular() {
    assert_eq!(
        normalize_contact_name("john@example.com", Some("John Doe")),
        Some("John Doe".to_string())
    );
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

#[test]
fn test_contains_email_with_valid_emails() {
    assert!(contains_email("john@example.com"));
    assert!(contains_email("alice@domain.co.uk"));
    assert!(contains_email("user.name@subdomain.example.com"));
    assert!(contains_email("test_email@test-domain.org"));
    assert!(contains_email("Contact john@example.com for info"));
    assert!(contains_email("John Doe (john@example.com)"));
    assert!(contains_email("Email: alice@test.com"));
    assert!(contains_email("john@example.com - John Doe"));
    assert!(contains_email("Reply to support@company.io today"));
}

#[test]
fn test_contains_email_with_spaces_around_at() {
    assert!(!contains_email("Gordon @ Calendly"));
    assert!(!contains_email("Sales @ Company"));
    assert!(!contains_email("Support @ Microsoft"));
    assert!(!contains_email("Team @ Notion"));
    assert!(!contains_email("John @ Work"));
}

#[test]
fn test_contains_email_without_domain() {
    assert!(!contains_email("user@localhost"));
    assert!(!contains_email("test@domain"));
    assert!(!contains_email("Contact @ HQ"));
}

#[test]
fn test_contains_email_edge_cases() {
    assert!(!contains_email(""));
    assert!(!contains_email("   "));
    assert!(!contains_email("@"));
    assert!(!contains_email(" @ "));
    assert!(contains_email("test@@example.com"));
    assert!(contains_email("user@domain1.com and admin@domain2.org"));
    assert!(contains_email("user+tag@example.com"));
    assert!(contains_email("first.last@example.co.uk"));
    assert!(!contains_email("John Doe"));
    assert!(!contains_email("Regular Name"));
    assert!(!contains_email("Company Name Inc."));
}

#[test]
fn test_contains_email_with_formatting() {
    assert!(contains_email("(john@example.com)"));
    assert!(contains_email("[admin@company.org]"));
    assert!(contains_email("\"test@example.com\""));
    assert!(contains_email("'user@domain.com'"));
    assert!(contains_email(
        "For questions, email support@company.com or call us"
    ));
    assert!(contains_email("John Doe <john.doe@example.com>"));
}
