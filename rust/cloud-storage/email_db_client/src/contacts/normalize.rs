use models_email::db::contact::ContactPhotoless;
use once_cell::sync::Lazy;
use regex::Regex;

pub fn normalize_contact(contact: ContactPhotoless) -> ContactPhotoless {
    let normalized_name = if is_generic_email(&contact.email_address) {
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

/// Checks if an email address is likely a generic/automated system email
///
/// This function identifies common patterns in email addresses that typically
/// indicate automated senders rather than individual users.
fn is_generic_email(email: &str) -> bool {
    let email_lower = email.to_lowercase();

    // Common automated email prefixes
    let automated_prefixes = [
        "reply",
        "noreply",
        "no-reply",
        "do-not-reply",
        "donotreply",
        "auto",
        "automated",
        "alert",
        "alerts",
        "notification",
        "notifications",
        "info",
        "information",
        "news",
        "newsletter",
        "updates",
        "support",
        "help",
        "helpdesk",
        "service",
        "services",
        "system",
        "admin",
        "administrator",
        "account",
        "accounts",
        "billing",
        "contact",
        "team",
        "no_reply",
        "do_not_reply",
        "mailer",
        "mail",
        "postmaster",
        "robot",
        "confirm",
        "confirmation",
        "verify",
        "verification",
        "security",
        "secure",
        "webmaster",
        "customercare",
        "customer-care",
        "customer.care",
        "customerservice",
        "customer-service",
        "customer.service",
        "feedback",
        "hello",
        "hi",
        "welcome",
        "marketing",
        "careers",
        "jobs",
        "applications",
        "receipts",
        "receipt",
        "order",
        "orders",
        "shipping",
        "delivery",
        "track",
        "tracking",
        "sales",
        "dev",
        "developer",
        "api",
        "test",
        "testing",
        "noreply-",
        "no-reply-",
        "no.reply.",
        "donotreply-",
        "do-not-reply-",
        "do.not.reply.",
    ];

    // Check if email starts with any of the automated prefixes
    // We check specifically for prefix@ pattern to avoid matching personal emails
    // that might contain these words elsewhere
    for prefix in automated_prefixes {
        if email_lower.starts_with(prefix)
            && (email_lower.contains(&format!("{}@", prefix))
                || email_lower.contains(&format!("{}-@", prefix))
                || email_lower.contains(&format!("{}.@", prefix))
                || email_lower.contains(&format!("{}+@", prefix))
                || email_lower.contains(&format!("{}=@", prefix))
                || email_lower.contains(&format!("{}_@", prefix)))
        {
            return true;
        }
    }

    // Check for common patterns for system accounts
    if email_lower.contains("@")
        && (email_lower.contains("noreply")
            || email_lower.contains("no-reply")
            || email_lower.contains("no.reply")
            || email_lower.contains("do-not-reply")
            || email_lower.contains("donotreply")
            || email_lower.contains("system")
            || email_lower.contains("notification")
            || email_lower.contains("automated")
            || email_lower.contains("no_reply")
            || email_lower.contains("do_not_reply"))
    {
        return true;
    }

    // Check for specific domains or addresses that typically send automated emails
    let system_domains = [
        "@sendgrid.net",
        "@mailchimp.com",
        "@sendgrid.com",
        "@amazonses.com",
        "@email.amazonses.com",
        "@bounce.amazonses.com",
        "@sparkpost.com",
        "@mailgun.org",
        "@mg.mailgun.org",
        "@postman.com",
        "@salesforce.com",
        "@salesforceiq.com",
        "@hubspot.com",
        "@marketo.com",
        "@mailjet.com",
        "@sendgrid.net",
        "@constant.com",
        "@constantcontact.com",
    ];

    for domain in system_domains {
        if email_lower.ends_with(domain) {
            return true;
        }
    }

    // Check common automated email patterns where @ is preceded by numbers or codes
    if let Some(at_pos) = email_lower.find('@') {
        let local_part = &email_lower[0..at_pos];

        // Check if local part consists only of numbers or contains certain patterns
        if local_part
            .chars()
            .all(|c| c.is_numeric() || c == '.' || c == '-' || c == '_')
            && local_part.chars().any(|c| c.is_numeric())
        {
            return true;
        }

        // Check for common notification-type IDs
        if local_part.starts_with("id") && local_part.chars().skip(2).all(|c| c.is_numeric()) {
            return true;
        }
    }

    false
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

#[cfg(test)]
mod tests {
    use crate::contacts::normalize::is_generic_email;

    #[test]
    fn test_is_generic_email() {
        // Test original "reply" pattern
        assert!(is_generic_email("reply@example.com"));
        assert!(is_generic_email("noreply@company.org"));
        assert!(is_generic_email("no-reply@service.com"));
        assert!(is_generic_email("do-not-reply@example.net"));

        // Test additional common system email prefixes
        assert!(is_generic_email("support@company.com"));
        assert!(is_generic_email("info@business.org"));
        assert!(is_generic_email("admin@system.net"));
        assert!(is_generic_email("help@service.io"));
        assert!(is_generic_email("notifications@app.com"));
        assert!(is_generic_email("billing@saas.co"));
        assert!(is_generic_email("system@platform.io"));
        assert!(is_generic_email("webmaster@website.com"));
        assert!(is_generic_email("customercare@retailer.com"));
        assert!(is_generic_email("service@product.net"));
        assert!(is_generic_email("feedback@startup.io"));
        assert!(is_generic_email("hello@company.org"));
        assert!(is_generic_email("orders@shop.com"));
        assert!(is_generic_email("contact@business.net"));
        assert!(is_generic_email("team@project.org"));
        assert!(is_generic_email("newsletter@news.com"));
        assert!(is_generic_email("confirmation@booking.com"));
        assert!(is_generic_email("verification@account.net"));
        assert!(is_generic_email("tracking@shipping.com"));
        assert!(is_generic_email("receipt@store.com"));

        // Test with dot and hyphen variants
        assert!(is_generic_email("no.reply@service.com"));
        assert!(is_generic_email("no_reply@service.com"));
        assert!(is_generic_email("customer.service@company.org"));
        assert!(is_generic_email("customer-service@company.org"));

        // Test with service provider domains
        assert!(is_generic_email("updates@mg.mailgun.org"));
        assert!(is_generic_email("notification@sendgrid.net"));
        assert!(is_generic_email("marketing@mailchimp.com"));
        assert!(is_generic_email("alert@amazonses.com"));

        // Test with numeric and code patterns
        assert!(is_generic_email("12345@notifications.com"));
        assert!(is_generic_email("id12345@system.net"));

        // Test non-automated emails (should return false)
        assert!(!is_generic_email("john.smith@example.com"));
        assert!(!is_generic_email("jane.doe@company.org"));
        assert!(!is_generic_email("user@personal.net"));
        assert!(!is_generic_email("employee@business.com"));
        assert!(!is_generic_email("replicate@example.com")); // Contains "reply" but not as a prefix/pattern
        assert!(!is_generic_email("supportive@example.com")); // Contains "support" but not as a pattern
        assert!(!is_generic_email("maryinformation@gmail.com")); // Contains "information" but not as a pattern
    }
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
