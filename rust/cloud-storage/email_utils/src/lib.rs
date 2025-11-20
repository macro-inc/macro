/// Checks if an email address is likely a generic/automated system email
///
/// This function identifies common patterns in email addresses that typically
/// indicate automated senders rather than individual users.
pub fn is_generic_email(email: &str) -> bool {
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
                || email_lower.contains(&format!("{}-", prefix))
                || email_lower.contains(&format!("{}.", prefix))
                || email_lower.contains(&format!("{}+", prefix))
                || email_lower.contains(&format!("{}=", prefix))
                || email_lower.contains(&format!("{}_", prefix)))
        {
            return true;
        }
    }

    // Check for common patterns for system accounts
    if email_lower.contains("@")
        && (email_lower.contains("noreply")
            || email_lower.contains("no-reply")
            || email_lower.contains("no.reply")
            || email_lower.contains("no_reply")
            || email_lower.contains("do-not-reply")
            || email_lower.contains("donotreply")
            || email_lower.contains("system")
            || email_lower.contains("notification")
            || email_lower.contains("automated")
            || email_lower.contains("unsubscribe")
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

#[cfg(test)]
mod tests {
    use crate::is_generic_email;

    #[test]
    fn test_is_generic_email() {
        // Test original "reply" pattern
        assert!(is_generic_email("reply@example.com"));
        assert!(is_generic_email("noreply@company.org"));
        assert!(is_generic_email("no-reply@service.com"));
        assert!(is_generic_email("do-not-reply@example.net"));
        assert!(is_generic_email(
            "32.mrtvirzriftueqkpj53gqqkinfzdiukcifng4s3bfvlvo4krnfpxqzdpinjxo2keonat2pi=@unsubscribe2.customer.io"
        ));
        assert!(is_generic_email(
            "reply-107199600-1441644_html-1962870046-524000040-59174@e.atlassian.com"
        ));

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
