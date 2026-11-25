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
fn deal_entries_are_keyed_by_source_link_within_their_pipeline() {
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
    assert_eq!(
        entries_by_link(entries, pipeline),
        HashMap::from([(link.to_owned(), ours)])
    );
}

#[test]
fn a_pipeline_whose_stages_cannot_all_be_options_is_refused_before_it_exists() {
    // The pipeline is created before its stages are set, so a stage the
    // database refuses afterwards would leave a pipeline behind, and the next
    // import would make another. Every stage is checked first.
    let fits = |stages: &[&str]| {
        new_deal_pipeline(
            "Sales",
            &stages
                .iter()
                .map(|stage| (*stage).to_owned())
                .collect::<Vec<_>>(),
        )
        .map(|pipeline| pipeline.stages)
    };
    assert_eq!(fits(&["Open", "Won"]).unwrap(), ["Open", "Won"]);
    assert!(fits(&["Open", &"x".repeat(201)]).is_err());
    assert!(fits(&["Open", " "]).is_err());
    assert!(fits(&["Won", "won"]).is_err());
}
