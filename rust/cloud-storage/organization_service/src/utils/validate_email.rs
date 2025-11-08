use lazy_static::lazy_static;
use regex::Regex;

lazy_static! {
    static ref EMAIL_REGEX: Regex = Regex::new(
        r"^([a-z0-9_+]([a-z0-9_+.]*[a-z0-9_+])?)@([a-z0-9]+([\-\.]{1}[a-z0-9]+)*\.[a-z]{2,6})"
    )
    .unwrap();
}

pub fn is_valid_email(email: &str) -> bool {
    EMAIL_REGEX.is_match(email)
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
        ];

        for email in emails {
            assert_eq!((email.0, is_valid_email(email.0)), (email.0, email.1));
        }
    }
}
