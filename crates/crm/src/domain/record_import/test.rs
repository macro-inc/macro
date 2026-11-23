use super::*;

#[test]
fn company_domains_are_hosts_and_never_personal_providers() {
    assert_eq!(company_domain("Acme.co").as_deref(), Some("acme.co"));
    assert_eq!(
        company_domain("https://www.acme.co/about").as_deref(),
        Some("acme.co")
    );
    assert_eq!(company_domain("gmail.com"), None);
    assert_eq!(company_domain("not a domain"), None);
    // Reserved names never key a company.
    assert_eq!(company_domain("acme.example"), None);
}

#[test]
fn currencies_are_the_pipelines_own() {
    assert!(supports_currency("EUR"));
    assert!(!supports_currency("ISK"));
}
