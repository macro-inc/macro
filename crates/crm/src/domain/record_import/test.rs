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

#[test]
fn a_deal_entry_is_found_by_its_pipeline_and_source_link() {
    let (pipeline, other) = (Uuid::now_v7(), Uuid::now_v7());
    let (ours, theirs) = (Uuid::now_v7(), Uuid::now_v7());
    let link = "https://app.hubspot.com/contacts/1/record/0-3/30";
    let fields = vec![(
        SOURCE_LINK_FIELD.to_owned(),
        FieldValue::Links(vec![link.to_owned()]),
    )];
    let entries = [
        (other, theirs, fields.as_slice()),
        (pipeline, ours, fields.as_slice()),
    ];
    assert_eq!(entry_with_link(entries, pipeline, link), Some(ours));
    assert_eq!(
        entry_with_link(
            entries,
            pipeline,
            "https://app.hubspot.com/contacts/1/record/0-3/31"
        ),
        None
    );
}
