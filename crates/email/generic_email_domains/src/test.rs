use super::*;

#[test]
fn list_is_sorted_and_lowercase() {
    // binary_search only works on a sorted list; a bad edit here would
    // silently misclassify domains.
    let mut sorted = GENERIC_EMAIL_DOMAINS.to_vec();
    sorted.sort_unstable();
    assert_eq!(GENERIC_EMAIL_DOMAINS, sorted.as_slice());
    for domain in GENERIC_EMAIL_DOMAINS {
        assert_eq!(*domain, domain.to_ascii_lowercase());
    }
}

#[test]
fn matches_generic_providers() {
    assert!(is_generic_email_domain("gmail.com"));
    assert!(is_generic_email_domain("outlook.com"));
    assert!(is_generic_email_domain("yahoo.co.uk"));
}

#[test]
fn is_case_insensitive() {
    assert!(is_generic_email_domain("Gmail.COM"));
}

#[test]
fn allows_company_domains() {
    assert!(!is_generic_email_domain("macro.com"));
    assert!(!is_generic_email_domain("acme.dev"));
}
