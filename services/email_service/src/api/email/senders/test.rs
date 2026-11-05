use super::*;

#[test]
fn parses_lowercase_host_names_in_order() {
    let parsed = parse_domains(vec!["slack.com".to_owned(), "linear.app".to_owned()]).unwrap();

    assert_eq!(
        parsed.iter().map(SenderDomain::as_str).collect::<Vec<_>>(),
        ["slack.com", "linear.app"]
    );
}

#[test]
fn one_invalid_domain_rejects_the_request_with_400() {
    let error = parse_domains(vec!["slack.com".to_owned(), "Linear.App".to_owned()])
        .map_err(SenderDomainCountsApiError::from)
        .unwrap_err();

    assert_eq!(error.into_response().status(), StatusCode::BAD_REQUEST);
}

#[test]
fn a_domain_count_outside_the_limit_is_a_400() {
    let error = SenderDomainCountsApiError::from(SenderDomainCountError::DomainCount);

    assert_eq!(error.into_response().status(), StatusCode::BAD_REQUEST);
}
