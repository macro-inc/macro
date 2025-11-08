use std::borrow::Cow;

use lazy_static::lazy_static;
use regex::Regex;

lazy_static! {
    static ref EMAIL_REGEX: Regex = Regex::new(
        r"^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$"
    )
    .unwrap();
}

lazy_static! {
    static ref EMAIL_ALIAS_REGEX: Regex =
        Regex::new(r"(?P<username>[^+@]+)(?:\+[^@]*)?@(?P<domain>[^@]+)").unwrap();
}

pub fn is_valid_email(email: &str) -> bool {
    EMAIL_REGEX.is_match(email)
}

/// Takes in an email address and returns the email address without the alias
pub fn remove_email_alias<'a>(email: &str) -> Option<Cow<'a, str>> {
    let email_parts = EMAIL_ALIAS_REGEX.captures(email)?;
    let username = email_parts.name("username")?.as_str();
    let domain = email_parts.name("domain")?.as_str();
    Some(Cow::Owned(format!("{}@{}", username, domain)))
}

/// Takes in an email address and returns the normalized email address removing any alias if
/// present and lowercasing the email address
pub fn normalize_email<'a>(email: &str) -> Option<Cow<'a, str>> {
    let email_parts = EMAIL_ALIAS_REGEX.captures(email)?;
    let username = email_parts.name("username")?.as_str();
    let domain = email_parts.name("domain")?.as_str();
    Some(Cow::Owned(
        format!("{}@{}", username, domain).to_lowercase(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_valid_email() {
        let emails: Vec<(&str, bool)> = vec![
            ("test@test.com", true),
            ("test321+test@test.com", true),
            ("test321312.test@test.com", true),
            ("test@test.test", true),
            ("test.com", false),
            ("test@test", false),
            ("test@@test.com", false),
            ("test@#test.com", false),
            ("test@$test.com", false),
            ("test@/test.com", false),
            ("test@\\test.com", false),
            ("test@test.test.test", true),
            ("test-123test.test@test.test", true),
        ];

        for email in emails {
            assert_eq!((email.0, is_valid_email(email.0)), (email.0, email.1));
        }
    }

    #[test]
    fn test_remove_email_alias() {
        let emails: Vec<(&str, &str)> = vec![
            ("test@test.com", "test@test.com"),
            ("test321+test@test.com", "test321@test.com"),
            ("test321312.test@test.com", "test321312.test@test.com"),
            ("test321312.test+abc@test.com", "test321312.test@test.com"),
            ("test@test.test", "test@test.test"),
            ("test@test", "test@test"),
            ("test@test.test.test", "test@test.test.test"),
            ("test-123test.test@test.test", "test-123test.test@test.test"),
        ];

        for email in emails {
            let result = remove_email_alias(email.0);
            assert_eq!(
                (email.0, result.unwrap().to_string().as_str()),
                (email.0, email.1)
            );
        }
    }

    #[test]
    fn test_normalize_email() {
        let emails: Vec<(&str, &str)> = vec![
            ("test@test.com", "test@test.com"),
            ("test321+test@test.com", "test321@test.com"),
            ("TEST321+test@test.com", "test321@test.com"),
            ("TEST321+TEST@test.com", "test321@test.com"),
            ("TEST321+TEST@TEST.com", "test321@test.com"),
            ("TEST321312.TEST@test.com", "test321312.test@test.com"),
            ("TEST321312.TEST+ABC@Test.com", "test321312.test@test.com"),
            ("test@test.test", "test@test.test"),
            ("test@test", "test@test"),
            ("test@test.test.test", "test@test.test.test"),
            ("test-123test.TESt@test.com", "test-123test.test@test.com"),
        ];

        for email in emails {
            let result = normalize_email(email.0);
            assert_eq!(
                (email.0, result.unwrap().to_string().as_str()),
                (email.0, email.1)
            );
        }
    }
}
