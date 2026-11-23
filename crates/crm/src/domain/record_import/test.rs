use super::*;

#[test]
fn company_domains_are_hosts_and_never_personal_providers() {
    assert_eq!(company_domain("Acme.example").as_deref(), Some("acme.example"));
    assert_eq!(
        company_domain("https://www.acme.example/about").as_deref(),
        Some("acme.example")
    );
    assert_eq!(company_domain("gmail.com"), None);
    assert_eq!(company_domain("not a domain"), None);
}

#[test]
fn currencies_are_the_pipelines_own() {
    assert!(supports_currency("EUR"));
    assert!(!supports_currency("ISK"));
}
