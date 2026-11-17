use super::*;
use axum::http::StatusCode;
use axum::response::IntoResponse;

#[test]
fn search_rejects_the_crm_email_filters_with_a_bad_request() {
    for (filters, field) in [
        (
            item_filters::EmailFilters {
                crm_domains: vec!["example.com".into()],
                ..Default::default()
            },
            "crm_domains",
        ),
        (
            item_filters::EmailFilters {
                crm_addresses: vec!["someone@example.com".into()],
                ..Default::default()
            },
            "crm_addresses",
        ),
    ] {
        let error = reject_unsupported_email_filters(&filters).unwrap_err();
        assert!(error.to_string().contains(field));
        assert_eq!(error.into_response().status(), StatusCode::BAD_REQUEST);
    }
}

#[test]
fn search_accepts_email_filters_it_applies() {
    let filters = item_filters::EmailFilters {
        project_ids: vec!["folder".into()],
        ..Default::default()
    };
    assert!(reject_unsupported_email_filters(&filters).is_ok());
}
